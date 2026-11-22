import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import LinkIntegrityPlugin from "../../src/app/plugin";
import { createDefaultSettings, type LinkIntegritySettings } from "../../src/shared/settings";
import type { SettingsSaveCoordinator } from "../../src/shared/settings-save-coordinator";

const directories: string[] = [];

function latch() {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  return { pending, release };
}

async function fixture(initial: unknown = createDefaultSettings()) {
  const path = "custom-config/plugins/link-integrity/data.json";
  const directory = mkdtempSync(join(tmpdir(), "link-integrity-sync-"));
  directories.push(directory);
  const dataFile = join(directory, "data.json");
  const replace = (value: unknown): void => writeFileSync(dataFile, JSON.stringify(value));
  if (initial !== null) replace(initial);
  let beforeProcess = (): Promise<void> => Promise.resolve();
  const writes: string[] = [];
  const adapter = {
    exists: async (file: string) => file === path && existsSync(dataFile),
    append: async (file: string, text: string) => {
      expect(file).toBe(path);
      appendFileSync(dataFile, text);
    },
    process: async (file: string, fn: (raw: string) => string) => {
      expect(file).toBe(path);
      await beforeProcess();
      const next = fn(readFileSync(dataFile, "utf8"));
      writes.push(next);
      writeFileSync(dataFile, next);
      return next;
    },
  };
  const app = {
    vault: { adapter, configDir: "custom-config", on: () => ({}) },
    workspace: { getLeavesOfType: () => [], onLayoutReady: () => undefined },
  };
  const manifest = { id: "link-integrity" };
  const plugin = new LinkIntegrityPlugin(app as never, manifest as never);
  Object.assign(plugin, { app, manifest });
  const read = (): LinkIntegritySettings => JSON.parse(existsSync(dataFile) ? readFileSync(dataFile, "utf8") : "null") as LinkIntegritySettings;
  vi.spyOn(plugin, "loadData").mockImplementation(async () => read());
  await plugin.onload();
  const saver = (plugin as unknown as { saveCoordinator: SettingsSaveCoordinator<LinkIntegritySettings> }).saveCoordinator;
  const setLocale = () => {
    const current = plugin.getSettings();
    plugin.updateSettings({ ...current, general: { ...current.general, locale: "zh-CN" } });
  };
  return { plugin, saver, writes, read, setLocale, replace,
    pause: (callback: () => Promise<void>) => { beforeProcess = callback; } };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("synced data.json", () => {
  it("merges changes from disk with scheduled preferences and concurrent rule additions", async () => {
    const h = await fixture();
    const base = h.plugin.getSettings();
    h.setLocale();
    h.plugin.updateSettings({ ...h.plugin.getSettings(),
      isolatedFiles: { ...base.isolatedFiles, expectedFilePaths: ["local.md"] } });
    h.replace({ ...base, isolatedFiles: { ...base.isolatedFiles, expectedFilePaths: ["remote.md"] } });
    await h.plugin.onExternalSettingsChange();
    expect(h.plugin.getSettings().isolatedFiles.expectedFilePaths).toEqual(["local.md", "remote.md"]);
    await h.saver.flush();
    expect(h.read()).toEqual(h.plugin.getSettings());
    expect(h.read().general.locale).toBe("zh-CN");
    h.plugin.onunload();
  });

  it("checks the on-disk schema while writing, including when unload drains a second save", async () => {
    const h = await fixture();
    const entered = latch();
    const resume = latch();
    h.pause(async () => { entered.release(); await resume.pending; });
    h.setLocale();
    const first = h.saver.flush();
    await entered.pending;
    const future = { ...createDefaultSettings(), schemaVersion: 11, futureRules: ["on another device"] };
    h.replace(future);
    const reloading = h.plugin.onExternalSettingsChange();
    const now = h.plugin.getSettings();
    h.plugin.updateSettings({ ...now, brokenLinks: { ...now.brokenLinks, showIgnored: true } });
    h.plugin.onunload();
    resume.release();
    await Promise.all([first, reloading, h.saver.close()]);
    expect(h.read()).toEqual(future);
    expect(h.writes).toEqual([]);
    expect(h.plugin.isSettingsWriteProtected()).toBe(true);
  });

  it("keeps a newer schema intact without its callback and resumes after a compatible sync", async () => {
    const h = await fixture();
    const future = { ...createDefaultSettings(), schemaVersion: 9, extra: "keep" };
    h.setLocale();
    h.replace(future);
    await h.saver.flush();
    h.setLocale();
    await h.plugin.retrySettingsSave();
    expect(h.writes).toEqual([]);
    expect(h.read()).toEqual(future);
    const restored = createDefaultSettings();
    h.replace(restored);
    await h.plugin.onExternalSettingsChange();
    expect(h.plugin.isSettingsWriteProtected()).toBe(false);
    h.setLocale();
    await h.saver.flush();
    expect(h.read().general.locale).toBe("zh-CN");
    h.plugin.onunload();
  });

  it("merges edits to independent fields of the same rule without reverting a synced deletion", async () => {
    const shared = { id: "shared", scope: "hide-broken-result" as const, enabled: true,
      matcher: { kind: "source-path" as const, value: "Source.md" }, createdAt: 1, note: "Before" };
    const removed = { ...shared, id: "remote-deletion" };
    const base = { ...createDefaultSettings(), ignoreRules: [shared, removed] };
    const h = await fixture(base);
    h.plugin.updateSettings({ ...base, ignoreRules: [{ ...shared, note: "local edit" }, removed] });
    h.replace({ ...base, ignoreRules: [{ ...shared, enabled: false }] });
    await h.saver.flush();
    expect(h.read().ignoreRules).toEqual([{ ...shared, note: "local edit", enabled: false }]);
    h.plugin.onunload();
  });

  it("preserves external changes when retrying a failed save", async () => {
    const h = await fixture();
    const defaults = h.plugin.getSettings();
    h.setLocale();
    h.pause(() => Promise.reject(new Error("disk unavailable")));
    await expect(h.saver.flush()).rejects.toThrow("disk unavailable");
    h.replace({ ...defaults, isolatedFiles: { ...defaults.isolatedFiles, expectedFilePaths: ["remote.md"] } });
    h.pause(() => Promise.resolve());
    await h.plugin.retrySettingsSave();
    expect(h.read().general.locale).toBe("zh-CN");
    expect(h.read().isolatedFiles.expectedFilePaths).toEqual(["remote.md"]);
    h.plugin.onunload();
  });

  it("creates settings for a new install", async () => {
    const h = await fixture(null);
    h.setLocale();
    await h.saver.flush();
    expect(h.read().general.locale).toBe("zh-CN");
    h.plugin.onunload();
  });
});
