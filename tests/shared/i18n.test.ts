import { describe, expect, it } from "vitest";

import {
  LOCALE_OPTIONS,
  MESSAGE_CATALOGS,
  SUPPORTED_LOCALES,
  ZH_CN_MESSAGES,
  createTranslator,
  resolvePluginLocale,
  resolveTextDirection,
} from "../../src/shared/i18n";

describe("i18n", () => {
  it("publishes eleven complete typed catalogs and language autonyms", () => {
    expect(SUPPORTED_LOCALES).toHaveLength(11);
    expect(LOCALE_OPTIONS.map(({ value }) => value)).toEqual(SUPPORTED_LOCALES);
    const sourceKeys = Object.keys(ZH_CN_MESSAGES).sort();
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(MESSAGE_CATALOGS[locale]).sort()).toEqual(sourceKeys);
    }
  });

  it.each([
    ["de-DE", "de"],
    ["fr_FR", "fr"],
    ["ru", "ru"],
    ["pt-PT", "pt-BR"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["es-MX", "es"],
    ["vi-VN", "vi"],
    ["zh-Hans", "zh-CN"],
    ["zh_Hant_TW", "zh-TW"],
    ["nl-NL", "en"],
  ] as const)("maps host locale %s to %s", (hostLocale, expected) => {
    expect(resolvePluginLocale("auto", hostLocale)).toBe(expected);
  });

  it("interpolates and applies locale plural rules", () => {
    const translator = createTranslator("en", "en-US");
    expect(translator.t("sidebar.broken.occurrences", { count: 1 }))
      .toBe("1 broken link");
    expect(translator.t("sidebar.broken.occurrences", { count: 2 }))
      .toBe("2 broken links");
    expect(translator.t("status.scanning", { current: 3, total: 10 }))
      .toBe("Scanning 3/10");
  });

  it("keeps an RTL foundation when automatic locale falls back to English", () => {
    const translator = createTranslator("auto", "ar-SA");
    expect(translator.locale).toBe("en");
    expect(translator.direction).toBe("rtl");
    expect(resolveTextDirection("en", "ar-SA")).toBe("ltr");
  });

  it("provides localized host-following language and command labels", () => {
    expect(createTranslator("zh-TW", "en").t("command.openSidebar"))
      .toBe("開啟 Link Integrity");
    expect(createTranslator("zh-CN", "en").t("settings.general.language.auto"))
      .toBe("跟随 Obsidian");
    expect(createTranslator("en", "en").t("settings.general.language.auto"))
      .toBe("Follow Obsidian");
  });
});
