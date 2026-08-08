import { describe, expect, it } from "vitest";

import {
  buildBrokenFolderTree,
  buildIsolatedTree,
  createSidebarViewModel,
  SIDEBAR_RESULT_BATCH_SIZE,
  type SidebarQuerySnapshot,
  type SidebarViewState,
} from "../../src/ui/sidebar";

describe("sidebar view model", () => {
  it("keeps occurrence counts separate from unique target counts and groups", () => {
    const model = createSidebarViewModel(snapshot(), state());
    expect(model.broken.badgeCount).toBe(3);
    expect(model.broken.uniqueTargetCount).toBe(2);
    expect(model.broken.groups).toHaveLength(2);
    expect(model.broken.groups[0]?.items.length).toBe(2);
  });

  it("excludes expected isolation from the main badge and list by default", () => {
    const model = createSidebarViewModel(snapshot(), {
      ...state(),
      activeTab: "isolated-files",
    });
    expect(model.isolated.badgeCount).toBe(2);
    expect(model.isolated.expectedCount).toBe(1);
    expect(model.isolated.items.map(({ path }) => path)).toEqual([
      "Loose.md",
      "With broken.md",
    ]);
  });

  it("shows expected results only through the independent advanced toggle", () => {
    const model = createSidebarViewModel(snapshot(), {
      ...state(),
      activeTab: "isolated-files",
      showExpectedIsolated: true,
    });
    expect(model.isolated.items.map(({ path }) => path)).toEqual([
      "Daily/2026-08-02.md",
      "Loose.md",
      "With broken.md",
    ]);
    expect(model.isolated.badgeCount).toBe(2);
  });

  it("builds deterministic folder trees", () => {
    const tree = buildIsolatedTree(snapshot().isolatedFiles);
    expect(tree.folders.map(({ name }) => name)).toEqual(["Daily"]);
    expect(tree.folders[0]?.files[0]?.path).toBe("Daily/2026-08-02.md");
    expect(tree.files.map(({ path }) => path)).toEqual(["Loose.md", "With broken.md"]);
  });

  it("uses fixed source order for broken lists without discarding grouped sort state", () => {
    const base = snapshot();
    const brokenLinks = [
      { ...base.brokenLinks[0]!, id: "z", sourcePath: "Z.md", targetText: "Popular" },
      { ...base.brokenLinks[1]!, id: "a", sourcePath: "A.md", targetText: "Rare" },
      { ...base.brokenLinks[2]!, id: "b", sourcePath: "B.md", targetText: "Popular" },
    ];
    const model = createSidebarViewModel({ ...base, brokenLinks }, {
      ...state(),
      brokenView: "list",
      brokenSort: "count",
    });
    expect(model.broken.items.map(({ sourcePath }) => sourcePath)).toEqual([
      "A.md",
      "B.md",
      "Z.md",
    ]);
  });

  it("keeps isolated trees path-ordered while preserving the saved list sort", () => {
    const base = snapshot();
    const isolatedFiles = [
      isolated("A/first.md", "unexpected", 0),
      { ...isolated("Z/latest.md", "unexpected", 0), modifiedAt: 10 },
    ];
    const model = createSidebarViewModel({ ...base, isolatedFiles }, {
      ...state(),
      activeTab: "isolated-files",
      isolatedView: "tree",
      isolatedSort: "modified",
    });
    expect(model.isolated.tree.folders.map(({ name }) => name)).toEqual(["A", "Z"]);
    expect(model.isolated.items.map(({ path }) => path)).toEqual([
      "A/first.md",
      "Z/latest.md",
    ]);
  });

  it("builds a source-folder tree with subtree and source occurrence counts", () => {
    const base = snapshot();
    const brokenLinks = [
      { ...base.brokenLinks[0]!, sourcePath: "Projects/A.md" },
      { ...base.brokenLinks[1]!, sourcePath: "Projects/A.md" },
      { ...base.brokenLinks[2]!, sourcePath: "Projects/Nested/B.md" },
    ];
    const tree = buildBrokenFolderTree(brokenLinks, brokenLinks, "count");
    expect(tree.folders[0]).toMatchObject({ path: "Projects", totalCount: 3 });
    expect(tree.folders[0]?.files[0]).toMatchObject({ path: "Projects/A.md", totalCount: 2 });
    expect(tree.folders[0]?.folders[0]).toMatchObject({
      path: "Projects/Nested",
      totalCount: 1,
    });
    const model = createSidebarViewModel({ ...base, brokenLinks }, {
      ...state(),
      brokenGrouping: "source-folder",
    });
    expect(model.broken.sourceFolderCount).toBe(2);
    const sourceModel = createSidebarViewModel({ ...base, brokenLinks }, {
      ...state(),
      brokenGrouping: "source",
    });
    expect(sourceModel.broken.sourceFileCount).toBe(2);
  });

  it("filters ambiguous media by every matching family rather than only its primary", () => {
    const base = snapshot();
    const webm = {
      ...isolated("clip.webm", "unexpected", 0),
      formatFamilyId: "webm-video",
      formatFamilyIds: ["webm-audio", "webm-video"],
    };
    const model = createSidebarViewModel({
      ...base,
      isolatedFiles: [webm],
    }, {
      ...state(),
      activeTab: "isolated-files",
      selectedFormatFamilyIds: new Set(["webm-audio"]),
    });
    expect(model.isolated.items.map(({ path }) => path)).toEqual(["clip.webm"]);
  });

  it("caps active-tab materialization and skips inactive result structures", () => {
    const isolatedFiles = Array.from({ length: SIDEBAR_RESULT_BATCH_SIZE + 25 }, (_, index) =>
      isolated(`Loose-${String(index).padStart(3, "0")}.md`, "unexpected", 0));
    const base = snapshot();
    const isolatedModel = createSidebarViewModel({
      ...base,
      isolatedFiles,
    }, {
      ...state(),
      activeTab: "isolated-files",
    });

    expect(isolatedModel.isolated.visibleCount).toBe(SIDEBAR_RESULT_BATCH_SIZE + 25);
    expect(isolatedModel.isolated.renderedCount).toBe(SIDEBAR_RESULT_BATCH_SIZE);
    expect(isolatedModel.isolated.items).toHaveLength(SIDEBAR_RESULT_BATCH_SIZE);
    expect(isolatedModel.broken.items).toEqual([]);
    expect(isolatedModel.broken.groups).toEqual([]);

    const brokenModel = createSidebarViewModel({
      ...base,
      isolatedFiles,
    }, state());
    expect(brokenModel.isolated.badgeCount).toBe(SIDEBAR_RESULT_BATCH_SIZE + 25);
    expect(brokenModel.isolated.items).toEqual([]);
    expect(brokenModel.isolated.tree.files).toEqual([]);

    const finalPage = createSidebarViewModel({
      ...base,
      isolatedFiles,
    }, {
      ...state(),
      activeTab: "isolated-files",
      isolatedResultOffset: Number.MAX_SAFE_INTEGER,
    });
    expect(finalPage.isolated.pageStart).toBe(SIDEBAR_RESULT_BATCH_SIZE);
    expect(finalPage.isolated.items).toHaveLength(25);
    expect(finalPage.isolated.items.at(-1)?.path).toBe(
      `Loose-${String(SIDEBAR_RESULT_BATCH_SIZE + 24).padStart(3, "0")}.md`,
    );
  });
});

