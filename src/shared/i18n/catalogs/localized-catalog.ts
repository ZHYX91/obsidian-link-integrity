import type { MessageCatalog } from "../types";

export function localizedCatalog(messages: MessageCatalog): MessageCatalog {
  return Object.freeze(messages);
}
