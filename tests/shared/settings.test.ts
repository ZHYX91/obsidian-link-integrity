import { describe, expect, it } from "vitest";

import { FORMAT_FAMILY_IDS } from "../../src/core/file-types";
import {
  getExpectedRuleStats,
  matchesExpectedIsolationRule,
  validateExpectedIsolationRule,
} from "../../src/core/expected-isolation-rules";
import { LinkIndex } from "../../src/core/link-index";
import { createFileRecord } from "../../src/core/model";
import { createIsolatedFileProjection } from "../../src/features/queries/isolated-files";
import {
  SETTINGS_SCHEMA_VERSION,
  applySettingValue,
  classifySettingChange,
  createDefaultSettings,
  loadSettings,
  normalizeSettings,
} from "../../src/shared/settings";

describe("settings", () => {
  it("drops the retired potential body setting without enabling automatic discovery", () => {
    const loaded = loadSettings({ schemaVersion: SETTINGS_SCHEMA_VERSION, general: { mentionDisplayMode: "document" } });
    expect(loaded.settings.general).not.toHaveProperty("mentionDisplayMode");
    expect(loaded.settings.brokenLinks.bodyHints).toBe(false);
    expect(loadSettings({ brokenLinks: { bodyHints: "document" } }).settings.brokenLinks.bodyHints).toBe(false);
    expect(loaded.settings.general.scanOnStartup).toBe(false);
  });
  it("creates deep independent defaults with every built-in candidate family", () => {
    const left = createDefaultSettings();
    const right = createDefaultSettings();
    expect(left).not.toBe(right);
    expect(left.isolatedFiles.periodicNotesPreset).not.toBe(
      right.isolatedFiles.periodicNotesPreset,
    );
    expect(left.isolatedFiles.candidateFormatFamilyIds).toEqual(FORMAT_FAMILY_IDS);
    expect(left.isolatedFiles.showExpectedIsolatedFiles).toBe(false);
    expect(left.general.scanOnStartup).toBe(false);
    expect(left.ui).toEqual({
      activeSidebarTab: null,
      brokenView: null,
      brokenGrouping: null,
      brokenSort: null,
      isolatedView: null,
      isolatedSort: null,
      expandedBrokenFolderPaths: [],
    });
  });

  it("normalizes unknown values, extensions, ignores, and expected rules", () => {
    const settings = normalizeSettings({
      general: { locale: "xx", defaultSidebarTab: "orphan-files" },
      isolatedFiles: {
        candidateFormatFamilyIds: ["markdown", "markdown", "unknown"],
        customExtensions: [".DRAWIO", " drawio ", "../bad"],
        expectedFilePaths: [" /Loose.md ", "Loose.md", "Folder\\Note.md", "../bad.md"],
        expectedRules: [{
          id: "periodic-daily",
          name: "Daily",
          enabled: true,
          fileTypeFamilyIds: ["markdown"],
          fileTypeCategoryIds: [],
          fileExtensions: [],
          folder: { path: "Daily", mode: "recursive" },
          namingPatterns: [{
            id: "date",
            kind: "date-format",
            pattern: "YYYY-MM-DD",
            flags: "u",
            target: "basename",
          }],
        }],
      },
      ignoreRules: [{
        id: "archive",
        enabled: true,
        scope: "exclude-isolated-candidate",
        matcher: { kind: "path-prefix", value: "Archive" },
        createdAt: 1,
        note: "Old files",
      }],
    });
    expect(settings.general.locale).toBe("auto");
    expect(settings.general.defaultSidebarTab).toBe("broken-links");
    expect(settings.isolatedFiles.candidateFormatFamilyIds).toEqual(["markdown"]);
    expect(settings.isolatedFiles.customExtensions).toEqual(["drawio"]);
    expect(settings.isolatedFiles.expectedFilePaths).toEqual([
      "Folder/Note.md",
      "Loose.md",
    ]);
    expect(settings.isolatedFiles.expectedRules).toHaveLength(1);
    expect(settings.ignoreRules).toHaveLength(1);
  });

  it.each(["namingPatterns", "patterns"])(
    "keeps malformed %s containers disabled and diagnosable across settings saves",
    (field) => {
      const files = [
        createFileRecord("Projects/Template-One.md"),
        createFileRecord("Projects/Unrelated.md"),
      ];
      const index = new LinkIndex(files);
      for (const value of [{ pattern: "Template-*" }, "Template-*", null, false, 1]) {
        const loaded = loadTemplateRuleSettings({ [field]: value });
        // Settings are normalized again for ordinary preference edits and on restart.
        const reloaded = loadSettings(JSON.parse(JSON.stringify(loaded.settings))).settings;
        for (const settings of [loaded.settings, reloaded]) {
          const rules = settings.isolatedFiles.expectedRules;
          const rule = rules[0]!;
          expect(rule.enabled).toBe(false);
          expect(validateExpectedIsolationRule(rule)).toContain("Pattern required.");
          expect(matchesExpectedIsolationRule(files[1]!, rule)).toBe(false);
          expect(matchesExpectedIsolationRule(files[1]!, { ...rule, enabled: true })).toBe(false);
          expect(getExpectedRuleStats(files, rules)[0]).toMatchObject({
            matchCount: 0,
            samples: [],
            errors: expect.arrayContaining(["Pattern required."]),
          });
          const projection = createIsolatedFileProjection(index, { expectedRules: rules });
          expect(projection.mainCount).toBe(2);
          expect(projection.expectedExcludedCount).toBe(0);
          expect(projection.items.map(({ classification }) => classification)).toEqual([
            "isolated", "isolated",
          ]);
        }
      }
      expect(index.toCanonicalState().edges).toEqual([]);
    },
  );

  it("does not fall back to a legacy pattern when the primary container is malformed", () => {
    const pattern = { id: "name", kind: "glob", pattern: "Template-*" };
    for (const namingPatterns of [null, undefined, "Template-*", {}]) {
      const { settings } = loadTemplateRuleSettings({ namingPatterns, patterns: [pattern] });
      const rule = settings.isolatedFiles.expectedRules[0]!;
      expect(rule.enabled).toBe(false);
      expect(validateExpectedIsolationRule(rule)).toContain("Pattern required.");
    }
  });

  it("preserves valid primary, legacy, and intentionally absent naming conditions", () => {
    const pattern = { id: "name", kind: "glob", pattern: "Template-*" };
    const files = [
      createFileRecord("Projects/Template-One.md"),
      createFileRecord("Projects/Unrelated.md"),
      createFileRecord("Elsewhere/Template-One.md"),
    ];
    for (const conditions of [
      { namingPatterns: [pattern] },
      { patterns: [pattern] },
      { namingPatterns: [pattern], patterns: null },
    ]) {
      const { settings } = loadTemplateRuleSettings(conditions);
      const rule = settings.isolatedFiles.expectedRules[0]!;
      expect(rule.enabled).toBe(true);
      expect(validateExpectedIsolationRule(rule)).toEqual([]);
      expect(files.map((file) => matchesExpectedIsolationRule(file, rule))).toEqual([
        true, false, false,
      ]);
      const projection = createIsolatedFileProjection(new LinkIndex(files), {
        expectedRules: [rule],
      });
      expect(projection.mainCount).toBe(2);
      expect(projection.expectedExcludedCount).toBe(1);
    }
    for (const conditions of [{}, { namingPatterns: [] }, { patterns: [] }]) {
      const { settings } = loadTemplateRuleSettings(conditions);
      const rule = settings.isolatedFiles.expectedRules[0]!;
      expect(rule.enabled).toBe(true);
      expect(files.map((file) => matchesExpectedIsolationRule(file, rule))).toEqual([
        true, true, false,
      ]);
    }
    const { settings } = loadTemplateRuleSettings({ namingPatterns: [false] });
    expect(settings.isolatedFiles.expectedRules[0]?.enabled).toBe(false);
  });

  it("migrates schema one settings with empty exact expected paths", () => {
    const result = loadSettings({
      schemaVersion: 1,
      isolatedFiles: { expectedRules: [] },
    });
    expect(result.compatibility).toBe("migrated");
    expect(result.shouldPersistMigration).toBe(true);
    expect(result.settings.isolatedFiles.expectedFilePaths).toEqual([]);
    expect(result.settings.ui.expandedBrokenFolderPaths).toEqual([]);
  });

  it("migrates historical orphan terminology without retaining it", () => {
    const result = loadSettings({
      schemaVersion: 0,
      general: { defaultSidebarTab: "orphan-files" },
      orphanFiles: { defaultView: "tree" },
      ui: { activeSidebarTab: "orphan-files" },
    });
    expect(result.compatibility).toBe("migrated");
    expect(result.shouldPersistMigration).toBe(true);
    expect(result.settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(result.settings.general.defaultSidebarTab).toBe("isolated-files");
    expect(result.settings.isolatedFiles.defaultView).toBe("tree");
    expect(result.settings.ui.activeSidebarTab).toBe("isolated-files");
  });

  it("write-protects a future schema while exposing normalized known values", () => {
    const result = loadSettings({
      schemaVersion: SETTINGS_SCHEMA_VERSION + 5,
      general: { locale: "de", futureField: true },
    });
    expect(result.compatibility).toBe("future");
    expect(result.writeProtected).toBe(true);
    expect(result.shouldPersistMigration).toBe(false);
    expect(result.settings.general.locale).toBe("de");
  });

  it("applies typed controls immutably and classifies side effects", () => {
    const defaults = createDefaultSettings();
    const result = applySettingValue(defaults, "general.locale", "ja");
    expect(result.settings.general.locale).toBe("ja");
    expect(defaults.general.locale).toBe("auto");
    expect(result.impact).toBe("query-only");
    expect(classifySettingChange("brokenLinks.diagnostics.missingFiles"))
      .toBe("revalidate");
    expect(classifySettingChange({ scope: "exclude-graph-contribution" }))
      .toBe("regraph");
    expect(() => applySettingValue(defaults, "general.locale", "unknown"))
      .toThrow(TypeError);
  });
});

function loadTemplateRuleSettings(conditions: Readonly<Record<string, unknown>>) {
  return loadSettings({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    isolatedFiles: {
      expectedRules: [{
        id: "project-templates",
        name: "Project templates",
        enabled: true,
        fileTypeFamilyIds: ["markdown"],
        folder: { path: "Projects", mode: "recursive" },
        ...conditions,
      }],
    },
  });
}
