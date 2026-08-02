import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import LinkIntegrityPlugin from "../../src/app/plugin";
import { createInitialSidebarState } from "../../src/app/sidebar-view";
import { createDefaultSettings } from "../../src/shared/settings";
import type { IndexStatus, SidebarViewState } from "../../src/ui/sidebar";

describe("plugin index lifecycle", () => {
  it("stays unscanned and event-inactive until an explicit first refresh", async () => {
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
    expect(metadataEvents.listenerCount("resolve")).toBe(1);

    const runtime = plugin as unknown as PluginRuntimeInspection;
    expect(runtime.query.getSnapshot().status.state).toBe("idle");
    expect(runtime.coordinator.store.generation).toBe(0);
    vaultEvents.emit("modify", file);
    await Promise.resolve();
    expect(snapshotBuildCount).toBe(0);
    expect(runtime.coordinator.store.generation).toBe(0);
    expect(() => runtime.coordinator.enqueue({ type: "modify", path: file.path }))
      .toThrow("not active");

    await plugin.rebuild();
    expect(runtime.query.getSnapshot().status.state).toBe("ready");
    expect(runtime.coordinator.store.generation).toBe(1);
    expect(runtime.coordinator.index.files.map(({ path }) => path)).toEqual(["A.md"]);
    expect(snapshotBuildCount).toBe(1);

    const baselineBuildCount = snapshotBuildCount;
    metadataEvents.emit("resolved");
    await Promise.resolve();
    expect(snapshotBuildCount).toBe(baselineBuildCount);

    metadataEvents.emit("resolve", file);
    await runtime.coordinator.whenIdle();
    expect(snapshotBuildCount).toBeGreaterThan(baselineBuildCount);

    let queryNotifications = 0;
    const unsubscribe = runtime.query.subscribe(() => {
      queryNotifications += 1;
    });
    const previousState = createInitialSidebarState(defaults);
    runtime.persistViewState({
      ...previousState,
      activeTab: "isolated-files",
    }, previousState);
    expect(queryNotifications).toBe(0);
    unsubscribe();

    vaultEvents.emit("modify", file);
    await runtime.coordinator.whenIdle();
    expect(snapshotBuildCount).toBeGreaterThan(1);
    plugin.onunload();
  });
});

interface PluginRuntimeInspection {
  readonly query: {
    readonly getSnapshot: () => { readonly status: IndexStatus };
    readonly subscribe: (listener: () => void) => () => void;
  };
  readonly coordinator: {
    readonly index: { readonly files: readonly { readonly path: string }[] };
    readonly store: { readonly generation: number };
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
    const callbacks = this.listeners.get(name) ?? [];
    callbacks.push(callback as (...args: unknown[]) => void);
    this.listeners.set(name, callbacks);
    return {};
  };

  public emit(name: string, ...args: unknown[]): void {
    for (const callback of this.listeners.get(name) ?? []) callback(...args);
  }

  public listenerCount(name: string): number {
    return this.listeners.get(name)?.length ?? 0;
  }
}

function createMockFile(path: string, modifiedAt: number): TFile {
  const MockTFile = TFile as unknown as new (
    path: string,
    extension: string,
    modifiedAt: number,
  ) => TFile;
  return new MockTFile(path, "md", modifiedAt);
}
