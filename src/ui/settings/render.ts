import { Setting } from "obsidian";

import {
  applySettingValue,
  getSettingValue,
  type SettingsControlKey,
} from "../../shared/settings";
import { getSettingsPageDefinitions, type SettingsItemDefinition } from "./definitions";
import { renderCustomSetting } from "./custom-sections";
import { addSettingsTabArrows } from "../settings-tab-arrows";
import { moveHorizontalTabIndex, revealHorizontalTab } from "../tab-navigation";
import type { SettingsTabId, SettingsUiContext } from "./types";

export interface ImperativeSettingsRenderOptions {
  readonly activeTab: SettingsTabId;
  readonly focusActiveTab?: boolean;
  readonly onSelectTab: (tabId: SettingsTabId, focus: boolean) => void;
}

let nextLayoutId = 0;

export function renderImperativeSettings(
  container: HTMLElement,
  context: SettingsUiContext,
  options: ImperativeSettingsRenderOptions,
): () => void {
  container.replaceChildren();
  container.classList.add("link-integrity-settings");
  container.dir = context.translator.direction;
  const cleanups: Array<() => void> = [];
  const pages = getSettingsPageDefinitions(context);
  const activeIndex = Math.max(0, pages.findIndex(({ id }) => id === options.activeTab));
  const activePage = pages[activeIndex] ?? pages[0];
  if (activePage === undefined) throw new Error("Link Integrity settings require a page.");

  const layoutId = `link-integrity-settings-${++nextLayoutId}`;
  const panelId = `${layoutId}-panel`;
  const tabList = container.ownerDocument.createElement("div");
  tabList.className = "link-integrity-settings-tabs";
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", context.translator.t("settings.tabs.label"));
  tabList.setAttribute("aria-orientation", "horizontal");
  const buttons = pages.map((page, index) => {
    const active = page.id === activePage.id;
    const button = container.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `link-integrity-settings-tab${active ? " is-active" : ""}`;
    button.id = `${layoutId}-tab-${page.id}`;
    button.dataset.tabId = page.id;
    button.textContent = page.label;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("aria-controls", panelId);
    button.tabIndex = active ? 0 : -1;
    button.addEventListener("click", () => {
      if (page.id === activePage.id) revealHorizontalTab(button, true);
      else options.onSelectTab(page.id, true);
    });
    button.addEventListener("keydown", (event) => {
      const next = moveHorizontalTabIndex(
        index,
        event.key,
        pages.length,
        context.translator.direction,
      );
      if (next === null || next === index) return;
      const target = pages[next];
      if (target === undefined) return;
      event.preventDefault();
      options.onSelectTab(target.id, true);
    });
    tabList.append(button);
    return button;
  });
  container.append(tabList);
  cleanups.push(addSettingsTabArrows(
    tabList, context.translator.direction,
    context.translator.t("settings.tabs.earlier"), context.translator.t("settings.tabs.more"),
  ));

  const panel = container.ownerDocument.createElement("div");
  panel.className = "link-integrity-settings-panel";
  panel.id = panelId;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", buttons[activeIndex]!.id);
  panel.tabIndex = 0;
  container.append(panel);

  if (context.writeProtected) {
    const warning = panel.ownerDocument.createElement("div");
    warning.className = "link-integrity-warning";
    warning.setAttribute("role", "alert");
    const title = panel.ownerDocument.createElement("strong");
    title.textContent = context.translator.t("settings.futureSchema.title");
    const description = panel.ownerDocument.createElement("p");
    description.textContent = context.translator.t("settings.futureSchema.description");
    warning.append(title, description);
    panel.append(warning);
  }

  for (const section of activePage.sections) {
    const sectionElement = panel.ownerDocument.createElement("section");
    sectionElement.className = "link-integrity-settings-section";
    panel.append(sectionElement);
    if (section.heading !== undefined) {
      const heading = panel.ownerDocument.createElement("h3");
      heading.textContent = section.heading;
      sectionElement.append(heading);
    }
    for (const item of section.items) {
      const cleanup = renderItem(sectionElement, item, context);
      if (cleanup !== undefined) cleanups.push(cleanup);
    }
  }

  if (options.focusActiveTab) buttons[activeIndex]?.focus({ preventScroll: true });

  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
    container.classList.remove("link-integrity-settings");
    container.removeAttribute("dir");
    container.replaceChildren();
  };
}

function renderItem(
  container: HTMLElement,
  item: SettingsItemDefinition,
  context: SettingsUiContext,
): (() => void) | undefined {
  const setting = new Setting(container).setName(item.name);
  if (item.description !== undefined) setting.setDesc(item.description);
  setting.setDisabled(context.writeProtected);
  if (item.kind === "custom") {
    return renderCustomSetting(setting.settingEl, item.id, context);
  }
  if (item.kind === "toggle") {
    setting.addToggle((toggle) => toggle
      .setValue(Boolean(getSettingValue(context.settings, item.key)))
      .setDisabled(context.writeProtected)
      .onChange((value) => commitControl(context, item.key, value)));
    return undefined;
  }
  setting.addDropdown((dropdown) => {
    for (const option of item.options) dropdown.addOption(option.value, option.label);
    const value = String(getSettingValue(context.settings, item.key));
    // Obsidian measures the selected label in setValue. A hidden or detached
    // panel has no layout yet, so keep the native select's intrinsic width.
    if (dropdown.selectEl.getClientRects().length) dropdown.setValue(value);
    else dropdown.selectEl.value = value;
    dropdown
      .setDisabled(context.writeProtected)
      .onChange((value) => commitControl(context, item.key, value));
  });
  return undefined;
}

function commitControl(
  context: SettingsUiContext,
  key: SettingsControlKey,
  value: unknown,
): void {
  try {
    const result = applySettingValue(context.getSettings?.() ?? context.settings, key, value);
    const operation = context.onSettingsChange(result.settings, result.impact);
    if (operation instanceof Promise) void operation.catch((error: unknown) => context.onError?.(error));
  } catch (error) {
    context.onError?.(error);
  }
}
