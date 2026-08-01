import { describe, expect, it, vi } from "vitest";

import type { ExpectedIsolationRule } from "../../src/core/expected-isolation-rules";
import { createTranslator } from "../../src/shared/i18n";
import type { IgnoreRule } from "../../src/shared/ignore-rules";
import { createDefaultSettings, type LinkIntegritySettings } from "../../src/shared/settings";
import { renderCustomSetting } from "../../src/ui/settings/custom-sections";
import type { SettingsUiContext } from "../../src/ui/settings";

describe("custom settings sections", () => {
  it("renders expected rule conditions and match samples, then edits immutably", () => {
    const rule = expectedRule();
    const settings = withExpectedRule(createDefaultSettings(), rule);
    const onSettingsChange = vi.fn();
    const container = document.createElement("div");
    renderCustomSetting(container, "expected-isolation-rules", context(settings, {
      onSettingsChange,
      getExpectedRulePreview: () => ({
        state: "ready",
        stats: {
          ruleId: rule.id,
          name: rule.name,
          matchCount: 2,
          samples: ["Daily/2026-08-01.md", "Daily/2026-08-02.md"],
          errors: [],
        },
      }),
    }));
    expect(container.textContent).toContain("File type, folder, and naming conditions use AND");
    expect(container.textContent).toContain("Daily/2026-08-01.md");
    const name = Array.from(container.querySelectorAll("label"))
      .find(({ textContent }) => textContent?.includes("Rule name"))
      ?.querySelector<HTMLInputElement>('input[type="text"]');
    expect(name).not.toBeNull();
    if (name !== null && name !== undefined) {
      name.value = "Journal notes";
      name.dispatchEvent(new Event("change", { bubbles: true }));
    }
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        isolatedFiles: expect.objectContaining({
          expectedRules: [expect.objectContaining({ name: "Journal notes" })],
        }),
      }),
      "query-only",
    );
  });

  it("shows a separate high-risk warning and preview for graph contribution rules", () => {
    const graphRule: IgnoreRule = {
      id: "generated",
      enabled: true,
      scope: "exclude-graph-contribution",
      matcher: { kind: "path-prefix", value: "Generated" },
      createdAt: 1,
      note: "Generated files",
    };
    const defaults = createDefaultSettings();
    const settings = { ...defaults, ignoreRules: [graphRule] };
    const container = document.createElement("div");
    renderCustomSetting(container, "isolated-ignore-rules", context(settings, {
      getIgnoreRulePreview: () => ({
        matchCount: 3,
        samples: ["Generated/a.md"],
      }),
    }));
    expect(container.textContent).toContain("false isolated-file results");
    expect(container.textContent).toContain("Matches 3 items");
    expect(container.textContent).toContain("Generated/a.md");
    expect(container.querySelector(".is-graph-risk")).not.toBeNull();
  });

  it("offers five independent periodic-note presets without a runtime integration", () => {
    const container = document.createElement("div");
    renderCustomSetting(
      container,
      "periodic-notes-preset",
      context(createDefaultSettings()),
    );
    for (const label of [
      "Daily notes",
      "Weekly notes",
      "Monthly notes",
      "Quarterly notes",
      "Yearly notes",
    ]) expect(container.textContent).toContain(label);
  });
});

function context(
  settings: LinkIntegritySettings,
  overrides: Partial<SettingsUiContext> = {},
): SettingsUiContext {
  return {
    settings,
    translator: createTranslator("en", "en"),
    writeProtected: false,
    createId: (kind) => `${kind}-new`,
    onSettingsChange: vi.fn(),
    ...overrides,
  };
}

function expectedRule(): ExpectedIsolationRule {
  return {
    id: "daily",
    name: "Daily notes",
    enabled: true,
    fileTypeFamilyIds: ["markdown"],
    fileTypeCategoryIds: [],
    fileExtensions: [],
    folder: { path: "Daily", mode: "recursive" },
    namingPatterns: [{
      id: "daily-name",
      kind: "date-format",
      pattern: "YYYY-MM-DD",
      flags: "u",
      target: "basename",
    }],
  };
}

function withExpectedRule(
  settings: LinkIntegritySettings,
  rule: ExpectedIsolationRule,
): LinkIntegritySettings {
  return {
    ...settings,
    isolatedFiles: {
      ...settings.isolatedFiles,
      expectedRules: [rule],
    },
  };
}
