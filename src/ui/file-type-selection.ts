export type SelectionState = "checked" | "mixed" | "unchecked";

export interface FileFormatOption {
  readonly id: string;
  readonly label: string;
  readonly extensions: readonly string[];
}

export interface FileTypeCategoryOption {
  readonly id: string;
  readonly label: string;
  readonly formats: readonly FileFormatOption[];
}

export interface FileTypeSelectionModel {
  readonly categories: readonly FileTypeCategoryOption[];
  readonly selectedFormatIds: ReadonlySet<string>;
  readonly defaultFormatIds: ReadonlySet<string>;
}

export interface RenderFileTypeSelectionOptions {
  readonly className?: string;
  readonly temporaryDescription?: string;
  readonly selectAllLabel: string;
  readonly clearLabel: string;
  readonly restoreDefaultLabel: string;
  readonly selectedCountLabel: (selected: number, total: number) => string;
  readonly onChange: (selectedFormatIds: ReadonlySet<string>) => void;
}

export function getCategorySelectionState(
  category: FileTypeCategoryOption,
  selectedFormatIds: ReadonlySet<string>,
): SelectionState {
  const selectedCount = category.formats
    .filter(({ id }) => selectedFormatIds.has(id)).length;
  if (selectedCount === 0) return "unchecked";
  return selectedCount === category.formats.length ? "checked" : "mixed";
}

export function toggleCategorySelection(
  model: FileTypeSelectionModel,
  categoryId: string,
): ReadonlySet<string> {
  const category = model.categories.find(({ id }) => id === categoryId);
  if (category === undefined) return new Set(model.selectedFormatIds);
  const next = new Set(model.selectedFormatIds);
  const shouldSelect = getCategorySelectionState(category, next) !== "checked";
  for (const { id } of category.formats) {
    if (shouldSelect) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function toggleFormatSelection(
  selectedFormatIds: ReadonlySet<string>,
  formatId: string,
): ReadonlySet<string> {
  const next = new Set(selectedFormatIds);
  if (next.has(formatId)) next.delete(formatId);
  else next.add(formatId);
  return next;
}

export function getAllFormatIds(
  categories: readonly FileTypeCategoryOption[],
): ReadonlySet<string> {
  return new Set(categories.flatMap(({ formats }) => formats.map(({ id }) => id)));
}

export function renderFileTypeSelection(
  container: HTMLElement,
  model: FileTypeSelectionModel,
  options: RenderFileTypeSelectionOptions,
): () => void {
  const root = container.ownerDocument.createElement("div");
  root.className = options.className ?? "link-integrity-file-types";
  container.append(root);

  if (options.temporaryDescription !== undefined) {
    root.append(createText(root.ownerDocument, "p", options.temporaryDescription,
      "link-integrity-file-types-description"));
  }

  const allIds = getAllFormatIds(model.categories);
  const summary = createText(
    root.ownerDocument,
    "div",
    options.selectedCountLabel(model.selectedFormatIds.size, allIds.size),
    "link-integrity-file-types-summary",
  );
  root.append(summary);

  const actions = root.ownerDocument.createElement("div");
  actions.className = "link-integrity-file-types-actions";
  actions.append(
    actionButton(root.ownerDocument, options.selectAllLabel, () => options.onChange(allIds)),
    actionButton(root.ownerDocument, options.clearLabel, () => options.onChange(new Set())),
    actionButton(
      root.ownerDocument,
      options.restoreDefaultLabel,
      () => options.onChange(new Set(model.defaultFormatIds)),
    ),
  );
  root.append(actions);

  for (const category of model.categories) {
    const section = root.ownerDocument.createElement("details");
    section.className = "link-integrity-file-type-category";
    const header = root.ownerDocument.createElement("summary");
    const parentCheckbox = root.ownerDocument.createElement("input");
    parentCheckbox.type = "checkbox";
    const state = getCategorySelectionState(category, model.selectedFormatIds);
    parentCheckbox.checked = state === "checked";
    parentCheckbox.indeterminate = state === "mixed";
    parentCheckbox.setAttribute("aria-label", category.label);
    parentCheckbox.addEventListener("click", (event) => event.stopPropagation());
    parentCheckbox.addEventListener("change", () => {
      options.onChange(toggleCategorySelection(model, category.id));
    });
    header.append(parentCheckbox, root.ownerDocument.createTextNode(category.label));
    section.append(header);

    const formats = root.ownerDocument.createElement("div");
    formats.className = "link-integrity-file-format-list";
    for (const format of category.formats) {
      const label = root.ownerDocument.createElement("label");
      label.className = "link-integrity-file-format";
      const checkbox = root.ownerDocument.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = model.selectedFormatIds.has(format.id);
      checkbox.addEventListener("change", () => {
        options.onChange(toggleFormatSelection(model.selectedFormatIds, format.id));
      });
      const extensions = format.extensions.map((item) => `.${item}`).join(", ");
      label.append(
        checkbox,
        createText(root.ownerDocument, "span", format.label),
        createText(root.ownerDocument, "span", extensions, "link-integrity-file-format-extensions"),
      );
      formats.append(label);
    }
    section.append(formats);
    root.append(section);
  }

  return () => root.remove();
}

function actionButton(
  document: Document,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createText(
  document: Document,
  tag: "div" | "p" | "span",
  text: string,
  className?: string,
): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className !== undefined) element.className = className;
  return element;
}
