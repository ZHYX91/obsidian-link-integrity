import type { ExpectedIsolationRule, ExpectedRuleStats } from "../../core/expected-isolation-rules";
import type { IgnoreRule, IgnoreRulePreview } from "../../shared/ignore-rules";
import type {
  LinkIntegritySettings,
  SettingsChangeImpact,
} from "../../shared/settings";
import type { Translator } from "../../shared/i18n";
import type { SettingsSaveStatus } from "../../shared/settings-save-coordinator";
import type { IndexStatus } from "../sidebar";

export interface IndexOperationDiagnosticsView {
  readonly completedAt: number;
  readonly durationMs: number;
}

export interface IndexDiagnosticsView {
  readonly fileCount: number;
  readonly sourceCount: number;
  readonly occurrenceCount: number;
  readonly pendingEventCount: number;
  readonly lastFullRebuild: (IndexOperationDiagnosticsView & {
    readonly fileCount: number;
    readonly sourceCount: number;
    readonly occurrenceCount: number;
  }) | null;
  readonly lastIncrementalUpdate: (IndexOperationDiagnosticsView & {
    readonly eventCount: number;
    readonly affectedSourceCount: number;
  }) | null;
}

export const SETTINGS_TAB_IDS = ["general", "broken-links", "isolated-files"] as const;
export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

export type SettingsCustomSectionId =
  | "isolated-candidate-types"
  | "expected-isolation-rules"
  | "periodic-notes-preset"
  | "broken-ignore-rules"
  | "isolated-ignore-rules"
  | "index-maintenance"
  | "persistence-status";

export interface ExpectedRulePreviewState {
  readonly state: "idle" | "loading" | "ready" | "failed";
  readonly stats: ExpectedRuleStats | null;
}

export interface SettingsUiContext {
  readonly settings: LinkIntegritySettings;
  readonly getSettings?: () => LinkIntegritySettings;
  readonly translator: Translator;
  readonly writeProtected: boolean;
  readonly createId: (kind: "expected-rule" | "expected-pattern" | "ignore-rule") => string;
  readonly onSettingsChange: (
    settings: LinkIntegritySettings,
    impact: SettingsChangeImpact,
  ) => void | Promise<void>;
  readonly getExpectedRulePreview?: (ruleId: string) => ExpectedRulePreviewState;
  readonly requestExpectedRulePreview?: (
    rule: ExpectedIsolationRule,
    publish?: (state: ExpectedRulePreviewState) => void,
  ) => void | Promise<void>;
  readonly getIgnoreRulePreview?: (ruleId: string) => IgnoreRulePreview | null;
  readonly requestIgnoreRulePreview?: (rule: IgnoreRule) => void | Promise<void>;
  readonly getSaveStatus?: () => SettingsSaveStatus;
  readonly subscribeSaveStatus?: (
    listener: (status: SettingsSaveStatus) => void,
  ) => () => void;
  readonly retrySave?: () => void | Promise<void>;
  readonly getIndexStatus?: () => IndexStatus;
  readonly subscribeIndexStatus?: (listener: (status: IndexStatus) => void) => () => void;
  readonly getIndexDiagnostics?: () => IndexDiagnosticsView;
  readonly subscribeIndexDiagnostics?: (
    listener: (snapshot: IndexDiagnosticsView) => void,
  ) => () => void;
  readonly rebuildIndex?: () => void | Promise<void>;
  readonly fileExists?: (path: string) => boolean;
  readonly openFile?: (path: string) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}
