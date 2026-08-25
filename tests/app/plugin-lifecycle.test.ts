import { Notice, TFile, TFolder } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import LinkIntegrityPlugin from "../../src/app/plugin";
import { createInitialSidebarState } from "../../src/app/sidebar-view";
import {
  createOccurrenceId,
  occurrenceIdMatches,
} from "../../src/core/occurrence-identity";
import { createDefaultSettings } from "../../src/shared/settings";
import type { IndexStatus, SidebarViewState } from "../../src/ui/sidebar";

afterEach(() => {
  vi.useRealTimers();
});

describe("plugin index lifecycle", () => {
  it("keeps the runtime dormant until an on-demand index is requested", async () => {
    vi.useFakeTimers();
    const file = createMockFile("A.md", 1);
    const vaultEvents = new TestEvents();
    const metadataEvents = new TestEvents();
    let layoutReady: (() => void) | null = null;
    let snapshotBuildCount = 0;
    const app = {
      vault: {
        cachedRead: async () => "",
        getFileByPath: (path: string) => path === file.path ? file : null,
        getFiles: () => [file],
        on: vaultEvents.on,
      },
      metadataCache: {
        getFileCache: () => {
          snapshotBuildCount += 1;
          return { links: [], embeds: [], frontmatterLinks: [] };
        },
        getFirstLinkpathDest: () => null,
        on: metadataEvents.on,
        offref: metadataEvents.offref,
      },
      workspace: {
        getLeavesOfType: () => [],
        onLayoutReady: (callback: () => void) => {
          layoutReady = callback;
        },
      },
    };
    const plugin = new LinkIntegrityPlugin(app as never, {} as never);
    Object.assign(plugin, { app });
    const defaults = createDefaultSettings();
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      ...defaults,
      general: { ...defaults.general, scanOnStartup: false },
      ignoreRules: [{
        id: "dormant-occurrence",
        enabled: true,
        scope: "ignore-occurrence",
        matcher: {
          kind: "occurrence-id",
          value: testOccurrenceId("Dormant.md", "2:0", 1),
        },
        createdAt: 1,
        note: "",
      }],
    });

    await plugin.onload();
    expect(layoutReady).not.toBeNull();
    (layoutReady as (() => void) | null)?.();
    await Promise.resolve();
    expect(metadataEvents.listenerCount("resolved")).toBe(0);
    expect(metadataEvents.listenerCount("resolve")).toBe(0);
    expect(metadataEvents.listenerCount("changed")).toBe(0);
    expect(metadataEvents.listenerCount("deleted")).toBe(0);
    expect(vaultEvents.listenerCount("modify")).toBe(0);
    expect(vaultEvents.listenerCount("rename")).toBe(1);

    const runtime = plugin as unknown as PluginRuntimeInspection;
    expect(runtime.query.getSnapshot().status.state).toBe("idle");
    expect(runtime.coordinator.store.generation).toBe(0);
    vaultEvents.emit("rename", createMockFile("Moved.md", 2), "Dormant.md");
    const dormantRule = plugin.getSettings().ignoreRules[0];
    expect(occurrenceIdMatches(
      dormantRule?.matcher.value ?? "",
      testOccurrenceId("Moved.md", "12:0", 7),
    )).toBe(true);
    vaultEvents.emit("modify", file);
    await Promise.resolve();
    expect(snapshotBuildCount).toBe(0);
    expect(runtime.coordinator.store.generation).toBe(0);

    const indexing = plugin.ensureIndex();
    expect(plugin.ensureIndex()).toBe(indexing);
    expect(vaultEvents.listenerCount("modify")).toBe(1);
    expect(metadataEvents.listenerCount("resolved")).toBe(1);
    metadataEvents.emit("resolved");
    await indexing;
    expect(runtime.query.getSnapshot().status.state).toBe("ready");
    expect(runtime.coordinator.store.generation).toBeGreaterThanOrEqual(1);
    expect(runtime.coordinator.index.files.map(({ path }) => path)).toEqual(["A.md"]);
    expect(snapshotBuildCount).toBeGreaterThanOrEqual(1);
    expect(metadataEvents.listenerCount("changed")).toBe(1);
    expect(metadataEvents.listenerCount("deleted")).toBe(1);

    const rebuildSpy = vi.spyOn(plugin, "rebuild");
    const buildsBeforeRegraph = snapshotBuildCount;
    plugin.updateSettings({
      ...plugin.getSettings(),
      ignoreRules: [{
        id: "graph-rule",
        enabled: true,
        scope: "exclude-graph-contribution",
        matcher: { kind: "source-path", value: "A.md" },
        createdAt: 1,
        note: "",
      }],
    }, "regraph");
    expect(rebuildSpy).not.toHaveBeenCalled();
    expect(snapshotBuildCount).toBe(buildsBeforeRegraph);

    runtime.setExpectedFile("A.md", true, document);
    expect(plugin.getSettings().isolatedFiles.expectedFilePaths).toEqual(["A.md"]);
    const undoNotice = (Notice as unknown as { messages: unknown[] }).messages
      .at(-1) as DocumentFragment;
    undoNotice.querySelector<HTMLButtonElement>("button")?.click();
    expect(plugin.getSettings().isolatedFiles.expectedFilePaths).toEqual([]);

    runtime.addExpectedFolderRule("Archive", "recursive", document);
    expect(plugin.getSettings().isolatedFiles.expectedRules).toEqual([
      expect.objectContaining({
        name: "Expected folder: Archive",
        folder: { path: "Archive", mode: "recursive" },
      }),
    ]);
    const folderUndoNotice = (Notice as unknown as { messages: unknown[] }).messages
      .at(-1) as DocumentFragment;
    expect(folderUndoNotice.textContent).toContain(
      "Marked Archive as expected isolated (Include subfolders)",
    );
    folderUndoNotice.querySelector<HTMLButtonElement>("button")?.click();
    expect(plugin.getSettings().isolatedFiles.expectedRules).toEqual([]);

    const disabledFolderRule = {
      id: "existing-folder",
      name: "Existing folder",
      enabled: false,
      fileTypeFamilyIds: [],
      fileTypeCategoryIds: [],
      fileExtensions: [],
      folder: { path: "Archive", mode: "recursive" as const },
      namingPatterns: [],
    };
    const folderOccurrenceId = testOccurrenceId("Archive/Single.md", "3:0", 2);
    plugin.updateSettings({
      ...plugin.getSettings(),
      isolatedFiles: {
        ...plugin.getSettings().isolatedFiles,
        expectedFilePaths: ["Archive/Single.md"],
        expectedRules: [disabledFolderRule],
      },
      ignoreRules: [
        ...plugin.getSettings().ignoreRules,
        {
          id: "folder-occurrence",
          enabled: true,
          scope: "ignore-occurrence",
          matcher: { kind: "occurrence-id", value: folderOccurrenceId },
          createdAt: 1,
          note: "",
        },
      ],
    }, "query-only");
    runtime.addExpectedFolderRule("Archive", "recursive", document);
    expect(plugin.getSettings().isolatedFiles.expectedRules).toEqual([
      { ...disabledFolderRule, enabled: true },
    ]);
    const reenableUndoNotice = (Notice as unknown as { messages: unknown[] }).messages
      .at(-1) as DocumentFragment;
    reenableUndoNotice.querySelector<HTMLButtonElement>("button")?.click();
    expect(plugin.getSettings().isolatedFiles.expectedRules).toEqual([disabledFolderRule]);

    vaultEvents.emit("rename", createMockFolder("Stored"), "Archive");
    expect(plugin.getSettings().isolatedFiles.expectedFilePaths).toEqual(["Stored/Single.md"]);
    expect(plugin.getSettings().isolatedFiles.expectedRules[0]?.folder?.path).toBe("Stored");
    const renamedFolderRule = plugin.getSettings().ignoreRules
      .find(({ id }) => id === "folder-occurrence");
    expect(renamedFolderRule?.matcher.kind).toBe("occurrence-id");
    expect(occurrenceIdMatches(
      renamedFolderRule?.matcher.value ?? "",
      testOccurrenceId("Stored/Single.md", "18:0", 9),
    )).toBe(true);

    let queryNotifications = 0;
    const unsubscribe = runtime.query.subscribe(() => {
      queryNotifications += 1;
    });
    const baselineBuildCount = snapshotBuildCount;
    metadataEvents.emit("resolved");
    await Promise.resolve();
    expect(snapshotBuildCount).toBe(baselineBuildCount);

    const notificationsBeforeLateResolve = queryNotifications;
    metadataEvents.emit("resolve", file);
    await runtime.coordinator.whenIdle();
    await Promise.resolve();
    expect(snapshotBuildCount).toBe(baselineBuildCount);
    expect(queryNotifications).toBe(notificationsBeforeLateResolve);

    const previousState = createInitialSidebarState(defaults);
    runtime.persistViewState({
      ...previousState,
      activeTab: "isolated-files",
    }, previousState);
    expect(queryNotifications).toBe(0);
    unsubscribe();

    vaultEvents.emit("modify", file);
    await vi.runOnlyPendingTimersAsync();
    await runtime.coordinator.whenIdle();
    expect(snapshotBuildCount).toBeGreaterThan(1);
    plugin.onunload();
  });

  it("revalidates all sources once when host metadata resolves after the startup fallback", async () => {
    vi.useFakeTimers();
    const source = createMockFile("Source.md", 1);
    const target = createMockFile("Target.md", 2);
    const vaultEvents = new TestEvents();
    const metadataEvents = new TestEvents();
    let layoutReady: (() => void) | null = null;
    let snapshotBuildCount = 0;
    let metadataReady = false;
    const app = {
      vault: {
        cachedRead: async (file: TFile) => file.path === source.path ? "[[Target]]" : "",
        getFileByPath: (path: string) => [source, target]
          .find((file) => file.path === path) ?? null,
        getFiles: () => [source, target],
        on: vaultEvents.on,
      },
      metadataCache: {
        getFileCache: (file: TFile) => {
          snapshotBuildCount += 1;
          if (!metadataReady) return null;
          return file.path === source.path
            ? { links: [reference("Target", "[[Target]]")] }
            : { links: [], embeds: [], frontmatterLinks: [] };
        },
        getFirstLinkpathDest: (linkpath: string) =>
          metadataReady && linkpath === "Target" ? target : null,
        on: metadataEvents.on,
        offref: metadataEvents.offref,
      },
      workspace: {
        getLeavesOfType: () => [],
        onLayoutReady: (callback: () => void) => {
          layoutReady = callback;
        },
      },
    };
    const plugin = new LinkIntegrityPlugin(app as never, {} as never);
    Object.assign(plugin, { app });
    const defaults = createDefaultSettings();
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      ...defaults,
      general: { ...defaults.general, scanOnStartup: true },
    });

    await plugin.onload();
    (layoutReady as (() => void) | null)?.();
    expect(metadataEvents.listenerCount("resolved")).toBe(1);
    expect(metadataEvents.listenerCount("resolve")).toBe(0);

    const runtime = plugin as unknown as PluginRuntimeInspection;
    await vi.advanceTimersByTimeAsync(1_000);
    await runtime.coordinator.whenIdle();
    expect(runtime.query.getSnapshot().status.state).toBe("ready");
    expect(runtime.coordinator.index.getOutgoingNeighborCount(source.path)).toBe(0);
    expect(metadataEvents.listenerCount("resolved")).toBe(1);
    expect(metadataEvents.listenerCount("resolve")).toBe(0);
    expect(metadataEvents.listenerCount("changed")).toBe(1);
    expect(metadataEvents.listenerCount("deleted")).toBe(1);

    const fallbackBuildCount = snapshotBuildCount;
    metadataReady = true;
    metadataEvents.emit("resolved");
    await vi.advanceTimersByTimeAsync(100);
    await runtime.coordinator.whenIdle();
    await Promise.resolve();

    expect(runtime.coordinator.index.getOutgoingNeighborCount(source.path)).toBe(1);
    expect(snapshotBuildCount).toBeGreaterThan(fallbackBuildCount);
    expect(metadataEvents.listenerCount("resolved")).toBe(0);
    const correctedBuildCount = snapshotBuildCount;
    metadataEvents.emit("resolved");
    for (let count = 0; count < 100; count += 1) metadataEvents.emit("resolve", source);
    await vi.runOnlyPendingTimersAsync();
    await runtime.coordinator.whenIdle();
    expect(snapshotBuildCount).toBe(correctedBuildCount);
    plugin.onunload();
  });

  it("detaches the initial metadata gate and settles an in-flight scan on unload", async () => {
    vi.useFakeTimers();
    const file = createMockFile("A.md", 1);
    const vaultEvents = new TestEvents();
    const metadataEvents = new TestEvents();
    let layoutReady: (() => void) | null = null;
    const app = {
      vault: {
        cachedRead: async () => "",
        getFileByPath: (path: string) => path === file.path ? file : null,
        getFiles: () => [file],
        on: vaultEvents.on,
      },
      metadataCache: {
        getFileCache: () => null,
        getFirstLinkpathDest: () => null,
        on: metadataEvents.on,
        offref: metadataEvents.offref,
      },
      workspace: {
        getLeavesOfType: () => [],
        onLayoutReady: (callback: () => void) => {
          layoutReady = callback;
        },
      },
    };
    const plugin = new LinkIntegrityPlugin(app as never, {} as never);
    Object.assign(plugin, { app });
    vi.spyOn(plugin, "loadData").mockResolvedValue(createDefaultSettings());

    await plugin.onload();
    (layoutReady as (() => void) | null)?.();
    const indexing = plugin.ensureIndex();
    expect(metadataEvents.listenerCount("resolved")).toBe(1);

    plugin.onunload();
    expect(metadataEvents.listenerCount("resolved")).toBe(0);
    await expect(indexing).resolves.toBeUndefined();
    await vi.runOnlyPendingTimersAsync();
    const runtime = plugin as unknown as PluginRuntimeInspection;
    expect(runtime.initialMetadataState).toBe("dormant");
  });

  it("absorbs pre-scan Vault events into the startup baseline without replaying them", async () => {
    vi.useFakeTimers();
    const fileA = createMockFile("A.md", 1);
    const fileB = createMockFile("B.md", 2);
    const fileC = createMockFile("C.md", 3);
    let files = [fileA];
    const vaultEvents = new TestEvents();
    const metadataEvents = new TestEvents();
    let layoutReady: (() => void) | null = null;
    let snapshotBuildCount = 0;
    const app = {
      vault: {
        cachedRead: async () => "",
        getFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
        getFiles: () => files,
        on: vaultEvents.on,
      },
      metadataCache: {
        getFileCache: () => {
          snapshotBuildCount += 1;
          return { links: [], embeds: [], frontmatterLinks: [] };
        },
        getFirstLinkpathDest: () => null,
        on: metadataEvents.on,
        offref: metadataEvents.offref,
      },
      workspace: {
        getLeavesOfType: () => [],
        onLayoutReady: (callback: () => void) => {
          layoutReady = callback;
        },
      },
    };
    const plugin = new LinkIntegrityPlugin(app as never, {} as never);
    Object.assign(plugin, { app });
    const defaults = createDefaultSettings();
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      ...defaults,
      general: { ...defaults.general, scanOnStartup: true },
      isolatedFiles: {
        ...defaults.isolatedFiles,
        expectedFilePaths: [fileB.path],
      },
      ignoreRules: [{
        id: "file-occurrence",
        enabled: true,
        scope: "ignore-occurrence",
        matcher: {
          kind: "occurrence-id",
          value: testOccurrenceId(fileB.path, "4:0", 3),
        },
        createdAt: 1,
        note: "",
      }],
    });

    await plugin.onload();
    (layoutReady as (() => void) | null)?.();
    expect(metadataEvents.listenerCount("resolved")).toBe(1);

    files = [fileA, fileB];
    vaultEvents.emit("create", fileB);
    vaultEvents.emit("modify", fileA);
    files = [fileA, fileC];
    vaultEvents.emit("rename", fileC, fileB.path);
    files = [fileC];
    vaultEvents.emit("delete", fileA);
    for (let count = 0; count < 100; count += 1) vaultEvents.emit("modify", fileC);
    metadataEvents.emit("resolved");

    await plugin.ensureIndex();
    const runtime = plugin as unknown as PluginRuntimeInspection;
    await Promise.resolve();
    expect(runtime.query.getSnapshot().status.state).toBe("ready");
    expect(runtime.coordinator.index.files.map(({ path }) => path)).toEqual(["C.md"]);
    expect(plugin.getSettings().isolatedFiles.expectedFilePaths).toEqual(["C.md"]);
    const renamedFileRule = plugin.getSettings().ignoreRules[0];
    expect(occurrenceIdMatches(
      renamedFileRule?.matcher.value ?? "",
      testOccurrenceId("C.md", "7:0", 5),
    )).toBe(true);
    expect(snapshotBuildCount).toBe(1);
    plugin.onunload();
  });

  it("still replays Vault events that arrive after a baseline scan begins", async () => {
    vi.useFakeTimers();
    const canvas = createMockFile("A.canvas", 1);
    const target = createMockFile("B.md", 1);
    const vaultEvents = new TestEvents();
    const metadataEvents = new TestEvents();
    let layoutReady: (() => void) | null = null;
    let source = JSON.stringify({ nodes: [] });
    let cachedReadCount = 0;
    let releaseFirstRead = (): void => undefined;
    let markFirstReadStarted = (): void => undefined;
    const firstReadStarted = new Promise<void>((resolve) => {
      markFirstReadStarted = resolve;
    });
    const firstReadGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const app = {
      vault: {
        cachedRead: async () => {
          cachedReadCount += 1;
          const captured = source;
          if (cachedReadCount === 1) {
            markFirstReadStarted();
            await firstReadGate;
          }
          return captured;
        },
        getFileByPath: (path: string) => [canvas, target]
          .find((file) => file.path === path) ?? null,
        getFiles: () => [canvas, target],
        on: vaultEvents.on,
      },
      metadataCache: {
        getFileCache: () => ({ links: [], embeds: [], frontmatterLinks: [] }),
        getFirstLinkpathDest: (path: string) => path === target.path ? target : null,
        on: metadataEvents.on,
        offref: metadataEvents.offref,
      },
      workspace: {
        getLeavesOfType: () => [],
        onLayoutReady: (callback: () => void) => {
          layoutReady = callback;
        },
      },
    };
    const plugin = new LinkIntegrityPlugin(app as never, {} as never);
    Object.assign(plugin, { app });
    const defaults = createDefaultSettings();
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      ...defaults,
      general: { ...defaults.general, scanOnStartup: true },
    });

    await plugin.onload();
    (layoutReady as (() => void) | null)?.();
    metadataEvents.emit("resolved");
    await firstReadStarted;

    source = JSON.stringify({
      nodes: [{ id: "target", type: "file", file: target.path }],
    });
    vaultEvents.emit("modify", canvas);
    await vi.advanceTimersByTimeAsync(100);
    releaseFirstRead();

    const runtime = plugin as unknown as PluginRuntimeInspection;
    const startupRebuild = runtime.coordinator.rebuildPromise;
    expect(startupRebuild).not.toBeNull();
    await startupRebuild;
    expect(cachedReadCount).toBe(2);
    expect(runtime.coordinator.index.getOutgoingNeighborCount(canvas.path)).toBe(1);
    plugin.onunload();
  });

  it("coalesces same-path Vault and metadata bursts into one incremental notification", async () => {
    vi.useFakeTimers();
    const file = createMockFile("A.md", 1);
    const vaultEvents = new TestEvents();
    const metadataEvents = new TestEvents();
    let layoutReady: (() => void) | null = null;
    let snapshotBuildCount = 0;
    const app = {
      vault: {
        cachedRead: async () => "",
        getFileByPath: (path: string) => path === file.path ? file : null,
        getFiles: () => [file],
        on: vaultEvents.on,
      },
      metadataCache: {
        getFileCache: () => {
          snapshotBuildCount += 1;
          return { links: [], embeds: [], frontmatterLinks: [] };
        },
        getFirstLinkpathDest: () => null,
        on: metadataEvents.on,
        offref: metadataEvents.offref,
      },
      workspace: {
        getLeavesOfType: () => [],
        onLayoutReady: (callback: () => void) => {
          layoutReady = callback;
        },
      },
    };
    const plugin = new LinkIntegrityPlugin(app as never, {} as never);
    Object.assign(plugin, { app });
    const defaults = createDefaultSettings();
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      ...defaults,
      general: { ...defaults.general, scanOnStartup: false },
    });

    await plugin.onload();
    (layoutReady as (() => void) | null)?.();
    await Promise.resolve();
    const rebuilding = plugin.rebuild();
    metadataEvents.emit("resolved");
    await rebuilding;

    const runtime = plugin as unknown as PluginRuntimeInspection;
    const baselineBuildCount = snapshotBuildCount;
    let queryNotifications = 0;
    const unsubscribe = runtime.query.subscribe(() => {
      queryNotifications += 1;
    });

    vaultEvents.emit("modify", file);
    await vi.advanceTimersByTimeAsync(99);
    metadataEvents.emit("changed", file);
    await vi.advanceTimersByTimeAsync(1);
    await runtime.coordinator.whenIdle();
    await Promise.resolve();
    expect(snapshotBuildCount).toBe(baselineBuildCount);
    expect(queryNotifications).toBe(0);

    await vi.runOnlyPendingTimersAsync();
    await runtime.coordinator.whenIdle();
    await Promise.resolve();

    expect(snapshotBuildCount - baselineBuildCount).toBe(1);
    expect(queryNotifications).toBe(1);

    const buildCountBeforeContinuousBurst = snapshotBuildCount;
    vaultEvents.emit("modify", file);
    for (let count = 0; count < 5; count += 1) {
      await vi.advanceTimersByTimeAsync(99);
      metadataEvents.emit("changed", file);
    }
    expect(snapshotBuildCount).toBe(buildCountBeforeContinuousBurst);

    await vi.advanceTimersByTimeAsync(5);
    await runtime.coordinator.whenIdle();
    await Promise.resolve();

    expect(snapshotBuildCount - buildCountBeforeContinuousBurst).toBe(1);
    expect(queryNotifications).toBe(2);
    unsubscribe();
    plugin.onunload();
  });

  it("invalidates cached projections after a failed rebuild drains buffered events", async () => {
    const plugin = new LinkIntegrityPlugin({} as never, {} as never);
    let replayDrained = false;
    const statuses: Array<{ readonly state: string; readonly invalidate: boolean }> = [];
    Object.assign(plugin, {
      runtimeStarted: true,
      initialMetadataState: "resolved",
      metadataEventsRegistered: true,
      coordinator: {
        state: "stale",
        rebuild: () => Promise.reject(new Error("rebuild failed")),
        whenIdle: async () => {
          replayDrained = true;
        },
      },
      query: {
        setStatus: (status: IndexStatus, invalidate = false) => {
          statuses.push({ state: status.state, invalidate });
          if (status.state === "stale") expect(replayDrained).toBe(true);
        },
      },
    });

    await expect(plugin.rebuild()).rejects.toThrow("rebuild failed");
    expect(statuses).toEqual([
      { state: "scanning", invalidate: false },
      { state: "stale", invalidate: true },
    ]);
  });
});

