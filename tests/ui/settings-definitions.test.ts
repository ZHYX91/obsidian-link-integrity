import { describe, expect, it, vi } from "vitest";

import { createDefaultSettings } from "../../src/shared/settings";
import { createTranslator } from "../../src/shared/i18n";
import {
  getDeclarativeSettingDefinitions,
  getSettingsPageDefinitions,
  type SettingsUiContext,
} from "../../src/ui/settings";

describe("settings definitions", () => {
  it("does not repeat page labels or single custom-setting names as section headings", () => {
    const pages = getSettingsPageDefinitions(settingsContext());
    const general = pages.find(({ id }) => id === "general");
    const broken = pages.find(({ id }) => id === "broken-links");
    const isolated = pages.find(({ id }) => id === "isolated-files");

    expect(general?.sections[0]?.heading).toBeUndefined();
    expect(broken?.sections.find(({ items }) =>
      items.some((item) => item.kind === "custom" && item.id === "broken-ignore-rules"),
    )?.heading).toBeUndefined();
    expect(isolated?.sections.find(({ items }) =>
      items.some((item) => item.kind === "custom" && item.id === "isolated-candidate-types"),
    )?.heading).toBeUndefined();
    expect(isolated?.sections.find(({ items }) =>
      items.some((item) => item.kind === "custom" && item.id === "isolated-ignore-rules"),
    )?.heading).toBeUndefined();

    const declarativePages = getDeclarativeSettingDefinitions(settingsContext());
    const declarativeGeneral = declarativePages[0];
    expect(declarativeGeneral).toMatchObject({ type: "page", name: "General" });
    if (declarativeGeneral !== undefined
      && "type" in declarativeGeneral
      && declarativeGeneral.type === "page") {
      expect(declarativeGeneral.items?.[0]).not.toMatchObject({ type: "group" });
    }
  });

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
