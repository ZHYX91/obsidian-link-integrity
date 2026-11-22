import { describe, expect, it, vi } from "vitest";

import {
  compileDateFormat,
  createDefaultPeriodicNotesPreset,
  createPeriodicExpectedIsolatedRule,
  createPeriodicExpectedIsolationRules,
  getExpectedRuleStats,
  matchExpectedIsolationRules,
  matchesExpectedIsolationRule,
  normalizeExpectedIsolationRules,
  validateExpectedIsolationRule,
  type ExpectedIsolationRule,
} from "../../src/core/expected-isolation-rules";
import { loadSettings, cloneSettings } from "../../src/shared/settings";
import * as model from "../../src/core/model";

const { createFileRecord } = model;

describe("expected-isolated rules", () => {
  it("combines file type, folder, and a pattern OR group with AND semantics", () => {
    const rule: ExpectedIsolationRule = {
      id: "journal",
      name: "Journal notes",
      enabled: true,
      fileTypeFamilyIds: ["markdown"],
      fileTypeCategoryIds: [],
      fileExtensions: [],
      folder: { path: "Journal", mode: "recursive" },
      namingPatterns: [
        { id: "date", kind: "date-format", pattern: "YYYY-MM-DD", flags: "u", target: "basename" },
        { id: "special", kind: "glob", pattern: "Special-*", flags: "u", target: "basename" },
      ],
    };
    expect(matchesExpectedIsolationRule(createFileRecord("Journal/2026-08-02.md"), rule)).toBe(true);
    expect(matchesExpectedIsolationRule(createFileRecord("Journal/Special-index.md"), rule)).toBe(true);
    expect(matchesExpectedIsolationRule(createFileRecord("Elsewhere/2026-08-02.md"), rule)).toBe(false);
    expect(matchesExpectedIsolationRule(createFileRecord("Journal/2026-08-02.png"), rule)).toBe(false);
  });

  it("normalizes file and rule folders once across a rule projection", () => {
    const rule = (id: string, path: string, mode: "exact" | "recursive"): ExpectedIsolationRule => ({
      id, name: id, enabled: true, fileTypeFamilyIds: [], fileTypeCategoryIds: [],
      fileExtensions: [], folder: { path, mode }, namingPatterns: [],
    });
    const rules = [
      rule("root", "", "exact"),
      rule("journal", " /Journal/ ", "exact"),
      rule("nested", "Journal", "recursive"),
      rule("daily", "Journal\\Daily", "exact"),
    ];
    const files = ["Note.md", "Journal/A.md", "Journal/Daily/B.md", "Journalism/C.md"]
      .map((path) => createFileRecord(path));
    const normalize = vi.spyOn(model, "normalizeVaultPath");
    try {
      expect(files.map((file) => matchExpectedIsolationRules(file, rules).matchedRuleIds)).toEqual([
        ["root"], ["journal", "nested"], ["nested", "daily"], [],
      ]);
      expect(normalize.mock.calls.length).toBeLessThanOrEqual(files.length + rules.length);
    } finally {
      normalize.mockRestore();
    }
  });

  it("validates periodic date ranges and provides all independent presets", () => {
    expect(compileDateFormat("YYYY-MM-DD").test("2026-12-31")).toBe(true);
    expect(compileDateFormat("YYYY-MM-DD").test("2026-19-99")).toBe(false);
    expect(compileDateFormat("GGGG-[W]WW").test("2026-W53")).toBe(true);
    expect(compileDateFormat("GGGG-[W]WW").test("2026-W54")).toBe(false);
    expect(() => compileDateFormat("yyyy-MM")).toThrow("Unsupported date-format token");
    expect(createPeriodicExpectedIsolatedRule("quarterly").namingPatterns[0]?.pattern).toBe(
      "YYYY-[Q]Q",
    );

    const preset = createDefaultPeriodicNotesPreset();
    const enabled = { ...preset, enabled: true };
    expect(createPeriodicExpectedIsolationRules(enabled)).toHaveLength(5);
  });

  it("normalizes persisted rules into the matcher model and disables universal rules", () => {
    const normalized = normalizeExpectedIsolationRules([
      {
        id: "periodic",
        name: " Periodic ",
        fileTypeFamilyIds: ["markdown", "not-real"],
        fileTypeCategoryIds: ["obsidian"],
        fileExtensions: [".DRAWIO"],
        folder: { path: " Journal/ ", mode: "recursive" },
        namingPatterns: [{
          id: "date",
          kind: "date-format",
          pattern: "YYYY-MM",
          target: "basename",
        }],
      },
      { id: "universal", name: "Universal" },
    ]);
    expect(normalized[0]).toMatchObject({
      id: "periodic",
      name: "Periodic",
      fileTypeFamilyIds: ["markdown"],
      fileTypeCategoryIds: ["obsidian"],
      fileExtensions: ["drawio"],
      folder: { path: "Journal", mode: "recursive" },
    });
    expect(normalized[1]?.enabled).toBe(false);
  });

  it("preserves invalid persisted naming conditions and disables the whole rule", () => {
    const overlong = "a".repeat(513);
    const [rule] = normalizeExpectedIsolationRules([{
      id: "overlong",
      name: "Overlong",
      enabled: true,
      fileTypeFamilyIds: ["markdown"],
      namingPatterns: [{
        id: "name",
        kind: "regex",
        pattern: overlong,
        flags: "u",
        target: "basename",
      }],
    }]);

    expect(rule?.enabled).toBe(false);
    expect(rule?.namingPatterns).toHaveLength(1);
    expect(rule?.namingPatterns[0]?.pattern).toBe(overlong);
    expect(validateExpectedIsolationRule(rule!)).toContain("regex pattern > 512 chars.");
    expect(matchesExpectedIsolationRule(createFileRecord("anything.md"), rule!)).toBe(false);
  });

  it.each([
    { fileTypeFamilyIds: "png" }, { fileTypeFamilyIds: ["unknown-type"] },
    { fileTypeCategoryIds: [false] }, { fileExtensions: null },
    { fileType: { familyIds: ["png", "unknown-type"] } }, { fileType: "png" },
  ])("pauses an unrecognized type condition through load, save and reopen: %j", (type) => {
    const data = { schemaVersion: 4, isolatedFiles: { expectedRules: [{
      id: "archive", name: "Archive", enabled: true, folder: { path: "Archive", mode: "recursive" }, ...type,
    }] } };
    const first = loadSettings(data).settings;
    const reopened = loadSettings(JSON.parse(JSON.stringify(cloneSettings(first)))).settings;
    for (const settings of [first, reopened]) {
      const rule = settings.isolatedFiles.expectedRules[0]!;
      expect(rule.enabled).toBe(false);
      expect(rule.unrecognizedFileTypes).toBeDefined();
      expect(validateExpectedIsolationRule(rule)).toContain("Unrecognized file type conditions.");
      expect(matchesExpectedIsolationRule(createFileRecord("Archive/Report.md"), { ...rule, enabled: true })).toBe(false);
    }
    expect(reopened.isolatedFiles.expectedRules).toEqual(first.isolatedFiles.expectedRules);
  });

  it.each([
    { flags: "u", caseSensitive: false, matchLowercase: false },
    { flags: "iu", caseSensitive: true, matchLowercase: true },
    { caseSensitive: true, matchLowercase: false }, { caseSensitive: false, matchLowercase: true },
  ])("retains glob case matching across repeated normalization: %j", ({ matchLowercase, ...options }) => {
    const [rule] = normalizeExpectedIsolationRules([{
      id: "special", name: "Special", namingPatterns: [{ kind: "glob", pattern: "Special-*", ...options }],
    }]);
    const [loaded] = normalizeExpectedIsolationRules(JSON.parse(JSON.stringify([rule])));
    expect(matchesExpectedIsolationRule(createFileRecord("Special-note.md"), loaded!)).toBe(true);
    expect(matchesExpectedIsolationRule(createFileRecord("special-note.md"), loaded!)).toBe(matchLowercase);
  });

  it.each(["../Notes", null, { path: "Notes" }])("pauses a saved invalid periodic folder: %j", (folder) => {
    const initial = loadSettings({ schemaVersion: 4, isolatedFiles: { periodicNotesPreset: {
      enabled: true, entries: { daily: { folder, enabled: true } },
    } } }).settings;
    const reopened = loadSettings(JSON.parse(JSON.stringify(cloneSettings(initial)))).settings;
    for (const settings of [initial, reopened]) {
      const preset = settings.isolatedFiles.periodicNotesPreset;
      expect(preset.entries.daily).toMatchObject({ enabled: false, invalidFolder: folder });
      expect(matchExpectedIsolationRules(createFileRecord("Elsewhere/2026-11-22.md"),
        createPeriodicExpectedIsolationRules(preset)).expected).toBe(false);
      expect(preset.entries.weekly.enabled).toBe(true);
    }
  });

  it("matches formerly catastrophic constructs without backtracking", () => {
    const unsafe: ExpectedIsolationRule = {
      id: "unsafe",
      name: "Unsafe",
      enabled: true,
      fileTypeFamilyIds: ["markdown"],
      fileTypeCategoryIds: [],
      fileExtensions: [],
      folder: null,
      namingPatterns: [{
        id: "regex",
        kind: "regex",
        pattern: "^(a+)+$",
        flags: "u",
        target: "basename",
      }],
    };
    expect(validateExpectedIsolationRule(unsafe)).toEqual([]);
    expect(matchesExpectedIsolationRule(createFileRecord(`${"a".repeat(200)}!.md`), unsafe)).toBe(false);

    const safe: ExpectedIsolationRule = {
      ...unsafe,
      id: "safe",
      name: "Safe",
      namingPatterns: [{
        id: "regex",
        kind: "regex",
        pattern: "^(?:Daily|Weekly)-\\d{4}-\\d{2}$",
        flags: "iu",
        target: "basename",
      }],
    };
    expect(validateExpectedIsolationRule(safe)).toEqual([]);
    expect(matchesExpectedIsolationRule(createFileRecord("Daily-2026-09.md"), safe)).toBe(true);
  });
  it("reports rule match counts and bounded examples", () => {
    const rule = createPeriodicExpectedIsolatedRule("monthly", {
      folderPath: "Periodic",
    });
    const stats = getExpectedRuleStats([
      createFileRecord("Periodic/2026-07.md"),
      createFileRecord("Periodic/2026-08.md"),
      createFileRecord("Other/2026-08.md"),
    ], [rule], 1);
    expect(stats[0]).toMatchObject({ matchCount: 2, samples: ["Periodic/2026-07.md"] });
  });

  it("retains whitespace-sensitive naming semantics through save and load", () => {
    const draft: ExpectedIsolationRule = {
      id: "space", name: "Space", enabled: true, fileTypeFamilyIds: [],
      fileTypeCategoryIds: [], fileExtensions: [], folder: null,
      namingPatterns: [{ id: "name", kind: "regex", pattern: " a ", flags: "u", target: "basename" }],
    };
    const loaded = normalizeExpectedIsolationRules([draft])[0]!;
    expect(loaded.namingPatterns[0]?.pattern).toBe(" a ");
    for (const path of ["a.md", " a .md"]) {
      expect(matchesExpectedIsolationRule(createFileRecord(path), loaded))
        .toBe(matchesExpectedIsolationRule(createFileRecord(path), draft));
    }
  });
});
