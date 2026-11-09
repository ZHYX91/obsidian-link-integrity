import { describe, expect, it, vi } from "vitest";

import { createOccurrenceId, occurrenceIdMatches } from "../../src/core/occurrence-identity";
import { IgnoreService, normalizeIgnoreRule, type IgnoreRule } from "../../src/shared/ignore-rules";
import { loadSettings, SETTINGS_SCHEMA_VERSION } from "../../src/shared/settings";
import { SettingsSaveCoordinator } from "../../src/shared/settings-save-coordinator";

const separator = "\u0000";
const oldPositionId = ["Source.md", "markdown-link", "0:0", "0"].join(separator);

describe("occurrence-rule migration", () => {
  it("pauses positional rules instead of hiding a new target at the old position", () => {
    const original = rule(oldPositionId);
    const loaded = loadSettings({ schemaVersion: 3, ignoreRules: [original] });
    expect(loaded.compatibility).toBe("migrated");
    expect(loaded.shouldPersistMigration).toBe(true);
    expect(loaded.settings.ignoreRules).toEqual([{ ...original, enabled: false }]);
    const oldLink = currentId("Old");
    const newLink = currentId("New");
    expect(occurrenceIdMatches(oldLink, newLink)).toBe(false);
    for (const occurrenceId of [oldLink, newLink, oldPositionId]) {
      expect(new IgnoreService([original]).shouldHideBrokenResult({ occurrenceId })).toBe(false);
      expect(new IgnoreService(loaded.settings.ignoreRules).shouldHideBrokenResult({ occurrenceId })).toBe(false);
    }
    expect(original.enabled).toBe(true);
  });

  it("imports valid eight-part semantic rules without retaining navigation metadata", () => {
    const current = currentId("Old");
    const semantic = current.split(separator).slice(0, 6).join(separator);
    const oldSemantic = [semantic, "3:7", "12"].join(separator);
    const loaded = loadSettings({ schemaVersion: 3, ignoreRules: [rule(oldSemantic)] });
    expect(loaded.settings.ignoreRules).toEqual([rule(semantic)]);
    expect(current.split(separator)).toHaveLength(6);
    expect(occurrenceIdMatches(oldSemantic, current)).toBe(false);
    expect(new IgnoreService(loaded.settings.ignoreRules).shouldHideBrokenResult({ occurrenceId: current })).toBe(true);
    const reloaded = loadSettings(JSON.parse(JSON.stringify(loaded.settings)));
    expect(reloaded.settings).toEqual(loaded.settings);
    expect(reloaded.compatibility).toBe("current");
    expect(reloaded.shouldPersistMigration).toBe(false);
  });

  it("retains paused data after a failed migration save and retries the same snapshot", async () => {
    const loaded = loadSettings({ schemaVersion: 3, ignoreRules: [rule(oldPositionId)] });
    const persist = vi.fn<(value: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    const saves = new SettingsSaveCoordinator(persist);
    await expect(saves.save(loaded.settings)).rejects.toThrow("disk full");
    expect(saves.getStatus().state).toBe("pending");
    expect(loaded.settings.ignoreRules).toEqual([{ ...rule(oldPositionId), enabled: false }]);
    await saves.retry();
    expect(persist).toHaveBeenNthCalledWith(1, loaded.settings);
    expect(persist).toHaveBeenNthCalledWith(2, loaded.settings);
    expect(loadSettings(JSON.parse(JSON.stringify(persist.mock.calls[1]![0]))).settings)
      .toEqual(loaded.settings);
    await saves.close();
  });

  it.each([
    ["future prefix", (parts: string[]) => { parts[0] = "occ-v9"; return parts; }],
    ["unknown kind", (parts: string[]) => { parts[2] = "future-link"; return parts; }],
    ["missing part", (parts: string[]) => parts.slice(0, 5)],
    ["extra part", (parts: string[]) => [...parts, "0:0"]],
    ["extra old part", (parts: string[]) => [...parts, "0:0", "0", "future"]],
    ["invalid hash", (parts: string[]) => { parts[3] = "invalid"; return parts; }],
    ["negative duplicate", (parts: string[]) => { parts[4] = "-1"; return parts; }],
    ["missing duplicate set", (parts: string[]) => { parts[5] = "0"; return parts; }],
    ["out-of-range duplicate", (parts: string[]) => { parts[4] = "1"; return parts; }],
    ["invalid old ordinal", (parts: string[]) => [...parts, "0:0", "-1"]],
  ] as const)("preserves a %s identifier paused across saves", (_name, mutate) => {
    const value = mutate(currentId("Old").split(separator).slice(0, 6)).join(separator);
    const original = rule(value);
    const normalized = normalizeIgnoreRule(original)!;
    expect(normalized).toEqual({ ...original, enabled: false });
    expect(normalizeIgnoreRule(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
    expect(new IgnoreService([original]).shouldHideBrokenResult({ occurrenceId: value })).toBe(false);
  });

  it("keeps an unrecognized identifier byte-for-byte for review", () => {
    const value = " Source\\Note.md\u0000markdown-link\u00000:0\u00000 ";
    const original = rule(value);
    expect(normalizeIgnoreRule(original)).toEqual({ ...original, enabled: false });
    const loaded = loadSettings({ schemaVersion: SETTINGS_SCHEMA_VERSION + 1, ignoreRules: [original] });
    expect(loaded.writeProtected).toBe(true);
    expect(loaded.shouldPersistMigration).toBe(false);
    expect(loaded.settings.ignoreRules).toEqual([{ ...original, enabled: false }]);
  });
});

function currentId(target: string): string {
  const input = {
    sourcePath: "Source.md", kind: "markdown-link" as const, raw: `[[${target}]]`, linktext: target,
    duplicateIndex: 0, duplicateCount: 1,
  };
  return createOccurrenceId(input);
}

function rule(value: string): IgnoreRule {
  return { id: "saved-occurrence", enabled: true, scope: "ignore-occurrence",
    matcher: { kind: "occurrence-id", value }, createdAt: 123, note: "Keep my review note" };
}
