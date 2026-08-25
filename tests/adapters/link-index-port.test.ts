import type {
  CachedMetadata,
  MetadataCache,
  Vault,
} from "obsidian";
import { describe, expect, it } from "vitest";

import { ObsidianLinkIndexPort } from "../../src/adapters/obsidian";
import { occurrenceIdMatches } from "../../src/core/occurrence-identity";

interface FakeFile {
  readonly path: string;
  readonly extension: string;
  readonly stat: { readonly mtime: number };
}

describe("ObsidianLinkIndexPort", () => {
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
      "properties:",
      "  related: 'link(\"Missing.md\")'",
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
): { readonly port: ObsidianLinkIndexPort } {
  const files = new Map(inputFiles.map((file) => [file.path, file]));
  const vault = {
    getFiles: () => [...files.values()],
    getFileByPath: (path: string) => files.get(path) ?? null,
    cachedRead: (file: FakeFile) => Promise.resolve(options.content[file.path] ?? ""),
  } as unknown as Vault;
  const metadataCache = {
    getFileCache: (file: FakeFile) => options.caches.get(file.path) ?? null,
    getFirstLinkpathDest: (linkpath: string) => options.destinations.get(linkpath) ?? null,
  } as unknown as MetadataCache;
  return { port: new ObsidianLinkIndexPort(vault, metadataCache) };
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
