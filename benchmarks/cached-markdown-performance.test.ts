import type { CachedMetadata, MetadataCache, Vault } from "obsidian";
import { expect, it, vi } from "vitest";

import { ObsidianLinkIndexPort } from "../src/adapters/obsidian/link-index-port";
import { LinkIndex } from "../src/core";
import { AtomicLinkIndexStore } from "../src/features/index/atomic-store";
import { IncrementalIndexController } from "../src/features/index/incremental-controller";

const SOURCE_COUNT = process.env.LINK_INTEGRITY_BENCHMARK_MODE === "large" ? 50_000 : 10_000;

it(`filters positioned cached non-content in ${SOURCE_COUNT} sources and keeps 12 edits local`, async () => {
  const files = Array.from({ length: SOURCE_COUNT }, (_, index) => file(`Source-${index}.md`));
  const hub = file("Hub.md"); const target = file("Target.md");
  const fileMap = new Map([...files, hub, target].map((value) => [value.path, value]));
  const body = "[[Hub]]\n%% [[Ghost]] ![[Ghost.png]] %%\n";
  const content = new Map(files.map(({ path }) => [path, body]));
  const caches = new Map<string, CachedMetadata>(files.map(({ path }) => [path, {
    links: [reference("Hub", "[[Hub]]", 0, 0), reference("Ghost", "[[Ghost]]", 1, 3)],
    embeds: [reference("Ghost.png", "![[Ghost.png]]", 1, 13)],
  }]));
  content.set(hub.path, "[[Target]]");
  caches.set(hub.path, { links: [reference("Target", "[[Target]]", 0, 0)] });
  caches.set(target.path, {});
  const cachedRead = vi.fn(async (value: { readonly path: string }) => content.get(value.path) ?? "");
  const getFiles = vi.fn(() => [...fileMap.values()]);
  const port = new ObsidianLinkIndexPort({
    getFiles, getFileByPath: (path: string) => fileMap.get(path) ?? null, cachedRead,
  } as unknown as Vault, {
    getFileCache: (value: { readonly path: string }) => caches.get(value.path) ?? null,
    getFirstLinkpathDest: (path: string) => fileMap.get(`${path}.md`) ?? null,
  } as unknown as MetadataCache);
  const started = performance.now();
  const index = new LinkIndex(await port.listFiles());
  for (const value of fileMap.values()) {
    index.replaceSourceSnapshot(value.path, (await port.buildSourceSnapshot(value.path))!);
  }
  const buildMs = performance.now() - started;
  expect(cachedRead).toHaveBeenCalledTimes(SOURCE_COUNT + 1);
  expect(index.occurrences).toHaveLength(SOURCE_COUNT + 1);
  expect(index.getIncomingNeighborCount(hub.path)).toBe(SOURCE_COUNT);
  expect(index.getIncomingContributionCount(hub.path)).toBe(SOURCE_COUNT);
  expect(index.getOutgoingNeighborCount(hub.path)).toBe(1);
  cachedRead.mockClear(); getFiles.mockClear();
  const buildSource = vi.spyOn(port, "buildSourceSnapshot");
  const store = new AtomicLinkIndexStore(index);
  const controller = new IncrementalIndexController(port, store);
  controller.start();
  const editsStarted = performance.now();
  for (let revision = 1; revision <= 12; revision += 1) {
    hub.stat.mtime = revision;
    content.set(hub.path, `Revision ${revision}\n[[Target]]\n%% [[Ghost]] %%`);
    caches.set(hub.path, { links: [reference("Target", "[[Target]]", 1, 0), reference("Ghost", "[[Ghost]]", 2, 3)] });
    controller.enqueue({ type: "modify", path: hub.path });
    await controller.whenIdle();
  }
  const editsMs = performance.now() - editsStarted;
  expect(buildSource).toHaveBeenCalledTimes(12);
  expect(cachedRead).toHaveBeenCalledTimes(12);
  expect(getFiles).not.toHaveBeenCalled();
  expect(store.current.getIncomingNeighborCount(hub.path)).toBe(SOURCE_COUNT);
  expect(store.current.getSourceSnapshot(hub.path)?.occurrences).toHaveLength(1);
  const current = store.current.getSourceSnapshot(hub.path);
  caches.delete(hub.path);
  expect(await port.buildSourceSnapshot(hub.path)).toEqual(current);
  controller.stop();
  console.log(`Cached Markdown: ${SOURCE_COUNT} sources, ${fileMap.size} registry files, ` +
    `${SOURCE_COUNT * body.length} generated-source UTF16 units; one body read/source, ` +
    `${SOURCE_COUNT + 1} retained occurrences, ${SOURCE_COUNT * 2} protected entries excluded; ` +
    `build ${buildMs.toFixed(1)} ms, 12 local edits/12 reads/0 registry scans ${editsMs.toFixed(1)} ms.`);
});

function file(path: string) {
  return { path, extension: "md", stat: { mtime: 0 } };
}

function reference(link: string, original: string, line: number, col: number) {
  // Cache line/column remains authoritative when host offsets use normalized LF.
  return { link, original, position: {
    start: { line, col, offset: 0 }, end: { line, col: col + original.length, offset: 0 },
  } };
}
