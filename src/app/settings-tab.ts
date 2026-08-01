import {
  PluginSettingTab,
  getLanguage,
  type App,
  type SettingDefinitionItem,
} from "obsidian";

import type { ExpectedIsolationRule } from "../core";
import { createTranslator } from "../shared/i18n";
import type { IgnoreRule, IgnoreRulePreview } from "../shared/ignore-rules";
import {
  applySettingValue,
  getSettingValue,
  type SettingsControlKey,
} from "../shared/settings";
import {
  getDeclarativeSettingDefinitions,
  PreviewRequestCoordinator,
  renderImperativeSettings,
  type ExpectedRulePreviewState,
  type SettingsTabId,
  type SettingsUiContext,
} from "../ui/settings";
import type LinkIntegrityPlugin from "./plugin";

const SETTINGS_CONTROL_KEYS = new Set<SettingsControlKey>([
  "general.locale",
  "general.scanOnStartup",
  "general.showScanStatus",
  "general.defaultSidebarTab",
  "brokenLinks.diagnostics.missingFiles",
  "brokenLinks.diagnostics.missingHeadings",
  "brokenLinks.diagnostics.missingBlocks",
  "brokenLinks.diagnostics.invalidLinks",
  "brokenLinks.defaultView",
  "brokenLinks.defaultGrouping",
  "brokenLinks.defaultSort",
  "brokenLinks.showIgnored",
  "isolatedFiles.defaultView",
  "isolatedFiles.defaultSort",
  "isolatedFiles.allowNoIncomingFilter",
  "isolatedFiles.showExpectedIsolatedFiles",
  "isolatedFiles.showIgnored",
]);

export class LinkIntegritySettingTab extends PluginSettingTab {
  private activeTab: SettingsTabId = "general";
  private cleanup: (() => void) | null = null;
  private imperativeVisible = false;
  private surfaceActive = false;
  private idCounter = 0;
  private readonly expectedPreviews = new Map<string, ExpectedRulePreviewState>();
  private readonly ignorePreviews = new Map<string, IgnoreRulePreview>();
  private readonly expectedPreviewRequests = new PreviewRequestCoordinator<
    string,
    ReturnType<LinkIntegrityPlugin["previewExpectedRule"]>
  >();
  private readonly ignorePreviewRequests = new PreviewRequestCoordinator<
    string,
    IgnoreRulePreview
  >();

  public constructor(app: App, private readonly owner: LinkIntegrityPlugin) {
    super(app, owner);
    this.icon = "link";
  }

  public override getSettingDefinitions(): SettingDefinitionItem[] {
    this.activateSurface();
    return getDeclarativeSettingDefinitions(this.createContext());
  }

  public override getControlValue(key: string): unknown {
    return isSettingsControlKey(key) ? getSettingValue(this.owner.getSettings(), key) : undefined;
  }

  public override setControlValue(key: string, value: unknown): void {
    if (!isSettingsControlKey(key) || this.owner.isSettingsWriteProtected()) return;
    const result = applySettingValue(this.owner.getSettings(), key, value);
    this.owner.updateSettings(result.settings, result.impact);
    this.refreshSurface();
  }

  public override display(): void {
    this.activateSurface();
    this.imperativeVisible = true;
    this.renderImperative(false);
  }

  public override hide(): void {
    super.hide();
    this.imperativeVisible = false;
    this.surfaceActive = false;
    this.expectedPreviewRequests.invalidate();
    this.ignorePreviewRequests.invalidate();
    this.cleanup?.();
    this.cleanup = null;
  }

  private createContext(): SettingsUiContext {
    const settings = this.owner.getSettings();
    return {
      settings,
      getSettings: () => this.owner.getSettings(),
      translator: createTranslator(settings.general.locale, getLanguage()),
      writeProtected: this.owner.isSettingsWriteProtected(),
      createId: (kind) => this.createId(kind),
      onSettingsChange: (nextSettings, impact) => {
        this.owner.updateSettings(nextSettings, impact);
        this.refreshSurface();
      },
      getExpectedRulePreview: (ruleId) =>
        this.expectedPreviews.get(ruleId) ?? { state: "idle", stats: null },
      requestExpectedRulePreview: (rule) => this.refreshExpectedPreview(rule),
      getIgnoreRulePreview: (ruleId) => this.ignorePreviews.get(ruleId) ?? null,
      requestIgnoreRulePreview: (rule) => this.refreshIgnorePreview(rule),
      getSaveStatus: () => this.owner.getSettingsSaveStatus(),
      subscribeSaveStatus: (listener) => this.owner.subscribeToSettingsSaveStatus(listener),
      retrySave: () => this.owner.retrySettingsSave(),
      onError: (error) => this.owner.reportSettingsError(error),
    };
  }

  private renderImperative(focusActiveTab: boolean): void {
    this.cleanup?.();
    this.cleanup = renderImperativeSettings(this.containerEl, this.createContext(), {
      activeTab: this.activeTab,
      focusActiveTab,
      onSelectTab: (tabId, focus) => {
        this.activeTab = tabId;
        this.renderImperative(focus);
      },
    });
  }

  private refreshSurface(): void {
    if (this.imperativeVisible) {
      this.renderImperative(false);
      return;
    }
    const update = (this as unknown as { readonly update?: () => void }).update;
    update?.call(this);
  }

  private refreshExpectedPreview(rule: ExpectedIsolationRule): void {
    void this.expectedPreviewRequests.request(
      rule.id,
      () => Promise.resolve(this.owner.previewExpectedRule(rule)),
      (state) => {
        this.expectedPreviews.set(rule.id, state.state === "ready"
          ? { state: "ready", stats: state.value }
          : state.state === "failed"
            ? { state: "failed", stats: null }
            : { state: "loading", stats: null });
        this.refreshSurface();
      },
    );
  }

  private refreshIgnorePreview(rule: IgnoreRule): void {
    void this.ignorePreviewRequests.request(
      rule.id,
      () => Promise.resolve(this.owner.previewIgnoreRule(rule)),
      (state) => {
        if (state.state === "ready") this.ignorePreviews.set(rule.id, state.value);
        else this.ignorePreviews.delete(rule.id);
        if (state.state === "failed") this.owner.reportSettingsError(state.error);
        this.refreshSurface();
      },
    );
  }

  private activateSurface(): void {
    if (this.surfaceActive) return;
    this.surfaceActive = true;
    this.expectedPreviewRequests.beginGeneration();
    this.ignorePreviewRequests.beginGeneration();
  }

  private createId(kind: "expected-rule" | "expected-pattern" | "ignore-rule"): string {
    this.idCounter += 1;
    const uuid = this.containerEl.ownerDocument.defaultView?.crypto.randomUUID?.() ??
      `${Date.now().toString(36)}-${this.idCounter.toString(36)}`;
    return `${kind}:${uuid}`;
  }
}

function isSettingsControlKey(value: string): value is SettingsControlKey {
  return SETTINGS_CONTROL_KEYS.has(value as SettingsControlKey);
}
