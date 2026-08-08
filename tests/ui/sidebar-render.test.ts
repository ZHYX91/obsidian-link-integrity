import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "../../src/shared/i18n";
import { createFileTypeCategoryOptions } from "../../src/ui/file-type-options";
import {
  createSidebarViewModel,
  renderSidebar,
  SIDEBAR_RESULT_BATCH_SIZE,
  type SidebarQuerySnapshot,
  type SidebarViewState,
} from "../../src/ui/sidebar";

describe("sidebar renderer", () => {
  it("renders two accessible business tabs and honest isolation confidence", () => {
    const container = document.createElement("div");
    const translator = createTranslator("en", "en");
    const state = viewState();
    const snapshot = querySnapshot();
    const onStateChange = vi.fn();
    renderSidebar(container, {
      model: createSidebarViewModel(snapshot, state),
      state,
      translator,
      navigation: navigation(),
      fileTypeCategories: createFileTypeCategoryOptions(translator),
      defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: true,
      onStateChange,
    });
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(container.querySelector(".link-integrity-sidebar-header")).toBeNull();
    expect(tabs[0]?.textContent).toContain("Broken links");
    expect(tabs[1]?.textContent).toContain("Isolated files");
    (tabs[1] as HTMLButtonElement).click();
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      activeTab: "isolated-files",
    }));
  });

  it("does not render expected isolation until the advanced toggle is enabled", () => {
    const container = document.createElement("div");
    const translator = createTranslator("en", "en");
    const state = { ...viewState(), activeTab: "isolated-files" as const };
    renderSidebar(container, {
      model: createSidebarViewModel(querySnapshot(), state),
      state,
      translator,
      navigation: navigation(),
      fileTypeCategories: createFileTypeCategoryOptions(translator),
      defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: true,
      onStateChange: vi.fn(),
    });
    expect(container.textContent).toContain("Isolated · contains 2 broken links");
    expect(container.textContent).not.toContain("Daily/2026-08-02.md");
    expect(container.textContent).toContain("1 expected isolated file");
  });

  it("reports the selected no-incoming projection total instead of the isolated-tab badge", () => {
    const container = document.createElement("div");
    const translator = createTranslator("en", "en");
    const state = {
      ...viewState(),
      activeTab: "isolated-files" as const,
      isolatedMode: "no-incoming" as const,
    };
    const snapshot = querySnapshot();
    renderSidebar(container, {
      model: createSidebarViewModel({
        ...snapshot,
        noIncomingFiles: [
          ...snapshot.isolatedFiles,
          {
            path: "Outgoing only.md",
            formatFamilyId: "markdown",
            modifiedAt: 1,
            brokenOutgoingCount: 0,
            incomingCount: 0,
            outgoingCount: 1,
            expectation: { kind: "unexpected", ruleIds: [] },
          },
        ],
      }, state),
      state,
      translator,
      navigation: navigation(),
      fileTypeCategories: createFileTypeCategoryOptions(translator),
      defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: true,
      onStateChange: vi.fn(),
    });
    expect(container.textContent).toContain("Showing 1–2 / 2");
    expect(container.textContent).toContain("Outgoing only.md");
  });

  it("uses RTL-aware arrow navigation", () => {
    const container = document.createElement("div");
    const translator = createTranslator("auto", "ar");
    const state = viewState();
    const onStateChange = vi.fn();
    renderSidebar(container, {
      model: createSidebarViewModel(querySnapshot(), state),
      state,
      translator,
      navigation: navigation(),
      fileTypeCategories: createFileTypeCategoryOptions(translator),
      defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: false,
      onStateChange,
    });
    const firstTab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    firstTab?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    // With two tabs, both visual directions reach the other tab; dir is still surfaced to CSS/AT.
    expect(container.dir).toBe("rtl");
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      activeTab: "isolated-files",
    }));
  });

  it("keeps the ready state quiet without a permanent status row", () => {
    const container = document.createElement("div");
    const translator = createTranslator("en", "en");
    const state = viewState();
    renderSidebar(container, {
      model: createSidebarViewModel(querySnapshot(), state),
      state,
      translator,
      navigation: navigation(),
      fileTypeCategories: createFileTypeCategoryOptions(translator),
      defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: false,
      onStateChange: vi.fn(),
    });
    expect(container.querySelector(".link-integrity-status")).toBeNull();
  });

  it("offers an explicit GUI action before the first lazy scan", () => {
    const container = document.createElement("div");
    const translator = createTranslator("en", "en");
    const state = viewState();
    const snapshot = {
      ...querySnapshot(),
      status: { state: "idle" as const, current: 0, total: 0, errorMessage: null },
    };
    const nav = navigation();
    renderSidebar(container, {
      model: createSidebarViewModel(snapshot, state),
      state,
      translator,
      navigation: nav,
      fileTypeCategories: createFileTypeCategoryOptions(translator),
      defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: false,
      onStateChange: vi.fn(),
    });

    expect(container.textContent).toContain("Not scanned");
    expect(container.textContent).toContain("The index is built automatically");
    const start = Array.from(container.querySelectorAll("button"))
      .find(({ textContent }) => textContent === "Build index");
    start?.click();
    expect(nav.rebuildIndex).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("No broken links");
  });

  it("shows a contextual rebuild action only when results need recovery", () => {
    const container = document.createElement("div");
    const translator = createTranslator("en", "en");
    const state = viewState();
    const nav = navigation();
    const snapshot = {
      ...querySnapshot(),
      status: {
        state: "failed" as const,
        current: 0,
        total: 0,
        errorMessage: "Index read failed",
      },
    };
    renderSidebar(container, {
      model: createSidebarViewModel(snapshot, state),
      state,
      translator,
      navigation: nav,
      fileTypeCategories: createFileTypeCategoryOptions(translator),
      defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: false,
      onStateChange: vi.fn(),
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Index read failed");
    const retry = Array.from(container.querySelectorAll("button"))
      .find(({ textContent }) => textContent === "Retry rebuild");
    retry?.click();
    expect(nav.rebuildIndex).toHaveBeenCalledOnce();
  });

  it("exposes sorting controls for both business tabs", () => {
    const container = document.createElement("div");
    const translator = createTranslator("en", "en");
    let state = viewState();
    const changes: SidebarViewState[] = [];
    const render = (): void => {
      renderSidebar(container, {
        model: createSidebarViewModel(querySnapshot(), state),
        state,
        translator,
        navigation: navigation(),
        fileTypeCategories: createFileTypeCategoryOptions(translator),
        defaultFormatFamilyIds: new Set(["markdown"]),
        allowNoIncomingFilter: true,
        onStateChange: (next) => {
          changes.push(next);
          state = next;
          render();
        },
      });
    };

    render();
    const brokenSort = container.querySelector<HTMLSelectElement>('[aria-label="Default sort"]');
    expect(brokenSort?.closest(".link-integrity-toolbar-select")?.textContent).toContain("Sort");
    expect(container.querySelector(".link-integrity-toolbar-view-toggle")).not.toBeNull();
    expect(Array.from(brokenSort?.options ?? []).map(({ value }) => value))
      .toEqual(["path", "count"]);
    if (brokenSort !== null) {
      brokenSort.value = "path";
      brokenSort.dispatchEvent(new Event("change", { bubbles: true }));
    }
    expect(changes.at(-1)?.brokenSort).toBe("path");

    state = { ...state, activeTab: "isolated-files" };
    render();
    const isolatedSort = container.querySelector<HTMLSelectElement>('[aria-label="Default sort"]');
    expect(isolatedSort?.closest(".link-integrity-toolbar-select")?.textContent).toContain("Sort");
    expect(Array.from(isolatedSort?.options ?? []).map(({ value }) => value))
      .toEqual(["path", "name", "modified", "broken-count"]);
  });

  it("reveals and restores focus to a clipped tab after a synchronous re-render", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const translator = createTranslator("en", "en");
    let state = viewState();
    const scrollIntoView = vi.fn();
    const rerender = (): void => {
      renderSidebar(container, {
        model: createSidebarViewModel(querySnapshot(), state),
        state,
        translator,
        navigation: navigation(),
        fileTypeCategories: createFileTypeCategoryOptions(translator),
        defaultFormatFamilyIds: new Set(["markdown"]),
        allowNoIncomingFilter: false,
        onStateChange: (next) => {
          state = next;
          rerender();
        },
      });
      const activeTab = container.querySelector<HTMLButtonElement>(
        '[role="tab"][aria-selected="true"]',
      );
      if (activeTab !== null) {
        Object.defineProperty(activeTab, "scrollIntoView", {
          configurable: true,
          value: scrollIntoView,
        });
      }
    };
    rerender();
    const tabList = container.querySelector<HTMLElement>('[role="tablist"]');
    if (tabList !== null) tabList.scrollLeft = 120;
    container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.click();
    await Promise.resolve();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(document.activeElement?.textContent).toContain("Isolated files");
    container.remove();
  });

  it("renders large result sets in explicit user-controlled batches", () => {
    const container = document.createElement("div");
    const translator = createTranslator("en", "en");
    const state = { ...viewState(), brokenView: "list" as const };
    const location = { line: 0, column: 0, property: null, canvasNodeId: null };
    const brokenLinks = Array.from(
      { length: SIDEBAR_RESULT_BATCH_SIZE + 25 },
      (_, index) => ({
        id: `broken-${index}`,
        sourcePath: `Source-${String(index).padStart(3, "0")}.md`,
        targetText: `Missing-${index}`,
        resolvedTargetPath: null,
        rawText: `[[Missing-${index}]]`,
        context: `Missing-${index}`,
        reason: "missing-file" as const,
        location,
      }),
    );
    const onStateChange = vi.fn();
    const groupedState = { ...state, brokenView: "group" as const };
    renderSidebar(container, {
      model: createSidebarViewModel({ ...querySnapshot(), brokenLinks }, groupedState),
      state: groupedState,
      translator,
      navigation: navigation(),
      fileTypeCategories: createFileTypeCategoryOptions(translator),
      defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: false,
      onStateChange: vi.fn(),
    });
    expect(container.querySelectorAll(".link-integrity-result-row"))
      .toHaveLength(SIDEBAR_RESULT_BATCH_SIZE);
    expect(container.querySelectorAll(".link-integrity-broken-group").length)
      .toBeLessThanOrEqual(SIDEBAR_RESULT_BATCH_SIZE);

    renderSidebar(container, {
      model: createSidebarViewModel({ ...querySnapshot(), brokenLinks }, state),
      state,
      translator,
      navigation: navigation(),
      fileTypeCategories: createFileTypeCategoryOptions(translator),
      defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: false,
      onStateChange,
    });

    expect(container.querySelectorAll(".link-integrity-result-row"))
      .toHaveLength(SIDEBAR_RESULT_BATCH_SIZE);
    expect(container.textContent).toContain(
      `Showing 1–${SIDEBAR_RESULT_BATCH_SIZE} / ${SIDEBAR_RESULT_BATCH_SIZE + 25}`,
    );
    const pageButtons = container.querySelectorAll<HTMLButtonElement>(
      ".link-integrity-pagination button",
    );
    expect(pageButtons[0]?.textContent).toBe("Previous");
    expect(pageButtons[0]?.disabled).toBe(true);
    expect(pageButtons[1]?.textContent).toBe("Next");
    pageButtons[1]?.click();
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      brokenResultOffset: SIDEBAR_RESULT_BATCH_SIZE,
    }));

    const finalState = {
      ...state,
      brokenResultOffset: SIDEBAR_RESULT_BATCH_SIZE,
    };
    renderSidebar(container, {
      model: createSidebarViewModel({ ...querySnapshot(), brokenLinks }, finalState),
      state: finalState,
      translator,
      navigation: navigation(),
      fileTypeCategories: createFileTypeCategoryOptions(translator),
      defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: false,
      onStateChange: vi.fn(),
    });
    expect(container.querySelectorAll(".link-integrity-result-row")).toHaveLength(25);
    expect(container.textContent).toContain(
      `Showing ${SIDEBAR_RESULT_BATCH_SIZE + 1}–${SIDEBAR_RESULT_BATCH_SIZE + 25} / ${
        SIDEBAR_RESULT_BATCH_SIZE + 25
      }`,
    );
    const finalButtons = container.querySelectorAll<HTMLButtonElement>(
      ".link-integrity-pagination button",
    );
    expect(finalButtons[0]?.disabled).toBe(false);
    expect(finalButtons[1]?.disabled).toBe(true);
  });

  it("keeps the isolated folder tree within the same fixed page bound", () => {
    const container = document.createElement("div");
    const translator = createTranslator("en", "en");
    const state = {
      ...viewState(),
      activeTab: "isolated-files" as const,
      isolatedView: "tree" as const,
    };
    const isolatedFiles = Array.from(
      { length: SIDEBAR_RESULT_BATCH_SIZE + 25 },
      (_, index) => ({
        path: `Folder-${String(index).padStart(3, "0")}/Loose.md`,
        formatFamilyId: "markdown",
        modifiedAt: index,
        brokenOutgoingCount: 0,
        incomingCount: 0,
        outgoingCount: 0,
        expectation: { kind: "unexpected" as const, ruleIds: [] },
      }),
    );
    renderSidebar(container, {
      model: createSidebarViewModel({ ...querySnapshot(), isolatedFiles }, state),
      state,
      translator,
      navigation: navigation(),
      fileTypeCategories: createFileTypeCategoryOptions(translator),
      defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: false,
      onStateChange: vi.fn(),
    });

    expect(container.querySelectorAll(".link-integrity-result-row"))
      .toHaveLength(SIDEBAR_RESULT_BATCH_SIZE);
    expect(container.querySelector(".link-integrity-isolated-tree")).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>(".link-integrity-pagination button:last-child")
      ?.disabled).toBe(false);
  });
});

function navigation() {
  return {
    openBrokenLink: vi.fn(),
    openFile: vi.fn(),
    rebuildIndex: vi.fn(),
  };
}

function viewState(): SidebarViewState {
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
  };
}

function querySnapshot(): SidebarQuerySnapshot {
  return {
    status: { state: "ready", current: 1, total: 1, errorMessage: null },
    brokenLinks: [],
    isolatedFiles: [
      {
        path: "With broken.md",
        formatFamilyId: "markdown",
        modifiedAt: 1,
        brokenOutgoingCount: 2,
        incomingCount: 0,
        outgoingCount: 0,
        expectation: { kind: "unexpected", ruleIds: [] },
      },
      {
        path: "Daily/2026-08-02.md",
        formatFamilyId: "markdown",
        modifiedAt: 1,
        brokenOutgoingCount: 0,
        incomingCount: 0,
        outgoingCount: 0,
        expectation: { kind: "expected", ruleIds: ["daily"] },
      },
    ],
    noIncomingFiles: [],
  };
}