function testOccurrenceId(sourcePath: string, location: string, legacyOrdinal: number): string {
  return createOccurrenceId({
    sourcePath,
    kind: "markdown-link",
    raw: "[[Missing]]",
    linktext: "Missing",
    duplicateIndex: 0,
    duplicateCount: 1,
    location,
    legacyOrdinal,
  });
}

interface PluginRuntimeInspection {
  readonly initialMetadataState: "dormant" | "waiting" | "fallback" | "resolved";
  readonly query: {
    readonly getSnapshot: () => { readonly status: IndexStatus };
    readonly subscribe: (listener: () => void) => () => void;
  };
  readonly coordinator: {
    readonly index: {
      readonly files: readonly { readonly path: string }[];
      readonly getOutgoingNeighborCount: (path: string) => number;
    };
    readonly store: { readonly generation: number };
    readonly rebuildPromise: Promise<unknown> | null;
    readonly enqueue: (event: { readonly type: "modify"; readonly path: string }) => void;
    readonly whenIdle: () => Promise<void>;
  };
  readonly persistViewState: (
    state: SidebarViewState,
    previousState: SidebarViewState,
  ) => void;
  readonly setExpectedFile: (path: string, expected: boolean, document: Document) => void;
  readonly addExpectedFolderRule: (
    path: string,
    mode: "exact" | "recursive",
    document: Document,
  ) => void;
}

