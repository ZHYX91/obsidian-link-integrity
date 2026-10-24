import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createFileRecord, LinkIndex, makeOccurrenceLookupKey, type LinkOccurrence } from "../../src/core";
import { extractMarkdownExplicitReferences } from "../../src/adapters/obsidian/explicit-link-parser";
import { createIsolatedFileProjection, queryBrokenLinks } from "../../src/features/queries";

const prefix = "Body Hints Acceptance";
function projection(files: Map<string, string>) {
  const index = new LinkIndex([...files.keys()].map((path) => createFileRecord(path)));
  for (const [path, text] of files) {
    const occurrences: LinkOccurrence[] = extractMarkdownExplicitReferences(text).map((reference, ordinal) => {
      const marker = reference.linktext.indexOf("#"); const linkpath = marker < 0 ? reference.linktext : reference.linktext.slice(0, marker);
      const subpath = marker < 0 ? null : reference.linktext.slice(marker); const targetPath = `${linkpath}.md`; const target = files.get(targetPath);
      const missingSubpath = subpath !== null && target !== undefined && !target.includes(subpath.startsWith("#^") ? subpath.slice(1) : `# ${subpath.slice(1)}`);
      return { id: `${path}:${ordinal}`, sourcePath: path, raw: reference.raw, linkpath, subpath, lookupKey: makeOccurrenceLookupKey(linkpath, path),
        kind: reference.embedded ? "markdown-embed" : "markdown-link", destinationKind: "internal", position: null,
        targetPath: target === undefined ? null : targetPath, fileStatus: target === undefined ? "missing" : "resolved",
        subpathStatus: missingSubpath ? subpath!.startsWith("#^") ? "missing-block" : "missing-heading" : subpath === null ? "none" : "ok" };
    });
    index.replaceSourceSnapshot(path, { sourcePath: path, occurrences });
  }
  return { broken: queryBrokenLinks(index).filter((result) => result.sourcePath.startsWith(prefix)).length,
    isolated: createIsolatedFileProjection(index).items.filter((result) => result.path.startsWith(prefix)).length };
}

describe("self-contained explicit body fixture provider", () => {
  it("preserves base bytes and verifies prepare/repair/restore transitions without filesystem writes", async () => {
    const source = await readFile("acceptance/fixtures/.obsidian/plugins/link-integrity-acceptance-provider/main.js", "utf8");
    const files = new Map([["Standalone.md", "baseline standalone"], ["Broken-only.md", "baseline broken"]]); const folders = new Set<string>();
    const module = { exports: null as unknown as new() => { app: unknown; onload: () => void; createFixtures: () => Promise<void>; createContextRegressionFixtures: () => Promise<void>; repair: () => Promise<void>; restore: () => Promise<void> } };
    const commands: string[] = [];
    runInNewContext(source, { module, require: () => ({ Plugin: class { addCommand(command: { id: string }) { commands.push(command.id); } }, Notice: class {} }) }, { timeout: 1_000 });
    const provider = new module.exports();
    provider.app = { vault: {
      getFileByPath: (path: string) => files.has(path) ? { path } : null,
      getAbstractFileByPath: (path: string) => files.has(path) || folders.has(path) ? { path } : null,
      cachedRead: async (file: { path: string }) => files.get(file.path), createFolder: async (path: string) => { folders.add(path); },
      create: async (path: string, text: string) => { files.set(path, text); }, modify: async (file: { path: string }, text: string) => { files.set(file.path, text); }, delete: async (file: { path: string }) => { files.delete(file.path); },
    }, workspace: { getLeaf: () => ({ openFile: async () => {} }) } };
    provider.onload(); expect(commands).toEqual(["create-body-hint-fixtures", "create-context-regression-fixtures", "repair-body-hint-fixtures", "restore-body-hint-fixtures"]);
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
    expect(files.get("Standalone.md")).toBe("baseline standalone"); expect(files.get("Broken-only.md")).toBe("baseline broken");
    files.set(`${prefix}/Source.md`, "user modification"); await expect(provider.repair()).rejects.toThrow("Unexpected fixture bytes");
    files.delete("Standalone.md"); await expect(provider.createFixtures()).rejects.toThrow("disposable acceptance fixture");
  });
});
