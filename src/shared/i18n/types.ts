import type { ZH_CN_MESSAGES } from "./catalogs/zh-cn";
import type { MessageValue } from "./message-value";

export const SUPPORTED_LOCALES = [
  "en",
  "zh-CN",
  "zh-TW",
  "de",
  "fr",
  "ru",
  "pt-BR",
  "ja",
  "ko",
  "es",
  "vi",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type PluginLocale = "auto" | SupportedLocale;
export type TextDirection = "ltr" | "rtl";
export type MessageKey = keyof typeof ZH_CN_MESSAGES;
export type MessageParameters = Readonly<Record<string, string | number>>;
export type MessageCatalog = Readonly<Record<MessageKey, MessageValue>>;
export type MessageCatalogs = Readonly<Record<SupportedLocale, MessageCatalog>>;

export interface Translator {
  readonly locale: SupportedLocale;
  readonly direction: TextDirection;
  readonly t: (key: MessageKey, parameters?: MessageParameters) => string;
}