class TestEvents {
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  public readonly on = (name: string, callback: (...args: never[]) => void): object => {
    const resolvedCallback = callback as (...args: unknown[]) => void;
    const callbacks = this.listeners.get(name) ?? [];
    callbacks.push(resolvedCallback);
    this.listeners.set(name, callbacks);
    return { name, callback: resolvedCallback } satisfies TestEventRef;
  };

  public readonly offref = (eventRef: object): void => {
    const { name, callback } = eventRef as TestEventRef;
    this.listeners.set(
      name,
      (this.listeners.get(name) ?? []).filter((listener) => listener !== callback),
    );
  };

  public emit(name: string, ...args: unknown[]): void {
    for (const callback of this.listeners.get(name) ?? []) callback(...args);
  }

  public listenerCount(name: string): number {
    return this.listeners.get(name)?.length ?? 0;
  }
}

interface TestEventRef {
  readonly name: string;
  readonly callback: (...args: unknown[]) => void;
}

function createMockFile(path: string, modifiedAt: number): TFile {
  const MockTFile = TFile as unknown as new (
    path: string,
    extension: string,
    modifiedAt: number,
  ) => TFile;
  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1) : "";
  return new MockTFile(path, extension, modifiedAt);
}

function createMockFolder(path: string): TFolder {
  const MockTFolder = TFolder as unknown as new (path: string) => TFolder;
  return new MockTFolder(path);
}

function reference(link: string, original: string) {
  return {
    link,
    original,
    position: {
      start: { line: 0, col: 0, offset: 0 },
      end: { line: 0, col: original.length, offset: original.length },
    },
  };
}
