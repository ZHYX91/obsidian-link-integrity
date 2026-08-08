import type { SettingsUiContext } from "./types";

export function labeledInput(
  container: HTMLElement,
  labelText: string,
  value: string,
): { readonly label: HTMLLabelElement; readonly input: HTMLInputElement } {
  const label = container.ownerDocument.createElement("label");
  label.className = "link-integrity-rule-field";
  const text = container.ownerDocument.createElement("span");
  text.textContent = labelText;
  const input = container.ownerDocument.createElement("input");
  input.type = "text";
  input.value = value;
  label.append(text, input);
  container.append(label);
  return { label, input };
}

export function labeledTextarea(
  container: HTMLElement,
  labelText: string,
  description: string,
  value: string,
): { readonly label: HTMLLabelElement; readonly textarea: HTMLTextAreaElement } {
  const label = container.ownerDocument.createElement("label");
  label.className = "link-integrity-rule-field";
  const text = container.ownerDocument.createElement("span");
  text.textContent = labelText;
  const help = container.ownerDocument.createElement("small");
  help.textContent = description;
  const textarea = container.ownerDocument.createElement("textarea");
  textarea.value = value;
  textarea.rows = 3;
  label.append(text, help, textarea);
  container.append(label);
  return { label, textarea };
}

export function checkboxLabel(
  container: HTMLElement,
  labelText: string,
  checked: boolean,
): { readonly label: HTMLLabelElement; readonly checkbox: HTMLInputElement } {
  const label = container.ownerDocument.createElement("label");
  label.className = "link-integrity-advanced-toggle";
  const checkbox = container.ownerDocument.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  label.append(checkbox, container.ownerDocument.createTextNode(labelText));
  container.append(label);
  return { label, checkbox };
}

export function summaryCheckboxTarget(
  document: Document,
  checkbox: HTMLInputElement,
  labelText: string,
): HTMLLabelElement {
  const target = document.createElement("label");
  target.className = "link-integrity-checkbox-target";
  target.setAttribute("aria-label", labelText);
  target.addEventListener("click", (event) => event.stopPropagation());
  target.append(checkbox);
  return target;
}

export function select(
  document: Document,
  options: readonly (readonly [string, string])[],
  selected: string,
): HTMLSelectElement {
  const element = document.createElement("select");
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    element.append(option);
  }
  return element;
}

export function button(
  container: HTMLElement,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const element = container.ownerDocument.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  container.append(element);
  return element;
}

export function textElement(
  container: HTMLElement,
  tag: "h4" | "p" | "span" | "small",
  text: string,
): HTMLElement {
  const element = container.ownerDocument.createElement(tag);
  element.textContent = text;
  return element;
}

export function disableControls(container: HTMLElement, disabled: boolean): void {
  if (!disabled) return;
  for (const control of container.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
  >("input, select, textarea, button")) control.disabled = true;
}

export function runAction(
  action: () => void | Promise<void> | undefined,
  context: SettingsUiContext,
): void {
  try {
    const result = action();
    if (result instanceof Promise) void result.catch((error: unknown) => context.onError?.(error));
  } catch (error) {
    context.onError?.(error);
  }
}
