import { describe, expect, it, vi } from "vitest";
import { SidebarQueryService } from "../../src/app/sidebar-query-service";
import { createFileRecord, LinkIndex } from "../../src/core";
import { createDefaultSettings } from "../../src/shared/settings";
import { createInitialSidebarState } from "../../src/app/sidebar-view";
import { createScheduledViewModelSelector, createSidebarViewModel, createSidebarViewModelSelector } from "../../src/ui/sidebar/view-model";
import { occurrence, snapshot } from "../core/test-helpers";

function fixture(count = 100) {
  let index = new LinkIndex(Array.from({ length: count }, (_, i) => createFileRecord(`Note-${i}.md`)));
  for (const file of index.files) index.replaceSourceSnapshot(file.path, snapshot(file.path, [
    occurrence(file.path, file.path, { fileStatus: "missing" }),
  ]));
  const settings = createDefaultSettings();
  const query = new SidebarQueryService(() => index, () => settings);
  return {
    query, settings, get index() { return index; },
    publish(next: LinkIndex) { index = next; query.recordChanges(next.changes); query.notifyResults(); },
  };
}

describe("incremental sidebar projections", () => {
  it("marks inactive counts unknown until their changed projection is prepared", async () => {
    const f = fixture(3);
    await f.query.prepareSnapshot("broken-links");
    await f.query.prepareSnapshot("isolated-files");
    const next = f.index.fork();
    next.replaceSourceSnapshot("Note-0.md", snapshot("Note-0.md", [
      occurrence("connected", "Note-0.md", { targetPath: "Note-1.md" }),
    ]));
    f.publish(next);
    await f.query.prepareSnapshot("isolated-files");
    const pending = f.query.getSnapshot("isolated-files");
    expect(pending.isolatedFilesKnown).toBe(true);
    expect(pending.brokenLinksKnown).toBe(false);
    expect(pending.brokenLinks).toHaveLength(3);
    await f.query.prepareSnapshot("broken-links");
    expect(f.query.getSnapshot("broken-links").brokenLinksKnown).toBe(true);
    expect(f.query.getSnapshot("broken-links").brokenLinks).toHaveLength(2);
  });

  it("updates broken locations, isolation endpoints and timestamps without a full registry query", () => {
    const f = fixture();
    f.query.getSnapshot("broken-links");
    f.query.getSnapshot("isolated-files");
    const next = f.index.fork();
    next.replaceSourceSnapshot("Note-0.md", snapshot("Note-0.md", [
      occurrence("connected", "Note-0.md", { targetPath: "Note-1.md" }),
    ]));
    next.replaceFileRecord("Note-2.md", createFileRecord("Note-2.md", { modifiedAt: 999 }));
    const enumerate = vi.spyOn(next, "iterateFiles");
    const allFiles = vi.spyOn(next, "files", "get");
    f.publish(next);
    f.query.getSnapshot("broken-links");
    const result = f.query.getSnapshot("isolated-files");
    expect(enumerate).not.toHaveBeenCalled();
    expect(allFiles).not.toHaveBeenCalled();
    const fresh = new SidebarQueryService(() => next, () => f.settings);
    fresh.getSnapshot("broken-links");
    expect(result).toEqual(fresh.getSnapshot("isolated-files"));
    expect(result.isolatedFiles.some(({ path }) => path === "Note-1.md")).toBe(false);
    expect(result.isolatedFiles.find(({ path }) => path === "Note-2.md")?.modifiedAt).toBe(999);
  });

  it("retains result arrays when a metadata-only edit changes no diagnostic or isolation result", () => {
    const f = fixture();
    const previous = f.query.getSnapshot("broken-links");
    const next = f.index.fork();
    next.replaceFileRecord("Note-0.md", createFileRecord("Note-0.md", { modifiedAt: 2 }));
    f.publish(next);
    expect(f.query.getSnapshot("broken-links").brokenLinks).toBe(previous.brokenLinks);
  });

  it("accumulates changes for an inactive tab and removes deleted files", async () => {
    const f = fixture();
    await f.query.prepareSnapshot("broken-links");
    await f.query.prepareSnapshot("isolated-files");
    let next = f.index.fork();
    next.replaceSourceSnapshot("Note-1.md", snapshot("Note-1.md", []));
    f.publish(next);
    next = f.index.fork();
    next.replaceSourceSnapshot("Note-2.md", snapshot("Note-2.md", []));
    next.replaceFileRecord("Note-3.md", null);
    f.publish(next);
    await f.query.prepareSnapshot("broken-links");
    await f.query.prepareSnapshot("isolated-files");
    const fresh = new SidebarQueryService(() => next, () => f.settings);
    fresh.getSnapshot("broken-links");
    expect(f.query.getSnapshot("isolated-files")).toEqual(fresh.getSnapshot("isolated-files"));
  });

  it("matches scheduled and synchronous projections with ignores and expected/no-incoming rules", async () => {
    const f = fixture(300);
    Object.assign(f.settings.isolatedFiles, { allowNoIncomingFilter: true, expectedFilePaths: ["Note-2.md"] });
    Object.assign(f.settings, { ignoreRules: [{
      id: "hide", enabled: true, scope: "exclude-isolated-candidate",
      matcher: { kind: "source-path", value: "Note-1.md" }, createdAt: 0, note: "",
    }] });
    f.query.notify();
    await f.query.prepareSnapshot("broken-links");
    await f.query.prepareSnapshot("isolated-files");
    const fresh = new SidebarQueryService(() => f.index, () => f.settings);
    fresh.getSnapshot("broken-links");
    expect(f.query.getSnapshot("isolated-files")).toEqual(fresh.getSnapshot("isolated-files"));
    Object.assign(f.settings.isolatedFiles, { allowNoIncomingFilter: false });
    f.query.notify();
    await f.query.prepareSnapshot("isolated-files");
    expect(f.query.getSnapshot("isolated-files").noIncomingFiles).toEqual([]);
  });

  it("cancels a stale scheduled projection after settings invalidation", async () => {
    const f = fixture(1500);
    const pending = f.query.prepareSnapshot("broken-links");
    Object.assign(f.settings.brokenLinks.diagnostics, { missingFiles: false });
    f.query.notify();
    expect(await pending).toBe(false);
    expect(await f.query.prepareSnapshot("broken-links")).toBe(true);
    expect(f.query.getSnapshot("broken-links").brokenLinks).toEqual([]);
  });

  it("keeps sorted view models identical and reuses the result model on progress-only updates", async () => {
    const f = fixture(300);
    await f.query.prepareSnapshot("broken-links");
    await f.query.prepareSnapshot("isolated-files");
    const select = createSidebarViewModelSelector();
    const scheduled = createScheduledViewModelSelector();
    for (const activeTab of ["broken-links", "isolated-files"] as const) {
      for (const search of ["", "Note-1", "nothing"]) {
        const state = { ...createInitialSidebarState(f.settings), activeTab, search };
        const data = f.query.getSnapshot(activeTab);
        const expected = createSidebarViewModel(data, state);
        expect(await scheduled(data, state)).toEqual(expected);
        const first = select(data, state);
        f.query.setProgress(20, 100);
        const progress = select(f.query.getSnapshot(activeTab), state);
        expect(progress.broken).toBe(first.broken);
        expect(progress.isolated).toBe(first.isolated);
      }
    }
  });

  it("matches every broken grouping and isolated sort after changing, adding and removing results", async () => {
    const f = fixture(210);
    f.query.getSnapshot("broken-links");
    f.query.getSnapshot("isolated-files");
    const baseline = f.query.getSnapshot("isolated-files");
    const next = f.index.fork();
    next.replaceSourceSnapshot("Note-2.md", snapshot("Note-2.md", []));
    next.replaceFileRecord("Note-3.md", null);
    next.replaceFileRecord("Note-4.md", createFileRecord("Note-4.md", { modifiedAt: 777 }));
    next.replaceFileRecord("New.md", createFileRecord("New.md", { modifiedAt: 888 }));
    next.replaceSourceSnapshot("New.md", snapshot("New.md", [
      occurrence("new", "New.md", { fileStatus: "missing" }),
    ]));
    f.publish(next);
    await f.query.prepareSnapshot("broken-links");
    await f.query.prepareSnapshot("isolated-files");
    const latest = f.query.getSnapshot("isolated-files");
    const initial = createInitialSidebarState(f.settings);
    for (const brokenGrouping of ["target", "source", "source-folder"] as const) {
      for (const brokenSort of ["path", "count"] as const) {
        const state = { ...initial, activeTab: "broken-links" as const, brokenGrouping, brokenSort };
        const select = createScheduledViewModelSelector();
        await select(baseline, state);
        expect(await select(latest, state)).toEqual(createSidebarViewModel(latest, state));
        const paged = { ...state, brokenResultOffset: 100 };
        expect(await select(latest, paged)).toEqual(createSidebarViewModel(latest, paged));
      }
    }
    for (const isolatedSort of ["path", "name", "modified", "broken-count"] as const) {
      const state = { ...initial, activeTab: "isolated-files" as const, isolatedView: "list" as const, isolatedSort };
      const select = createScheduledViewModelSelector();
      await select(baseline, state);
      expect(await select(latest, state)).toEqual(createSidebarViewModel(latest, state));
    }
  });

  it("abandons an older search when a newer search arrives", async () => {
    const f = fixture(1000);
    const data = f.query.getSnapshot("broken-links");
    const select = createScheduledViewModelSelector();
    const state = createInitialSidebarState(f.settings);
    const old = select(data, { ...state, search: "Note" });
    const latest = select(data, { ...state, search: "Note-999" });
    expect(await old).toBeNull();
    expect(await latest).toEqual(createSidebarViewModel(data, { ...state, search: "Note-999" }));
  });
});
