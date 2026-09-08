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
    next = f.index.fork();
    next.replaceSourceSnapshot("A.md", snapshot("A.md", [{
      ...occurrence("A.md", "A.md", { fileStatus: "missing" }),
      position: { line: 42, column: 3, endLine: 42, endColumn: 12, property: null, canvasNodeId: null },
    }]));
    f.publish(next);
    await vi.waitFor(() => expect(f.view.contentEl.querySelector(".link-integrity-result-path")?.textContent).toBe("A.md:43"));
    f.view.contentEl.querySelector<HTMLButtonElement>(".link-integrity-result-main")!.click();
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
});
