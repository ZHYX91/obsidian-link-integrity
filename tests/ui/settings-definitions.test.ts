import { describe, expect, it, vi } from "vitest";

import { createDefaultSettings } from "../../src/shared/settings";
import { createTranslator } from "../../src/shared/i18n";
import {
  getDeclarativeSettingDefinitions,
  getSettingsPageDefinitions,
  type SettingsUiContext,
} from "../../src/ui/settings";

describe("settings definitions", () => {
  it("uses one three-page definition source for imperative and declarative UI", () => {
    const context = settingsContext();
    const pages = getSettingsPageDefinitions(context);
    const declarative = getDeclarativeSettingDefinitions(context);
    expect(pages.map(({ id }) => id)).toEqual([
      "general",
      "broken-links",
      "isolated-files",
    ]);
    expect(declarative).toHaveLength(pages.length);
    expect(pages.map(({ label }) => label)).toEqual([
      "General",
      "Broken links",
      "Isolated files",
    ]);
    expect(JSON.stringify(pages)).not.toMatch(/orphan/i);
  });

  it("keeps expected-isolation rules exclusively on the isolated-files page", () => {
    const pages = getSettingsPageDefinitions(settingsContext());
    const broken = pages.find(({ id }) => id === "broken-links")!;
    const isolated = pages.find(({ id }) => id === "isolated-files")!;
    expect(JSON.stringify(broken)).not.toContain("expected-isolation-rules");
    expect(JSON.stringify(isolated)).toContain("expected-isolation-rules");
    expect(JSON.stringify(isolated)).toContain("periodic-notes-preset");
  });

  it("includes all public language choices plus automatic", () => {
    const general = getSettingsPageDefinitions(settingsContext())[0]!;
    const language = general.sections[0]?.items.find((item) =>
      item.kind === "dropdown" && item.key === "general.locale");
    expect(language?.kind).toBe("dropdown");
    if (language?.kind === "dropdown") expect(language.options).toHaveLength(12);
  });
});

function settingsContext(): SettingsUiContext {
  return {
    settings: createDefaultSettings(),
    translator: createTranslator("en", "en"),
    writeProtected: false,
    createId: (kind) => `${kind}-1`,
    onSettingsChange: vi.fn(),
  };
}
