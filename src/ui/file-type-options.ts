import { FILE_TYPE_CATEGORIES } from "../core/file-types";
import type { MessageKey, Translator } from "../shared/i18n";
import type { FileTypeCategoryOption } from "./file-type-selection";

export function createFileTypeCategoryOptions(
  translator: Translator,
): readonly FileTypeCategoryOption[] {
  return FILE_TYPE_CATEGORIES.map((category) => ({
    id: category.id,
    label: translator.t(asMessageKey(category.labelKey)),
    formats: category.families.map((format) => ({
      id: format.id,
      label: translator.t(asMessageKey(format.labelKey)),
      extensions: format.extensions,
    })),
  }));
}

function asMessageKey(value: string): MessageKey {
  return value as MessageKey;
}
