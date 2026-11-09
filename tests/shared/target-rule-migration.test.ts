import { describe, expect, it, vi } from "vitest";

import { IgnoreService, normalizeIgnoreRule } from "../../src/shared/ignore-rules";
import { loadSettings, SETTINGS_SCHEMA_VERSION } from "../../src/shared/settings";
import { SettingsSaveCoordinator } from "../../src/shared/settings-save-coordinator";

describe("target-rule settings migration", () => {
  it("persists schema-two target rules once without requiring a settings edit", async () => {
    const loaded = loadSettings({
      schemaVersion: 2,
      ignoreRules: [
        targetRule("relative", "./Missing.md"),
        targetRule("folder", "Folder/Missing.md"),
        targetRule("confirmed", "Root.md", { pathKind: "vault" }),
      ],
    });
    expect(loaded.compatibility).toBe("migrated");
    expect(loaded.shouldPersistMigration).toBe(true);
    expect(loaded.settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(loaded.settings.ignoreRules).toEqual([
      { ...targetRule("relative", "./Missing.md"), enabled: false },
      targetRule("folder", "Folder/Missing.md", { pathKind: "vault" }),
      targetRule("confirmed", "Root.md", { pathKind: "vault" }),
    ]);

    let stored: unknown;
    const persist = vi.fn(async (settings: unknown) => { stored = JSON.parse(JSON.stringify(settings)); });
    const saves = new SettingsSaveCoordinator(persist);
    if (loaded.shouldPersistMigration) saves.schedule(loaded.settings);
    await saves.close();
    expect(persist).toHaveBeenCalledOnce();
    const reloaded = loadSettings(stored);
    expect(reloaded.settings).toEqual(loaded.settings);
    expect(reloaded.compatibility).toBe("current");
    expect(reloaded.shouldPersistMigration).toBe(false);
  });

  it.each(["relative-v2", "future-vault", ""])(
    "retains an unknown path marker %j paused through normalization and reload",
    (pathKind) => {
      const raw = targetRule("unknown", "Folder/Missing.md", { pathKind });
      const normalized = normalizeIgnoreRule(raw)!;
      expect(normalized).toEqual({ ...raw, enabled: false });
      const reloaded = loadSettings(JSON.parse(JSON.stringify({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        ignoreRules: [normalized],
      })));
      expect(reloaded.settings.ignoreRules).toEqual([normalized]);
      expect(new IgnoreService([{ ...normalized, enabled: true }]).shouldHideBrokenResult({
        targetPath: "Folder/Missing.md",
      })).toBe(false);
    },
  );

  it.each([null, false, 1, {}])("does not recover a malformed explicit path marker %j", (pathKind) => {
    const first = normalizeIgnoreRule(targetRule("invalid", "Folder/Missing.md", { pathKind }))!;
    const second = normalizeIgnoreRule(JSON.parse(JSON.stringify(first)))!;
    expect(first.enabled).toBe(false);
    expect(second).toEqual(first);
    expect(second.matcher.pathKind).not.toBe("vault");
  });

  it("leaves future settings write-protected and their unknown target rule inactive", () => {
    const loaded = loadSettings({
      schemaVersion: SETTINGS_SCHEMA_VERSION + 1,
      ignoreRules: [targetRule("future", "Folder/Missing.md", { pathKind: "future-vault" })],
    });
    expect(loaded.compatibility).toBe("future");
    expect(loaded.writeProtected).toBe(true);
    expect(loaded.shouldPersistMigration).toBe(false);
    expect(loaded.settings.ignoreRules[0]).toEqual({
      ...targetRule("future", "Folder/Missing.md", { pathKind: "future-vault" }),
      enabled: false,
    });
  });
});

function targetRule(id: string, value: string, marker: Readonly<Record<string, unknown>> = {}) {
  return {
    id,
    enabled: true,
    scope: "ignore-target",
    matcher: { kind: "target-path", value, ...marker },
    createdAt: 1,
    note: "Keep this explanation",
  };
}
