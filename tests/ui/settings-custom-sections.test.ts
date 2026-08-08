import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExpectedIsolationRule } from "../../src/core/expected-isolation-rules";
import { createTranslator } from "../../src/shared/i18n";
import type { IgnoreRule } from "../../src/shared/ignore-rules";
import { createDefaultSettings, type LinkIntegritySettings } from "../../src/shared/settings";
import { renderCustomSetting } from "../../src/ui/settings/custom-sections";
import type { SettingsUiContext } from "../../src/ui/settings";

describe("custom settings sections", () => {
  afterEach(() => {
    document.querySelectorAll(".link-integrity-rule-modal").forEach((element) => element.remove());
    vi.useRealTimers();
  });

  it("renders compact expected-rule summaries and commits only a saved draft", () => {
    vi.useFakeTimers();
    const rule = expectedRule();
    const settings = withExpectedRule(createDefaultSettings(), rule);
    const onSettingsChange = vi.fn();
    const requestExpectedRulePreview = vi.fn();
    const container = document.createElement("div");
    const cleanup = renderCustomSetting(container, "expected-isolation-rules", context(settings, {
      onSettingsChange,
      requestExpectedRulePreview,
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
    expect(container.textContent).toContain("Rules only classify isolated files");
    expect(container.textContent).toContain("Daily · Include subfolders · Markdown");
    expect(container.textContent).toContain("Matches 2 items");
    const summaryCheckbox = container.querySelector<HTMLInputElement>(
      ".link-integrity-expected-rule-card > input[type=checkbox]",
    );
    expect(summaryCheckbox?.getAttribute("aria-label")).toBe("Daily notes");
    const edit = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(({ textContent }) => textContent === "Edit");
    edit?.click();
    const dialog = document.querySelector<HTMLElement>('.link-integrity-rule-modal [role="dialog"]');
    expect(dialog).not.toBeNull();
    const name = Array.from(dialog?.querySelectorAll("label") ?? [])
      .find(({ textContent }) => textContent?.includes("Rule name"))
      ?.querySelector<HTMLInputElement>('input[type="text"]');
    expect(name).not.toBeNull();
    if (name !== null && name !== undefined) {
      name.value = "Journal notes";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(onSettingsChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(requestExpectedRulePreview).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Journal notes" }),
      expect.any(Function),
    );
    Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find(({ textContent }) => textContent === "Save")
      ?.click();
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        isolatedFiles: expect.objectContaining({
          expectedRules: [expect.objectContaining({ name: "Journal notes" })],
        }),
      }),
      "query-only",
    );
    expect(document.querySelector(".link-integrity-rule-modal")).toBeNull();
    cleanup();
  });

  it("chooses a friendly rule template and keeps it as a draft until save", () => {
    const settings = createDefaultSettings();
    const onSettingsChange = vi.fn();
    const container = document.createElement("div");
    const cleanup = renderCustomSetting(container, "expected-isolation-rules", context(settings, {
      onSettingsChange,
    }));
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(({ textContent }) => textContent === "Add expected-isolation rule")
      ?.click();
    const picker = document.querySelector<HTMLElement>(".link-integrity-rule-template-picker");
    expect(picker?.textContent).toContain("Periodic notes preset");
    expect(picker?.textContent).toContain("Folder");
    expect(picker?.textContent).toContain("Naming patterns");
    expect(picker?.textContent).toContain("Advanced");
    Array.from(picker?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find(({ textContent }) => textContent === "Folder")
      ?.click();
    const dialog = document.querySelector<HTMLElement>('.link-integrity-rule-modal [role="dialog"]');
    const folder = Array.from(dialog?.querySelectorAll("label") ?? [])
      .find(({ textContent }) => textContent?.startsWith("Folder"))
      ?.querySelector<HTMLInputElement>('input[type="text"]');
    expect(folder).not.toBeNull();
    if (folder !== null && folder !== undefined) {
      folder.value = "Templates";
      folder.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(onSettingsChange).not.toHaveBeenCalled();
    const save = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find(({ textContent }) => textContent === "Save");
    expect(save?.disabled).toBe(false);
    save?.click();
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        isolatedFiles: expect.objectContaining({
          expectedRules: [expect.objectContaining({
            name: "Folder",
            folder: { path: "Templates", mode: "recursive" },
          })],
        }),
      }),
      "query-only",
    );
    cleanup();
  });

  it("discards an edited rule draft when the modal is cancelled with Escape", () => {
    const rule = expectedRule();
    const onSettingsChange = vi.fn();
    const container = document.createElement("div");
    const cleanup = renderCustomSetting(
      container,
      "expected-isolation-rules",
      context(withExpectedRule(createDefaultSettings(), rule), { onSettingsChange }),
    );
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(({ textContent }) => textContent === "Edit")
      ?.click();
    const dialog = document.querySelector<HTMLElement>('.link-integrity-rule-modal [role="dialog"]');
    const name = Array.from(dialog?.querySelectorAll("label") ?? [])
      .find(({ textContent }) => textContent?.includes("Rule name"))
      ?.querySelector<HTMLInputElement>('input[type="text"]');
    if (name !== null && name !== undefined) {
      name.value = "Unsaved name";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    }
    dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".link-integrity-rule-modal")).toBeNull();
    expect(onSettingsChange).not.toHaveBeenCalled();
    cleanup();
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
    const summaryCheckbox = container.querySelector<HTMLInputElement>(
      ".is-graph-risk > summary input[type=checkbox]",
    );
    expect(summaryCheckbox?.getAttribute("aria-label")).toBe("Generated files");
    summaryCheckbox?.click();
    expect(summaryCheckbox?.closest("details")?.open).toBe(false);
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
    const summaryCheckboxes = Array.from(container.querySelectorAll<HTMLInputElement>(
      ".link-integrity-periodic-entry > summary input[type=checkbox]",
    ));
    expect(summaryCheckboxes.map((checkbox) => checkbox.getAttribute("aria-label"))).toEqual([
      "Daily notes",
      "Weekly notes",
      "Monthly notes",
      "Quarterly notes",
      "Yearly notes",
    ]);
    for (const checkbox of summaryCheckboxes) {
      checkbox.click();
      expect(checkbox.closest("details")?.open).toBe(false);
    }
  });

  it("keeps card enablement separate from opening the draft editor", () => {
    const container = document.createElement("div");
    const onSettingsChange = vi.fn();
    renderCustomSetting(
      container,
      "expected-isolation-rules",
      context(withExpectedRule(createDefaultSettings(), expectedRule()), { onSettingsChange }),
    );
    const card = container.querySelector<HTMLElement>(".link-integrity-expected-rule-card")!;
    const checkbox = card.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSettingsChange).toHaveBeenCalledOnce();
    expect(document.querySelector(".link-integrity-rule-modal")).toBeNull();
    Array.from(card.querySelectorAll<HTMLButtonElement>("button"))
      .find(({ textContent }) => textContent === "Edit")
      ?.click();
    expect(document.querySelector('.link-integrity-rule-modal [role="dialog"]')).not.toBeNull();
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
