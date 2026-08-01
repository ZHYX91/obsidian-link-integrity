import { MESSAGE_CATALOGS } from "./catalogs";
import type { MessageValue } from "./message-value";
import {
  SUPPORTED_LOCALES,
  type MessageCatalog,
  type MessageKey,
  type MessageParameters,
  type PluginLocale,
  type SupportedLocale,
  type TextDirection,
  type Translator,
} from "./types";

export interface LocaleOption {
  readonly value: SupportedLocale;
  readonly autonym: string;
}

export const LOCALE_OPTIONS: readonly LocaleOption[] = [
  { value: "en", autonym: "English" },
  { value: "zh-CN", autonym: "简体中文" },
  { value: "zh-TW", autonym: "繁體中文" },
  { value: "de", autonym: "Deutsch" },
  { value: "fr", autonym: "Français" },
  { value: "ru", autonym: "Русский" },
  { value: "pt-BR", autonym: "Português (Brasil)" },
  { value: "ja", autonym: "日本語" },
  { value: "ko", autonym: "한국어" },
  { value: "es", autonym: "Español" },
  { value: "vi", autonym: "Tiếng Việt" },
];

export type CatalogOverrides = Partial<
  Record<SupportedLocale, Partial<MessageCatalog>>
>;

export function isPluginLocale(value: unknown): value is PluginLocale {
  return value === "auto" ||
    (typeof value === "string" &&
      (SUPPORTED_LOCALES as readonly string[]).includes(value));
}

export function resolvePluginLocale(
  configuredLocale: PluginLocale,
  hostLocale: string,
): SupportedLocale {
  if (configuredLocale !== "auto") return configuredLocale;
  const normalized = normalizeLanguageTag(hostLocale);
  const parts = normalized.split("-");
  const language = parts[0] ?? "en";
  if (language === "zh") {
    return parts.includes("hant") ||
        parts.includes("tw") ||
        parts.includes("hk") ||
        parts.includes("mo")
      ? "zh-TW"
      : "zh-CN";
  }
  if (language === "pt") return "pt-BR";
  return isSupportedLocale(language) ? language : "en";
}

export function resolveTextDirection(
  configuredLocale: PluginLocale,
  hostLocale: string,
): TextDirection {
  const languageTag = configuredLocale === "auto" ? hostLocale : configuredLocale;
  const language = normalizeLanguageTag(languageTag).split("-")[0] ?? "en";
  return RTL_LANGUAGE_CODES.has(language) ? "rtl" : "ltr";
}

export function createTranslator(
  configuredLocale: PluginLocale,
  hostLocale: string,
  overrides: CatalogOverrides = {},
): Translator {
  const locale = resolvePluginLocale(configuredLocale, hostLocale);
  return Object.freeze({
    locale,
    direction: resolveTextDirection(configuredLocale, hostLocale),
    t: (key: MessageKey, parameters: MessageParameters = {}) => {
      const message = overrides[locale]?.[key] ??
        MESSAGE_CATALOGS[locale][key] ??
        MESSAGE_CATALOGS.en[key];
      return interpolate(selectMessage(message, locale, parameters.count), parameters);
    },
  });
}

function selectMessage(
  message: MessageValue,
  locale: SupportedLocale,
  count: string | number | undefined,
): string {
  if (typeof message === "string") return message;
  if (typeof count !== "number" || !Number.isFinite(count)) return message.other;
  const category = new Intl.PluralRules(locale).select(count);
  return message[category] ?? message.other;
}

function interpolate(message: string, parameters: MessageParameters): string {
  return message.replace(
    /\{([A-Za-z][A-Za-z0-9]*)\}/g,
    (placeholder, name: string) => parameters[name] === undefined
      ? placeholder
      : String(parameters[name]),
  );
}

function normalizeLanguageTag(value: string): string {
  return value.trim().replaceAll("_", "-").toLowerCase();
}

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

const RTL_LANGUAGE_CODES = new Set([
  "ar",
  "fa",
  "he",
  "iw",
  "ps",
  "sd",
  "ug",
  "ur",
  "yi",
]);
