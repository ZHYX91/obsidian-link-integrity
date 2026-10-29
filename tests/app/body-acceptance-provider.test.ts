import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createFileRecord, LinkIndex, makeOccurrenceLookupKey, type LinkOccurrence } from "../../src/core";
import { extractMarkdownExplicitReferences } from "../../src/adapters/obsidian/explicit-link-parser";
import { createIsolatedFileProjection, queryBrokenLinks } from "../../src/features/queries";

const prefix = "Body Hints Acceptance";
const inlinePrefix = "Inline Metadata Acceptance";
function projection(files: Map<string, string>, group = prefix) {
  const index = new LinkIndex([...files.keys()].map((path) => createFileRecord(path)));
  for (const [path, text] of files) {
    const occurrences: LinkOccurrence[] = extractMarkdownExplicitReferences(text).map((reference, ordinal) => {
      const marker = reference.linktext.indexOf("#"); const linkpath = marker < 0 ? reference.linktext : reference.linktext.slice(0, marker);
      const subpath = marker < 0 ? null : reference.linktext.slice(marker);
      const sibling = `${path.slice(0, path.lastIndexOf("/") + 1)}${linkpath}.md`;
      const targetPath = files.has(sibling) ? sibling : `${linkpath}.md`; const target = files.get(targetPath);
      const missingSubpath = subpath !== null && target !== undefined && !target.includes(subpath.startsWith("#^") ? subpath.slice(1) : `# ${subpath.slice(1)}`);
      return { id: `${path}:${ordinal}`, sourcePath: path, raw: reference.raw, linkpath, subpath, lookupKey: makeOccurrenceLookupKey(linkpath, path),
        kind: reference.embedded ? "markdown-embed" : "markdown-link", destinationKind: "internal", position: null,
        targetPath: target === undefined ? null : targetPath, fileStatus: target === undefined ? "missing" : "resolved",
        subpathStatus: missingSubpath ? subpath!.startsWith("#^") ? "missing-block" : "missing-heading" : subpath === null ? "none" : "ok" };
    });
    index.replaceSourceSnapshot(path, { sourcePath: path, occurrences });
  }
  return { broken: queryBrokenLinks(index).filter((result) => result.sourcePath.startsWith(group)).length,
    isolated: createIsolatedFileProjection(index).items.filter((result) => result.path.startsWith(group)).length };
}

interface FixtureProvider {
  app: unknown;
  onload: () => void;
  createFixtures: () => Promise<void>;
  createContextRegressionFixtures: () => Promise<void>;
  createResolutionRegressionFixtures: () => Promise<void>;
  prepareBlockContextFixtures: (mode: string) => Promise<void>;
  prepareInlineMetadataFixtures: (mode: string) => Promise<void>;
  repair: () => Promise<void>;
  restore: () => Promise<void>;
}

async function loadProvider() {
  const source = await readFile("acceptance/fixtures/.obsidian/plugins/link-integrity-acceptance-provider/main.js", "utf8");
  const files = new Map([["Standalone.md", "baseline standalone"], ["Broken-only.md", "baseline broken"]]); const folders = new Set<string>();
  const module = { exports: null as unknown as new() => FixtureProvider };
  const commands: { id: string; name: string; callback: () => Promise<void> }[] = [];
  const mutations: string[] = [];
  const opened: string[] = [];
  const notices: string[] = [];
  runInNewContext(source, { module, require: () => ({ Plugin: class { addCommand(command: typeof commands[number]) { commands.push(command); } },
    Notice: class { constructor(message: string) { notices.push(message); } } }) }, { timeout: 1_000 });
  const provider = new module.exports();
  provider.app = { vault: {
    getFileByPath: (path: string) => files.has(path) ? { path } : null,
    getAbstractFileByPath: (path: string) => files.has(path) ? { path } : folders.has(path) ? { path,
      children: [...files.keys(), ...folders].filter((child) => child.slice(0, child.lastIndexOf("/")) === path).map((child) => ({ path: child })) } : null,
    cachedRead: async (file: { path: string }) => files.get(file.path), createFolder: async (path: string) => { mutations.push(path); folders.add(path); },
    create: async (path: string, text: string) => { mutations.push(path); files.set(path, text); },
    modify: async (file: { path: string }, text: string) => { mutations.push(file.path); files.set(file.path, text); },
    delete: async (file: { path: string }) => { mutations.push(file.path); files.delete(file.path); },
  }, workspace: { getLeaf: () => ({ openFile: async (file: { path: string }) => { opened.push(file.path); } }) } };
  return { provider, files, folders, commands, mutations, opened, notices };
}

