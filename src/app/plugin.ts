import {
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  getLanguage,
  type Command,
  type EventRef,
  type WorkspaceLeaf,
} from "obsidian";

import { ObsidianLinkIndexPort } from "../adapters/obsidian";
import {
  ALLOW_ALL_GRAPH_CONTRIBUTION_POLICY,
  classifyFileExtension,
  getExpectedRuleStats,
  LinkIndex,
  type ExpectedIsolationRule,
  type ExpectedRuleStats,
  type GraphContributionPolicy,
} from "../core";
import {
  LinkIndexCoordinator,
  RebuildCancelledError,
  type SourceEvent,
} from "../features/index";
import { queryBrokenLinks } from "../features/queries";
import { createTranslator } from "../shared/i18n";
import {
  IgnoreService,
  type IgnoreEvaluationContext,
  type IgnoreMatcherKind,
  type IgnoreRule,
  type IgnoreRulePreview,
  type IgnoreRuleScope,
} from "../shared/ignore-rules";
import {
  SettingsSaveCoordinator,
  type SettingsSaveStatus,
} from "../shared/settings-save-coordinator";
import {
  loadSettings,
  normalizeSettings,
  classifySettingChange,
  type LinkIntegritySettings,
  type SettingsChangeImpact,
} from "../shared/settings";
import type {
  BrokenLinkResult,
  IndexStatus,
  SidebarNavigationPort,
  SidebarViewState,
} from "../ui/sidebar";
import { SidebarQueryService } from "./sidebar-query-service";
import { LinkIntegritySettingTab } from "./settings-tab";
import {
  LINK_INTEGRITY_VIEW_TYPE,
  LinkIntegritySidebarView,
} from "./sidebar-view";

export default class LinkIntegrityPlugin extends Plugin {
  public override settings!: LinkIntegritySettings;
  private settingsWriteProtected = false;
  private saveCoordinator!: SettingsSaveCoordinator<LinkIntegritySettings>;
  private coordinator!: LinkIndexCoordinator;
  private query!: SidebarQueryService;
  private ribbonElement: HTMLElement | null = null;
  private openCommand: Command | null = null;
  private rebuildCommand: Command | null = null;
  private runtimeStarted = false;
  private coordinatorStarted = false;
  private baselineAvailable = false;
  private rebuildRequestCount = 0;
  private unloaded = false;
  private notificationPending = false;
  private pendingSourceEvents: SourceEvent[] = [];
  private eventFlushTimer: number | null = null;
  private eventMaxFlushTimer: number | null = null;

  public override async onload(): Promise<void> {
    const loaded = loadSettings(await this.loadData());
    this.settings = loaded.settings;
    this.settingsWriteProtected = loaded.writeProtected;
    this.saveCoordinator = new SettingsSaveCoordinator(
      async (snapshot) => this.saveData(snapshot),
      { onError: (error) => this.reportError(error) },
    );
    if (loaded.shouldPersistMigration) this.saveCoordinator.schedule(this.settings);

    const port = new ObsidianLinkIndexPort(this.app.vault, this.app.metadataCache);
    this.coordinator = new LinkIndexCoordinator(port, new LinkIndex(), {
      concurrency: 4,
      onProgress: (current, total) => this.query.setProgress(current, total),
    });
    this.updateGraphContributionPolicy();
    this.query = new SidebarQueryService(
      () => this.coordinator.index,
      () => this.settings,
    );

    const navigation: SidebarNavigationPort = {
      openBrokenLink: (result) => this.openBrokenLink(result),
      openFile: async (path) => {
        await this.openFile(path);
      },
      rebuildIndex: () => this.rebuild(),
      openBrokenLinkActions: (result, anchor) => this.showBrokenLinkActions(result, anchor),
      openIsolatedFileActions: (result, anchor) =>
        this.showIsolatedFileActions(result.path, anchor),
    };
    this.registerView(LINK_INTEGRITY_VIEW_TYPE, (leaf) => new LinkIntegritySidebarView(leaf, {
      query: this.query,
      navigation,
      getSettings: () => this.settings,
      ensureIndex: () => this.ensureIndex(),
      onViewStateChange: (state, previousState) =>
        this.persistViewState(state, previousState),
      onActionError: (error) => this.reportError(error),
    }));
    this.addSettingTab(new LinkIntegritySettingTab(this.app, this));

    this.refreshEntrypoints();
    this.app.workspace.onLayoutReady(() => {
      if (!this.unloaded) void this.startRuntime();
    });
  }

