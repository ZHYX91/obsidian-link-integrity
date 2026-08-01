import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "../../src/shared/i18n";
import { createFileTypeCategoryOptions } from "../../src/ui/file-type-options";
import {
  getCategorySelectionState,
  renderFileTypeSelection,
  toggleCategorySelection,
  toggleFormatSelection,
} from "../../src/ui/file-type-selection";

describe("file type selection", () => {
  const categories = createFileTypeCategoryOptions(createTranslator("en", "en"));

  it("derives checked, mixed, and unchecked parent states", () => {
    const image = categories.find(({ id }) => id === "image")!;
    expect(getCategorySelectionState(image, new Set())).toBe("unchecked");
    expect(getCategorySelectionState(image, new Set(["jpeg"]))).toBe("mixed");
    expect(getCategorySelectionState(
      image,
      new Set(image.formats.map(({ id }) => id)),
    )).toBe("checked");
  });

  it("toggles categories and individual format families immutably", () => {
    const model = {
      categories,
      selectedFormatIds: new Set<string>(),
      defaultFormatIds: new Set(["markdown"]),
    };
    const selected = toggleCategorySelection(model, "obsidian");
    expect(selected).toEqual(new Set(["markdown", "bases", "canvas"]));
    expect(model.selectedFormatIds.size).toBe(0);
    expect(toggleFormatSelection(selected, "canvas")).toEqual(new Set(["markdown", "bases"]));
  });

  it("renders expandable child formats and propagates checkbox changes", () => {
    const container = document.createElement("div");
    const onChange = vi.fn();
    renderFileTypeSelection(container, {
      categories,
      selectedFormatIds: new Set(["jpeg"]),
      defaultFormatIds: new Set(["markdown"]),
    }, {
      selectAllLabel: "Select all",
      clearLabel: "Clear",
      restoreDefaultLabel: "Restore defaults",
      selectedCountLabel: (selected, total) => `${selected}/${total}`,
      onChange,
    });
    const imageParent = container.querySelector<HTMLInputElement>(
      'input[aria-label="Images"]',
    );
    expect(imageParent?.indeterminate).toBe(true);
    const png = Array.from(container.querySelectorAll("label"))
      .find((label) => label.querySelector("span")?.textContent === "PNG")
      ?.querySelector<HTMLInputElement>("input");
    if (png != null) {
      png.checked = true;
      png.dispatchEvent(new Event("change", { bubbles: true }));
    }
    expect(onChange).toHaveBeenCalledWith(new Set(["jpeg", "png"]));
  });
});