describe("self-contained explicit body fixture provider", () => {
  it("prepares inert resolution inputs once without changing existing fixture bytes", async () => {
    const { provider, files, mutations, commands, notices } = await loadProvider();
    const baseline = new Map(files);
    provider.onload();
    await commands.find(({ id }) => id === "create-resolution-regression-fixtures")!.callback();
    const root = "Resolution Semantics Acceptance";
    const text = files.get(`${root}/Destinations/Source.md`)!;
    expect(text.startsWith("😀\n")).toBe(true);
    expect(extractMarkdownExplicitReferences(text).map(({ linktext }) => linktext)).toEqual([
      "A&B.md", "foo!.md", "A&amp;B.md", "Escaped&amp;B.md", "Wiki&amp;Name", "Percent%26Name.md", "https://example.com", "Missing&Value.md",
    ]);
    expect(JSON.parse(files.get(`${root}/Destinations/Board.canvas`)!) as unknown).toEqual({ nodes: [{ id: "destinations", type: "text", text }] });
    expect(files.get(`${root}/Parent/Source.md`)).toBe("[[Subdir/Suffix Target]]\n");
    expect([...files.keys()].some((path) => path.includes("Suffix Target.md") || path.includes("Missing&Value.md"))).toBe(false);
    expect(new Map([...files].filter(([path]) => !path.startsWith(`${root}/`)))).toEqual(baseline);
    expect(mutations.every((path) => path === root || path.startsWith(`${root}/`))).toBe(true);
    expect(notices.at(-1)).toContain("Observe native targets");
    const before = new Map(files); const writes = mutations.length;
    await expect(provider.createResolutionRegressionFixtures()).rejects.toThrow("already exist");
    expect(files).toEqual(before); expect(mutations).toHaveLength(writes);
    files.delete("Standalone.md");
    await expect(provider.createResolutionRegressionFixtures()).rejects.toThrow("disposable acceptance fixture");
    expect(mutations).toHaveLength(writes);
  });

  it("preserves base bytes and verifies prepare/repair/restore transitions without filesystem writes", async () => {
    const { provider, files, commands } = await loadProvider();
    provider.onload(); expect(commands.map(({ id }) => id)).toEqual(["create-body-hint-fixtures", "create-context-regression-fixtures", "create-resolution-regression-fixtures", "repair-body-hint-fixtures", "restore-body-hint-fixtures",
      "prepare-block-quote-code", "prepare-block-list-prose", "prepare-block-definition-continuation", "prepare-block-definition-non1-code", "prepare-block-definition-title",
      "prepare-inline-quoted", "prepare-inline-parenthesized", "prepare-inline-label-wiki", "prepare-inline-invalid-outer",
      "prepare-inline-atx-boundary", "prepare-inline-nested-image", "prepare-inline-reference-inner", "prepare-inline-quote-continuation", "prepare-inline-hint-metadata"]);
    await provider.createFixtures(); expect(projection(files)).toEqual({ broken: 5, isolated: 1 });
    await expect(provider.createFixtures()).rejects.toThrow("already exist");
    await provider.repair(); expect(projection(files)).toEqual({ broken: 0, isolated: 1 });
    await provider.restore(); expect(projection(files)).toEqual({ broken: 5, isolated: 1 });
    await provider.createContextRegressionFixtures();
    const context = "Context Regression Acceptance";
    expect(extractMarkdownExplicitReferences(files.get(`${context}/Escaped.md`)!).map(({ linktext }) => linktext))
      .toEqual(["Escaped%20Missing.md", "Visible missing"]);
    expect(extractMarkdownExplicitReferences(files.get(`${context}/Percent.md`)!).map(({ linktext }) => linktext))
      .toEqual(["100% Missing", "Missing%ZZ", "Encoded%25%20Missing.md", `${context}/Target%#100%`, `${context}/Target%`]);
    expect(files.get(`${context}/A/Source.md`)).toBe(files.get(`${context}/B/Source.md`));
    expect(files.has(`${context}/A/Sibling.md`)).toBe(true); expect(files.has(`${context}/B/Sibling.md`)).toBe(false);
    const originalContext = new Map(files);
    await expect(provider.createContextRegressionFixtures()).rejects.toThrow("already exist");
    expect(files).toEqual(originalContext);
    for (const [mode, count] of [["quote-code", 0], ["list-prose", 2], ["definition-continuation", 2], ["definition-non1-code", 0], ["definition-title", 0]] as const) {
      await provider.prepareBlockContextFixtures(mode);
      expect(extractMarkdownExplicitReferences(files.get("Block Context Acceptance/C5 Source.md")!)).toHaveLength(count);
    }
    expect(new Map([...files].filter(([path]) => !path.startsWith("Block Context Acceptance/")))).toEqual(originalContext);
    const originalBlock = new Map(files);
    await expect(provider.prepareBlockContextFixtures("invalid")).rejects.toThrow("Unknown block-context");
    expect(files).toEqual(originalBlock);
    files.set("Block Context Acceptance/C5 Source.md", "user modification");
    await expect(provider.prepareBlockContextFixtures("list-prose")).rejects.toThrow("Unexpected block-context fixture bytes");
    expect(files.get("Block Context Acceptance/C5 Source.md")).toBe("user modification");
    files.set("Block Context Acceptance/C5 Source.md", originalBlock.get("Block Context Acceptance/C5 Source.md")!);
    files.set("Block Context Acceptance/C5 Target.md", "changed target");
    await expect(provider.prepareBlockContextFixtures("list-prose")).rejects.toThrow("Unexpected block-context fixture bytes");
    expect(files.get("Standalone.md")).toBe("baseline standalone"); expect(files.get("Broken-only.md")).toBe("baseline broken");
    files.set(`${prefix}/Source.md`, "user modification"); await expect(provider.repair()).rejects.toThrow("Unexpected fixture bytes");
    files.delete("Standalone.md"); await expect(provider.createFixtures()).rejects.toThrow("disposable acceptance fixture");
  });

  it("prepares block, nesting, quote and hint inputs without changing targets or declaring a verdict", async () => {
    const { provider, files, commands, mutations, notices } = await loadProvider();
    provider.onload();
    await provider.prepareInlineMetadataFixtures("quoted");
    const baseline = new Map(files);
    for (const [mode, text, references] of [
      ["atx-boundary", '# [label](Target "title\n[[Missing]]")\n', ["Missing"]],
      ["nested-image", '![outer [inner](Target)](Ghost "[[Missing]]")\n', ["Ghost", "Target"]],
      ["reference-inner", '[outer [r]](Ghost "[[Missing]]")\n\n[r]: Target\n', ["Missing"]],
      ["quote-continuation", '> [label](Target\n> "[[Ghost]] [[Missing]]")\n', ["Target"]],
      ["hint-metadata", '[label](Missing "<!--") [[Missing]]\n', ["Missing", "Missing"]],
    ] as const) {
      mutations.length = 0;
      await commands.find(({ id }) => id === `prepare-inline-${mode}`)!.callback();
      expect(files.get(`${inlinePrefix}/Source.md`)).toBe(text);
      expect(extractMarkdownExplicitReferences(text).map(({ linktext }) => linktext)).toEqual(references);
      expect(mutations).toEqual([`${inlinePrefix}/Source.md`]);
      expect(new Map([...files].filter(([path]) => path !== `${inlinePrefix}/Source.md`)))
        .toEqual(new Map([...baseline].filter(([path]) => path !== `${inlinePrefix}/Source.md`)));
      expect(notices.at(-1)).toBe(`inline-metadata ${mode} input prepared; observe diagnostics and isolation separately.`);
    }
    // Reference-style target interpretation remains the host's responsibility.
    // Source-only projection is not a native-cache or hint acceptance verdict.
    const contract = JSON.parse(await readFile("acceptance/product-scenarios.json", "utf8")) as { scenarios: { id: string; steps: string[] }[] };
    const scenario = contract.scenarios.find(({ id }) => id === "inline-proof-boundaries")!;
    for (const mode of ["atx-boundary", "nested-image", "reference-inner", "quote-continuation", "hint-metadata"]) {
      expect(scenario.steps.join("\n")).toContain(`prepare-inline-${mode}`);
    }
  });

  it("prepares four exact inline inputs explicitly, changes only Source and leaves verdicts to the host", async () => {
    const { provider, files, commands, mutations, opened, notices } = await loadProvider();
    provider.onload();
    expect(mutations).toEqual([]);
    const baseline = new Map(files);
    const cases = [
      ["quoted", 81, "a53b48ce1bcb153702aab6863a723e8151a367b1c184a14c5f11be8c6b994a1e", 0, 1],
      ["parenthesized", 82, "9d79c95703b7c8a0dba652dc30bbbc3504fb400de0bb011f242d0bb41a96b51d", 0, 1],
      ["label-wiki", 62, "bfc6ab0ccb9538b421989ceb55d31dd2fd0fde3a472226e2a55d3abc51faa520", 1, 0],
      ["invalid-outer", 46, "02d6d412844a34aaaeffeb89f0810056e47ba94afc4c0c9f11fe64eb4f103006", 1, 1],
    ] as const;
    for (const [mode, bytes, sha256, broken, isolated] of cases) {
      const command = commands.find(({ id }) => id === `prepare-inline-${mode}`)!;
      expect(command.name).toBe(`Prepare inline-metadata ${mode} in this disposable acceptance Vault`);
      mutations.length = 0;
      await command.callback();
      const text = files.get(`${inlinePrefix}/Source.md`)!;
      expect(Buffer.byteLength(text)).toBe(bytes);
      expect(createHash("sha256").update(text).digest("hex")).toBe(sha256);
      expect(text.endsWith("\n")).toBe(true); expect(text).not.toContain("\r");
      expect(files.get(`${inlinePrefix}/Target.md`)).toBe("# Inline metadata target\n");
      expect(files.get(`${inlinePrefix}/Ghost.md`)).toBe("# Inline metadata ghost\n");
      expect(files.has(`${inlinePrefix}/Missing.md`)).toBe(false);
      expect(projection(files, inlinePrefix)).toEqual({ broken, isolated });
      expect(new Map([...files].filter(([path]) => !path.startsWith(`${inlinePrefix}/`)))).toEqual(baseline);
      expect(opened.at(-1)).toBe(`${inlinePrefix}/Source.md`);
      expect(mutations).toEqual(mode === "quoted"
        ? [inlinePrefix, `${inlinePrefix}/Target.md`, `${inlinePrefix}/Ghost.md`, `${inlinePrefix}/Source.md`]
        : [`${inlinePrefix}/Source.md`]);
      expect(notices.at(-1)).toBe(`inline-metadata ${mode} input prepared; observe diagnostics and isolation separately.`);
    }
    const contract = JSON.parse(await readFile("acceptance/product-scenarios.json", "utf8")) as { scenarios: { id: string; steps: string[] }[] };
    const scenario = contract.scenarios.find(({ id }) => id === "inline-metadata-boundaries")!;
    for (const [mode] of cases) expect(scenario.steps.join("\n")).toContain(`prepare-inline-${mode}`);
  });

  it.each(["source", "target", "ghost", "missing", "extra", "extra-folder", "removed-source", "removed-target", "removed-ghost", "crlf", "folder-file", "mode", "guard"])("rejects %s changes before any inline fixture mutation", async (change) => {
    const { provider, files, folders, mutations } = await loadProvider();
    await provider.prepareInlineMetadataFixtures("quoted");
    if (change === "source") files.set(`${inlinePrefix}/Source.md`, "user source");
    if (change === "target") files.set(`${inlinePrefix}/Target.md`, "user target");
    if (change === "ghost") files.set(`${inlinePrefix}/Ghost.md`, "user ghost");
    if (change === "missing") files.set(`${inlinePrefix}/Missing.md`, "user missing");
    if (change === "extra") files.set(`${inlinePrefix}/Other.md`, "user extra");
    if (change === "extra-folder") folders.add(`${inlinePrefix}/Other`);
    if (change.startsWith("removed-")) files.delete(`${inlinePrefix}/${change.slice(8).replace(/^./u, (letter) => letter.toUpperCase())}.md`);
    if (change === "crlf") files.set(`${inlinePrefix}/Source.md`, files.get(`${inlinePrefix}/Source.md`)!.replaceAll("\n", "\r\n"));
    if (change === "folder-file") { folders.delete(inlinePrefix); files.set(inlinePrefix, "foreign file"); }
    if (change === "guard") files.delete("Standalone.md");
    const before = new Map(files); const beforeFolders = new Set(folders); mutations.length = 0;
    await expect(provider.prepareInlineMetadataFixtures(change === "mode" ? "__proto__" : "parenthesized")).rejects.toThrow();
    expect(files).toEqual(before); expect(folders).toEqual(beforeFolders); expect(mutations).toEqual([]);
  });
});
