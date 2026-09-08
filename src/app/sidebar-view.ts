import { getLanguage, ItemView, type WorkspaceLeaf } from "obsidian";

import {
  FILE_TYPE_CATEGORIES,
} from "../core";
import { createTranslator, type MessageKey } from "../shared/i18n";
import type { LinkIntegritySettings } from "../shared/settings";
import type { FileTypeCategoryOption } from "../ui/file-type-selection";
import {
  mountSidebar,
  type SidebarMount,
  type SidebarRenderOptions,
  type SidebarNavigationPort,
  type SidebarQueryPort,
  type SidebarViewState,
} from "../ui/sidebar";
import {
  createSidebarViewModelSelector, createScheduledViewModelSelector, type SidebarViewModel,
} from "../ui/sidebar/view-model";

export const LINK_INTEGRITY_VIEW_TYPE = "link-integrity-results";

export interface LinkIntegritySidebarViewOptions {
  readonly query: SidebarQueryPort;
  readonly navigation: SidebarNavigationPort;
  readonly getSettings: () => LinkIntegritySettings;
  readonly ensureIndex: () => void | Promise<void>;
  readonly onViewStateChange: (
    state: SidebarViewState,
    previousState: SidebarViewState,
  ) => void;
  readonly onActionError: (error: unknown) => void;
}

export class LinkIntegritySidebarView extends ItemView {
  private state: SidebarViewState;
  private lastSettings: LinkIntegritySettings;
  private mount: SidebarMount | null = null;
  private unsubscribe: (() => void) | null = null;
  private isOpen = false;
  private visible = true;
  private visibilityObserver: IntersectionObserver | null = null;
  private renderGeneration = 0;
  private readonly selectModel = createSidebarViewModelSelector();
  private readonly selectScheduledModel = createScheduledViewModelSelector();

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly options: LinkIntegritySidebarViewOptions,
  ) {
    super(leaf);
    this.lastSettings = options.getSettings();
    this.state = createInitialSidebarState(this.lastSettings);
  }

  public getViewType(): string {
    return LINK_INTEGRITY_VIEW_TYPE;
  }

  public getDisplayText(): string {
    const settings = this.options.getSettings();
    return createTranslator(settings.general.locale, getLanguage()).t("app.name");
  }

  public override getIcon(): string {
    return "link";
  }

  public override async onOpen(): Promise<void> {
    this.isOpen = true;
    if (typeof IntersectionObserver !== "undefined") {
      this.visibilityObserver = new IntersectionObserver((entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible === this.visible) return;
        this.visible = visible;
        this.renderGeneration += 1;
        if (visible) this.render();
      });
      this.visibilityObserver.observe(this.contentEl);
    }
    this.unsubscribe?.();
    this.unsubscribe = this.options.query.subscribe(() => this.render());
    this.render();
    try {
      await this.options.ensureIndex();
    } catch (error) {
      this.options.onActionError(error);
    }
  }

  public override async onClose(): Promise<void> {
    this.isOpen = false;
    this.renderGeneration += 1;
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.mount?.dispose();
    this.mount = null;
    this.contentEl.replaceChildren();
  }

  public requestRender(): void {
    this.render();
  }

  private render(): void {
    if (!this.isOpen || !this.visible) return;
    const settings = this.options.getSettings();
    this.state = reconcileSidebarState(this.state, this.lastSettings, settings);
    this.lastSettings = settings;
    const generation = ++this.renderGeneration;
    if (this.options.query.prepareSnapshot !== undefined) {
      void this.options.query.prepareSnapshot(this.state.activeTab).then(async (ready) => {
        if (ready && generation === this.renderGeneration && this.isOpen && this.visible) {
          const model = await this.selectScheduledModel(
            this.options.query.getSnapshot(this.state.activeTab), this.state,
          );
          if (model !== null && generation === this.renderGeneration && this.isOpen && this.visible) {
            this.renderPrepared(model);
          }
        }
      }).catch((error: unknown) => this.options.onActionError(error));
    } else this.renderPrepared();
  }

  private renderPrepared(preparedModel?: SidebarViewModel): void {
    const settings = this.options.getSettings();
    const translator = createTranslator(settings.general.locale, getLanguage());
    const categories = createFileTypeOptions(translator.t);
    const model = preparedModel ?? this.selectModel(
      this.options.query.getSnapshot(this.state.activeTab),
      this.state,
    );
    const renderOptions: SidebarRenderOptions = {
      model,
      state: this.state,
      translator,
      navigation: this.options.navigation,
      fileTypeCategories: categories,
      defaultFormatFamilyIds: new Set(settings.isolatedFiles.candidateFormatFamilyIds),
      allowNoIncomingFilter: settings.isolatedFiles.allowNoIncomingFilter,
      onStateChange: (nextState) => {
        const previousState = this.state;
        this.state = nextState;
        this.options.onViewStateChange(nextState, previousState);
        this.render();
      },
      onActionError: this.options.onActionError,
    };
    if (this.mount === null) this.mount = mountSidebar(this.contentEl, renderOptions);
    else this.mount.update(renderOptions);
  }
}

