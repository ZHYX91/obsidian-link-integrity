import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";

import {
  createDefaultSettings,
  getSettingValue,
  type SettingsControlKey,
} from "../../shared/settings";
import { LOCALE_OPTIONS } from "../../shared/i18n";
import { renderCustomSetting } from "./custom-sections";
import type {
  SettingsCustomSectionId,
  SettingsTabId,
  SettingsUiContext,
} from "./types";

export interface SettingsOptionDefinition {
  readonly value: string;
  readonly label: string;
}

export type SettingsItemDefinition =
  | {
    readonly kind: "toggle";
    readonly key: SettingsControlKey;
    readonly name: string;
    readonly description?: string;
  }
  | {
    readonly kind: "dropdown";
    readonly key: SettingsControlKey;
    readonly name: string;
    readonly description?: string;
    readonly options: readonly SettingsOptionDefinition[];
  }
  | {
    readonly kind: "custom";
    readonly id: SettingsCustomSectionId;
    readonly name: string;
    readonly description?: string;
  };

export interface SettingsSectionDefinition {
  readonly heading?: string;
  readonly items: readonly SettingsItemDefinition[];
}

export interface SettingsPageDefinition {
  readonly id: SettingsTabId;
  readonly label: string;
  readonly sections: readonly SettingsSectionDefinition[];
}

export function getSettingsPageDefinitions(
  context: SettingsUiContext,
): readonly SettingsPageDefinition[] {
  const { t } = context.translator;
  const languageOptions: SettingsOptionDefinition[] = [
    { value: "auto", label: t("settings.general.language.auto") },
    ...LOCALE_OPTIONS.map(({ value, autonym }) => ({ value, label: autonym })),
  ];
  const viewOptions = [
    { value: "group", label: t("sidebar.broken.view.group") },
    { value: "list", label: t("sidebar.broken.view.list") },
  ];
  return [
    {
      id: "general",
      label: t("settings.tab.general"),
      sections: [{
        items: [
          dropdown(
            "general.locale",
            t("settings.general.language"),
            t("settings.general.language.description"),
            languageOptions,
          ),
          toggle(
            "general.scanOnStartup",
            t("settings.general.scanOnStartup"),
            t("settings.general.scanOnStartup.description"),
          ),
          dropdown("general.defaultSidebarTab", t("settings.general.defaultTab"), undefined, [
            { value: "broken-links", label: t("sidebar.tab.broken") },
            { value: "isolated-files", label: t("sidebar.tab.isolated") },
          ]),
          custom(
            "index-maintenance",
            t("settings.general.indexMaintenance"),
            t("settings.general.indexMaintenance.description"),
          ),
          custom("persistence-status", t("status.save.saved")),
        ],
      }],
    },
    {
      id: "broken-links",
      label: t("settings.tab.broken"),
      sections: [
        {
          heading: t("settings.broken.diagnostics"),
          items: [
            toggle("brokenLinks.diagnostics.missingFiles", t("settings.broken.missingFiles")),
            toggle("brokenLinks.diagnostics.missingHeadings", t("settings.broken.missingHeadings")),
            toggle("brokenLinks.diagnostics.missingBlocks", t("settings.broken.missingBlocks")),
            toggle("brokenLinks.diagnostics.invalidLinks", t("settings.broken.invalidLinks")),
          ],
        },
        {
          heading: t("settings.broken.defaultView"),
          items: [
            dropdown("brokenLinks.defaultView", t("settings.broken.defaultView"), undefined,
              viewOptions),
            dropdown("brokenLinks.defaultGrouping", t("settings.broken.defaultGrouping"), undefined, [
              { value: "target", label: t("sidebar.broken.group.target") },
              { value: "source", label: t("sidebar.broken.group.source") },
              { value: "source-folder", label: t("sidebar.broken.group.sourceFolder") },
            ]),
            dropdown("brokenLinks.defaultSort", t("settings.broken.defaultSort"), undefined, [
              { value: "path", label: t("settings.sort.path") },
              { value: "count", label: t("settings.sort.count") },
            ]),
            toggle("brokenLinks.showIgnored", t("settings.ignore.showIgnored")),
          ],
        },
        {
          items: [custom("broken-ignore-rules", t("settings.ignore.title"))],
        },
      ],
    },
    {
      id: "isolated-files",
      label: t("settings.tab.isolated"),
      sections: [
        {
          items: [custom(
            "isolated-candidate-types",
            t("settings.isolated.candidates"),
            t("settings.isolated.candidates.description"),
          )],
        },
        {
          heading: t("settings.isolated.defaultView"),
          items: [
            dropdown("isolatedFiles.defaultView", t("settings.isolated.defaultView"), undefined, [
              { value: "list", label: t("sidebar.isolated.view.list") },
              { value: "tree", label: t("sidebar.isolated.view.tree") },
            ]),
            dropdown("isolatedFiles.defaultSort", t("settings.isolated.defaultSort"), undefined, [
              { value: "path", label: t("settings.sort.path") },
              { value: "name", label: t("settings.sort.name") },
              { value: "modified", label: t("settings.sort.modified") },
              { value: "broken-count", label: t("settings.sort.count") },
            ]),
            toggle(
              "isolatedFiles.allowNoIncomingFilter",
              t("settings.isolated.advancedMode"),
              t("settings.isolated.advancedMode.description"),
            ),
            toggle(
              "isolatedFiles.showExpectedIsolatedFiles",
              t("settings.isolated.showExpected"),
              t("sidebar.isolated.showExpected.description"),
            ),
            toggle("isolatedFiles.showIgnored", t("settings.ignore.showIgnored")),
          ],
        },
        {
          heading: t("settings.expected.title"),
          items: [
            custom(
              "expected-isolation-rules",
              t("settings.expected.title"),
              t("settings.expected.description"),
            ),
            custom(
              "periodic-notes-preset",
              t("settings.expected.periodicPreset"),
              t("settings.expected.periodicPreset.description"),
            ),
          ],
        },
        {
          items: [custom("isolated-ignore-rules", t("settings.ignore.title"))],
        },
      ],
    },
  ];
}