  public override onunload(): void {
    this.unloaded = true;
    this.runtimeStarted = false;
    this.baselineAvailable = false;
    this.rebuildRequestCount = 0;
    if (this.eventFlushTimer !== null) window.clearTimeout(this.eventFlushTimer);
    if (this.eventMaxFlushTimer !== null) window.clearTimeout(this.eventMaxFlushTimer);
    this.eventFlushTimer = null;
    this.eventMaxFlushTimer = null;
    this.pendingSourceEvents = [];
    this.notificationPending = false;
    this.coordinator?.stop();
    this.coordinatorStarted = false;
    void this.saveCoordinator?.close().catch((error: unknown) => this.reportError(error));
  }

  public getSettings(): LinkIntegritySettings {
    return this.settings;
  }

  public isSettingsWriteProtected(): boolean {
    return this.settingsWriteProtected;
  }

  public getSettingsSaveStatus(): SettingsSaveStatus {
    return this.saveCoordinator.getStatus();
  }

  public subscribeToSettingsSaveStatus(
    listener: (status: SettingsSaveStatus) => void,
  ): () => void {
    return this.saveCoordinator.subscribe(listener);
  }

  public retrySettingsSave(): Promise<void> {
    if (this.settingsWriteProtected) return Promise.resolve();
    return this.saveCoordinator.retry();
  }

  public previewExpectedRule(rule: ExpectedIsolationRule): ExpectedRuleStats {
    return getExpectedRuleStats(this.coordinator.index.files, [rule])[0] ?? {
      ruleId: rule.id,
      name: rule.name,
      matchCount: 0,
      samples: [],
      errors: [],
    };
  }

  public previewIgnoreRule(rule: IgnoreRule): IgnoreRulePreview {
    const service = new IgnoreService([rule]);
    return service.preview(rule, this.getIgnorePreviewContexts(rule));
  }

  public updateSettings(
    settings: LinkIntegritySettings,
    impact: SettingsChangeImpact = "query-only",
  ): void {
    this.settings = normalizeSettings(settings);
    if (!this.settingsWriteProtected) this.saveCoordinator.schedule(this.settings);
    if (impact === "full-rebuild") this.updateGraphContributionPolicy();
    this.refreshEntrypoints();
    this.query.notify();
    if (impact === "full-rebuild" && this.runtimeStarted) {
      void this.rebuild().catch((error: unknown) => this.reportError(error));
    }
  }

