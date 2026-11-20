import { describe, expect, it } from "vitest";
import { createTranslator, SUPPORTED_LOCALES } from "../../src/shared/i18n";
import { formatExpectedRuleErrors } from "../../src/ui/settings/expected-rule-messages";

describe("expected isolation rule error messages", () => {
  it("translates known errors without changing the core validation contract", () => {
    const t = createTranslator("en", "en").t;
    expect(formatExpectedRuleErrors(["regex pattern > 512 chars."], t))
      .toBe("Naming pattern must be at most 512 characters.");
    expect(formatExpectedRuleErrors(["Rule name required."], t))
      .toBe(t("settings.expected.validation.name"));
    expect(formatExpectedRuleErrors(["Unsupported date-format token near: yyyy"], t))
      .toBe(t("settings.expected.validation.date"));
    expect(formatExpectedRuleErrors(["Regex flags repeated."], t))
      .toBe(t("settings.expected.validation.regex"));
    expect(formatExpectedRuleErrors(["Unexpected backend detail"], t))
      .toBe(t("settings.expected.validation.generic"));
  });

  it("provides localized diagnostics in all twelve languages without echoing raw errors", () => {
    const errors = [
      "Invalid rule ID.", "Rule name required.", "Rule needs a condition.",
      "Duplicate pattern ID: test", "regex pattern > 512 chars.",
      "Unclosed date-format literal: YYYY-[X",
      "Backreferences unsupported.", "Invalid Vault folder path",
      "Unrecognized internal detail",
    ];
    const en = formatExpectedRuleErrors(errors, createTranslator("en", "en").t);
    for (const locale of SUPPORTED_LOCALES) {
      const t = createTranslator(locale, "en").t;
      const result = formatExpectedRuleErrors(errors, t);
      expect(result, locale).toContain(t("settings.expected.validation.patternLength", { max: 512 }));
      for (const error of errors) expect(result, locale).not.toContain(error);
      if (locale !== "en") expect(result, locale).not.toBe(en);
    }
  });

  it("uses singular file preview labels where the locale has singular grammar", () => {
    for (const locale of ["en", "de", "fr", "es", "pt-BR"] as const) {
      const t = createTranslator(locale, "en").t;
      const singular = t("settings.expected.preview", { count: 1, samples: "One.md" });
      const plural = t("settings.expected.preview", { count: 2, samples: "One.md" });
      expect(singular, locale).not.toBe(plural.replace("2", "1"));
      expect(singular).toContain("One.md");
    }
  });

  it.each([1, 2, 3])("labels the Arabic matching-file count for %i matches", (count) => {
    const t = createTranslator("ar", "ar").t;
    expect(t("settings.expected.preview", { count, samples: "A.md" }))
      .toBe(`عدد الملفات المطابقة: ${count}؛ أمثلة: A.md`);
  });
});
