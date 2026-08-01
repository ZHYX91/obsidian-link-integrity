import type { MessageCatalog } from "../types";
import { EN_MESSAGES } from "./en";

export function localizedCatalog(overrides: Partial<MessageCatalog>): MessageCatalog {
  return Object.freeze({ ...EN_MESSAGES, ...overrides });
}
