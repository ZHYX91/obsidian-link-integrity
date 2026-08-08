import type { BrokenGrouping } from "./types";
import type { SidebarRenderOptions } from "./render";

export function createSelect(
  document: Document,
  options: readonly (readonly [string, string])[],
  selected: string,
  onChange: (value: string) => void,
  ariaLabel?: string,
): HTMLSelectElement {
  const select = document.createElement("select");
  if (ariaLabel !== undefined) select.setAttribute("aria-label", ariaLabel);
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    select.append(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

export function toggleGroup(
  document: Document,
  ...buttons: readonly HTMLElement[]
): HTMLElement {
  const group = document.createElement("div");
  group.className = "link-integrity-toolbar-view-toggle";
  group.append(...buttons);
  return group;
}

export function groupingControl(options: SidebarRenderOptions): HTMLElement {
  const document = documentFor(options);
  const { t } = options.translator;
  const labels: Readonly<Record<BrokenGrouping, string>> = {
    target: t("sidebar.broken.group.compactTarget"),
    source: t("sidebar.broken.group.compactSource"),
    "source-folder": t("sidebar.broken.group.compactFolder"),
  };
  const fullLabels: Readonly<Record<BrokenGrouping, string>> = {
    target: t("sidebar.broken.group.target"),
    source: t("sidebar.broken.group.source"),
    "source-folder": t("sidebar.broken.group.sourceFolder"),
  };
  const wrapper = document.createElement("div");
  wrapper.className = `link-integrity-grouping-control${
    options.state.brokenView === "group" ? " is-active" : ""}`;
  const main = createActionButton(
    document,
    t("sidebar.broken.view.groupCompact", { grouping: labels[options.state.brokenGrouping] }),
    () => options.onStateChange({
      ...options.state,
      brokenView: "group",
      brokenResultOffset: 0,
    }),
  );
  main.className = options.state.brokenView === "group" ? "is-active" : "";
  main.setAttribute("aria-pressed", String(options.state.brokenView === "group"));
  main.setAttribute("aria-label", t("sidebar.broken.group.current", {
    grouping: fullLabels[options.state.brokenGrouping],
  }));
  const choice = document.createElement("label");
  choice.className = "link-integrity-grouping-choice";
  choice.append(createText(document, "span", "▾"));
  const select = document.createElement("select");
  select.setAttribute("aria-label", t("sidebar.broken.group.choose"));
  for (const grouping of ["target", "source", "source-folder"] as const) {
    const item = document.createElement("option");
    item.value = grouping;
    item.textContent = fullLabels[grouping];
    select.append(item);
  }
  select.value = options.state.brokenView === "group" ? options.state.brokenGrouping : "";
  select.addEventListener("change", () => {
    if (select.value === "target" || select.value === "source" ||
      select.value === "source-folder") {
      options.onStateChange({
        ...options.state,
        brokenView: "group",
        brokenGrouping: select.value,
        brokenResultOffset: 0,
      });
    }
  });
  choice.append(select);
  wrapper.append(main, choice);
  return wrapper;
}

type CompactSelectOption = readonly [value: string, compactLabel: string, fullLabel: string];

export function compactSelect(
  document: Document,
  prefix: string,
  options: readonly CompactSelectOption[],
  selected: string,
  onChange: (value: string) => void,
  ariaLabel: string,
): HTMLLabelElement {
  const selectedLabel = options.find(([value]) => value === selected)?.[1] ?? selected;
  const label = document.createElement("label");
  label.className = "link-integrity-toolbar-compact-select";
  label.append(
    createText(document, "span", `${prefix} · ${selectedLabel}`),
    createText(document, "span", "▾", "link-integrity-select-chevron"),
  );
  const select = document.createElement("select");
  select.setAttribute("aria-label", ariaLabel);
  for (const [value, , fullLabel] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = fullLabel;
    option.selected = value === selected;
    select.append(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  label.append(select);
  return label;
}

export function brokenSortOptions(options: SidebarRenderOptions): readonly CompactSelectOption[] {
  const { t } = options.translator;
  const pathLabel = options.state.brokenGrouping === "target"
    ? t("sidebar.sort.targetName")
    : options.state.brokenGrouping === "source"
      ? t("sidebar.sort.sourcePath")
      : t("sidebar.sort.folderPath");
  const countLabel = options.state.brokenGrouping === "source-folder"
    ? t("sidebar.sort.folderProblemCount")
    : t("sidebar.sort.problemCount");
  return [
    ["path", options.state.brokenGrouping === "target"
      ? t("settings.sort.name")
      : t("settings.sort.path"), pathLabel],
    ["count", t("sidebar.sort.compactProblemCount"), countLabel],
  ];
}

export function toggleButton(
  document: Document,
  label: string,
  pressed: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const button = createActionButton(document, label, onClick);
  button.className = pressed ? "is-active" : "";
  button.setAttribute("aria-pressed", String(pressed));
  return button;
}

export function moreButton(
  document: Document,
  label: string,
  onClick: (button: HTMLButtonElement) => void,
): HTMLButtonElement {
  const button = createActionButton(document, "…", () => onClick(button));
  button.className = "link-integrity-more-button";
  button.setAttribute("aria-label", label);
  return button;
}

export function createActionButton(
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

export function createText(
  document: Document,
  tag: "div" | "h2" | "h3" | "p" | "span" | "summary",
  text: string,
  className?: string,
): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className !== undefined) element.className = className;
  return element;
}

export function runAction(
  action: () => void | Promise<void>,
  onError?: (error: unknown) => void,
): void {
  try {
    const result = action();
    if (result instanceof Promise) void result.catch((error: unknown) => onError?.(error));
  } catch (error) {
    onError?.(error);
  }
}

export function documentFor(options: SidebarRenderOptions): Document {
  return options.document ?? window.document;
}
