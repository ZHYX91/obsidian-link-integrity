import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkIntegritySidebarView } from "../../src/app/sidebar-view";
import { SidebarQueryService } from "../../src/app/sidebar-query-service";
import { createFileRecord, LinkIndex } from "../../src/core";
import { createDefaultSettings } from "../../src/shared/settings";
import { occurrence, snapshot } from "../core/test-helpers";

const views: LinkIntegritySidebarView[] = [];
afterEach(async () => {
  for (const view of views.splice(0)) await view.onClose();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function fixture() {
  let index = new LinkIndex([createFileRecord("A.md"), createFileRecord("B.md")]);
  for (const path of ["A.md", "B.md"]) index.replaceSourceSnapshot(path, snapshot(path, [
    occurrence(path, path, { fileStatus: "missing" }),
  ]));
  const defaults = createDefaultSettings();
  const settings = { ...defaults, ui: { ...defaults.ui, brokenView: "list" as const } };
  const query = new SidebarQueryService(() => index, () => settings);
  query.setStatus({ state: "ready", current: 0, total: 0, errorMessage: null });
  const open = vi.fn();
  const errors = vi.fn();
  const view = new LinkIntegritySidebarView({} as never, {
    query, getSettings: () => settings, ensureIndex: () => undefined,
    navigation: { openBrokenLink: open, openFile: () => undefined, rebuildIndex: () => undefined },
    onViewStateChange: () => undefined, onActionError: errors,
  });
  views.push(view);
  document.body.append(view.contentEl);
  await view.onOpen();
  await vi.waitFor(() => expect(view.contentEl.querySelectorAll(".link-integrity-result-row")).toHaveLength(2));
  return {
    query, view, open, errors, get index() { return index; },
    publish(next: LinkIndex) { index = next; query.recordChanges(next.changes); query.notifyResults(); },
  };
}

describe("scheduled sidebar rendering", () => {
  it("moves keyboard focus with the selected tab after the production asynchronous query", async () => {
    const f = await fixture();
    const tabs = f.view.contentEl.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await vi.waitFor(() => {
      expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(tabs[1]);
    });
    tabs[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await vi.waitFor(() => {
      expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(tabs[0]);
    });
  });

  it.each(["ArrowRight", "Home"])("keeps the latest keyboard request when %s follows a pending End", async (key) => {
    const f = await fixture();
    const prepare = f.query.prepareSnapshot.bind(f.query);
    const completions: (() => void)[] = [];
    vi.spyOn(f.query, "prepareSnapshot").mockImplementation(async (tab) => {
      await new Promise<void>((resolve) => completions.push(resolve));
      return prepare(tab);
    });
    const tabs = f.view.contentEl.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(completions).toHaveLength(2);
    completions[1]!();
    await vi.waitFor(() => {
      expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(tabs[0]);
    });
    completions[0]!();
    await prepare("isolated-files");
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("false");
    expect(document.activeElement).toBe(tabs[0]);
  });

  it.each(["search", "external", "blur", "close"])("does not reclaim delayed tab focus after %s", async (action) => {
    const f = await fixture();
    const prepare = f.query.prepareSnapshot.bind(f.query);
    let release!: () => void;
    vi.spyOn(f.query, "prepareSnapshot").mockImplementation(async (tab) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return prepare(tab);
    });
    const tabs = f.view.contentEl.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    let expected = document.activeElement;
    if (action === "search") {
      const search = f.view.contentEl.querySelector<HTMLInputElement>('input[type="search"]')!;
      search.focus(); expected = search;
    } else if (action === "external") {
      const button = document.createElement("button"); document.body.append(button);
      button.focus(); expected = button;
    } else if (action === "blur") window.dispatchEvent(new Event("blur"));
    else { await f.view.onClose(); expected = document.activeElement; }
    release();
    if (action !== "close") await vi.waitFor(() => expect(tabs[1]!.getAttribute("aria-selected")).toBe("true"));
    else { await prepare("isolated-files"); expect(f.view.contentEl.childElementCount).toBe(0); }
    expect(document.activeElement).toBe(expected);
  });

  it("preserves the current page and focus across progress updates", async () => {
    const f = await fixture();
    const row = f.view.contentEl.querySelector<HTMLElement>(".link-integrity-result-row")!;
    const button = row.querySelector<HTMLButtonElement>("button")!;
    button.focus();
    f.query.setProgress(1, 100);
    await vi.waitFor(() => expect(f.view.contentEl.querySelector(".link-integrity-status")).not.toBeNull());
    const afterStateChange = f.view.contentEl.querySelector(".link-integrity-result-row");
    expect(afterStateChange).toBe(row);
    f.query.setProgress(2, 100);
    await vi.waitFor(() => expect(f.view.contentEl.querySelector(".link-integrity-status")?.textContent).toContain("2"));
    expect(f.view.contentEl.querySelector(".link-integrity-result-row")).toBe(row);
    expect(document.activeElement).toBe(button);
    expect(f.errors).not.toHaveBeenCalled();
  });

  it("reuses unaffected rows and replaces a changed location without retaining its old click payload", async () => {
    const f = await fixture();
    const firstRow = f.view.contentEl.querySelector(".link-integrity-result-row")!;
    let next = f.index.fork();
    next.replaceSourceSnapshot("B.md", snapshot("B.md", []));
    f.publish(next);
    await vi.waitFor(() => expect(f.view.contentEl.querySelectorAll(".link-integrity-result-row")).toHaveLength(1));
    expect(f.view.contentEl.querySelector(".link-integrity-result-row")).toBe(firstRow);
    const oldButton = f.view.contentEl.querySelector<HTMLButtonElement>(".link-integrity-result-main")!;
    oldButton.focus();
    next = f.index.fork();
    next.replaceSourceSnapshot("A.md", snapshot("A.md", [{
      ...occurrence("A.md", "A.md", { fileStatus: "missing" }),
      position: { line: 42, column: 3, endLine: 42, endColumn: 12, property: null, canvasNodeId: null },
    }]));
    f.publish(next);
    await vi.waitFor(() => expect(Array.from(
      f.view.contentEl.querySelectorAll(".link-integrity-result-context"),
    ).some(({ textContent }) => textContent?.includes("L43") === true)).toBe(true));
    expect(f.view.contentEl.querySelector(".link-integrity-result-path")?.textContent).toBe("A.md");
    const newButton = f.view.contentEl.querySelector<HTMLButtonElement>(".link-integrity-result-main")!;
    expect(newButton).not.toBe(oldButton);
    expect(document.activeElement).toBe(newButton);
    newButton.click();
    expect(f.open).toHaveBeenLastCalledWith(expect.objectContaining({ location: expect.objectContaining({ line: 42, column: 3 }) }));
    expect(f.view.contentEl.querySelector(".link-integrity-result-row")).not.toBe(firstRow);
  });

  it("defers hidden view queries and catches up when visible again", async () => {
    let observe!: (entries: { isIntersecting: boolean }[]) => void;
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: typeof observe) { observe = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const f = await fixture();
    const prepare = vi.spyOn(f.query, "prepareSnapshot");
    observe([{ isIntersecting: false }]);
    const next = f.index.fork();
    next.replaceSourceSnapshot("B.md", snapshot("B.md", []));
    f.publish(next);
    expect(prepare).not.toHaveBeenCalled();
    observe([{ isIntersecting: true }]);
    await vi.waitFor(() => expect(f.view.contentEl.querySelectorAll(".link-integrity-result-row")).toHaveLength(1));
    expect(prepare).toHaveBeenCalled();
    await f.view.onClose();
    expect(disconnect).toHaveBeenCalled();
  });

  it("cancels delayed tab focus when the view becomes hidden", async () => {
    let observe!: (entries: { isIntersecting: boolean }[]) => void;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: typeof observe) { observe = callback; }
      observe() {}
      disconnect() {}
    });
    const f = await fixture();
    const prepare = f.query.prepareSnapshot.bind(f.query);
    let release!: () => void;
    vi.spyOn(f.query, "prepareSnapshot").mockImplementationOnce(async (tab) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return prepare(tab);
    });
    const tabs = f.view.contentEl.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    observe([{ isIntersecting: false }]);
    release();
    await prepare("isolated-files");
    observe([{ isIntersecting: true }]);
    await vi.waitFor(() => expect(tabs[1]!.getAttribute("aria-selected")).toBe("true"));
    expect(document.activeElement).toBe(tabs[0]);
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs[1]));
  });
});
