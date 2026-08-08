import type { FileRecord, SourceSnapshot } from "../../core/model";
import {
  makeFileLookupKeys,
  normalizeVaultPath,
} from "../../core/model";
import { AtomicLinkIndexStore } from "./atomic-store";
import type { LinkIndexPort, SourceEvent } from "./ports";

interface CoalescedEvents {
  readonly directPaths: ReadonlySet<string>;
  readonly changedTargetPaths: ReadonlySet<string>;
  readonly modifiedPaths: ReadonlySet<string>;
  readonly namespaceChanged: boolean;
  readonly allMetadataResolved: boolean;
}

interface FileRecordUpdate {
  readonly path: string;
  readonly file: FileRecord | null;
}

interface SnapshotBuild {
  readonly sourcePath: string;
  readonly revision: number;
  readonly snapshot: SourceSnapshot | null;
}

export interface IncrementalIndexOptions {
  readonly concurrency?: number;
  readonly now?: () => number;
  readonly onPendingEventCountChange?: (count: number) => void;
  readonly onBatchComplete?: (diagnostics: IncrementalBatchDiagnostics) => void;
}

export interface IncrementalBatchDiagnostics {
  readonly completedAt: number;
  readonly durationMs: number;
  readonly eventCount: number;
  readonly affectedSourceCount: number;
}

export class IncrementalIndexController {
  private active = false;
  private lifecycleEpoch = 0;
  private readonly revisions = new Map<string, number>();
  private queuedEvents: SourceEvent[] = [];
  private drainPromise: Promise<void> | null = null;
  private readonly concurrency: number;
  private readonly now: () => number;
  private readonly options: IncrementalIndexOptions;
  private activeEventCount = 0;

  public constructor(
    private readonly port: LinkIndexPort,
    private readonly store: AtomicLinkIndexStore,
    options: IncrementalIndexOptions = {},
  ) {
    this.options = options;
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
    this.now = options.now ?? Date.now;
  }

  public get epoch(): number {
    return this.lifecycleEpoch;
  }

  public get pendingEventCount(): number {
    return this.queuedEvents.length + this.activeEventCount;
  }

  public start(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycleEpoch += 1;
  }

  public stop(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycleEpoch += 1;
    this.queuedEvents = [];
    this.activeEventCount = 0;
    this.notifyPendingEventCount();
  }

  public enqueue(eventInput: SourceEvent): void {
    if (!this.active) throw new Error("Incremental index controller is not active.");
    const event = normalizeEvent(eventInput);
    this.queuedEvents.push(event);
    this.notifyPendingEventCount();
    for (const path of this.getImmediatelyAffectedPaths(event)) this.bumpRevision(path);
    this.scheduleDrain();
  }

  public async whenIdle(): Promise<void> {
    while (this.drainPromise !== null || this.queuedEvents.length > 0) {
      const pending = this.drainPromise;
      if (pending !== null) await pending;
      else this.scheduleDrain();
    }
  }

  private scheduleDrain(): void {
    if (this.drainPromise !== null || !this.active) return;
    this.drainPromise = Promise.resolve()
      .then(async () => this.drain())
      .finally(() => {
        this.drainPromise = null;
        if (this.active && this.queuedEvents.length > 0) this.scheduleDrain();
      });
  }

  private async drain(): Promise<void> {
    while (this.active && this.queuedEvents.length > 0) {
      const events = this.queuedEvents;
      this.queuedEvents = [];
      this.activeEventCount = events.length;
      this.notifyPendingEventCount();
      const startedAt = this.now();
      try {
        const affectedSourceCount = await this.applyBatch(coalesceEvents(events));
        if (affectedSourceCount !== null && this.active) {
          const completedAt = this.now();
          this.safelyNotify(() => this.options.onBatchComplete?.(Object.freeze({
            completedAt,
            durationMs: Math.max(0, completedAt - startedAt),
            eventCount: events.length,
            affectedSourceCount,
          })));
        }
      } finally {
        this.activeEventCount = 0;
        this.notifyPendingEventCount();
      }
    }
  }

