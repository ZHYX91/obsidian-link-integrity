import { describe, expect, it } from "vitest";

import {
  compileDateFormat,
  createDefaultPeriodicNotesPreset,
  createPeriodicExpectedIsolatedRule,
  createPeriodicExpectedIsolationRules,
  getExpectedRuleStats,
  matchesExpectedIsolationRule,
  normalizeExpectedIsolationRules,
  type ExpectedIsolationRule,
} from "../../src/core/expected-isolation-rules";
import { createFileRecord } from "../../src/core/model";

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
});
