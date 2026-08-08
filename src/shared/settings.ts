import {
  DEFAULT_ISOLATED_CANDIDATE_FAMILIES,
  FORMAT_FAMILY_IDS,
  type FormatFamilyId,
} from "../core/file-types";
import {
  createDefaultPeriodicNotesPreset,
  normalizeExpectedIsolationRules,
  normalizePeriodicNotesPreset,
  type ExpectedIsolationRule,
  type PeriodicNotesPreset,
} from "../core/expected-isolation-rules";
import { normalizeIgnoreRules, type IgnoreRule } from "./ignore-rules";
import { isPluginLocale, type PluginLocale } from "./i18n";

export const SETTINGS_SCHEMA_VERSION = 1;

export type SidebarTabId = "broken-links" | "isolated-files";
export type BrokenViewMode = "group" | "list";
export type BrokenGrouping = "target" | "source";
export type BrokenSort = "path" | "count";
export type IsolatedViewMode = "list" | "tree";
export type IsolatedSort = "path" | "name" | "modified" | "broken-count";

export interface GeneralSettings {
  readonly locale: PluginLocale;
  readonly scanOnStartup: boolean;
  readonly defaultSidebarTab: SidebarTabId;
}

export interface BrokenLinkSettings {
  readonly diagnostics: {
    readonly missingFiles: boolean;
    readonly missingHeadings: boolean;
    readonly missingBlocks: boolean;
    readonly invalidLinks: boolean;
  };
  readonly defaultView: BrokenViewMode;
  readonly defaultGrouping: BrokenGrouping;
  readonly defaultSort: BrokenSort;
  readonly showIgnored: boolean;
}

export interface IsolatedFileSettings {
  readonly candidateFormatFamilyIds: readonly FormatFamilyId[];
  readonly customExtensions: readonly string[];
  readonly defaultView: IsolatedViewMode;
  readonly defaultSort: IsolatedSort;
  readonly allowNoIncomingFilter: boolean;
  readonly showExpectedIsolatedFiles: boolean;
  readonly showIgnored: boolean;
  readonly expectedRules: readonly ExpectedIsolationRule[];
  readonly periodicNotesPreset: PeriodicNotesPreset;
}

export interface UiPreferences {
  /** A null value means that the corresponding product default still owns the choice. */
  readonly activeSidebarTab: SidebarTabId | null;
  readonly brokenView: BrokenViewMode | null;
  readonly brokenGrouping: BrokenGrouping | null;
  readonly brokenSort: BrokenSort | null;
  readonly isolatedView: IsolatedViewMode | null;
  readonly isolatedSort: IsolatedSort | null;
}

export interface LinkIntegritySettings {
  readonly schemaVersion: number;
  readonly general: GeneralSettings;
  readonly brokenLinks: BrokenLinkSettings;
  readonly isolatedFiles: IsolatedFileSettings;
  readonly ignoreRules: readonly IgnoreRule[];
  readonly ui: UiPreferences;
}

export type SettingsCompatibility = "current" | "migrated" | "future";

export interface SettingsLoadResult {
  readonly settings: LinkIntegritySettings;
  readonly compatibility: SettingsCompatibility;
  readonly sourceSchemaVersion: number;
  readonly writeProtected: boolean;
  readonly shouldPersistMigration: boolean;
}

export type SettingsChangeImpact =
  | "query-only"
  | "revalidate"
  | "partial-reindex"
  | "full-rebuild";

export type SettingsControlKey =
  | "general.locale"
  | "general.scanOnStartup"
  | "general.defaultSidebarTab"
  | "brokenLinks.diagnostics.missingFiles"
  | "brokenLinks.diagnostics.missingHeadings"
  | "brokenLinks.diagnostics.missingBlocks"
  | "brokenLinks.diagnostics.invalidLinks"
  | "brokenLinks.defaultView"
  | "brokenLinks.defaultGrouping"
  | "brokenLinks.defaultSort"
  | "brokenLinks.showIgnored"
  | "isolatedFiles.defaultView"
  | "isolatedFiles.defaultSort"
  | "isolatedFiles.allowNoIncomingFilter"
  | "isolatedFiles.showExpectedIsolatedFiles"
  | "isolatedFiles.showIgnored";