  public async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LINK_INTEGRITY_VIEW_TYPE)[0];
    if (leaf === undefined) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: LINK_INTEGRITY_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  public async rebuild(): Promise<void> {
    if (!this.runtimeStarted) return;
    if (!this.coordinatorStarted) {
      this.coordinator.start();
      this.coordinatorStarted = true;
    }
    this.rebuildRequestCount += 1;
    this.query.setStatus({ state: "scanning", current: 0, total: 0, errorMessage: null });
    try {
      const rebuild = this.coordinator.rebuild();
      this.flushPendingSourceEvents();
      await rebuild;
      this.baselineAvailable = true;
      this.flushPendingSourceEvents();
      this.query.setStatus(
        { state: "ready", current: 0, total: 0, errorMessage: null },
        true,
      );
    } catch (error) {
      if (error instanceof RebuildCancelledError) return;
      const state: IndexStatus["state"] = this.coordinator.state === "stale"
        ? "stale"
        : "failed";
      this.query.setStatus({
        state,
        current: 0,
        total: 0,
        errorMessage: errorMessage(error),
      });
      throw error;
    } finally {
      this.rebuildRequestCount = Math.max(0, this.rebuildRequestCount - 1);
    }
  }

  private async startRuntime(): Promise<void> {
    if (this.runtimeStarted || this.unloaded) return;
    this.runtimeStarted = true;
    if (!this.coordinatorStarted) {
      this.coordinator.start();
      this.coordinatorStarted = true;
    }
    this.registerVaultEvents();
    try {
      const sidebarAlreadyOpen = this.app.workspace
        .getLeavesOfType(LINK_INTEGRITY_VIEW_TYPE).length > 0;
      if (this.settings.general.scanOnStartup || sidebarAlreadyOpen) {
        await this.waitForInitialMetadataResolution();
        if (this.unloaded) return;
        await this.rebuild();
      }
    } catch (error) {
      this.reportError(error);
    } finally {
      if (!this.unloaded) this.registerMetadataEvents();
    }
  }

  private registerVaultEvents(): void {
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile) this.enqueue({ type: "create", path: file.path });
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile) this.enqueue({ type: "modify", path: file.path });
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile) this.enqueue({ type: "delete", path: file.path });
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) this.enqueue({ type: "rename", oldPath, path: file.path });
    }));
  }

  private registerMetadataEvents(): void {
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      this.enqueueMetadata({ type: "modify", path: file.path });
    }));
    this.registerEvent(this.app.metadataCache.on("deleted", (file) => {
      this.enqueueMetadata({ type: "delete", path: file.path });
    }));
  }

  private waitForInitialMetadataResolution(maxWaitMs = 1_000): Promise<void> {
    return new Promise((resolve) => {
      let eventRef: EventRef | null = null;
      let timeout: number | null = null;
      const finish = (): void => {
        if (eventRef !== null) this.app.metadataCache.offref(eventRef);
        if (timeout !== null) window.clearTimeout(timeout);
        resolve();
      };
      eventRef = this.app.metadataCache.on("resolved", finish);
      timeout = window.setTimeout(finish, maxWaitMs);
    });
  }

  private enqueueMetadata(event: SourceEvent): void {
    this.enqueue(event);
  }

  private enqueue(event: SourceEvent): void {
    if (!this.runtimeStarted || this.unloaded) return;
    this.pendingSourceEvents.push(event);
    if (this.eventFlushTimer !== null) window.clearTimeout(this.eventFlushTimer);
    this.eventFlushTimer = window.setTimeout(() => {
      this.flushPendingSourceEvents();
    }, 100);
    this.eventMaxFlushTimer ??= window.setTimeout(() => {
      this.flushPendingSourceEvents();
    }, 500);
  }

  private flushPendingSourceEvents(): void {
    if (this.eventFlushTimer !== null) window.clearTimeout(this.eventFlushTimer);
    if (this.eventMaxFlushTimer !== null) window.clearTimeout(this.eventMaxFlushTimer);
    this.eventFlushTimer = null;
    this.eventMaxFlushTimer = null;
    if (!this.runtimeStarted || this.unloaded) {
      this.pendingSourceEvents = [];
      return;
    }
    if (!this.baselineAvailable && this.coordinator.state !== "rebuilding") return;
    const events = this.pendingSourceEvents;
    this.pendingSourceEvents = [];
    if (events.length === 0) return;
    for (const event of events) this.coordinator.enqueue(event);
    if (!this.baselineAvailable) return;
    if (this.notificationPending) return;
    this.notificationPending = true;
    void this.coordinator.whenIdle()
      .then(() => {
        if (this.eventFlushTimer !== null || this.pendingSourceEvents.length > 0) {
          this.notificationPending = false;
          return;
        }
        this.notificationPending = false;
        this.query.notify();
      })
      .catch((error: unknown) => {
        this.notificationPending = false;
        this.query.setStatus({
          state: this.coordinator.store.generation > 0 ? "stale" : "failed",
          current: 0,
          total: 0,
          errorMessage: errorMessage(error),
        });
        this.reportError(error);
      });
  }

  private refreshEntrypoints(): void {
    const translator = createTranslator(this.settings.general.locale, getLanguage());
    const label = translator.t("command.openSidebar");
    if (this.ribbonElement === null) {
      this.ribbonElement = this.addRibbonIcon("link", label, () => {
        void this.activateView().catch((error: unknown) => this.reportError(error));
      });
    } else {
      this.ribbonElement.setAttribute("aria-label", label);
      this.ribbonElement.setAttribute("data-tooltip-position", "right");
    }
    if (this.openCommand === null) {
      this.openCommand = this.addCommand({
        id: "open-results",
        name: label,
        icon: "link",
        callback: () => {
          void this.activateView().catch((error: unknown) => this.reportError(error));
        },
      });
    } else {
      this.openCommand.name = label;
    }
    const rebuildLabel = translator.t("command.rebuildIndex");
    if (this.rebuildCommand === null) {
      this.rebuildCommand = this.addCommand({
        id: "rebuild-link-index",
        name: rebuildLabel,
        icon: "refresh-cw",
        callback: () => {
          void this.rebuild().catch((error: unknown) => this.reportError(error));
        },
      });
    } else {
      this.rebuildCommand.name = rebuildLabel;
    }
  }

  public async ensureIndex(): Promise<void> {
    if (!this.runtimeStarted || this.baselineAvailable || this.rebuildRequestCount > 0) return;
    await this.rebuild();
  }

  public getIndexStatus(): IndexStatus {
    return this.query.getSnapshot().status;
  }

  public subscribeToIndexStatus(listener: (status: IndexStatus) => void): () => void {
    return this.query.subscribe(() => listener(this.query.getSnapshot().status));
  }

  private async openBrokenLink(result: BrokenLinkResult): Promise<void> {
    const leaf = await this.openFile(result.sourcePath);
    if (result.location.line === null || !(leaf.view instanceof MarkdownView)) return;
    leaf.view.editor.setCursor({
      line: result.location.line,
      ch: result.location.column ?? 0,
    });
    leaf.view.editor.scrollIntoView({
      from: { line: result.location.line, ch: result.location.column ?? 0 },
      to: { line: result.location.line, ch: result.location.column ?? 0 },
    }, true);
  }

  private async openFile(path: string): Promise<WorkspaceLeaf> {
    const file = this.app.vault.getFileByPath(path);
    if (file === null) throw new Error(`Vault file no longer exists: ${path}`);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    return leaf;
  }

  private showBrokenLinkActions(result: BrokenLinkResult, anchor: HTMLElement): void {
    const translator = createTranslator(this.settings.general.locale, getLanguage());
    const menu = new Menu().setParentElement(anchor);
    const rules: readonly {
      readonly title: string;
      readonly scope: IgnoreRuleScope;
      readonly kind: IgnoreMatcherKind;
      readonly value: string;
    }[] = [
      {
        title: translator.t("ignore.scope.ignoreOccurrence"),
        scope: "ignore-occurrence",
        kind: "occurrence-id",
        value: result.id,
      },
      {
        title: translator.t("ignore.scope.ignoreTarget"),
        scope: "ignore-target",
        kind: "target-path",
        value: result.resolvedTargetPath ?? result.targetText,
      },
      {
        title: translator.t("ignore.scope.hideBroken"),
        scope: "hide-broken-result",
        kind: "source-path",
        value: result.sourcePath,
      },
    ];
    for (const rule of rules) {
      menu.addItem((item) => item
        .setTitle(rule.title)
        .onClick(() => this.addIgnoreRule(rule.scope, rule.kind, rule.value, rule.title, anchor)));
    }
    showMenuAtAnchor(menu, anchor);
  }

  private showIsolatedFileActions(path: string, anchor: HTMLElement): void {
    const translator = createTranslator(this.settings.general.locale, getLanguage());
    const menu = new Menu().setParentElement(anchor);
    const label = translator.t("ignore.scope.excludeIsolated");
    menu.addItem((item) => item
      .setTitle(`${label}: ${path}`)
      .onClick(() => this.addIgnoreRule(
        "exclude-isolated-candidate",
        "source-path",
        path,
        label,
        anchor,
      )));
    const folder = path.split("/").slice(0, -1).join("/");
    if (folder.length > 0) {
      menu.addItem((item) => item
        .setTitle(`${label}: ${folder}/`)
        .onClick(() => this.addIgnoreRule(
          "exclude-isolated-candidate",
          "path-prefix",
          folder,
          label,
          anchor,
        )));
    }
    showMenuAtAnchor(menu, anchor);
  }

  private addIgnoreRule(
    scope: IgnoreRuleScope,
    kind: IgnoreMatcherKind,
    value: string,
    label: string,
    anchor: HTMLElement,
  ): void {
    const suffix = anchor.ownerDocument.defaultView?.crypto.randomUUID?.() ??
      Date.now().toString(36);
    const rule: IgnoreRule = {
      id: `ignore-rule:${suffix}`,
      enabled: true,
      scope,
      matcher: { kind, value },
      createdAt: Date.now(),
      note: `Added from sidebar: ${label}`,
    };
    const preview = this.previewIgnoreRule(rule);
    this.updateSettings({
      ...this.settings,
      ignoreRules: [...this.settings.ignoreRules, rule],
    }, classifySettingChange(rule));
    this.showIgnoreUndoNotice(rule, label, preview, anchor.ownerDocument);
  }

  private showIgnoreUndoNotice(
    rule: IgnoreRule,
    label: string,
    preview: IgnoreRulePreview,
    document: Document,
  ): void {
    const translator = createTranslator(this.settings.general.locale, getLanguage());
    const fragment = document.createDocumentFragment();
    const message = document.createElement("span");
    message.textContent = `${label} · ${translator.t("settings.ignore.matchCount", {
      count: preview.matchCount,
    })}`;
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = translator.t("common.undo");
    fragment.append(message, document.createTextNode(" "), undo);
    const notice = new Notice(fragment, 8_000);
    undo.addEventListener("click", () => {
      this.updateSettings({
        ...this.settings,
        ignoreRules: this.settings.ignoreRules.filter(({ id }) => id !== rule.id),
      }, classifySettingChange(rule));
      notice.hide();
    }, { once: true });
  }

  private persistViewState(
    state: SidebarViewState,
    previousState: SidebarViewState,
  ): void {
    const changed = state.activeTab !== previousState.activeTab ||
      state.brokenView !== previousState.brokenView ||
      state.brokenGrouping !== previousState.brokenGrouping ||
      state.brokenSort !== previousState.brokenSort ||
      state.isolatedView !== previousState.isolatedView ||
      state.isolatedSort !== previousState.isolatedSort;
    if (!changed) return;
    this.settings = normalizeSettings({
      ...this.settings,
      ui: {
        activeSidebarTab: state.activeTab !== previousState.activeTab
          ? state.activeTab
          : this.settings.ui.activeSidebarTab,
        brokenView: state.brokenView !== previousState.brokenView
          ? state.brokenView
          : this.settings.ui.brokenView,
        brokenGrouping: state.brokenGrouping !== previousState.brokenGrouping
          ? state.brokenGrouping
          : this.settings.ui.brokenGrouping,
        brokenSort: state.brokenSort !== previousState.brokenSort
          ? state.brokenSort
          : this.settings.ui.brokenSort,
        isolatedView: state.isolatedView !== previousState.isolatedView
          ? state.isolatedView
          : this.settings.ui.isolatedView,
        isolatedSort: state.isolatedSort !== previousState.isolatedSort
          ? state.isolatedSort
          : this.settings.ui.isolatedSort,
      },
    });
    if (!this.settingsWriteProtected) this.saveCoordinator.schedule(this.settings);
  }

  private updateGraphContributionPolicy(): void {
    if (this.coordinator === undefined) return;
    const service = new IgnoreService(this.settings.ignoreRules);
    const policy: GraphContributionPolicy = service.getGraphContributionRules().length === 0
      ? ALLOW_ALL_GRAPH_CONTRIBUTION_POLICY
      : {
        allows: ({ occurrence, sourceFile }) => {
          const classification = classifyFileExtension(sourceFile.path);
          return !service.shouldExcludeGraphContribution({
            sourcePath: occurrence.sourcePath,
            targetPath: occurrence.targetPath,
            occurrenceId: occurrence.id,
            formatFamilyIds: classification.familyIds,
            extension: sourceFile.extension,
          });
        },
      };
    this.coordinator.setGraphContributionPolicy(policy);
  }

  private getIgnorePreviewContexts(rule: IgnoreRule): readonly IgnoreEvaluationContext[] {
    if (rule.scope === "exclude-isolated-candidate") {
      return this.coordinator.index.files.map((file) => {
        const classification = classifyFileExtension(file.path);
        return {
          candidatePath: file.path,
          formatFamilyIds: classification.familyIds,
          extension: file.extension,
        };
      });
    }
    const occurrences = rule.scope === "exclude-graph-contribution"
      ? this.coordinator.index.occurrences.filter(({ fileStatus, targetPath }) =>
        fileStatus === "resolved" && targetPath !== null)
      : queryBrokenLinks(this.coordinator.index).map(({ occurrence }) => occurrence);
    return occurrences.map((occurrence) => {
      const sourceFile = this.coordinator.index.getFile(occurrence.sourcePath);
      const classification = sourceFile === null
        ? null
        : classifyFileExtension(sourceFile.path);
      return {
        sourcePath: occurrence.sourcePath,
        targetPath: occurrence.targetPath ?? occurrence.linkpath,
        occurrenceId: occurrence.id,
        formatFamilyIds: classification?.familyIds,
        extension: sourceFile?.extension ?? null,
      };
    });
  }

  private reportError(error: unknown): void {
    const message = errorMessage(error);
    console.error("Link Integrity:", error);
    if (!this.unloaded) new Notice(`Link Integrity: ${message}`);
  }

  public reportSettingsError(error: unknown): void {
    this.reportError(error);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showMenuAtAnchor(menu: Menu, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  menu.showAtPosition({
    x: rect.left,
    y: rect.bottom,
    width: rect.width,
  }, anchor.ownerDocument);
}
