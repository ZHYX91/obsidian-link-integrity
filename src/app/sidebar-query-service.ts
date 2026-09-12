import { classifyFileExtension, createPeriodicExpectedIsolationRules, type LinkIndex, type IndexChanges } from "../core";
import {
  createIsolatedFileProjection,
  queryBrokenLinks,
  diagnoseOccurrence,
  type BrokenLinkDiagnostic,
  type IsolatedFileResult as CoreIsolatedFileResult,
} from "../features/queries";
import type { LinkIntegritySettings } from "../shared/settings";
import { IgnoreService } from "../shared/ignore-rules";
import { WorkScheduler } from "../scheduling/work-scheduler";
import { sortSteps } from "../scheduling/sort-steps";
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
  private brokenPaths: Set<string> | null = null;
  private isolatedPaths: Set<string> | null = null;
  private resultsRevision = 0;
  private preparationGeneration = 0;
  private pendingPreparation: {
    tab: SidebarTabId; revision: number; promise: Promise<boolean>;
  } | null = null;
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
      const items = this.computeBrokenLinks(this.brokenPaths);
      this.brokenLinks = this.brokenPaths === null ? items : mergeResults(
        this.brokenLinks, items, this.brokenPaths, (item) => item.sourcePath, compareBrokenResults,
      );
      this.brokenLinksKnown = true;
      this.brokenLinksDirty = false;
      this.brokenPaths = new Set();
    }
    if (activeTab === "isolated-files" && this.isolatedFilesDirty) {
      const projection = this.computeIsolatedFiles(this.isolatedPaths);
      this.isolatedFiles = this.isolatedPaths === null ? projection.isolatedFiles : mergeResults(
        this.isolatedFiles, projection.isolatedFiles, this.isolatedPaths,
        (item) => item.path, compareIsolatedResults,
      );
      this.noIncomingFiles = this.isolatedPaths === null ? projection.noIncomingFiles : mergeResults(
        this.noIncomingFiles, projection.noIncomingFiles, this.isolatedPaths,
        (item) => item.path, compareIsolatedResults,
      );
      this.isolatedFilesKnown = true;
      this.isolatedFilesDirty = false;
      this.isolatedPaths = new Set();
    }
    return {
      status: this.status,
      brokenLinks: this.brokenLinks,
      brokenLinksKnown: this.brokenLinksKnown && !this.brokenLinksDirty,
      isolatedFiles: this.isolatedFiles,
      noIncomingFiles: this.noIncomingFiles,
      isolatedFilesKnown: this.isolatedFilesKnown && !this.isolatedFilesDirty,
    };
  };

  /** The host uses this scheduled path; synchronous queries remain useful to pure callers. */
  public readonly prepareSnapshot = (tab: SidebarTabId): Promise<boolean> => {
    const revision = this.resultsRevision;
    const pending = this.pendingPreparation;
    if (pending?.tab === tab && pending.revision === revision) return pending.promise;
    const generation = ++this.preparationGeneration;
    const isCurrent = (): boolean => revision === this.resultsRevision && generation === this.preparationGeneration;
    const scheduler = new WorkScheduler();
    const promise = (async (): Promise<boolean> => {
      const pendingPaths = tab === "broken-links" ? this.brokenPaths : this.isolatedPaths;
      const paths = pendingPaths === null ? null : new Set(pendingPaths);
      const dirty = tab === "broken-links" ? this.brokenLinksDirty : this.isolatedFilesDirty;
      if (!dirty) return true;
      const work = paths ?? filePaths(this.getIndex());
      const broken: BrokenLinkResult[] = [];
      const isolated: IsolatedFileResult[] = [];
      const noIncoming: IsolatedFileResult[] = [];
      const settings = this.getSettings();
      const ignore = new IgnoreService(settings.ignoreRules);
      const index = this.getIndex();
      for (const batch of pathBatches(work)) {
        if (tab === "broken-links") {
          for (const path of batch) {
            for (const occurrence of index.getSourceSnapshot(path)?.occurrences ?? []) {
              const diagnostic = diagnoseOccurrence(occurrence);
              if (diagnostic !== null && this.diagnosticVisible(diagnostic, index, settings, ignore)) {
                broken.push(toBrokenResult(diagnostic));
              }
              const pause = scheduler.checkpoint();
              if (pause !== null) await pause;
              if (!isCurrent()) return false;
            }
          }
        } else {
          const result = this.computeIsolatedFiles(batch);
          isolated.push(...result.isolatedFiles);
          noIncoming.push(...result.noIncomingFiles);
        }
        const pause = scheduler.checkpoint();
        if (pause !== null) await pause;
        if (!isCurrent()) return false;
      }
      const sortedBroken = await scheduledSteps(sortSteps(broken, compareBrokenResults), scheduler, isCurrent);
      if (sortedBroken === null) return false;
      const sortedIsolated = await scheduledSteps(sortSteps(isolated, compareIsolatedResults), scheduler, isCurrent);
      if (sortedIsolated === null) return false;
      const sortedNoIncoming = await scheduledSteps(sortSteps(noIncoming, compareIsolatedResults), scheduler, isCurrent);
      if (sortedNoIncoming === null) return false;
      if (tab === "broken-links") {
        const result = paths === null ? sortedBroken : await scheduledSteps(mergeResultSteps(
          this.brokenLinks, sortedBroken, paths, (item) => item.sourcePath, compareBrokenResults,
        ), scheduler, isCurrent);
        if (result === null || !isCurrent()) return false;
        this.brokenLinks = result;
        this.brokenPaths = new Set();
        this.brokenLinksDirty = false;
        this.brokenLinksKnown = true;
      } else {
        const result = paths === null ? sortedIsolated : await scheduledSteps(mergeResultSteps(
          this.isolatedFiles, sortedIsolated, paths, (item) => item.path, compareIsolatedResults,
        ), scheduler, isCurrent);
        if (result === null) return false;
        const incomingResult = paths === null ? sortedNoIncoming : await scheduledSteps(mergeResultSteps(
          this.noIncomingFiles, sortedNoIncoming, paths, (item) => item.path, compareIsolatedResults,
        ), scheduler, isCurrent);
        if (incomingResult === null || !isCurrent()) return false;
        this.isolatedFiles = result;
        this.noIncomingFiles = incomingResult;
        this.isolatedPaths = new Set();
        this.isolatedFilesDirty = false;
        this.isolatedFilesKnown = true;
      }
      return true;
    })();
    this.pendingPreparation = { tab, revision, promise };
    void promise.finally(() => {
      if (this.pendingPreparation?.promise === promise) this.pendingPreparation = null;
    }).catch(() => undefined);
    return promise;
  };

  public getStatus(): IndexStatus {
    return this.status;
  }

  private computeBrokenLinks(paths: ReadonlySet<string> | null = null): readonly BrokenLinkResult[] {
    const index = this.getIndex();
    const settings = this.getSettings();
    const ignoreService = new IgnoreService(settings.ignoreRules);
    return queryBrokenLinks(index, paths === null ? {} : { sourcePaths: paths })
      .filter((diagnostic) => this.diagnosticVisible(diagnostic, index, settings, ignoreService))
      .map(toBrokenResult);
  }

  private diagnosticVisible(
    diagnostic: BrokenLinkDiagnostic, index: LinkIndex, settings: LinkIntegritySettings, ignore: IgnoreService,
  ): boolean {
    return diagnosticEnabled(diagnostic, settings) && (settings.brokenLinks.showIgnored ||
        !ignore.shouldHideBrokenResult({
          sourcePath: diagnostic.sourcePath,
          targetPath: diagnostic.resolvedTargetPath ?? diagnostic.targetText,
          occurrenceId: diagnostic.id,
          extension: index.getFile(diagnostic.sourcePath)?.extension ?? null,
        }));
  }

  private computeIsolatedFiles(paths: ReadonlySet<string> | null = null): {
    readonly isolatedFiles: readonly IsolatedFileResult[];
    readonly noIncomingFiles: readonly IsolatedFileResult[];
  } {
    const index = this.getIndex();
    const settings = this.getSettings();
    const expectedRules = [
      ...settings.isolatedFiles.expectedRules,
      ...createPeriodicExpectedIsolationRules(settings.isolatedFiles.periodicNotesPreset),
    ];
    const expectedFilePaths = new Set(settings.isolatedFiles.expectedFilePaths);
    const ignoreService = new IgnoreService(settings.ignoreRules);
    const excludedCandidatePaths = settings.isolatedFiles.showIgnored || settings.ignoreRules.length === 0
      ? new Set<string>()
      : new Set((paths === null ? index.files : Array.from(paths)
        .flatMap((path) => index.getFile(path) ?? []))
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
      ...(paths === null ? {} : { paths }),
      candidateScope,
      expectedRules,
      expectedFilePaths,
      includeExpected: true,
      mode: "isolated",
    });
    const noIncoming = settings.isolatedFiles.allowNoIncomingFilter
      ? createIsolatedFileProjection(index, {
        ...(paths === null ? {} : { paths }),
        candidateScope,
        expectedRules,
        expectedFilePaths,
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

  public recordChanges(changes: IndexChanges): void {
    this.resultsRevision += 1;
    for (const path of changes.sourcePaths) {
      this.brokenPaths?.add(path);
      this.isolatedPaths?.add(path);
    }
    for (const path of changes.filePaths) {
      this.brokenPaths?.add(path);
      this.isolatedPaths?.add(path);
    }
    for (const path of changes.graphPaths) this.isolatedPaths?.add(path);
    if (changes.sourcePaths.size > 0 || changes.filePaths.size > 0) this.brokenLinksDirty = true;
    if (changes.sourcePaths.size > 0 || changes.filePaths.size > 0 || changes.graphPaths.size > 0) {
      this.isolatedFilesDirty = true;
    }
  }

  public notifyResults(): void { this.emit(); }

  private invalidateResults(): void {
    this.resultsRevision += 1;
    this.brokenLinksDirty = true;
    this.isolatedFilesDirty = true;
    this.brokenPaths = null;
    this.isolatedPaths = null;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function compareBrokenResults(left: BrokenLinkResult, right: BrokenLinkResult): number {
  return left.sourcePath.localeCompare(right.sourcePath) ||
    (left.location.line ?? Number.MAX_SAFE_INTEGER) - (right.location.line ?? Number.MAX_SAFE_INTEGER) ||
    (left.location.column ?? Number.MAX_SAFE_INTEGER) - (right.location.column ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id);
}

function compareIsolatedResults(left: IsolatedFileResult, right: IsolatedFileResult): number {
  return left.path.localeCompare(right.path);
}

function mergeResults<T>(
  previous: readonly T[], updates: readonly T[], paths: ReadonlySet<string>,
  pathOf: (item: T) => string, compare: (left: T, right: T) => number,
): readonly T[] {
  const steps = mergeResultSteps(previous, updates, paths, pathOf, compare);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

function* mergeResultSteps<T>(
  previous: readonly T[], updates: readonly T[], paths: ReadonlySet<string>,
  pathOf: (item: T) => string, compare: (left: T, right: T) => number,
): Generator<void, readonly T[]> {
  if (paths.size === 0) return previous;
  let affected = 0;
  let unchanged = true;
  for (const item of previous) {
    if (paths.has(pathOf(item))) {
      if (JSON.stringify(item) !== JSON.stringify(updates[affected])) unchanged = false;
      affected += 1;
    }
    yield;
  }
  if (unchanged && affected === updates.length) return previous;
  const result: T[] = [];
  let position = 0;
  for (const item of previous) {
    if (!paths.has(pathOf(item))) {
      while (position < updates.length) {
        const update = updates[position];
        if (update === undefined || compare(update, item) > 0) break;
        result.push(update);
        position += 1;
        yield;
      }
      result.push(item);
    }
    yield;
  }
  for (; position < updates.length; position += 1) {
    const item = updates[position];
    if (item !== undefined) result.push(item);
    yield;
  }
  return result;
}

function* filePaths(index: LinkIndex): Iterable<string> {
  for (const file of index.iterateFiles()) yield file.path;
}

function* pathBatches(paths: Iterable<string>): Iterable<Set<string>> {
  let batch = new Set<string>();
  for (const path of paths) {
    batch.add(path);
    if (batch.size === 32) { yield batch; batch = new Set(); }
  }
  if (batch.size > 0) yield batch;
}

async function scheduledSteps<T>(
  steps: Generator<void, T>, scheduler: WorkScheduler, isCurrent: () => boolean,
): Promise<T | null> {
  let step = steps.next();
  while (!step.done) {
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    if (!isCurrent()) return null;
    step = steps.next();
  }
  return isCurrent() ? step.value : null;
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