export function createInitialSidebarState(settings: LinkIntegritySettings): SidebarViewState {
  return {
    activeTab: settings.ui.activeSidebarTab ?? settings.general.defaultSidebarTab,
    search: "",
    brokenView: settings.ui.brokenView ?? settings.brokenLinks.defaultView,
    brokenGrouping: settings.ui.brokenGrouping ?? settings.brokenLinks.defaultGrouping,
    brokenSort: settings.ui.brokenSort ?? settings.brokenLinks.defaultSort,
    isolatedView: settings.ui.isolatedView ?? settings.isolatedFiles.defaultView,
    isolatedSort: settings.ui.isolatedSort ?? settings.isolatedFiles.defaultSort,
    isolatedMode: "isolated",
    showExpectedIsolated: settings.isolatedFiles.showExpectedIsolatedFiles,
    selectedFormatFamilyIds: new Set(settings.isolatedFiles.candidateFormatFamilyIds),
    brokenResultOffset: 0,
    isolatedResultOffset: 0,
    expandedBrokenFolderPaths: new Set(settings.ui.expandedBrokenFolderPaths),
  };
}

export function reconcileSidebarState(
  state: SidebarViewState,
  previousSettings: LinkIntegritySettings,
  settings: LinkIntegritySettings,
): SidebarViewState {
  const previousCandidateTypes = new Set(
    previousSettings.isolatedFiles.candidateFormatFamilyIds,
  );
  const candidateTypesFollowedDefault = setsEqual(
    state.selectedFormatFamilyIds,
    previousCandidateTypes,
  );
  return {
    ...state,
    activeTab: reconcilePreference(
      state.activeTab,
      previousSettings.ui.activeSidebarTab,
      previousSettings.general.defaultSidebarTab,
      settings.ui.activeSidebarTab,
      settings.general.defaultSidebarTab,
    ),
    brokenView: reconcilePreference(
      state.brokenView,
      previousSettings.ui.brokenView,
      previousSettings.brokenLinks.defaultView,
      settings.ui.brokenView,
      settings.brokenLinks.defaultView,
    ),
    brokenGrouping: reconcilePreference(
      state.brokenGrouping,
      previousSettings.ui.brokenGrouping,
      previousSettings.brokenLinks.defaultGrouping,
      settings.ui.brokenGrouping,
      settings.brokenLinks.defaultGrouping,
    ),
    brokenSort: reconcilePreference(
      state.brokenSort,
      previousSettings.ui.brokenSort,
      previousSettings.brokenLinks.defaultSort,
      settings.ui.brokenSort,
      settings.brokenLinks.defaultSort,
    ),
    isolatedView: reconcilePreference(
      state.isolatedView,
      previousSettings.ui.isolatedView,
      previousSettings.isolatedFiles.defaultView,
      settings.ui.isolatedView,
      settings.isolatedFiles.defaultView,
    ),
    isolatedSort: reconcilePreference(
      state.isolatedSort,
      previousSettings.ui.isolatedSort,
      previousSettings.isolatedFiles.defaultSort,
      settings.ui.isolatedSort,
      settings.isolatedFiles.defaultSort,
    ),
    isolatedMode: settings.isolatedFiles.allowNoIncomingFilter
      ? state.isolatedMode
      : "isolated",
    showExpectedIsolated: state.showExpectedIsolated ===
      previousSettings.isolatedFiles.showExpectedIsolatedFiles
      ? settings.isolatedFiles.showExpectedIsolatedFiles
      : state.showExpectedIsolated,
    selectedFormatFamilyIds: candidateTypesFollowedDefault
      ? new Set(settings.isolatedFiles.candidateFormatFamilyIds)
      : state.selectedFormatFamilyIds,
    expandedBrokenFolderPaths: setsEqual(
      state.expandedBrokenFolderPaths,
      new Set(previousSettings.ui.expandedBrokenFolderPaths),
    )
      ? new Set(settings.ui.expandedBrokenFolderPaths)
      : state.expandedBrokenFolderPaths,
  };
}

function reconcilePreference<Value>(
  current: Value,
  previousOverride: Value | null,
  previousDefault: Value,
  nextOverride: Value | null,
  nextDefault: Value,
): Value {
  if (nextOverride !== null) return nextOverride;
  if (previousOverride !== null || current === previousDefault) return nextDefault;
  return current;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && Array.from(left).every((value) => right.has(value));
}

function createFileTypeOptions(
  translate: (key: MessageKey) => string,
): readonly FileTypeCategoryOption[] {
  return FILE_TYPE_CATEGORIES.map((category) => ({
    id: category.id,
    label: translate(category.labelKey),
    formats: category.families.map((family) => ({
      id: family.id,
      label: translate(family.labelKey),
      extensions: family.extensions,
    })),
  }));
}
