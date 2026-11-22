import { isBrokenDiagnosticVisible } from "./broken-link-visibility";
import { classifyFileExtension, createPeriodicExpectedIsolationRules, type LinkIndex, type IndexChanges } from "../core";
import {
  createIsolatedFileProjector,
  filesAtPaths,
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
  private readonly pendingPreparations = new Map<SidebarTabId, {
    revision: number; promise: Promise<boolean>;
  }>();
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
    if (activeTab !== null && this.isDirty(activeTab)) {
      const steps = this.prepareTab(activeTab);
      while (!steps.next().done) { /* Synchronous callers use the same projection as the mounted sidebar. */ }
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
    if (!this.isDirty(tab)) return Promise.resolve(true);
    const revision = this.resultsRevision;
    const pending = this.pendingPreparations.get(tab);
    if (pending?.revision === revision) return pending.promise;
    const promise = this.runPreparation(tab, revision);
    this.pendingPreparations.set(tab, { revision, promise });
    void promise.finally(() => {
      if (this.pendingPreparations.get(tab)?.promise === promise) this.pendingPreparations.delete(tab);
    }).catch(() => undefined);
    return promise;
  };

  public getStatus(): IndexStatus {
    return this.status;
  }

  private async runPreparation(tab: SidebarTabId, revision: number): Promise<boolean> {
    const scheduler = new WorkScheduler();
    const steps = this.prepareTab(tab);
    let step = steps.next();
    while (!step.done) {
      const pause = scheduler.checkpoint();
      if (pause !== null) {
        await pause;
        if (revision !== this.resultsRevision) return false;
        // A synchronous reader can finish this revision while the scheduled reader yields.
        if (!this.isDirty(tab)) return true;
      }
      step = steps.next();
    }
    return true;
  }

  private isDirty(tab: SidebarTabId): boolean {
    return tab === "broken-links" ? this.brokenLinksDirty : this.isolatedFilesDirty;
  }

  private prepareTab(tab: SidebarTabId): Generator<void> {
    return tab === "broken-links" ? this.prepareBrokenLinks() : this.prepareIsolatedFiles();
  }

  private *prepareBrokenLinks(): Generator<void> {
    const paths = this.brokenPaths === null ? null : new Set(this.brokenPaths);
    const index = this.getIndex();
    const settings = this.getSettings();
    const ignore = new IgnoreService(settings.ignoreRules);
    const broken: BrokenLinkResult[] = [];
    const occurrences = paths === null ? index.iterateOccurrences() : changedOccurrences(index, paths);
    for (const occurrence of occurrences) {
      const diagnostic = occurrence && diagnoseOccurrence(occurrence);
      if (diagnostic && isBrokenDiagnosticVisible(diagnostic, index, settings, ignore)) {
        broken.push(toBrokenResult(diagnostic));
      }
      yield;
    }
    const sorted = yield* sortSteps(broken, compareBrokenResults);
    this.brokenLinks = paths === null ? sorted : yield* mergeResultSteps(
      this.brokenLinks, sorted, paths, (item) => item.sourcePath, compareBrokenResults,
    );
    this.brokenPaths = new Set();
    this.brokenLinksDirty = false;
    this.brokenLinksKnown = true;
  }

  private *prepareIsolatedFiles(): Generator<void> {
    const index = this.getIndex();
    const settings = this.getSettings();
    const options = settings.isolatedFiles;
    const paths = this.isolatedPaths === null ? null : new Set(this.isolatedPaths);
    const ignore = !options.showIgnored && settings.ignoreRules.length > 0 ? new IgnoreService(settings.ignoreRules) : null;
    const project = createIsolatedFileProjector(index, {
      mode: options.allowNoIncomingFilter ? "no-incoming" : "isolated",
      candidateScope: {
        familyIds: new Set(options.candidateFormatFamilyIds), customExtensions: new Set(options.customExtensions),
      },
      expectedRules: [...options.expectedRules, ...createPeriodicExpectedIsolationRules(options.periodicNotesPreset)],
      expectedFilePaths: new Set(options.expectedFilePaths),
    });
    const items: IsolatedFileResult[] = [];
    const files = paths === null ? index.iterateFiles() : filesAtPaths(index, paths);
    for (const file of files) {
      if (!ignore?.shouldExcludeIsolatedCandidate({
        candidatePath: file.path, extension: file.extension, formatFamilyIds: classifyFileExtension(file.extension).familyIds,
      })) {
        const item = project(file);
        if (item !== null) items.push(toIsolatedResult(item));
      }
      yield;
    }
    const sorted = yield* sortSteps(items, compareIsolatedResults);
    let isolated = sorted;
    if (options.allowNoIncomingFilter) {
      isolated = [];
      for (const item of sorted) {
        if (item.outgoingCount === 0) isolated.push(item);
        yield;
      }
    }
    const noIncoming = options.allowNoIncomingFilter ? sorted : [];
    const isolatedFiles = paths === null ? isolated : yield* mergeResultSteps(
      this.isolatedFiles, isolated, paths, (item) => item.path, compareIsolatedResults,
    );
    const noIncomingFiles = paths === null ? noIncoming : yield* mergeResultSteps(
      this.noIncomingFiles, noIncoming, paths, (item) => item.path, compareIsolatedResults,
    );
    // Publish both lists together after the final scheduling checkpoint.
    this.isolatedFiles = isolatedFiles;
    this.noIncomingFiles = noIncomingFiles;
    this.isolatedPaths = new Set();
    this.isolatedFilesDirty = false;
    this.isolatedFilesKnown = true;
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

  public notifyResults(): void {
    if (this.status.state !== "idle") this.emit();
  }

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

/** Empty or deleted sources still yield a checkpoint during a large incremental update. */
function* changedOccurrences(index: LinkIndex, paths: Iterable<string>) {
  for (const path of paths) {
    const occurrences = index.getSourceSnapshot(path)?.occurrences;
    if (occurrences?.length) yield* occurrences;
    else yield null;
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
      ...(diagnostic.occurrence.kind === "frontmatter" ? { inFrontmatter: true as const } : {}),
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