function state(): SidebarViewState {
  return {
    activeTab: "broken-links",
    search: "",
    brokenView: "group",
    brokenGrouping: "target",
    brokenSort: "count",
    isolatedView: "list",
    isolatedSort: "path",
    isolatedMode: "isolated",
    showExpectedIsolated: false,
    selectedFormatFamilyIds: new Set(["markdown"]),
    brokenResultOffset: 0,
    isolatedResultOffset: 0,
    expandedBrokenFolderPaths: new Set(),
  };
}

function snapshot(): SidebarQuerySnapshot {
  const location = { line: 0, column: 1, property: null, canvasNodeId: null };
  return {
    status: { state: "ready", current: 3, total: 3, errorMessage: null },
    brokenLinksKnown: true,
    brokenLinks: [
      {
        id: "a",
        sourcePath: "A.md",
        targetText: "Missing",
        resolvedTargetPath: null,
        rawText: "[[Missing]]",
        context: "A -> Missing",
        reason: "missing-file",
        location,
      },
      {
        id: "b",
        sourcePath: "B.md",
        targetText: "Missing",
        resolvedTargetPath: null,
        rawText: "[[Missing]]",
        context: "B -> Missing",
        reason: "missing-file",
        location,
      },
      {
        id: "c",
        sourcePath: "C.md",
        targetText: "Note#Nope",
        resolvedTargetPath: "Note.md",
        rawText: "[[Note#Nope]]",
        context: "C -> Note",
        reason: "missing-heading",
        location,
      },
    ],
    isolatedFilesKnown: true,
    isolatedFiles: [
      isolated("Loose.md", "unexpected", 0),
      isolated("With broken.md", "unexpected", 2),
      isolated("Daily/2026-08-02.md", "expected", 0),
    ],
    noIncomingFiles: [],
  };
}

function isolated(
  path: string,
  kind: "unexpected" | "expected",
  brokenOutgoingCount: number,
) {
  return {
    path,
    formatFamilyId: "markdown",
    modifiedAt: 1,
    brokenOutgoingCount,
    incomingCount: 0,
    outgoingCount: 0,
    expectation: { kind, ruleIds: kind === "expected" ? ["daily"] : [] },
  } as const;
}
