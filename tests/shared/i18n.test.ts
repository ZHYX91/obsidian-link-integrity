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
  it("publishes twelve complete typed catalogs and language autonyms", () => {
    expect(SUPPORTED_LOCALES).toHaveLength(12);
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
    ["ar-SA", "ar"],
    ["ar_EG", "ar"],
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

  it("illustrates outgoing links versus isolation in every settings locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const guide = createTranslator(locale, "en").t("settings.isolated.advancedMode.description");
      expect(guide, locale).toContain("A.md");
      expect(guide, locale).toContain("B.md");
      expect(guide, locale).toContain("[[B]]");
    }
  });

  it("renders Arabic RTL and preserves RTL for an unsupported host language", () => {
    const translator = createTranslator("auto", "ar-SA");
    expect(translator.locale).toBe("ar");
    expect(translator.direction).toBe("rtl");
    expect(translator.t("settings.general.language")).toBe("لغة الواجهة");
    expect(resolveTextDirection("ar", "en")).toBe("rtl");
    const unsupported = createTranslator("auto", "fa-IR");
    expect(unsupported.locale).toBe("en");
    expect(unsupported.direction).toBe("rtl");
    expect(resolveTextDirection("en", "ar-SA")).toBe("ltr");
  });

  it("uses Arabic plural rules for 0, 1, 2, 3 and 11", () => {
    const t = createTranslator("ar", "en").t;
    expect(t("sidebar.broken.occurrences", { count: 0 })).toContain("لا توجد");
    expect(t("sidebar.broken.occurrences", { count: 1 })).toContain("رابط معطّل");
    expect(t("sidebar.broken.occurrences", { count: 2 })).toContain("رابطان معطّلان");
    expect(t("sidebar.broken.occurrences", { count: 3 })).toContain("روابط معطّلة");
    expect(t("sidebar.broken.occurrences", { count: 11 })).toContain("رابطًا معطّلًا");
    expect(t("fileType.selectedCount", { selected: 2, total: 5 })).toContain("2 من 5");
  });

  it("provides localized host-following language and command labels", () => {
    expect(createTranslator("zh-TW", "en").t("command.openSidebar"))
      .toBe("開啟 Link Integrity");
    expect(createTranslator("zh-CN", "en").t("settings.general.language.auto"))
      .toBe("跟随 Obsidian");
    expect(createTranslator("en", "en").t("settings.general.language.auto"))
      .toBe("Follow Obsidian");
  });
  it("explains connection filters in everyday language", () => {
    const en = createTranslator("en", "en");
    const zh = createTranslator("zh-CN", "en");
    const ar = createTranslator("ar", "en");
    expect(en.t("settings.ignore.matcher.formatFamily")).toBe("File type group");
    expect(zh.t("settings.ignore.matcher.formatFamily")).toBe("文件类型组");
    expect(ar.t("settings.ignore.matcher.formatFamily")).toBe("مجموعة أنواع الملفات");
    expect(en.t("settings.expected.conditions")).not.toMatch(/\\bAND\\b|\\bOR\\b/);
    expect(zh.t("settings.expected.conditions")).not.toMatch(/\\bAND\\b|\\bOR\\b/);
    expect(en.t("sidebar.isolated.showExpected.description")).not.toContain("high-confidence");
  });

  it("keeps advanced ignore controls user-facing in the primary locales", () => {
    expect(createTranslator("en", "en").t("settings.ignore.matcher.occurrenceId"))
      .toBe("Reference identifier");
    expect(createTranslator("en", "en").t("ignore.scope.ignoreOccurrence"))
      .toBe("Ignore this reference");
    expect(createTranslator("zh-CN", "en").t("settings.ignore.matcher.occurrenceId"))
      .toBe("引用标识");
    expect(createTranslator("zh-CN", "en").t("ignore.scope.excludeGraph"))
      .toBe("从连接关系中排除匹配链接（高级）");
    expect(createTranslator("zh-TW", "en").t("settings.ignore.matcher.occurrenceId"))
      .toBe("參照識別碼");
    expect(createTranslator("zh-TW", "en").t("ignore.scope.ignoreOccurrence"))
      .toBe("忽略這一處參照");
    expect(createTranslator("pt-BR", "en").t("settings.ignore.title"))
      .toBe("Regras de exclusão");
  });

  it.each([
    ["en", /\bgraph\b/iu],
    ["de", /Link-Graph/iu],
    ["es", /grafo de enlaces/iu],
    ["fr", /graphe de liens/iu],
    ["ja", /リンクグラフ/u],
    ["ko", /링크 그래프/u],
    ["pt-BR", /grafo de links/iu],
    ["ru", /граф ссылок/iu],
    ["vi", /đồ thị liên kết/iu],
    ["zh-CN", /链接图/u],
    ["zh-TW", /連結圖/u],
    ["ar", /رسم بياني|مخطط بياني/u],
  ] as const)("keeps temporary-filter copy free of graph jargon in %s", (locale, pattern) => {
    expect(createTranslator(locale, "en").t("sidebar.fileTypes.temporary"))
      .not.toMatch(pattern);
  });


  it("keeps interpolation placeholders in parity with the source catalog", () => {
    const collect = (value: unknown): string[] => {
      const messages = typeof value === "string"
        ? [value]
        : value != null && typeof value === "object"
          ? Object.values(value as Record<string, string>)
          : [];
      return [...new Set(messages.flatMap((message) =>
        [...message.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
          .map((match) => match[1] ?? "")
          .filter(Boolean),
      ))].sort();
    };
    const source = MESSAGE_CATALOGS["zh-CN"];
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = MESSAGE_CATALOGS[locale];
      for (const key of Object.keys(source) as Array<keyof typeof source>) {
        expect(collect(catalog[key]), `${locale}:${String(key)}`)
          .toEqual(collect(source[key]));
      }
    }
  });

});
