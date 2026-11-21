import {
  PluginSettingTab,
  getLanguage,
  type App,
  type SettingDefinitionItem,
} from "obsidian";

import type { ExpectedIsolationRule } from "../core";
import { createTranslator } from "../shared/i18n";
import {
  PreviewRequestCoordinator,
  renderImperativeSettings,
  type ExpectedRulePreviewState,
  type SettingsTabId,
  type SettingsUiContext,
} from "../ui/settings";
import type { IgnoreRuleDraft } from "../ui/settings/types";
import type LinkIntegrityPlugin from "./plugin";

// Declarative settings are intentionally inactive. Obsidian 1.13 bypasses
// display() for non-empty definitions, removing the established top-tab surface
// and degrading the settings experience. Retain dormant definitions for tests only.

export class LinkIntegritySettingTab extends PluginSettingTab {
  private activeTab: SettingsTabId = "general";
  private indexDetailsExpanded = false;
  private cleanup: (() => void) | null = null;
  private imperativeVisible = false;
  private idCounter = 0;
  private readonly ignoreRuleDrafts = new Map<string, IgnoreRuleDraft>();
  private readonly expectedPreviews = new Map<string, ExpectedRulePreviewState>();
  private readonly expectedPreviewRequests = new PreviewRequestCoordinator<
    string,
    Awaited<ReturnType<LinkIntegrityPlugin["previewExpectedRule"]>>
  >();

  public constructor(app: App, private readonly owner: LinkIntegrityPlugin) {
    super(app, owner);
    this.icon = "link";
  }

  public override getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  public override display(): void {
    this.imperativeVisible = true;
    this.renderImperative(false);
  }

  public override hide(): void {
    super.hide();
    this.imperativeVisible = false;
    this.expectedPreviewRequests.invalidate();
    this.cleanup?.();
    this.cleanup = null;
    this.indexDetailsExpanded = false;
    this.ignoreRuleDrafts.clear();
  }

  private createContext(): SettingsUiContext {
    const settings = this.owner.getSettings();
    return {
      settings,
      ignoreRuleDrafts: this.ignoreRuleDrafts,
      getSettings: () => this.owner.getSettings(),
      translator: createTranslator(settings.general.locale, getLanguage()),
      writeProtected: this.owner.isSettingsWriteProtected(),
      createId: (kind) => this.createId(kind),
      onSettingsChange: (nextSettings, impact, surface) => {
        this.owner.updateSettings(nextSettings, impact);
        if (surface !== "keep-controls") this.refreshSurface();
      },
      getExpectedRulePreview: (ruleId) =>
        this.expectedPreviews.get(ruleId) ?? { state: "idle", stats: null },
      requestExpectedRulePreview: (rule, publish, signal) => this.refreshExpectedPreview(rule, publish, signal),
      requestIgnoreRulePreview: (rule, signal) => this.owner.previewIgnoreRule(rule, signal),
      getIndexRevision: () => this.owner.getIndexRevision(),
      getSaveStatus: () => this.owner.getSettingsSaveStatus(),
      subscribeSaveStatus: (listener) => this.owner.subscribeToSettingsSaveStatus(listener),
      retrySave: () => this.owner.retrySettingsSave(),
      getIndexStatus: () => this.owner.getIndexStatus(),
      subscribeIndexStatus: (listener) => this.owner.subscribeToIndexStatus(listener),
      getIndexDiagnostics: () => this.owner.getIndexDiagnostics(),
      subscribeIndexDiagnostics: (listener) =>
        this.owner.subscribeToIndexDiagnostics(listener),
      rebuildIndex: () => this.owner.rebuild(),
      indexDetailsExpanded: this.indexDetailsExpanded,
      rememberIndexDetails: (open) => { this.indexDetailsExpanded = open; },
      fileExists: (path) => this.owner.hasVaultFile(path),
      openFile: (path) => this.owner.openVaultFile(path),
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

  private refreshExpectedPreview(
    rule: ExpectedIsolationRule,
    publish?: (state: ExpectedRulePreviewState) => void,
    signal?: AbortSignal,
  ): void {
    void this.expectedPreviewRequests.request(
      rule.id,
      (requestSignal) => this.owner.previewExpectedRule(rule, requestSignal),
      (state) => {
        const previewState: ExpectedRulePreviewState = state.state === "ready"
          ? { state: "ready", stats: state.value }
          : state.state === "failed"
            ? { state: "failed", stats: null }
            : { state: "loading", stats: null };
        if (publish === undefined) {
          this.expectedPreviews.set(rule.id, previewState);
          this.refreshSurface();
        } else {
          publish(previewState);
        }
      },
      signal,
    );
  }

  private createId(kind: "expected-rule" | "expected-pattern" | "ignore-rule"): string {
    this.idCounter += 1;
    const uuid = this.containerEl.ownerDocument.defaultView?.crypto.randomUUID?.() ??
      `${Date.now().toString(36)}-${this.idCounter.toString(36)}`;
    return `${kind}:${uuid}`;
  }
}
