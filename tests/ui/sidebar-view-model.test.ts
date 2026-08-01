import { describe, expect, it } from "vitest";

import {
  buildIsolatedTree,
  createSidebarViewModel,
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
    const model = createSidebarViewModel(snapshot(), state());
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
      selectedFormatFamilyIds: new Set(["webm-audio"]),
    });
    expect(model.isolated.items.map(({ path }) => path)).toEqual(["clip.webm"]);
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
  };
}

function snapshot(): SidebarQuerySnapshot {
  const location = { line: 0, column: 1, property: null, canvasNodeId: null };
  return {
    status: { state: "ready", current: 3, total: 3, errorMessage: null },
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
