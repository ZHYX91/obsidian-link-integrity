import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import LinkIntegrityPlugin from "../../src/app/plugin";
import { createInitialSidebarState } from "../../src/app/sidebar-view";
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

    const runtime = plugin as unknown as PluginRuntimeInspection;
    expect(runtime.query.getSnapshot().status.state).toBe("idle");
    expect(runtime.coordinator.store.generation).toBe(0);
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

  it("ignores late per-file resolve storms after the startup metadata fallback", async () => {
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
    expect(snapshotBuildCount).toBe(1);
    expect(metadataEvents.listenerCount("resolved")).toBe(0);
    expect(metadataEvents.listenerCount("resolve")).toBe(0);
    expect(metadataEvents.listenerCount("changed")).toBe(1);
    expect(metadataEvents.listenerCount("deleted")).toBe(1);

    let queryNotifications = 0;
    const unsubscribe = runtime.query.subscribe(() => {
      queryNotifications += 1;
    });
    for (let count = 0; count < 100; count += 1) metadataEvents.emit("resolve", file);
    await vi.runOnlyPendingTimersAsync();
    await runtime.coordinator.whenIdle();
    await Promise.resolve();

    expect(snapshotBuildCount).toBe(1);
    expect(queryNotifications).toBe(0);
    unsubscribe();
    plugin.onunload();
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
});

interface PluginRuntimeInspection {
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
