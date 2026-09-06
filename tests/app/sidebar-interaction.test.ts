import { afterEach, describe, expect, it, vi } from "vitest";

import { LinkIntegritySidebarView } from "../../src/app/sidebar-view";
import { createDefaultSettings } from "../../src/shared/settings";
import type { SidebarQuerySnapshot } from "../../src/ui/sidebar";

const views: LinkIntegritySidebarView[] = [];
afterEach(async () => {
  for (const view of views.splice(0)) await view.onClose();
  document.body.replaceChildren();
});

async function openSidebar(isolated = false) {
  const defaults = createDefaultSettings();
  const settings = { ...defaults, general: { ...defaults.general }, ui: { ...defaults.ui } };
  settings.ui.activeSidebarTab = isolated ? "isolated-files" : "broken-links";
  settings.ui.isolatedView = "tree";
  let notify = (): void => {};
  const snapshot: SidebarQuerySnapshot = {
    status: { state: "ready", current: 1, total: 1, errorMessage: null },
    brokenLinksKnown: true,
    brokenLinks: [],
    isolatedFilesKnown: true,
    isolatedFiles: [{
      path: "Folder/A.md", formatFamilyId: "markdown", modifiedAt: 1,
      brokenOutgoingCount: 0, incomingCount: 0, outgoingCount: 0,
      expectation: { kind: "unexpected", ruleIds: [] },
    }],
    noIncomingFiles: [],
  };
  const changes = vi.fn();
  const view = new LinkIntegritySidebarView({} as never, {
    query: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => { notify = listener; return () => { notify = () => {}; }; },
    },
    navigation: { openBrokenLink: vi.fn(), openFile: vi.fn(), rebuildIndex: vi.fn() },
    getSettings: () => settings,
    ensureIndex: () => undefined,
    onViewStateChange: changes,
    onActionError: (error) => { throw error; },
  });
  views.push(view);
  document.body.append(view.contentEl);
  await view.onOpen();
  const search = view.contentEl.querySelector<HTMLInputElement>('input[type="search"]')!;
  return { view, search, refresh: () => notify(), changes, settings };
}

describe("sidebar interaction across host updates", () => {
  it("keeps one focused search input during typing, index refresh and selection replacement", async () => {
    const { view, search, refresh, changes } = await openSidebar();
    search.focus();
    for (const text of ["a", "ab", "abc"]) {
      search.value = text;
      search.dispatchEvent(new Event("input", { bubbles: true }));
      expect(view.contentEl.querySelector('input[type="search"]')).toBe(search);
      expect(document.activeElement).toBe(search);
    }
    search.setSelectionRange(1, 2);
    refresh();
    expect(document.activeElement).toBe(search);
    expect([search.selectionStart, search.selectionEnd]).toEqual([1, 2]);
    search.setRangeText("中", 1, 2, "end");
    const caret = search.selectionStart;
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(changes.mock.lastCall?.[0].search).toBe("a中c");
    expect(search.selectionStart).toBe(caret);
  });

  it("does not interrupt IME composition or publish an unfinished search", async () => {
    const { search, refresh, changes } = await openSidebar();
    search.focus();
    search.dispatchEvent(new CompositionEvent("compositionstart"));
    search.value = "zhong";
    search.dispatchEvent(new InputEvent("input", { isComposing: true }));
    refresh();
    expect(search.value).toBe("zhong");
    expect(document.activeElement).toBe(search);
    expect(changes).not.toHaveBeenCalled();
    search.value = "中文";
    search.dispatchEvent(new CompositionEvent("compositionend", { data: "中文" }));
    search.dispatchEvent(new InputEvent("input"));
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes.mock.lastCall?.[0].search).toBe("中文");
  });

  it("preserves toolbar focus on progress updates and uses the latest search in its actions", async () => {
    const { view, search, refresh, changes } = await openSidebar();
    const sort = view.contentEl.querySelector<HTMLSelectElement>('[aria-label="Choose sorting"]')
      ?? view.contentEl.querySelector<HTMLSelectElement>('.link-integrity-toolbar-compact-select select')!;
    sort.focus();
    refresh();
    expect(document.activeElement).toBe(sort);
    search.value = "current";
    search.dispatchEvent(new Event("input"));
    sort.value = "path";
    sort.dispatchEvent(new Event("change"));
    expect(changes.mock.lastCall?.[0].search).toBe("current");
    expect(changes.mock.lastCall?.[0].brokenSort).toBe("path");
  });

  it("retains collapsed folders even when refresh arrives before the native toggle event", async () => {
    const { view, refresh } = await openSidebar(true);
    const folder = (): HTMLDetailsElement => view.contentEl
      .querySelector<HTMLDetailsElement>('.link-integrity-isolated-tree details')!;
    folder().open = false;
    refresh();
    expect(folder().open).toBe(false);
    expect(folder().parentElement?.getAttribute("aria-expanded")).toBe("false");
    const filter = view.contentEl.querySelector<HTMLDetailsElement>('.link-integrity-temporary-filter')!;
    filter.open = true;
    refresh();
    expect(view.contentEl.querySelector<HTMLDetailsElement>('.link-integrity-temporary-filter')?.open)
      .toBe(true);
    expect(folder().open).toBe(false);
  });

  it("clears search without resetting filters or folder choices and restores input focus", async () => {
    const { view, search, changes } = await openSidebar(true);
    view.contentEl.querySelector<HTMLDetailsElement>('.link-integrity-isolated-tree details')!.open = false;
    search.value = "missing";
    search.dispatchEvent(new Event("input"));
    expect(view.contentEl.querySelector('.link-integrity-isolated-tree')).toBeNull();
    const previousState = changes.mock.lastCall?.[0];
    const clear = view.contentEl.querySelector<HTMLButtonElement>('.link-integrity-empty-state button')!;
    expect(clear.textContent).toBe("Clear search");
    clear.focus();
    clear.click();
    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);
    expect(changes.mock.lastCall?.[0]).toEqual({
      ...previousState, search: "", brokenResultOffset: 0, isolatedResultOffset: 0,
    });
    expect(view.contentEl.querySelector<HTMLDetailsElement>('.link-integrity-isolated-tree details')?.open)
      .toBe(false);
  });

  it("updates language without replacing search and disposes subscriptions on close", async () => {
    const { view, search, refresh, settings } = await openSidebar();
    const previousLabel = search.getAttribute("aria-label");
    search.focus();
    settings.general.locale = "zh-CN";
    view.requestRender();
    expect(search.getAttribute("aria-label")).not.toBe(previousLabel);
    expect(document.activeElement).toBe(search);
    await view.onClose();
    refresh();
    expect(view.contentEl.childElementCount).toBe(0);
  });
});