  private async applyBatch(events: CoalescedEvents): Promise<number | null> {
    const epoch = this.lifecycleEpoch;
    const index = this.store.current;
    const affectedPaths = new Set(events.directPaths);
    let nextFiles: readonly FileRecord[] | null = null;
    let fileRecordUpdates: readonly FileRecordUpdate[] = [];

    for (const targetPath of events.changedTargetPaths) {
      addAll(affectedPaths, index.getSourcePathsByTargetPath(targetPath));
      addAll(affectedPaths, index.getSourcePathsByLookupKeys(makeFileLookupKeys(targetPath)));
    }

    if (events.namespaceChanged) {
      const previousFiles = index.files;
      nextFiles = await this.port.listFiles();
      if (!this.isCurrentEpoch(epoch)) return null;
      const changedLookupKeys = getChangedLookupKeys(previousFiles, nextFiles);
      addAll(affectedPaths, index.getSourcePathsByLookupKeys(changedLookupKeys));
      for (const file of nextFiles) {
        if (changedLookupKeys.some((key) => file.lookupKeys.includes(key))) {
          affectedPaths.add(file.path);
        }
      }
    } else if (events.modifiedPaths.size > 0) {
      fileRecordUpdates = await Promise.all(Array.from(events.modifiedPaths, async (path) => ({
        path,
        file: await this.port.getFileRecord(path),
      })));
      if (!this.isCurrentEpoch(epoch)) return null;
      for (const update of fileRecordUpdates) {
        const before = index.getFile(update.path);
        const changedLookupKeys = getChangedLookupKeys(
          before === null ? [] : [before],
          update.file === null ? [] : [update.file],
        );
        addAll(affectedPaths, index.getSourcePathsByLookupKeys(changedLookupKeys));
        if (update.file !== null && changedLookupKeys.some((key) =>
          update.file?.lookupKeys.includes(key) === true)) {
          affectedPaths.add(update.file.path);
        }
      }
    }

    if (events.allMetadataResolved) {
      for (const file of nextFiles ?? index.files) affectedPaths.add(file.path);
    }

    for (const sourcePath of affectedPaths) this.ensureBatchRevision(sourcePath);
    const availableSourcePaths = new Set((nextFiles ?? index.files).map(({ path }) => path));
    if (nextFiles === null) {
      for (const update of fileRecordUpdates) {
        if (update.file === null) availableSourcePaths.delete(update.path);
        else availableSourcePaths.add(update.file.path);
      }
    }
    const builds = await this.buildSnapshots(Array.from(affectedPaths), availableSourcePaths);
    if (!this.isCurrentEpoch(epoch)) return null;
    const currentBuilds = builds.filter((build) =>
      this.getRevision(build.sourcePath) === build.revision);
    index.validateSourceSnapshotReplacements(currentBuilds, availableSourcePaths);
    // Defer registry mutation until every source build succeeds. This keeps a
    // failed namespace, parse, or reducer validation from partially replacing
    // the last-known-good index.
    if (nextFiles !== null) index.replaceFiles(nextFiles);
    else {
      for (const update of fileRecordUpdates) {
        index.replaceFileRecord(update.path, update.file);
      }
    }
    for (const build of currentBuilds) this.publishIfCurrent(build);
    return currentBuilds.length;
  }

  private notifyPendingEventCount(): void {
    this.safelyNotify(() => this.options.onPendingEventCountChange?.(this.pendingEventCount));
  }

  private safelyNotify(notify: () => void): void {
    try {
      notify();
    } catch {
      // Diagnostics are observational and must never interrupt indexing.
    }
  }

  private publishIfCurrent(build: SnapshotBuild): void {
    if (this.getRevision(build.sourcePath) !== build.revision) return;
    const index = this.store.current;
    if (!index.hasFile(build.sourcePath)) {
      index.replaceSourceSnapshot(build.sourcePath, null);
      return;
    }
    index.replaceSourceSnapshot(build.sourcePath, build.snapshot);
  }

