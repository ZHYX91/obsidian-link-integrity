import type { Translator } from "../../shared/i18n/types";

/** Translate validation diagnostics only at the UI boundary; keep matcher errors stable. */
export function formatExpectedRuleErrors(errors: readonly string[], t: Translator["t"]): string {
  return errors.map((message) => formatExpectedRuleError(message, t)).join(" ");
}

function formatExpectedRuleError(message: string, t: Translator["t"]): string {
  if (message === "Invalid rule ID.") return t("settings.expected.validation.ruleId");
  if (message === "Rule name required." || message === "Rule name > 120 chars.") {
    return t("settings.expected.validation.name");
  }
  if (message === "Rule needs a condition.") return t("settings.expected.validation.condition");
  if (message === "Invalid pattern ID." || message.startsWith("Duplicate pattern ID:") ||
      message === "Pattern required." || message === "Glob pattern cannot be empty.") {
    return t("settings.expected.validation.pattern");
  }
  const length = /^(?:date-format|glob|regex) pattern > (\d+) chars\.$/u.exec(message);
  if (length !== null) {
    return t("settings.expected.validation.patternLength", { max: Number(length[1]) });
  }
  if (message === "Date format cannot be empty." ||
      message.startsWith("Unclosed date-format literal:") ||
      message.startsWith("Unsupported date-format token near:")) {
    return t("settings.expected.validation.date");
  }
  if (/^(?:Regex |Pattern >|Lookaround|Backreferences)/u.test(message)) {
    return t("settings.expected.validation.regex");
  }
  if (/\b(?:folder|path)\b/iu.test(message)) return t("settings.expected.validation.folder");
  return t("settings.expected.validation.generic");
}
