import type { MetadataCache, Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { ObsidianLinkIndexPort } from "../../src/adapters/obsidian/link-index-port";
import type { LinkIndex, LinkOccurrenceKind } from "../../src/core";
import { AtomicLinkIndexStore, FullRebuildController, IncrementalIndexController } from "../../src/features/index";
import { queryBrokenLinks, queryIsolatedFiles } from "../../src/features/queries";

const paths = ["#cover.png", "Assets/#cover.png", "cover#1.png"];

describe("Canvas background file paths", () => {
  it.each(paths)("keeps the exact background identity for %s in a full rebuild", async (path) => {
    for (const exists of [false, true]) {
      const test = setup(path);
      test.setNodes([group(path)]);
      if (exists) test.files.set(path, file(path));
      const source = test.content();
      const { index } = await new FullRebuildController(test.port, new AtomicLinkIndexStore()).rebuild();

      expectReference(index, path, exists, "canvas-background");
      expect(test.resolveDestination).not.toHaveBeenCalled();
      expect(test.content()).toBe(source);
    }
  });

  it.each(paths)("agrees with a rebuild while %s changes between missing and present", async (path) => {
    const test = setup(path);
    test.setNodes([{ id: "image", type: "file", file: path }]);
    const store = new AtomicLinkIndexStore();
    const incremental = new IncrementalIndexController(test.port, store);
    incremental.start();
    try {
      await new FullRebuildController(test.port, store).rebuild();
      expectReference(store.current, path, false, "canvas-file");

      test.setNodes([group(path)]);
      incremental.enqueue({ type: "modify", path: "Board.canvas" });
      await incremental.whenIdle();
      expectReference(store.current, path, false, "canvas-background");

      for (const exists of [true, false, true]) {
        const previous = store.current;
        const previousState = previous.toCanonicalState();
        if (exists) test.files.set(path, file(path));
        else test.files.delete(path);
        incremental.enqueue({ type: exists ? "create" : "delete", path });
        await incremental.whenIdle();

        expectReference(store.current, path, exists, "canvas-background");
        const rebuilt = await new FullRebuildController(test.port, new AtomicLinkIndexStore()).rebuild();
        expect(store.current.toCanonicalState()).toEqual(rebuilt.index.toCanonicalState());
        expect(previous.toCanonicalState()).toEqual(previousState);
      }
      expect(test.resolveDestination).not.toHaveBeenCalled();
      expect(test.content()).toBe(JSON.stringify({ nodes: [group(path)], edges: [] }));
    } finally {
      incremental.stop();
    }
  });

  it("keeps colors separate from absent or blank background paths", async () => {
    const test = setup("#FF0000");
    test.files.set("#FF0000", file("#FF0000"));
    test.setNodes([
      { id: "color", type: "group", color: "#FF0000" },
      { id: "empty", type: "group", color: "1", background: "" },
      { id: "blank", type: "group", background: " \t " },
    ]);
    const { index } = await new FullRebuildController(test.port, new AtomicLinkIndexStore()).rebuild();

    expect(index.getSourceSnapshot("Board.canvas")!.occurrences).toEqual([]);
    expect(index.getIncomingContributionCount("#FF0000")).toBe(0);
    expect(queryBrokenLinks(index)).toEqual([]);
    expect(test.resolveDestination).not.toHaveBeenCalled();
  });
});

function expectReference(index: LinkIndex, path: string, exists: boolean, kind: LinkOccurrenceKind): void {
  expect(index.getSourceSnapshot("Board.canvas")!.occurrences).toMatchObject([{
    kind, linkpath: path, targetPath: exists ? path : null,
    fileStatus: exists ? "resolved" : "missing", subpath: null,
  }]);
  expect(index.getIncomingContributionCount(path)).toBe(exists ? 1 : 0);
  expect(index.getOutgoingContributionCount("Board.canvas")).toBe(exists ? 1 : 0);
  expect(queryBrokenLinks(index).map(({ targetText }) => targetText)).toEqual(exists ? [] : [path]);
  expect(queryIsolatedFiles(index, { candidateScope: { familyIds: new Set(["canvas", "png"]) } })
    .map(({ path: resultPath, confidence, brokenOutgoingCount }) => ({ path: resultPath, confidence, brokenOutgoingCount })))
    .toEqual(exists ? [] : [{ path: "Board.canvas", confidence: "low", brokenOutgoingCount: 1 }]);
}

function group(path: string): object {
  return { id: "background", type: "group", background: path, backgroundStyle: "cover", color: "#FF0000" };
}

function file(path: string) {
  const dot = path.lastIndexOf(".");
  return { path, extension: dot < 0 ? "" : path.slice(dot + 1), stat: { mtime: 1 } };
}

function setup(path: string) {
  const source = file("Board.canvas");
  const files = new Map([[source.path, source]]);
  let content = JSON.stringify({ nodes: [group(path)], edges: [] });
  const resolveDestination = vi.fn(() => null);
  const port = new ObsidianLinkIndexPort({
    getFiles: () => [...files.values()],
    getFileByPath: (candidate: string) => files.get(candidate) ?? null,
    cachedRead: async (candidate: typeof source) => {
      expect(candidate).toBe(source);
      return content;
    },
  } as unknown as Vault, {
    getFileCache: () => null,
    getFirstLinkpathDest: resolveDestination,
  } as unknown as MetadataCache);
  return { port, files, resolveDestination, content: () => content,
    setNodes: (nodes: readonly object[]) => { content = JSON.stringify({ nodes, edges: [] }); } };
}
