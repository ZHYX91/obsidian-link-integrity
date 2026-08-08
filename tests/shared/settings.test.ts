import { describe, expect, it } from "vitest";

import { FORMAT_FAMILY_IDS } from "../../src/core/file-types";
import {
  SETTINGS_SCHEMA_VERSION,
  applySettingValue,
  classifySettingChange,
  createDefaultSettings,
  loadSettings,
  normalizeSettings,
} from "../../src/shared/settings";

describe("settings", () => {
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
      .toBe("full-rebuild");
    expect(() => applySettingValue(defaults, "general.locale", "unknown"))
      .toThrow(TypeError);
  });
});