export function createDefaultSettings(): LinkIntegritySettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    general: {
      locale: "auto",
      scanOnStartup: false,
      defaultSidebarTab: "broken-links",
    },
    brokenLinks: {
      diagnostics: {
        missingFiles: true,
        missingHeadings: true,
        missingBlocks: true,
        invalidLinks: true,
      },
      defaultView: "group",
      defaultGrouping: "target",
      defaultSort: "path",
      showIgnored: false,
    },
    isolatedFiles: {
      candidateFormatFamilyIds: [...DEFAULT_ISOLATED_CANDIDATE_FAMILIES],
      customExtensions: [],
      defaultView: "list",
      defaultSort: "path",
      allowNoIncomingFilter: false,
      showExpectedIsolatedFiles: false,
      showIgnored: false,
      expectedRules: [],
      periodicNotesPreset: createDefaultPeriodicNotesPreset(),
    },
    ignoreRules: [],
    ui: {
      activeSidebarTab: null,
      brokenView: null,
      brokenGrouping: null,
      brokenSort: null,
      isolatedView: null,
      isolatedSort: null,
    },
  };
}

export function loadSettings(value: unknown): SettingsLoadResult {
  const raw = isRecord(value) ? value : {};
  const sourceSchemaVersion = readSchemaVersion(raw.schemaVersion);
  const future = sourceSchemaVersion > SETTINGS_SCHEMA_VERSION;
  const migratedRaw = future ? raw : migrateRawSettings(raw, sourceSchemaVersion);
  return {
    settings: normalizeSettings(migratedRaw),
    compatibility: future
      ? "future"
      : sourceSchemaVersion < SETTINGS_SCHEMA_VERSION
        ? "migrated"
        : "current",
    sourceSchemaVersion,
    writeProtected: future,
    shouldPersistMigration: !future &&
      isRecord(value) &&
      Object.keys(value).length > 0 &&
      sourceSchemaVersion < SETTINGS_SCHEMA_VERSION,
  };
}

export function normalizeSettings(value: unknown): LinkIntegritySettings {
  const defaults = createDefaultSettings();
  if (!isRecord(value)) return defaults;
  const general = isRecord(value.general) ? value.general : {};
  const broken = isRecord(value.brokenLinks) ? value.brokenLinks : {};
  const diagnostics = isRecord(broken.diagnostics) ? broken.diagnostics : {};
  const isolated = isRecord(value.isolatedFiles) ? value.isolatedFiles : {};
  const ui = isRecord(value.ui) ? value.ui : {};

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    general: {
      locale: isPluginLocale(general.locale) ? general.locale : defaults.general.locale,
      scanOnStartup: booleanOr(general.scanOnStartup, defaults.general.scanOnStartup),
      defaultSidebarTab: isSidebarTabId(general.defaultSidebarTab)
        ? general.defaultSidebarTab
        : defaults.general.defaultSidebarTab,
    },
    brokenLinks: {
      diagnostics: {
        missingFiles: booleanOr(
          diagnostics.missingFiles,
          defaults.brokenLinks.diagnostics.missingFiles,
        ),
        missingHeadings: booleanOr(
          diagnostics.missingHeadings,
          defaults.brokenLinks.diagnostics.missingHeadings,
        ),
        missingBlocks: booleanOr(
          diagnostics.missingBlocks,
          defaults.brokenLinks.diagnostics.missingBlocks,
        ),
        invalidLinks: booleanOr(
          diagnostics.invalidLinks,
          defaults.brokenLinks.diagnostics.invalidLinks,
        ),
      },
      defaultView: isBrokenViewMode(broken.defaultView)
        ? broken.defaultView
        : defaults.brokenLinks.defaultView,
      defaultGrouping: isBrokenGrouping(broken.defaultGrouping)
        ? broken.defaultGrouping
        : defaults.brokenLinks.defaultGrouping,
      defaultSort: isBrokenSort(broken.defaultSort)
        ? broken.defaultSort
        : defaults.brokenLinks.defaultSort,
      showIgnored: booleanOr(broken.showIgnored, defaults.brokenLinks.showIgnored),
    },
    isolatedFiles: {
      candidateFormatFamilyIds: normalizeFormatFamilies(
        isolated.candidateFormatFamilyIds,
        defaults.isolatedFiles.candidateFormatFamilyIds,
      ),
      customExtensions: normalizeCustomExtensions(isolated.customExtensions),
      defaultView: isIsolatedViewMode(isolated.defaultView)
        ? isolated.defaultView
        : defaults.isolatedFiles.defaultView,
      defaultSort: isIsolatedSort(isolated.defaultSort)
        ? isolated.defaultSort
        : defaults.isolatedFiles.defaultSort,
      allowNoIncomingFilter: booleanOr(
        isolated.allowNoIncomingFilter,
        defaults.isolatedFiles.allowNoIncomingFilter,
      ),
      showExpectedIsolatedFiles: booleanOr(
        isolated.showExpectedIsolatedFiles,
        defaults.isolatedFiles.showExpectedIsolatedFiles,
      ),
      showIgnored: booleanOr(isolated.showIgnored, defaults.isolatedFiles.showIgnored),
      expectedRules: normalizeExpectedIsolationRules(isolated.expectedRules),
      periodicNotesPreset: normalizePeriodicNotesPreset(isolated.periodicNotesPreset),
    },
    ignoreRules: normalizeIgnoreRules(value.ignoreRules),
    ui: {
      activeSidebarTab: isSidebarTabId(ui.activeSidebarTab)
        ? ui.activeSidebarTab
        : null,
      brokenView: isBrokenViewMode(ui.brokenView)
        ? ui.brokenView
        : null,
      brokenGrouping: isBrokenGrouping(ui.brokenGrouping)
        ? ui.brokenGrouping
        : null,
      brokenSort: isBrokenSort(ui.brokenSort) ? ui.brokenSort : null,
      isolatedView: isIsolatedViewMode(ui.isolatedView)
        ? ui.isolatedView
        : null,
      isolatedSort: isIsolatedSort(ui.isolatedSort)
        ? ui.isolatedSort
        : null,
    },
  };
}

