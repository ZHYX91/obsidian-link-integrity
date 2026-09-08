import { performance } from "node:perf_hooks";
import { expect, it, vi } from "vitest";
import { createFileRecord, LinkIndex } from "../src/core";
import { AtomicLinkIndexStore } from "../src/features/index/atomic-store";
import { IncrementalIndexController } from "../src/features/index/incremental-controller";
import { SidebarQueryService } from "../src/app/sidebar-query-service";
import { createDefaultSettings } from "../src/shared/settings";
import type { LinkIndexPort } from "../src/features/index/ports";
import { occurrence, snapshot } from "../tests/core/test-helpers";
import { createScheduledViewModelSelector, type SidebarViewState } from "../src/ui/sidebar/view-model";

const LARGE = process.env.LINK_INTEGRITY_BENCHMARK_MODE === "large";
const FILE_COUNT = LARGE ? 50_000 : 10_000;

it(`keeps editing a heavily referenced note local in a ${FILE_COUNT}-file Vault`, async () => {
  const files = Array.from({ length: FILE_COUNT }, (_, i) => createFileRecord(`Note-${i}.md`, {
    targetFingerprint: "ready", modifiedAt: 0,
  }));
  const index = new LinkIndex(files);
  const hub = files[0]!;
  for (const file of files) index.replaceSourceSnapshot(file.path, snapshot(file.path,
    file === hub ? [] : [occurrence(file.path, file.path, { targetPath: hub.path })]));
  const store = new AtomicLinkIndexStore(index);
  const fileMap = new Map(files.map((file) => [file.path, file]));
  const port: LinkIndexPort = {
    listFiles: vi.fn(async () => files),
    getFileRecord: async (path) => fileMap.get(path) ?? null,
    buildSourceSnapshot: vi.fn(async (path) => index.getSourceSnapshot(path)),
  };
  const query = new SidebarQueryService(() => store.current, createDefaultSettings);
  query.getSnapshot("broken-links");
  query.getSnapshot("isolated-files");
  const beforeBroken = query.getSnapshot("broken-links").brokenLinks;
  const controller = new IncrementalIndexController(port, store, {
    onChanges: (changes) => query.recordChanges(changes),
  });
  controller.start();
  const started = performance.now();
  for (let revision = 1; revision <= 12; revision += 1) {
    fileMap.set(hub.path, createFileRecord(hub.path, { targetFingerprint: "ready", modifiedAt: revision }));
    controller.enqueue({ type: "modify", path: hub.path });
    await controller.whenIdle();
    await query.prepareSnapshot("broken-links");
    await query.prepareSnapshot("isolated-files");
  }
  const elapsed = performance.now() - started;
  expect(port.buildSourceSnapshot).toHaveBeenCalledTimes(12);
  expect(port.listFiles).not.toHaveBeenCalled();
  expect(query.getSnapshot("broken-links").brokenLinks).toBe(beforeBroken);
  expect(store.current.getIncomingNeighborCount(hub.path)).toBe(FILE_COUNT - 1);
  expect(index.getFile(hub.path)?.modifiedAt).toBe(0);
  expect(elapsed).toBeLessThan(LARGE ? 1500 : 750);
  console.log(`Link Integrity local-edit benchmark: ${FILE_COUNT} files, ${FILE_COUNT - 1} incoming sources, ` +
    `12 edits, 12 source builds, 0 registry scans in ${elapsed.toFixed(1)} ms`);
});

it(`schedules initial projection and changed-row ordering for ${FILE_COUNT} isolated results`, async () => {
  let index = new LinkIndex(Array.from({ length: FILE_COUNT }, (_, i) => createFileRecord(`Note-${i}.md`)));
  const settings = createDefaultSettings();
  const query = new SidebarQueryService(() => index, () => settings);
  const select = createScheduledViewModelSelector();
  const state: SidebarViewState = {
    activeTab: "isolated-files", search: "", brokenView: "list", brokenGrouping: "target",
    brokenSort: "path", isolatedView: "list", isolatedSort: "modified", isolatedMode: "isolated",
    showExpectedIsolated: false, selectedFormatFamilyIds: new Set(["markdown"]),
    brokenResultOffset: 0, isolatedResultOffset: 0, expandedBrokenFolderPaths: new Set(),
  };
  const started = performance.now();
  await query.prepareSnapshot("isolated-files");
  await select(query.getSnapshot("isolated-files"), state);
  const initialMs = performance.now() - started;
  const updateStarted = performance.now();
  index = index.fork();
  index.replaceFileRecord("Note-999.md", createFileRecord("Note-999.md", { modifiedAt: 999 }));
  query.recordChanges(index.changes);
  await query.prepareSnapshot("isolated-files");
  const model = await select(query.getSnapshot("isolated-files"), state);
  expect(model?.isolated.items[0]?.path).toBe("Note-999.md");
  expect(model?.isolated.renderedCount).toBe(100);
  console.log(`Link Integrity scheduled sidebar: ${FILE_COUNT} results, initial ${initialMs.toFixed(1)} ms, ` +
    `one changed row ${(performance.now() - updateStarted).toFixed(1)} ms; includes cooperative task yields`);
});
