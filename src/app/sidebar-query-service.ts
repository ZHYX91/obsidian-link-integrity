import { classifyFileExtension, createPeriodicExpectedIsolationRules, type LinkIndex } from "../core";
import {
  createIsolatedFileProjection,
  queryBrokenLinks,
  type BrokenLinkDiagnostic,
  type IsolatedFileResult as CoreIsolatedFileResult,
} from "../features/queries";
import type { LinkIntegritySettings } from "../shared/settings";
import { IgnoreService } from "../shared/ignore-rules";
import type {
  BrokenLinkResult,
  IndexStatus,
  IsolatedFileResult,
  SidebarQueryPort,
  SidebarQuerySnapshot,
  SidebarTabId,
} from "../ui/sidebar";

export class SidebarQueryService implements SidebarQueryPort {
  private readonly listeners = new Set<() => void>();
  private brokenLinks: readonly BrokenLinkResult[] = [];
  private isolatedFiles: readonly IsolatedFileResult[] = [];
  private noIncomingFiles: readonly IsolatedFileResult[] = [];
  private brokenLinksKnown = false;
  private isolatedFilesKnown = false;
  private brokenLinksDirty = true;
  private isolatedFilesDirty = true;
  private status: IndexStatus = {
    state: "idle",
    current: 0,
    total: 0,
    errorMessage: null,
  };

  public constructor(
    private readonly getIndex: () => LinkIndex,
    private readonly getSettings: () => LinkIntegritySettings,
  ) {}

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly getSnapshot = (
    activeTab: SidebarTabId | null = null,
  ): SidebarQuerySnapshot => {
    if (activeTab === "broken-links" && this.brokenLinksDirty) {
      this.brokenLinks = this.computeBrokenLinks();
      this.brokenLinksKnown = true;
      this.brokenLinksDirty = false;
    }
    if (activeTab === "isolated-files" && this.isolatedFilesDirty) {
      const projection = this.computeIsolatedFiles();
      this.isolatedFiles = projection.isolatedFiles;
      this.noIncomingFiles = projection.noIncomingFiles;
      this.isolatedFilesKnown = true;
      this.isolatedFilesDirty = false;
    }
    return {
      status: this.status,
      brokenLinks: this.brokenLinks,
      brokenLinksKnown: this.brokenLinksKnown,
      isolatedFiles: this.isolatedFiles,
      noIncomingFiles: this.noIncomingFiles,
      isolatedFilesKnown: this.isolatedFilesKnown,
    };
  };

  public getStatus(): IndexStatus {
    return this.status;
  }

  private computeBrokenLinks(): readonly BrokenLinkResult[] {
    const index = this.getIndex();
    const settings = this.getSettings();
    const ignoreService = new IgnoreService(settings.ignoreRules);
    return queryBrokenLinks(index)
      .filter((diagnostic) => diagnosticEnabled(diagnostic, settings))
      .filter((diagnostic) => settings.brokenLinks.showIgnored ||
        !ignoreService.shouldHideBrokenResult({
          sourcePath: diagnostic.sourcePath,
          targetPath: diagnostic.resolvedTargetPath ?? diagnostic.targetText,
          occurrenceId: diagnostic.id,
          extension: index.getFile(diagnostic.sourcePath)?.extension ?? null,
        }))
      .map(toBrokenResult);
  }

  private computeIsolatedFiles(): {
    readonly isolatedFiles: readonly IsolatedFileResult[];
    readonly noIncomingFiles: readonly IsolatedFileResult[];
  } {
    const index = this.getIndex();
    const settings = this.getSettings();
    const expectedRules = [
      ...settings.isolatedFiles.expectedRules,
      ...createPeriodicExpectedIsolationRules(settings.isolatedFiles.periodicNotesPreset),
    ];
    const ignoreService = new IgnoreService(settings.ignoreRules);
    const excludedCandidatePaths = settings.isolatedFiles.showIgnored || settings.ignoreRules.length === 0
      ? new Set<string>()
      : new Set(index.files
        .filter((file) => {
          const classification = classifyFileExtension(file.path);
          return ignoreService.shouldExcludeIsolatedCandidate({
            candidatePath: file.path,
            formatFamilyIds: classification.familyIds,
            extension: file.extension,
          });
        })
        .map(({ path }) => path));
    const candidateScope = {
      familyIds: new Set(settings.isolatedFiles.candidateFormatFamilyIds),
      customExtensions: new Set(settings.isolatedFiles.customExtensions),
      excludedPaths: excludedCandidatePaths,
    };
    const isolated = createIsolatedFileProjection(index, {
      candidateScope,
      expectedRules,
      includeExpected: true,
      mode: "isolated",
    });
    const noIncoming = settings.isolatedFiles.allowNoIncomingFilter
      ? createIsolatedFileProjection(index, {
        candidateScope,
        expectedRules,
        includeExpected: true,
        mode: "no-incoming",
      })
      : null;
    return {
      isolatedFiles: isolated.items.map(toIsolatedResult),
      noIncomingFiles: noIncoming?.items.map(toIsolatedResult) ?? [],
    };
  }

  public setStatus(status: IndexStatus, invalidateResults = false): void {
    this.status = status;
    if (invalidateResults) this.invalidateResults();
    this.emit();
  }

  public setProgress(current: number, total: number): void {
    this.status = { state: "scanning", current, total, errorMessage: null };
    this.emit();
  }

  public notify(): void {
    this.invalidateResults();
    this.emit();
  }

  private invalidateResults(): void {
    this.brokenLinksDirty = true;
    this.isolatedFilesDirty = true;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function diagnosticEnabled(
  diagnostic: BrokenLinkDiagnostic,
  settings: LinkIntegritySettings,
): boolean {
  switch (diagnostic.reason) {
    case "missing-file":
      return settings.brokenLinks.diagnostics.missingFiles;
    case "missing-heading":
      return settings.brokenLinks.diagnostics.missingHeadings;
    case "missing-block":
      return settings.brokenLinks.diagnostics.missingBlocks;
    case "invalid":
      return settings.brokenLinks.diagnostics.invalidLinks;
  }
}

function toBrokenResult(diagnostic: BrokenLinkDiagnostic): BrokenLinkResult {
  return {
    id: diagnostic.id,
    sourcePath: diagnostic.sourcePath,
    targetText: diagnostic.targetText,
    resolvedTargetPath: diagnostic.resolvedTargetPath,
    rawText: diagnostic.raw,
    context: diagnostic.raw,
    reason: diagnostic.reason,
    location: {
      line: diagnostic.occurrence.position?.line ?? null,
      column: diagnostic.occurrence.position?.column ?? null,
      property: diagnostic.occurrence.position?.property ?? null,
      canvasNodeId: diagnostic.occurrence.position?.canvasNodeId ?? null,
    },
  };
}

function toIsolatedResult(result: CoreIsolatedFileResult): IsolatedFileResult {
  return {
    path: result.path,
    formatFamilyId: result.formatFamilyId,
    formatFamilyIds: result.formatFamilyIds,
    modifiedAt: result.modifiedAt,
    brokenOutgoingCount: result.brokenOutgoingCount,
    incomingCount: result.incomingCount,
    outgoingCount: result.outgoingCount,
    expectation: result.classification === "expected-isolated"
      ? { kind: "expected", ruleIds: result.expectedRuleIds }
      : { kind: "unexpected", ruleIds: [] },
  };
}
