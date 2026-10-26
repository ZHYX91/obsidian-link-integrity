import type {
  CachedMetadata,
  MetadataCache,
  Vault,
} from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { ObsidianLinkIndexPort } from "../../src/adapters/obsidian";
import { occurrenceIdMatches } from "../../src/core/occurrence-identity";
import { createFileRecord, LinkIndex } from "../../src/core";
import { WorkScheduler } from "../../src/scheduling/work-scheduler";
import { AtomicLinkIndexStore, FullRebuildController, IncrementalIndexController } from "../../src/features/index";
import { queryBrokenLinks, queryIsolatedFiles } from "../../src/features/queries";

interface FakeFile {
  readonly path: string;
  readonly extension: string;
  readonly stat: { readonly mtime: number };
}

describe("ObsidianLinkIndexPort", () => {
  it.each(["fallback", "cached", "canvas"])("updates container-relative code diagnostics, graph and isolation via %s", async (mode) => {
    const sourceFile = fakeFile(mode === "canvas" ? "Board.canvas" : "Source.md");
    const target = fakeFile("Target.md");
    const files = [sourceFile, target];
    const content: Record<string, string> = {};
    const caches = new Map<string, CachedMetadata>();
    const { port } = createPort(files, { content, caches, destinations: new Map([["Target", target]]) });
    const store = new AtomicLinkIndexStore();
    const incremental = new IncrementalIndexController(port, store);
    const cases: readonly [string, boolean][] = [
      ["[[Target]] [[Missing]]", true],
      [">     [[Target]] [[Missing]]", false],
      ["- item\n\n    😀 [[Target]] [[Missing]]", true],
      ["- item\n\n      [[Target]] [[Missing]]", false],
      ["> paragraph\n>     [[Target]] [[Missing]]", true],
      ["> >     [[Target]] [[Missing]]", false],
      ["- item\n  - nested\n\n      [[Target]] [[Missing]]", true],
      ["10. item\n\n        [[Target]] [[Missing]]", false],
      ["-   \n\n      [[Target]] [[Missing]]", false],
      ["> * * *\n>     [[Target]] [[Missing]]", false],
      ["-\titem\n\n\t  [[Target]] [[Missing]]", true],
      ["-\titem\n\n\t\t[[Target]] [[Missing]]", false],
      ["- item\nlazy continuation\n\n    [[Target]] [[Missing]]", true],
      [">     <!--\n\n[[Target]] [[Missing]]", true],
      [">     <pre>\n\n[[Target]] [[Missing]]", true],
      ["> ~~~\n> [[Target]] [[Missing]]\n> ~~~", false],
      ["<!--\n~~~\n[[Target]] [[Missing]]\n-->", false],
      ["<pre>\n~~~\n[[Target]] [[Missing]]\n</pre>", false],
      [">    [[Target]] [[Missing]]", true],
    ];
    incremental.start();
    try {
      for (const newline of ["\n", "\r\n"]) {
        for (const [example, visible] of cases) {
          const text = `😀${newline}${newline}${example.replaceAll("\n", newline)}`;
          content[sourceFile.path] = mode === "canvas"
            ? JSON.stringify({ nodes: [{ id: "container-node", type: "text", text }] }) : text;
          if (mode === "cached") caches.set(sourceFile.path, { links: [
            positioned(text, "Target", "[[Target]]"), positioned(text, "Missing", "[[Missing]]"),
          ] });
          if (store.current.files.length === 0) await new FullRebuildController(port, store).rebuild();
          else {
            incremental.enqueue({ type: "modify", path: sourceFile.path });
            await incremental.whenIdle();
          }
          const clean = (await new FullRebuildController(port, new AtomicLinkIndexStore()).rebuild()).index;
          expect(store.current.toCanonicalState(), example).toEqual(clean.toCanonicalState());
          const occurrences = store.current.getSourceSnapshot(sourceFile.path)!.occurrences;
          expect(occurrences.map(({ linkpath }) => linkpath), example).toEqual(visible ? ["Target", "Missing"] : []);
          if (visible) {
            const start = positioned(text, "Target", "[[Target]]").position.start;
            expect(occurrences[0]?.position).toMatchObject({ line: start.line, column: start.col });
          }
          expect(queryBrokenLinks(store.current).map(({ targetText }) => targetText), example)
            .toEqual(visible ? ["Missing"] : []);
          expect(store.current.getOutgoingContributionCount(sourceFile.path), example).toBe(visible ? 1 : 0);
          expect(store.current.getIncomingContributionCount(target.path), example).toBe(visible ? 1 : 0);
          expect(queryIsolatedFiles(store.current).map(({ path }) => path).sort(), example)
            .toEqual(visible ? [] : files.map(({ path }) => path).sort());
        }
      }
    } finally {
      incremental.stop();
    }
  });

  it.each(["Source.md", "Board.canvas"])("removes non-content links from graph queries and incremental rebuilds in %s", async (path) => {
    const sourceFile = fakeFile(path);
    const target = fakeFile("Target.md");
    const files = [sourceFile, target];
    const encode = (text: string) => sourceFile.extension === "canvas"
      ? JSON.stringify({ nodes: [{ id: "node-1", type: "text", text }] }) : text;
    const content = { [path]: encode("[[Target]] [[Missing]]") };
    const { port } = createPort(files, {
      content, caches: new Map(), destinations: new Map([["Target", target]]),
    });
    const store = new AtomicLinkIndexStore();
    await new FullRebuildController(port, store).rebuild();
    expect(queryBrokenLinks(store.current)).toHaveLength(1);
    expect(store.current.getOutgoingContributionCount(path)).toBe(1);
    const incremental = new IncrementalIndexController(port, store);
    incremental.start();
    try {
      for (const protectedText of [
        "<!-- [[Target]] [[Missing]] -->",
        "<pre>[[Target]] [[Missing]]</pre>",
        "> ~~~md\r\n> [[Target]] [[Missing]]\r\n> ~~~",
        "> - ```md\r\n>   [[Target]] [[Missing]]\r\n>   ```",
        "<!-- unclosed [[Target]] [[Missing]]",
        "<pre>unclosed [[Target]] [[Missing]]",
      ]) {
        content[path] = encode(`😀\r\n${protectedText}`);
        incremental.enqueue({ type: "modify", path });
        await incremental.whenIdle();
        const clean = (await new FullRebuildController(port, new AtomicLinkIndexStore()).rebuild()).index;
        expect(store.current.toCanonicalState()).toEqual(clean.toCanonicalState());
        expect(store.current.getSourceSnapshot(path)?.occurrences).toEqual([]);
        expect(queryBrokenLinks(store.current)).toEqual([]);
        expect(store.current.getOutgoingEdges(path)).toEqual([]);
        expect(queryIsolatedFiles(store.current).map(({ path: isolatedPath }) => isolatedPath).sort())
          .toEqual(files.map(({ path: filePath }) => filePath).sort());
      }
      content[path] = encode("😀 [[Target]] [[Missing]]");
      incremental.enqueue({ type: "modify", path });
      await incremental.whenIdle();
      expect(store.current.getSourceSnapshot(path)?.occurrences[0]?.position?.column).toBe(3);
      expect(queryBrokenLinks(store.current)).toHaveLength(1);
      expect(store.current.getOutgoingContributionCount(path)).toBe(1);
      expect(queryIsolatedFiles(store.current)).toEqual([]);
    } finally {
      incremental.stop();
    }
  });
  it.each(["\n", "\r\n", "\r"])("filters cached comment links and embeds like fallback with %j line endings", async (newline) => {
    const file = fakeFile("Source.md");
    const source = ["😀 [[Real]]", "%% [[Protected ghost]] ![[Ghost.png]] %%", "[[Other]]"].join(newline);
    const cache = {
      links: [positioned(source, "Real", "[[Real]]"), positioned(source, "Protected ghost", "[[Protected ghost]]"),
        positioned(source, "Other", "[[Other]]")],
      embeds: [positioned(source, "Ghost.png", "![[Ghost.png]]")],
    };
    const options = { content: { [file.path]: source }, destinations: new Map() };
    const cached = createPort([file], { ...options, caches: new Map([[file.path, cache]]) });
    const fallback = createPort([file], { ...options, caches: new Map() });
    const actual = await cached.port.buildSourceSnapshot(file.path);
    const expected = await fallback.port.buildSourceSnapshot(file.path);
    expect(actual).toEqual(expected);
    expect(actual?.occurrences.map(({ linkpath }) => linkpath)).toEqual(["Real", "Other"]);
    expect(cached.cachedRead).toHaveBeenCalledOnce();
    expect(fallback.cachedRead).toHaveBeenCalledOnce();
  });

  it("keeps a positioned cache link between escaped backticks, just like fallback parsing", async () => {
    const file = fakeFile("Source.md");
    const source = "\\` [[Missing]] \\`";
    const options = { content: { [file.path]: source }, destinations: new Map() };
    const cached = createPort([file], {
      ...options,
      caches: new Map([[file.path, { links: [positioned(source, "Missing", "[[Missing]]")] }]]),
    });
    const fallback = createPort([file], { ...options, caches: new Map() });
    const actual = await cached.port.buildSourceSnapshot(file.path);
    const expected = await fallback.port.buildSourceSnapshot(file.path);
    expect(actual?.occurrences.map(({ linkpath }) => linkpath)).toEqual(["Missing"]);
    expect(actual).toEqual(expected);
  });

  it.each([
    "%% before\n[[Ghost]]\nafter %%",
    "`[[Ghost]]`",
    "```md\n[[Ghost]]\n```",
    "~~~\n[[Ghost]]",
    "\n    [[Ghost]]",
    "---\nrelated: '[[Property]]' # [[Ghost]]\n---",
    "<!-- [[Ghost]] -->",
    "<pre>[[Ghost]]</pre>",
    "> ~~~\n> [[Ghost]]\n> ~~~",
  ])("shares the existing non-content boundary for positioned cache entries: %s", async (protectedText) => {
    const file = fakeFile("Source.md");
    const source = `${protectedText}\n`;
    const test = createPort([file], {
      content: { [file.path]: source }, destinations: new Map(),
      caches: new Map([[file.path, { links: [positioned(source, "Ghost", "[[Ghost]]")] }]]),
    });
    expect((await test.port.buildSourceSnapshot(file.path))?.occurrences).toEqual([]);
  });

  it("retains native reference forms, formatted labels and frontmatter while preserving graph edges", async () => {
    const file = fakeFile("Source.md");
    const target = fakeFile("Target.md");
    const source = ["---", "related: '[[Target]]'", "---", "[label][ref] [ref][] [ref]",
      "[a `code` label](Target)", "![[Target]]", "%% [[Ghost]] %%", "[ref]: Target"].join("\n");
    const native = ["[label][ref]", "[ref][]", "[ref]", "[a `code` label](Target)"];
    const test = createPort([file, target], {
      content: { [file.path]: source }, destinations: new Map([["Target", target]]),
      caches: new Map([[file.path, {
        links: [...native.map((raw) => positioned(source, "Target", raw,
          raw === "[ref]" ? source.indexOf("[ref][]") + "[ref][] ".length : 0)),
        positioned(source, "Ghost", "[[Ghost]]")],
        embeds: [positioned(source, "Target", "![[Target]]")],
        frontmatterLinks: [{ link: "Target", original: "[[Target]]", key: "related" }],
      }], [target.path, {}]]),
    });
    const snapshot = await test.port.buildSourceSnapshot(file.path);
    expect(snapshot?.occurrences.map(({ raw }) => raw)).toEqual([...native, "![[Target]]", "[[Target]]"]);
    expect(snapshot?.occurrences.at(-1)).toMatchObject({ kind: "frontmatter", position: { property: "related" } });
    const index = new LinkIndex([createFileRecord(file.path), createFileRecord(target.path)]);
    index.replaceSourceSnapshot(file.path, snapshot!);
    expect(index.getOutgoingNeighborCount(file.path)).toBe(1);
    expect(index.getIncomingContributionCount(target.path)).toBe(6);
    expect(snapshot?.occurrences.every(({ fileStatus }) => fileStatus === "resolved")).toBe(true);
  });

  it("does not infer a mask from inaccurate or stale cache coordinates", async () => {
    const file = fakeFile("Source.md");
    const source = "%% [[Ghost]] %%\n[[Real]]";
    const ghost = positioned(source, "Ghost", "[[Ghost]]");
    const test = createPort([file], {
      content: { [file.path]: source }, destinations: new Map(),
      caches: new Map([[file.path, { links: [
        { ...ghost, original: "[[Stale]]" },
        { ...ghost, position: { ...ghost.position, start: { ...ghost.position.start, col: 100 } } },
        { ...ghost, position: { ...ghost.position, start: { ...ghost.position.start, line: -1 } } },
      ] }]]),
    });
    expect((await test.port.buildSourceSnapshot(file.path))?.occurrences).toHaveLength(3);
  });

  it("keeps frontmatter-only caches independent of body reads", async () => {
    const file = fakeFile("Source.md");
    const test = createPort([file], {
      content: {}, destinations: new Map(),
      caches: new Map([[file.path, { frontmatterLinks: [{ link: "Target", original: "[[Target]]", key: "related" }] }]]),
    });
    expect((await test.port.buildSourceSnapshot(file.path))?.occurrences).toHaveLength(1);
    expect(test.cachedRead).not.toHaveBeenCalled();
  });

  it("omits unsupported decoded YAML coordinates without losing repeated occurrences", async () => {
    const base = fakeFile("Escaped.base");
    const { port } = createPort([base], {
      content: { [base.path]: `formulas:\n  target: ${JSON.stringify('if(true, link("Missing"), link("Missing"))')}\n` },
      caches: new Map(),
      destinations: new Map(),
    });
    const snapshot = await port.buildSourceSnapshot(base.path);
    expect(snapshot?.occurrences).toHaveLength(2);
    expect(snapshot?.occurrences.map(({ position }) => position)).toEqual([null, null]);
    expect(new Set(snapshot?.occurrences.map(({ id }) => id)).size).toBe(2);
  });
  it("fingerprints target structure while ignoring link positions and ordinary edits", async () => {
    const source = fakeFile("Source.md");
    const caches = new Map<string, CachedMetadata>();
    const { port } = createPort([source], { content: {}, caches, destinations: new Map() });
    expect((await port.getFileRecord(source.path))?.targetFingerprint).toBeNull();
    const position = reference("", "", 1).position;
    caches.set(source.path, { headings: [{ heading: "Title", level: 1, position }] });
    const first = (await port.getFileRecord(source.path))?.targetFingerprint;
    caches.set(source.path, {
      headings: [{ heading: "Title", level: 1, position: reference("", "", 12).position }],
      links: [reference("Missing", "[[Missing]]", 20)],
    });
    expect((await port.getFileRecord(source.path))?.targetFingerprint).toBe(first);
    caches.set(source.path, { headings: [{ heading: "Renamed", level: 1, position }] });
    expect((await port.getFileRecord(source.path))?.targetFingerprint).not.toBe(first);
    caches.set(source.path, { blocks: { block: { id: "block", position } } });
    const block = (await port.getFileRecord(source.path))?.targetFingerprint;
    caches.set(source.path, { footnotes: [{ id: "footnote", position }] });
    expect((await port.getFileRecord(source.path))?.targetFingerprint).not.toBe(block);
  });

  it("yields inside a dense cached source and preserves exact occurrence identities and positions", async () => {
    const source = fakeFile("Dense.md");
    const caches = new Map([[source.path, {
      links: Array.from({ length: 400 }, (_, i) => reference(`Missing-${i}`, `[[Missing-${i}]]`, i)),
    }]]);
    const { port } = createPort([source], { content: {}, caches, destinations: new Map() });
    const expected = await port.buildSourceSnapshot(source.path);
    let yields = 0;
    const actual = await port.buildSourceSnapshot(source.path, new WorkScheduler({
      yieldEvery: 16, now: () => 0, yieldControl: async () => { yields += 1; },
    }));
    expect(actual).toEqual(expected);
    expect(yields).toBeGreaterThan(10);
  });
  it("reads one current FileRecord by path without enumerating the Vault", async () => {
    const source = fakeFile("Source.md");
    const { port } = createPort([source], {
      content: {},
      caches: new Map(),
      destinations: new Map(),
    });

    await expect(port.getFileRecord(source.path)).resolves.toMatchObject({
      path: "Source.md",
      extension: "md",
      modifiedAt: 123,
    });
    await expect(port.getFileRecord("Missing.md")).resolves.toBeNull();
  });

  it("uses Metadata Cache occurrences and keeps file/subpath status separate", async () => {
    const source = fakeFile("Source.md");
    const target = fakeFile("Target.md");
    const files = [source, target];
    const cache: CachedMetadata = {
      links: [
        reference("Target#Missing heading", "[[Target#Missing heading]]", 1),
        reference("Source", "[[Source]]", 2),
      ],
      embeds: [reference("Missing.png", "![[Missing.png]]", 3)],
      frontmatterLinks: [{
        link: "Target",
        original: "[[Target]]",
        key: "related",
      }],
    };
    const { port } = createPort(files, {
      content: {},
      caches: new Map([[source.path, cache], [target.path, {}]]),
      destinations: new Map([["Target", target], ["Source", source]]),
    });

    const snapshot = await port.buildSourceSnapshot(source.path);

    expect(snapshot?.occurrences).toHaveLength(4);
    expect(snapshot?.occurrences[0]).toMatchObject({
      targetPath: "Target.md",
      fileStatus: "resolved",
      subpathStatus: "missing-heading",
    });
    expect(snapshot?.occurrences[1]).toMatchObject({
      targetPath: "Source.md",
      fileStatus: "resolved",
      subpathStatus: "none",
    });
    expect(snapshot?.occurrences[2]).toMatchObject({
      linkpath: "Missing.png",
      fileStatus: "missing",
    });
    expect(snapshot?.occurrences[3]?.position).toMatchObject({ property: "related" });
  });

  it("reads Canvas file, background, and Markdown text references", async () => {
    const canvas = fakeFile("Board.canvas");
    const image = fakeFile("image.png");
    const target = fakeFile("Target.md");
    const source = JSON.stringify({
      nodes: [
        { id: "file-1", type: "file", file: "image.png" },
        { id: "group-1", type: "group", background: "Target.md" },
        { id: "text-1", type: "text", text: "[[Missing]] [site](https://example.com)" },
      ],
    });
    const { port } = createPort([canvas, image, target], {
      content: { [canvas.path]: source },
      caches: new Map([[target.path, {}]]),
      destinations: new Map([["image.png", image], ["Target.md", target]]),
    });

    const snapshot = await port.buildSourceSnapshot(canvas.path);

    expect(snapshot?.occurrences.map(({ kind }) => kind)).toEqual([
      "canvas-file",
      "canvas-background",
      "canvas-text",
      "canvas-text",
    ]);
    expect(snapshot?.occurrences[2]).toMatchObject({ fileStatus: "missing" });
    expect(snapshot?.occurrences[3]).toMatchObject({
      destinationKind: "external",
      targetPath: null,
    });
    expect(snapshot?.occurrences[0]?.position?.canvasNodeId).toBe("file-1");
  });

  it.each([
    ["an empty document", "{}"],
    ["an edges-only document", JSON.stringify({ edges: [] })],
  ])("accepts %s when Canvas nodes are omitted", async (_name, source) => {
    const canvas = fakeFile("Empty.canvas");
    const { port } = createPort([canvas], {
      content: { [canvas.path]: source },
      caches: new Map(),
      destinations: new Map(),
    });

    await expect(port.buildSourceSnapshot(canvas.path)).resolves.toEqual({
      sourcePath: canvas.path,
      occurrences: [],
    });
  });

  it("fails closed when Canvas nodes are present but not an array", async () => {
    const canvas = fakeFile("Broken.canvas");
    const { port } = createPort([canvas], {
      content: { [canvas.path]: JSON.stringify({ nodes: {} }) },
      caches: new Map(),
      destinations: new Map(),
    });

    await expect(port.buildSourceSnapshot(canvas.path)).rejects.toThrow(
      "Cannot parse Canvas source: Broken.canvas",
    );
  });

  it("fails closed when Canvas JSON cannot be parsed", async () => {
    const canvas = fakeFile("Broken.canvas");
    const { port } = createPort([canvas], {
      content: { [canvas.path]: "{ not valid JSON" },
      caches: new Map(),
      destinations: new Map(),
    });

    await expect(port.buildSourceSnapshot(canvas.path)).rejects.toThrow(
      "Cannot parse Canvas source: Broken.canvas",
    );
  });

  it("indexes only explicit Bases link values", async () => {
    const base = fakeFile("Tasks.base");
    const target = fakeFile("Target.md");
    const source = [
      "filters:",
      "  - 'file.folder == [[Target]]'",
      "  - 'file.hasTag(\"open\")'",
      "formulas:",
      "  related: 'link(\"Missing.md\")'",
      "properties:",
      "  displayOnly:",
      "    displayName: \"link('Not-a-reference.md')\"",
    ].join("\n");
    const { port } = createPort([base, target], {
      content: { [base.path]: source },
      caches: new Map([[target.path, {}]]),
      destinations: new Map([["Target", target]]),
    });

    const snapshot = await port.buildSourceSnapshot(base.path);

    expect(snapshot?.occurrences.map(({ linkpath, fileStatus }) => ({ linkpath, fileStatus })))
      .toEqual([
        { linkpath: "Target", fileStatus: "resolved" },
        { linkpath: "Missing.md", fileStatus: "missing" },
      ]);
  });

  it("maps fallback parser offsets through one shared multiline index", async () => {
    const sourceFile = fakeFile("Source.md");
    const source = [
      "😀 preface",
      "[[First]]",
      "plain text",
      "before [[Second]] after",
    ].join("\n");
    const { port } = createPort([sourceFile], {
      content: { [sourceFile.path]: source },
      caches: new Map(),
      destinations: new Map(),
    });

    const snapshot = await port.buildSourceSnapshot(sourceFile.path);

    expect(snapshot?.occurrences.map(({ position }) => position)).toEqual([
      expect.objectContaining({ line: 1, column: 0, endLine: 1, endColumn: 9 }),
      expect.objectContaining({ line: 3, column: 7, endLine: 3, endColumn: 17 }),
    ]);
  });

  it("keeps fallback diagnostics out of code blocks and frontmatter comments", async () => {
    const sourceFile = fakeFile("Source.md");
    const source = [
      "---",
      "related: '[[Real property link]]' # [[Fake YAML comment]]",
      "---",
      "",
      "    [[Fake code link]]",
      "",
      "[[Real body link]]",
    ].join("\n");
    const { port } = createPort([sourceFile], {
      content: { [sourceFile.path]: source },
      caches: new Map(),
      destinations: new Map(),
    });

    const snapshot = await port.buildSourceSnapshot(sourceFile.path);

    expect(snapshot?.occurrences.map(({ linkpath }) => linkpath)).toEqual([
      "Real property link",
      "Real body link",
    ]);
  });

  it("keeps a persisted occurrence identity across unrelated content inserted before it", async () => {
    const sourceFile = fakeFile("Source.md");
    const before = createPort([sourceFile], {
      content: { [sourceFile.path]: "preface\n[[Missing]]\n" },
      caches: new Map(),
      destinations: new Map(),
    });
    const after = createPort([sourceFile], {
      content: { [sourceFile.path]: "[[Unrelated]]\npreface\n[[Missing]]\n" },
      caches: new Map(),
      destinations: new Map(),
    });

    const savedId = (await before.port.buildSourceSnapshot(sourceFile.path))?.occurrences
      .find(({ linkpath }) => linkpath === "Missing")?.id;
    const currentId = (await after.port.buildSourceSnapshot(sourceFile.path))?.occurrences
      .find(({ linkpath }) => linkpath === "Missing")?.id;
    expect(savedId).toBeDefined();
    expect(currentId).toBeDefined();
    expect(savedId).not.toBe(currentId);
    expect(occurrenceIdMatches(savedId ?? "", currentId)).toBe(true);
  });

  it("fails an old identity closed when an indistinguishable duplicate is inserted", async () => {
    const sourceFile = fakeFile("Source.md");
    const before = createPort([sourceFile], {
      content: { [sourceFile.path]: "preface\n[[Missing]]\n" },
      caches: new Map(),
      destinations: new Map(),
    });
    const after = createPort([sourceFile], {
      content: { [sourceFile.path]: "[[Missing]]\npreface\n[[Missing]]\n" },
      caches: new Map(),
      destinations: new Map(),
    });

    const savedId = (await before.port.buildSourceSnapshot(sourceFile.path))?.occurrences[0]?.id ?? "";
    const currentIds = (await after.port.buildSourceSnapshot(sourceFile.path))?.occurrences
      .map(({ id }) => id) ?? [];
    expect(currentIds).toHaveLength(2);
    expect(currentIds.some((id) => occurrenceIdMatches(savedId, id))).toBe(false);
  });
});

