import { Setting } from "obsidian";

import {
  applySettingValue,
  getSettingValue,
  type SettingsControlKey,
} from "../../shared/settings";
import { getSettingsPageDefinitions, type SettingsItemDefinition } from "./definitions";
import { renderCustomSetting } from "./custom-sections";
import { moveHorizontalTabIndex, revealHorizontalTab } from "../tab-navigation";
import type { SettingsTabId, SettingsUiContext } from "./types";

export interface ImperativeSettingsRenderOptions {
  readonly activeTab: SettingsTabId;
  readonly focusActiveTab?: boolean;
  readonly onSelectTab: (tabId: SettingsTabId, focus: boolean) => void;
}

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
    button.id = settingsTabId(page.id);
    button.dataset.tabId = page.id;
    button.textContent = page.label;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("aria-controls", settingsPanelId(page.id));
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

  const panel = container.ownerDocument.createElement("div");
  panel.className = "link-integrity-settings-panel";
  panel.id = settingsPanelId(activePage.id);
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", settingsTabId(activePage.id));
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
    if (section.heading !== undefined) {
      const heading = panel.ownerDocument.createElement("h3");
      heading.textContent = section.heading;
      sectionElement.append(heading);
    }
    for (const item of section.items) {
      const cleanup = renderItem(sectionElement, item, context);
      if (cleanup !== undefined) cleanups.push(cleanup);
    }
    panel.append(sectionElement);
  }

  const activeButton = buttons[activeIndex];
  const ownerWindow = container.ownerDocument.defaultView;
  const reveal = (): void => {
    if (activeButton === undefined) return;
    revealHorizontalTab(activeButton, options.focusActiveTab === true);
  };
  const frame = ownerWindow?.requestAnimationFrame(reveal);
  if (frame !== undefined) cleanups.push(() => ownerWindow?.cancelAnimationFrame(frame));

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
    dropdown
      .setValue(String(getSettingValue(context.settings, item.key)))
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
    const result = applySettingValue(context.settings, key, value);
    const operation = context.onSettingsChange(result.settings, result.impact);
    if (operation instanceof Promise) void operation.catch((error: unknown) => context.onError?.(error));
  } catch (error) {
    context.onError?.(error);
  }
}

function settingsTabId(id: SettingsTabId): string {
  return `link-integrity-settings-tab-${id}`;
}

function settingsPanelId(id: SettingsTabId): string {
  return `link-integrity-settings-panel-${id}`;
}