  private async buildSnapshots(
    sourcePaths: readonly string[],
    availableSourcePaths: ReadonlySet<string>,
  ): Promise<readonly SnapshotBuild[]> {
    const builds: SnapshotBuild[] = [];
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < sourcePaths.length) {
        const pathIndex = nextIndex;
        nextIndex += 1;
        const sourcePath = sourcePaths[pathIndex];
        if (sourcePath === undefined) continue;
        const revision = this.getRevision(sourcePath);
        const built = availableSourcePaths.has(sourcePath)
          ? await this.port.buildSourceSnapshot(sourcePath)
          : null;
        builds[pathIndex] = { sourcePath, revision, snapshot: built };
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(this.concurrency, Math.max(1, sourcePaths.length)) },
      worker,
    ));
    return builds;
  }

  private getImmediatelyAffectedPaths(event: SourceEvent): ReadonlySet<string> {
    const paths = new Set<string>();
    const index = this.store.current;
    const addPathAndReferences = (path: string): void => {
      paths.add(path);
      addAll(paths, index.getSourcePathsByTargetPath(path));
      addAll(paths, index.getSourcePathsByLookupKeys(makeFileLookupKeys(path)));
    };
    if (event.type === "rename") {
      addPathAndReferences(event.oldPath);
      addPathAndReferences(event.path);
    } else if (event.type === "metadata-resolved") {
      if (event.path === null) {
        for (const snapshot of index.snapshots) paths.add(snapshot.sourcePath);
      } else addPathAndReferences(event.path);
    } else {
      addPathAndReferences(event.path);
    }
    return paths;
  }

  private ensureBatchRevision(path: string): void {
    if (!this.revisions.has(path)) this.bumpRevision(path);
  }

  private bumpRevision(path: string): void {
    this.revisions.set(path, this.getRevision(path) + 1);
  }

  private getRevision(path: string): number {
    return this.revisions.get(path) ?? 0;
  }

  private isCurrentEpoch(epoch: number): boolean {
    return this.active && this.lifecycleEpoch === epoch;
  }
}

function normalizeEvent(event: SourceEvent): SourceEvent {
  if (event.type === "rename") {
    return {
      type: "rename",
      oldPath: normalizeVaultPath(event.oldPath),
      path: normalizeVaultPath(event.path),
    };
  }
  if (event.type === "metadata-resolved") {
    return event.path === null
      ? event
      : { type: "metadata-resolved", path: normalizeVaultPath(event.path) };
  }
  return { type: event.type, path: normalizeVaultPath(event.path) };
}

function coalesceEvents(events: readonly SourceEvent[]): CoalescedEvents {
  const directPaths = new Set<string>();
  const changedTargetPaths = new Set<string>();
  const modifiedPaths = new Set<string>();
  let namespaceChanged = false;
  let allMetadataResolved = false;
  for (const event of events) {
    if (event.type === "rename") {
      directPaths.add(event.oldPath);
      directPaths.add(event.path);
      changedTargetPaths.add(event.oldPath);
      changedTargetPaths.add(event.path);
      namespaceChanged = true;
    } else if (event.type === "metadata-resolved") {
      if (event.path === null) allMetadataResolved = true;
      else {
        directPaths.add(event.path);
        changedTargetPaths.add(event.path);
      }
    } else {
      directPaths.add(event.path);
      changedTargetPaths.add(event.path);
      if (event.type === "modify") modifiedPaths.add(event.path);
      else namespaceChanged = true;
    }
  }
  return {
    directPaths,
    changedTargetPaths,
    modifiedPaths,
    namespaceChanged,
    allMetadataResolved,
  };
}

function getChangedLookupKeys(
  previousFiles: readonly FileRecord[],
  nextFiles: readonly FileRecord[],
): readonly string[] {
  const previous = new Map(previousFiles.map((file) => [file.path, file]));
  const next = new Map(nextFiles.map((file) => [file.path, file]));
  const changed = new Set<string>();
  for (const path of new Set([...previous.keys(), ...next.keys()])) {
    const before = previous.get(path);
    const after = next.get(path);
    if (before !== undefined && after !== undefined && sameLookupKeys(before, after)) continue;
    for (const key of before?.lookupKeys ?? []) changed.add(key);
    for (const key of after?.lookupKeys ?? []) changed.add(key);
    if (before === undefined || after === undefined) {
      for (const key of makeFileLookupKeys(path)) changed.add(key);
    }
  }
  return Array.from(changed);
}

function sameLookupKeys(left: FileRecord, right: FileRecord): boolean {
  if (left.lookupKeys.length !== right.lookupKeys.length) return false;
  const rightKeys = new Set(right.lookupKeys);
  return left.lookupKeys.every((key) => rightKeys.has(key));
}

function addAll(target: Set<string>, values: Iterable<string>): void {
  for (const value of values) target.add(value);
}
