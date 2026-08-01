import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "../../src/shared/i18n";
import { createFileTypeCategoryOptions } from "../../src/ui/file-type-options";
import {
  createSidebarViewModel,
  renderSidebar,
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
    expect(container.textContent).toContain("Showing 2 / 2");
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

  it("omits the status row when the general preference is disabled", () => {
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
      showStatus: false,
      onStateChange: vi.fn(),
    });
    expect(container.querySelector(".link-integrity-status")).toBeNull();
  });

  it("keeps an unscanned baseline explicit even when routine scan status is hidden", () => {
    const container = document.createElement("div");
    const translator = createTranslator("en", "en");
    const state = viewState();
    const snapshot = {
      ...querySnapshot(),
      status: { state: "idle" as const, current: 0, total: 0, errorMessage: null },
    };
    renderSidebar(container, {
      model: createSidebarViewModel(snapshot, state),
      state,
      translator,
      navigation: navigation(),
      fileTypeCategories: createFileTypeCategoryOptions(translator),
      defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: false,
      showStatus: false,
      onStateChange: vi.fn(),
    });

    expect(container.querySelector(".link-integrity-status")?.textContent).toBe("Not scanned");
    expect(container.textContent).toContain("Refresh to build the first complete Vault index.");
    expect(container.textContent).not.toContain("No broken links");
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
    expect(Array.from(isolatedSort?.options ?? []).map(({ value }) => value))
      .toEqual(["path", "name", "modified", "broken-count"]);
  });

  it("restores focus to the selected tab after a synchronous re-render", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const translator = createTranslator("en", "en");
    let state = viewState();
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
    };
    rerender();
    container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.click();
    await Promise.resolve();
    expect(document.activeElement?.textContent).toContain("Isolated files");
    container.remove();
  });
});

function navigation() {
  return {
    openBrokenLink: vi.fn(),
    openFile: vi.fn(),
    openSettings: vi.fn(),
    refresh: vi.fn(),
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