export function getDeclarativeSettingDefinitions(
  context: SettingsUiContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  return getSettingsPageDefinitions(context).map((page) => ({
    type: "page",
    name: page.label,
    items: page.sections.flatMap((section) => toDeclarativeSection(section, context)),
  }));
}

function toDeclarativeSection(
  section: SettingsSectionDefinition,
  context: SettingsUiContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  const items = section.items.map((item) => toDeclarativeItem(item, context));
  return section.heading === undefined
    ? items
    : [{ type: "group", heading: section.heading, items }];
}

function toDeclarativeItem(
  item: SettingsItemDefinition,
  context: SettingsUiContext,
): SettingGroupItem<SettingsControlKey> {
  if (item.kind === "custom") {
    return {
      name: item.name,
      ...(item.description === undefined ? {} : { desc: item.description }),
      searchable: false,
      render: (setting) => renderCustomSetting(setting.settingEl, item.id, context),
    };
  }
  const base = {
    name: item.name,
    ...(item.description === undefined ? {} : { desc: item.description }),
  };
  if (item.kind === "toggle") {
    return {
      ...base,
      control: {
        type: "toggle",
        key: item.key,
        defaultValue: Boolean(getSettingValue(createDefaultSettings(), item.key)),
        disabled: () => context.writeProtected,
      },
    };
  }
  return {
    ...base,
    control: {
      type: "dropdown",
      key: item.key,
      defaultValue: String(getSettingValue(createDefaultSettings(), item.key)),
      options: Object.fromEntries(item.options.map(({ value, label }) => [value, label])),
      disabled: () => context.writeProtected,
    },
  };
}

function toggle(
  key: SettingsControlKey,
  name: string,
  description?: string,
): SettingsItemDefinition {
  return { kind: "toggle", key, name, ...(description === undefined ? {} : { description }) };
}

function dropdown(
  key: SettingsControlKey,
  name: string,
  description: string | undefined,
  options: readonly SettingsOptionDefinition[],
): SettingsItemDefinition {
  return {
    kind: "dropdown",
    key,
    name,
    options,
    ...(description === undefined ? {} : { description }),
  };
}

function custom(
  id: SettingsCustomSectionId,
  name: string,
  description?: string,
): SettingsItemDefinition {
  return { kind: "custom", id, name, ...(description === undefined ? {} : { description }) };
}
