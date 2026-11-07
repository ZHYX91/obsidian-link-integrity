import { afterEach, describe, expect, it, vi } from "vitest";

import { createOccurrenceId } from "../../src/core/occurrence-identity";
import { createTranslator, SUPPORTED_LOCALES, type SupportedLocale } from "../../src/shared/i18n";
import { normalizeIgnoreRule, type IgnoreRule } from "../../src/shared/ignore-rules";
import { createDefaultSettings, type LinkIntegritySettings } from "../../src/shared/settings";
import { renderIgnoreRules } from "../../src/ui/settings/ignore-rule-editor";
import type { IgnoreRuleDraft, SettingsUiContext } from "../../src/ui/settings/types";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

describe("paused occurrence rules in settings", () => {
  it.each(SUPPORTED_LOCALES)("explains how to select the reference again in %s", (locale) => {
    const view = setup(locale);
    const { t } = view.translator;
    expect(view.container.textContent).toContain(t("settings.ignore.occurrenceSelectionRequired", {
      action: t("ignore.scope.ignoreOccurrence"),
    }));
    expect(view.container.textContent).not.toContain("{action}");
    expect(view.enabled.disabled).toBe(true);
    expect(view.enabled.checked).toBe(false);
    expect(view.action(t("settings.ignore.confirmTargetPath")).hidden).toBe(true);
    expect(view.action(t("common.preview")).disabled).toBe(true);
    expect(view.action(t("common.save")).disabled).toBe(true);
    view.enabled.checked = true;
    view.enabled.dispatchEvent(new Event("change"));
    view.action(t("common.preview")).dispatchEvent(new Event("click"));
    view.action(t("common.save")).dispatchEvent(new Event("click"));
    expect(view.preview).not.toHaveBeenCalled();
    expect(view.onSettingsChange).not.toHaveBeenCalled();
    expect(view.settings().ignoreRules).toEqual([view.original]);
    expect(view.drafts.get(view.original.id)?.draft.enabled).toBe(false);
  });

  it("retains a paused rule when a delete save fails", async () => {
    const failed = vi.fn(async () => { throw new Error("disk full"); });
    const view = setup("en", { onSettingsChange: failed });
    view.action("Delete").click();
    await vi.waitFor(() => expect(view.onError).toHaveBeenCalledOnce());
    expect(view.settings().ignoreRules).toEqual([view.original]);
    expect(view.drafts.get(view.original.id)?.draft).toEqual(view.original);
    expect(view.container.textContent).toContain("Keep this explanation");
  });

  it("requires a fresh preview after explicitly replacing the old identifier", async () => {
    const view = setup("en");
    const current = createOccurrenceId({ sourcePath: "Source.md", kind: "markdown-link",
      raw: "[[Selected]]", linktext: "Selected", duplicateIndex: 0, duplicateCount: 1 });
    const field = [...view.container.querySelectorAll("label")]
      .find((label) => label.querySelector("span")?.textContent === "Match value")!
      .querySelector("input")!;
    field.value = current;
    field.dispatchEvent(new Event("input"));
    expect(view.enabled.disabled).toBe(false);
    expect(view.enabled.checked).toBe(false);
    expect(view.action("Save").disabled).toBe(true);
    view.enabled.checked = true;
    view.enabled.dispatchEvent(new Event("change"));
    view.action("Preview").click();
    await vi.waitFor(() => expect(view.action("Save").disabled).toBe(false));
    view.action("Save").click();
    expect(view.settings().ignoreRules[0]).toEqual({
      ...view.original, enabled: true, matcher: { kind: "occurrence-id", value: current },
    });
  });
});

function setup(locale: SupportedLocale, overrides: Partial<SettingsUiContext> = {}) {
  const original = normalizeIgnoreRule({ id: "paused", enabled: true, scope: "ignore-occurrence",
    matcher: { kind: "occurrence-id", value: "Source.md\u0000markdown-link\u00000:0\u00000" },
    createdAt: 1, note: "Keep this explanation" })!;
  let settings: LinkIntegritySettings = { ...createDefaultSettings(), ignoreRules: [original] };
  const translator = createTranslator(locale, "en");
  const drafts = new Map<string, IgnoreRuleDraft>();
  const onSettingsChange = vi.fn((next: LinkIntegritySettings) => { settings = next; });
  const preview = vi.fn(async (_rule: IgnoreRule, _signal: AbortSignal) => ({ matchCount: 1, samples: ["Source.md"] }));
  const onError = vi.fn();
  const context: SettingsUiContext = {
    settings, getSettings: () => settings, translator, writeProtected: false, onSettingsChange,
    createId: () => "new-rule",
    getSaveStatus: () => ({ state: "saved", error: null }), retrySave: async () => undefined,
    ignoreRuleDrafts: drafts, requestIgnoreRulePreview: preview, onError, ...overrides,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const cleanup = renderIgnoreRules(container, context, "broken");
  cleanups.push(() => { cleanup(); container.remove(); });
  const action = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === text)!;
  return { container, translator, original, drafts, preview, onError, onSettingsChange, action,
    enabled: container.querySelector<HTMLInputElement>('input[type="checkbox"]')!, settings: () => settings };
}