export function cloneSettings(settings: LinkIntegritySettings): LinkIntegritySettings {
  return normalizeSettings(settings);
}

export function getSettingValue(
  settings: LinkIntegritySettings,
  key: SettingsControlKey,
): unknown {
  const segments = key.split(".");
  let value: unknown = settings;
  for (const segment of segments) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }
  return value;
}

export function applySettingValue(
  settings: LinkIntegritySettings,
  key: SettingsControlKey,
  value: unknown,
): { readonly settings: LinkIntegritySettings; readonly impact: SettingsChangeImpact } {
  const mutable = cloneToMutable(settings);
  setControlValue(mutable, key, value);
  return { settings: normalizeSettings(mutable), impact: classifySettingChange(key) };
}

export function classifySettingChange(
  keyOrRule: SettingsControlKey | Pick<IgnoreRule, "scope">,
): SettingsChangeImpact {
  if (typeof keyOrRule !== "string") {
    return keyOrRule.scope === "exclude-graph-contribution" ? "full-rebuild" : "query-only";
  }
  if (keyOrRule.startsWith("brokenLinks.diagnostics.")) return "revalidate";
  return "query-only";
}

function setControlValue(
  settings: MutableSettings,
  key: SettingsControlKey,
  value: unknown,
): void {
  switch (key) {
    case "general.locale":
      assertValue(isPluginLocale(value), key);
      settings.general.locale = value;
      return;
    case "general.scanOnStartup":
      assertValue(typeof value === "boolean", key);
      settings.general.scanOnStartup = value;
      return;
    case "general.defaultSidebarTab":
      assertValue(isSidebarTabId(value), key);
      settings.general.defaultSidebarTab = value;
      return;
    case "brokenLinks.defaultView":
      assertValue(isBrokenViewMode(value), key);
      settings.brokenLinks.defaultView = value;
      return;
    case "brokenLinks.defaultGrouping":
      assertValue(isBrokenGrouping(value), key);
      settings.brokenLinks.defaultGrouping = value;
      return;
    case "brokenLinks.defaultSort":
      assertValue(isBrokenSort(value), key);
      settings.brokenLinks.defaultSort = value;
      return;
    case "isolatedFiles.defaultView":
      assertValue(isIsolatedViewMode(value), key);
      settings.isolatedFiles.defaultView = value;
      return;
    case "isolatedFiles.defaultSort":
      assertValue(isIsolatedSort(value), key);
      settings.isolatedFiles.defaultSort = value;
      return;
    case "brokenLinks.diagnostics.missingFiles":
    case "brokenLinks.diagnostics.missingHeadings":
    case "brokenLinks.diagnostics.missingBlocks":
    case "brokenLinks.diagnostics.invalidLinks": {
      assertValue(typeof value === "boolean", key);
      const diagnosticKey = key.split(".")[2] as keyof MutableSettings["brokenLinks"]["diagnostics"];
      settings.brokenLinks.diagnostics[diagnosticKey] = value;
      return;
    }
    case "brokenLinks.showIgnored":
      assertValue(typeof value === "boolean", key);
      settings.brokenLinks.showIgnored = value;
      return;
    case "isolatedFiles.allowNoIncomingFilter":
    case "isolatedFiles.showExpectedIsolatedFiles":
    case "isolatedFiles.showIgnored": {
      assertValue(typeof value === "boolean", key);
      const isolatedKey = key.split(".")[1] as
        | "allowNoIncomingFilter"
        | "showExpectedIsolatedFiles"
        | "showIgnored";
      settings.isolatedFiles[isolatedKey] = value;
    }
  }
}