function createPort(
  inputFiles: readonly FakeFile[],
  options: {
    readonly content: Readonly<Record<string, string>>;
    readonly caches: ReadonlyMap<string, CachedMetadata>;
    readonly destinations: ReadonlyMap<string, FakeFile>;
  },
): { readonly port: ObsidianLinkIndexPort; readonly cachedRead: ReturnType<typeof vi.fn> } {
  const files = new Map(inputFiles.map((file) => [file.path, file]));
  const cachedRead = vi.fn((file: FakeFile) => Promise.resolve(options.content[file.path] ?? ""));
  const vault = {
    getFiles: () => [...files.values()],
    getFileByPath: (path: string) => files.get(path) ?? null,
    cachedRead,
  } as unknown as Vault;
  const metadataCache = {
    getFileCache: (file: FakeFile) => options.caches.get(file.path) ?? null,
    getFirstLinkpathDest: (linkpath: string) => options.destinations.get(linkpath) ?? null,
  } as unknown as MetadataCache;
  return { port: new ObsidianLinkIndexPort(vault, metadataCache), cachedRead };
}

function positioned(source: string, link: string, original: string, from = 0) {
  const offset = source.indexOf(original, from);
  if (offset < 0) throw new Error(`Missing test reference: ${original}`);
  const point = (index: number) => {
    const prefix = source.slice(0, index).split(/\r\n|\r|\n/u);
    return { line: prefix.length - 1, col: prefix.at(-1)!.length, offset: index };
  };
  return { link, original, position: { start: point(offset), end: point(offset + original.length) } };
}

function fakeFile(path: string): FakeFile {
  return {
    path,
    extension: path.split(".").at(-1) ?? "",
    stat: { mtime: 123 },
  };
}

function reference(link: string, original: string, line: number) {
  return {
    link,
    original,
    position: {
      start: { line, col: 0, offset: line * 10 },
      end: { line, col: original.length, offset: line * 10 + original.length },
    },
  };
}
