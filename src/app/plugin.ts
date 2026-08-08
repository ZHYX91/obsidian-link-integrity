import {
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  TFolder,
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
  IsolatedFileResult,
  SidebarNavigationPort,
  SidebarViewState,
} from "../ui/sidebar";
import { SidebarQueryService } from "./sidebar-query-service";
import { LinkIntegritySettingTab } from "./settings-tab";
import {
  findPureExpectedFolderRule,
  renameExpectedIsolationFolder,
} from "./expected-isolation-paths";
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
  private layoutReady = false;
  private initialMetadataReady = false;
  private initialMetadataPromise: Promise<void> | null = null;
  private metadataEventsRegistered = false;
  private baselineAvailable = false;
  private rebuildPromise: Promise<void> | null = null;
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
        this.showIsolatedFileActions(result, anchor),
      openIsolatedFolderActions: (path, anchor) =>
        this.showIsolatedFolderActions(path, anchor),
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
      this.layoutReady = true;
      const sidebarAlreadyOpen = this.app.workspace
        .getLeavesOfType(LINK_INTEGRITY_VIEW_TYPE).length > 0;
      if (!this.unloaded && (this.settings.general.scanOnStartup || sidebarAlreadyOpen)) {
        void this.ensureIndex().catch((error: unknown) => this.reportError(error));
      }
    });
  }

  public override onunload(): void {
    this.unloaded = true;
    this.runtimeStarted = false;
    this.layoutReady = false;
    this.initialMetadataReady = false;
    this.initialMetadataPromise = null;
    this.metadataEventsRegistered = false;
    this.baselineAvailable = false;
    this.rebuildPromise = null;
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
    const scanOnStartupWasEnabled = this.settings.general.scanOnStartup;
    this.settings = normalizeSettings(settings);
    if (!this.settingsWriteProtected) this.saveCoordinator.schedule(this.settings);
    if (impact === "full-rebuild") this.updateGraphContributionPolicy();
    this.refreshEntrypoints();
    this.query.notify();
    const shouldStartOnDemandRuntime = !scanOnStartupWasEnabled &&
      this.settings.general.scanOnStartup && this.layoutReady;
    if (impact === "full-rebuild" && this.runtimeStarted) {
      void this.rebuild().catch((error: unknown) => this.reportError(error));
    } else if (shouldStartOnDemandRuntime && !this.baselineAvailable) {
      void this.ensureIndex().catch((error: unknown) => this.reportError(error));
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

  public hasVaultFile(path: string): boolean {
    return this.app.vault.getFileByPath(path) !== null;
  }

  public async openVaultFile(path: string): Promise<void> {
    await this.openFile(path);
  }

  public rebuild(): Promise<void> {
    if (this.rebuildPromise !== null) return this.rebuildPromise;
    const request = this.performRebuild();
    this.rebuildPromise = request;
    void request.then(
      () => {
        if (this.rebuildPromise === request) this.rebuildPromise = null;
      },
      () => {
        if (this.rebuildPromise === request) this.rebuildPromise = null;
      },
    );
    return request;
  }

  private async performRebuild(): Promise<void> {
    this.startRuntime();
    if (!this.runtimeStarted) return;
    this.query.setStatus({ state: "scanning", current: 0, total: 0, errorMessage: null });
    try {
      await this.ensureInitialMetadataResolution();
      if (this.unloaded) return;
      const startsNewRebuild = this.coordinator.state !== "rebuilding";
      if (startsNewRebuild) this.discardPendingSourceEvents();
      const rebuild = this.coordinator.rebuild();
      await rebuild;
      this.baselineAvailable = true;
      this.flushPendingSourceEvents();
      this.query.setStatus(
        { state: "ready", current: 0, total: 0, errorMessage: null },
        true,
      );
    } catch (error) {
      if (error instanceof RebuildCancelledError) return;
      if (this.coordinator.state === "stale") {
        try {
          await this.coordinator.whenIdle();
        } catch (replayError) {
          this.reportError(replayError);
        }
      }
      const state: IndexStatus["state"] = this.coordinator.state === "stale"
        ? "stale"
        : "failed";
      this.query.setStatus({
        state,
        current: 0,
        total: 0,
        errorMessage: errorMessage(error),
      }, true);
      throw error;
    } finally {
      if (!this.unloaded) this.registerMetadataEvents();
    }
  }

  private startRuntime(): void {
    if (this.runtimeStarted || this.unloaded) return;
    this.runtimeStarted = true;
    if (!this.coordinatorStarted) {
      this.coordinator.start();
      this.coordinatorStarted = true;
    }
    this.registerVaultEvents();
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
      if (file instanceof TFile) {
        this.renameExpectedFilePath(oldPath, file.path);
        this.enqueue({ type: "rename", oldPath, path: file.path });
      } else if (file instanceof TFolder) {
        this.renameExpectedFolderPath(oldPath, file.path);
      }
    }));
  }

  private registerMetadataEvents(): void {
    if (this.metadataEventsRegistered) return;
    this.metadataEventsRegistered = true;
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

  private async ensureInitialMetadataResolution(): Promise<void> {
    if (this.initialMetadataReady) return;
    this.initialMetadataPromise ??= this.waitForInitialMetadataResolution()
      .then(() => {
        this.initialMetadataReady = true;
      })
      .finally(() => {
        this.initialMetadataPromise = null;
      });
    await this.initialMetadataPromise;
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

  private discardPendingSourceEvents(): void {
    if (this.eventFlushTimer !== null) window.clearTimeout(this.eventFlushTimer);
    if (this.eventMaxFlushTimer !== null) window.clearTimeout(this.eventMaxFlushTimer);
    this.eventFlushTimer = null;
    this.eventMaxFlushTimer = null;
    this.pendingSourceEvents = [];
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

  public ensureIndex(): Promise<void> {
    if (this.baselineAvailable) return Promise.resolve();
    return this.rebuild();
  }

  public getIndexStatus(): IndexStatus {
    return this.query.getStatus();
  }

  public subscribeToIndexStatus(listener: (status: IndexStatus) => void): () => void {
    return this.query.subscribe(() => listener(this.query.getStatus()));
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

  private showIsolatedFileActions(result: IsolatedFileResult, anchor: HTMLElement): void {
    const translator = createTranslator(this.settings.general.locale, getLanguage());
    const menu = new Menu().setParentElement(anchor);
    const explicitlyExpected = this.settings.isolatedFiles.expectedFilePaths.includes(result.path);
    if (explicitlyExpected) {
      menu.addItem((item) => item
        .setTitle(translator.t("sidebar.isolated.removeExpected"))
        .onClick(() => this.setExpectedFile(result.path, false, anchor.ownerDocument)));
    } else if (result.expectation.kind === "expected") {
      menu.addItem((item) => item
        .setTitle(translator.t("sidebar.isolated.expectedByRule"))
        .setDisabled(true));
    } else {
      menu.addItem((item) => item
        .setTitle(translator.t("sidebar.isolated.markExpected"))
        .onClick(() => this.setExpectedFile(result.path, true, anchor.ownerDocument)));
    }
    showMenuAtAnchor(menu, anchor);
  }

  private showIsolatedFolderActions(path: string, anchor: HTMLElement): void {
    const translator = createTranslator(this.settings.general.locale, getLanguage());
    const menu = new Menu().setParentElement(anchor);
    const actions = [
      {
        mode: "exact" as const,
        title: translator.t("sidebar.isolated.markFolderExpectedExact"),
      },
      {
        mode: "recursive" as const,
        title: translator.t("sidebar.isolated.markFolderExpectedRecursive"),
      },
    ];
    for (const action of actions) {
      const alreadyConfigured = findPureExpectedFolderRule(
        this.settings.isolatedFiles.expectedRules,
        path,
        action.mode,
      )?.enabled === true;
      menu.addItem((item) => item
        .setTitle(action.title)
        .setDisabled(alreadyConfigured)
        .onClick(() => this.addExpectedFolderRule(
          path,
          action.mode,
          anchor.ownerDocument,
        )));
    }
    showMenuAtAnchor(menu, anchor);
  }

  private addExpectedFolderRule(
    path: string,
    mode: "exact" | "recursive",
    document: Document,
  ): void {
    const existing = findPureExpectedFolderRule(
      this.settings.isolatedFiles.expectedRules,
      path,
      mode,
    );
    if (existing?.enabled === true) return;
    const translator = createTranslator(this.settings.general.locale, getLanguage());
    const suffix = document.defaultView?.crypto.randomUUID?.() ?? Date.now().toString(36);
    const rule: ExpectedIsolationRule = existing === null ? {
      id: `expected-folder:${suffix}`,
      name: translator.t("sidebar.isolated.expectedFolderRuleName", { path }),
      enabled: true,
      fileTypeFamilyIds: [],
      fileTypeCategoryIds: [],
      fileExtensions: [],
      folder: { path, mode },
      namingPatterns: [],
    } : { ...existing, enabled: true };
    const expectedRules = existing === null
      ? [...this.settings.isolatedFiles.expectedRules, rule]
      : this.settings.isolatedFiles.expectedRules.map((candidate) =>
        candidate.id === existing.id ? rule : candidate);
    this.updateSettings({
      ...this.settings,
      isolatedFiles: {
        ...this.settings.isolatedFiles,
        expectedRules,
      },
    }, "query-only");

    const fragment = document.createDocumentFragment();
    const message = document.createElement("span");
    message.textContent = translator.t("sidebar.isolated.markedExpectedFolder", {
      path,
      scope: translator.t(mode === "exact"
        ? "settings.expected.folderExact"
        : "settings.expected.folderRecursive"),
    });
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = translator.t("common.undo");
    fragment.append(message, document.createTextNode(" "), undo);
    const notice = new Notice(fragment, 8_000);
    undo.addEventListener("click", () => {
      this.updateSettings({
        ...this.settings,
        isolatedFiles: {
          ...this.settings.isolatedFiles,
          expectedRules: existing === null
            ? this.settings.isolatedFiles.expectedRules.filter(({ id }) => id !== rule.id)
            : this.settings.isolatedFiles.expectedRules.map((candidate) =>
              candidate.id === rule.id ? existing : candidate),
        },
      }, "query-only");
      notice.hide();
    }, { once: true });
  }

  private setExpectedFile(path: string, expected: boolean, document: Document): void {
    const before = this.settings.isolatedFiles.expectedFilePaths;
    const after = expected
      ? [...before, path]
      : before.filter((candidate) => candidate !== path);
    this.updateSettings({
      ...this.settings,
      isolatedFiles: {
        ...this.settings.isolatedFiles,
        expectedFilePaths: after,
      },
    }, "query-only");
    const translator = createTranslator(this.settings.general.locale, getLanguage());
    const fragment = document.createDocumentFragment();
    const message = document.createElement("span");
    message.textContent = translator.t(expected
      ? "sidebar.isolated.markedExpected"
      : "sidebar.isolated.removedExpected", { path });
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = translator.t("common.undo");
    fragment.append(message, document.createTextNode(" "), undo);
    const notice = new Notice(fragment, 8_000);
    undo.addEventListener("click", () => {
      const current = this.settings.isolatedFiles.expectedFilePaths;
      this.updateSettings({
        ...this.settings,
        isolatedFiles: {
          ...this.settings.isolatedFiles,
          expectedFilePaths: expected
            ? current.filter((candidate) => candidate !== path)
            : [...current, path],
        },
      }, "query-only");
      notice.hide();
    }, { once: true });
  }

  private renameExpectedFilePath(oldPath: string, newPath: string): void {
    if (!this.settings.isolatedFiles.expectedFilePaths.includes(oldPath)) return;
    this.updateSettings({
      ...this.settings,
      isolatedFiles: {
        ...this.settings.isolatedFiles,
        expectedFilePaths: this.settings.isolatedFiles.expectedFilePaths
          .map((path) => path === oldPath ? newPath : path),
      },
    }, "query-only");
  }

  private renameExpectedFolderPath(oldPath: string, newPath: string): void {
    const isolatedFiles = renameExpectedIsolationFolder(
      this.settings.isolatedFiles,
      oldPath,
      newPath,
    );
    if (isolatedFiles === this.settings.isolatedFiles) return;
    this.updateSettings({ ...this.settings, isolatedFiles }, "query-only");
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
      state.isolatedSort !== previousState.isolatedSort ||
      !setsEqual(state.expandedBrokenFolderPaths, previousState.expandedBrokenFolderPaths);
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
        expandedBrokenFolderPaths: !setsEqual(
          state.expandedBrokenFolderPaths,
          previousState.expandedBrokenFolderPaths,
        )
          ? Array.from(state.expandedBrokenFolderPaths)
          : this.settings.ui.expandedBrokenFolderPaths,
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

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && Array.from(left).every((value) => right.has(value));
}

function showMenuAtAnchor(menu: Menu, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  menu.showAtPosition({
    x: rect.left,
    y: rect.bottom,
    width: rect.width,
  }, anchor.ownerDocument);
}