function migrateRawSettings(
  value: Record<string, unknown>,
  sourceSchemaVersion: number,
): Record<string, unknown> {
  if (sourceSchemaVersion >= SETTINGS_SCHEMA_VERSION) return cloneRawRecord(value);
  const migrated = cloneRawRecord(value);
  const legacyIsolated = isRecord(migrated.orphanFiles) ? migrated.orphanFiles : null;
  if (!isRecord(migrated.isolatedFiles) && legacyIsolated !== null) {
    migrated.isolatedFiles = legacyIsolated;
  }
  delete migrated.orphanFiles;
  const general = isRecord(migrated.general) ? migrated.general : {};
  if (general.defaultSidebarTab === "orphan-files") general.defaultSidebarTab = "isolated-files";
  migrated.general = general;
  const ui = isRecord(migrated.ui) ? migrated.ui : {};
  if (ui.activeSidebarTab === "orphan-files") ui.activeSidebarTab = "isolated-files";
  migrated.ui = ui;
  migrated.schemaVersion = SETTINGS_SCHEMA_VERSION;
  return migrated;
}

function normalizeFormatFamilies(
  value: unknown,
  fallback: readonly FormatFamilyId[],
): FormatFamilyId[] {
  if (!Array.isArray(value)) return [...fallback];
  return Array.from(new Set(value.filter(isFormatFamilyId)));
}

function isFormatFamilyId(value: unknown): value is FormatFamilyId {
  return typeof value === "string" &&
    (FORMAT_FAMILY_IDS as readonly string[]).includes(value);
}

function normalizeCustomExtensions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase().replace(/^\.+/, ""))
    .filter((item) => /^[a-z0-9][a-z0-9+_-]{0,31}$/.test(item))))
    .sort((left, right) => left.localeCompare(right));
}

function isSidebarTabId(value: unknown): value is SidebarTabId {
  return value === "broken-links" || value === "isolated-files";
}

function isBrokenViewMode(value: unknown): value is BrokenViewMode {
  return value === "group" || value === "list";
}

function isBrokenGrouping(value: unknown): value is BrokenGrouping {
  return value === "target" || value === "source";
}

function isBrokenSort(value: unknown): value is BrokenSort {
  return value === "path" || value === "count";
}

function isIsolatedViewMode(value: unknown): value is IsolatedViewMode {
  return value === "list" || value === "tree";
}

function isIsolatedSort(value: unknown): value is IsolatedSort {
  return value === "path" || value === "name" || value === "modified" ||
    value === "broken-count";
}

function readSchemaVersion(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function assertValue(condition: boolean, key: string): asserts condition {
  if (!condition) throw new TypeError(`Invalid Link Integrity setting: ${key}`);
}

type MutableSettings = {
  -readonly [Key in keyof LinkIntegritySettings]: MutableDeep<LinkIntegritySettings[Key]>;
};

type MutableDeep<T> = T extends readonly (infer Item)[]
  ? MutableDeep<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: MutableDeep<T[Key]> }
    : T;

function cloneToMutable(settings: LinkIntegritySettings): MutableSettings {
  return structuredClone(settings) as MutableSettings;
}

function cloneRawRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
