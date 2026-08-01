import type { MessageCatalogs } from "../types";
import { EN_MESSAGES } from "./en";
import { DE_MESSAGES } from "./de";
import { ES_MESSAGES } from "./es";
import { FR_MESSAGES } from "./fr";
import { JA_MESSAGES } from "./ja";
import { KO_MESSAGES } from "./ko";
import { PT_BR_MESSAGES } from "./pt-br";
import { RU_MESSAGES } from "./ru";
import { VI_MESSAGES } from "./vi";
import { ZH_CN_MESSAGES } from "./zh-cn";
import { ZH_TW_MESSAGES } from "./zh-tw";

export const MESSAGE_CATALOGS: MessageCatalogs = {
  en: EN_MESSAGES,
  "zh-CN": ZH_CN_MESSAGES,
  "zh-TW": ZH_TW_MESSAGES,
  de: DE_MESSAGES,
  fr: FR_MESSAGES,
  ru: RU_MESSAGES,
  "pt-BR": PT_BR_MESSAGES,
  ja: JA_MESSAGES,
  ko: KO_MESSAGES,
  es: ES_MESSAGES,
  vi: VI_MESSAGES,
};
