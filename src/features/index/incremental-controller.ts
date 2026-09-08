import type { FileRecord, SourceSnapshot } from "../../core/model";
import {
  makeFileLookupKeys,
  normalizeVaultPath,
} from "../../core/model";
import { AtomicLinkIndexStore } from "./atomic-store";
import type { LinkIndexPort, SourceEvent } from "./ports";
import { raceWithAbort } from "./cancellation";
import { WorkScheduler, type WorkSchedulerOptions } from "../../scheduling/work-scheduler";
import type { IndexChanges } from "../../core/link-index";
import { consumeSteps } from "./consume-steps";

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

export interface IncrementalIndexOptions extends WorkSchedulerOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly onPendingEventCountChange?: (count: number) => void;
  readonly onBatchComplete?: (diagnostics: IncrementalBatchDiagnostics) => void;
  readonly onChanges?: (changes: IndexChanges) => void;
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
  private eventRevision = 0;

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
    this.eventRevision += 1;
    this.notifyPendingEventCount();
    // Revisioning direct paths is cheap even when a note has many incoming links.
    if (event.type === "rename") this.bumpRevision(event.oldPath);
    if (event.path !== null) this.bumpRevision(event.path);
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
        if (affectedSourceCount === null && this.active && this.options.signal?.aborted !== true) {
          this.queuedEvents.unshift(...events);
        }
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
    const indexVersion = index.version;
    const eventRevision = this.eventRevision;
    const scheduler = new WorkScheduler(this.options);
    const affectedPaths = new Set(events.directPaths);
    let nextFiles: readonly FileRecord[] | null = null;
    let fileRecordUpdates: readonly FileRecordUpdate[] = [];

    if (events.namespaceChanged) {
      const previousFiles = index.files;
      nextFiles = await raceWithAbort(this.port.listFiles(scheduler), this.options.signal);
      if (!this.isCurrentEpoch(epoch)) return null;
      const changedLookupKeys = await getChangedLookupKeys(previousFiles, nextFiles, scheduler);
      const changedKeys = new Set(changedLookupKeys);
      await addPaths(affectedPaths, index.iterateSourcePathsByLookupKeys(changedLookupKeys), scheduler);
      for (const file of nextFiles) {
        if (file.lookupKeys.some((key) => changedKeys.has(key))) {
          affectedPaths.add(file.path);
        }
        const pause = scheduler.checkpoint();
        if (pause !== null) await pause;
      }
    } else if (events.modifiedPaths.size > 0) {
      const updates: FileRecordUpdate[] = [];
      for (const path of events.modifiedPaths) {
        updates.push({ path, file: await raceWithAbort(this.port.getFileRecord(path), this.options.signal) });
        const pause = scheduler.checkpoint();
        if (pause !== null) await pause;
        if (!this.isCurrentEpoch(epoch)) return null;
      }
      fileRecordUpdates = updates;
      if (!this.isCurrentEpoch(epoch)) return null;
      for (const update of fileRecordUpdates) {
        const before = index.getFile(update.path);
        const changedLookupKeys = await getChangedLookupKeys(
          before === null ? [] : [before],
          update.file === null ? [] : [update.file],
          scheduler,
        );
        await addPaths(affectedPaths, index.iterateSourcePathsByLookupKeys(changedLookupKeys), scheduler);
        if (update.file !== null && changedLookupKeys.some((key) =>
          update.file?.lookupKeys.includes(key) === true)) {
          affectedPaths.add(update.file.path);
        }
      }
    }

    const updatesByPath = new Map(fileRecordUpdates.map((update) => [update.path, update.file]));
    for (const targetPath of events.changedTargetPaths) {
      const before = index.getFile(targetPath);
      const after = updatesByPath.get(targetPath);
      const targetUnchanged = !events.namespaceChanged && events.modifiedPaths.has(targetPath) &&
        before?.targetFingerprint != null && after?.targetFingerprint != null &&
        before.targetFingerprint === after.targetFingerprint;
      if (!targetUnchanged) {
        await addPaths(affectedPaths, index.iterateSourcePathsByTargetPath(targetPath), scheduler);
        await addPaths(affectedPaths, index.iterateSourcePathsByLookupKeys(makeFileLookupKeys(targetPath)), scheduler);
      }
      const pause = scheduler.checkpoint();
      if (pause !== null) await pause;
    }

    if (events.allMetadataResolved) {
      nextFiles ??= await raceWithAbort(this.port.listFiles(scheduler), this.options.signal);
      for (const file of nextFiles ?? index.files) affectedPaths.add(file.path);
    }

    for (const sourcePath of affectedPaths) this.ensureBatchRevision(sourcePath);
    const nextPaths = nextFiles === null ? null : new Set<string>();
    if (nextPaths !== null) {
      for (const file of nextFiles ?? []) {
        const path = normalizeVaultPath(file.path);
        if (nextPaths.has(path)) throw new Error(`Duplicate file path: ${path}`);
        nextPaths.add(path);
        const pause = scheduler.checkpoint();
        if (pause !== null) await pause;
      }
    }
    const availableSourcePaths = {
      has: (path: string): boolean => nextPaths?.has(path) ??
        (updatesByPath.has(path) ? updatesByPath.get(path) !== null : index.hasFile(path)),
    };
    const builds = await this.buildSnapshots(
      Array.from(affectedPaths),
      availableSourcePaths,
      epoch,
      scheduler,
    );
    if (!this.isCurrentEpoch(epoch)) return null;
    const currentBuilds = builds.filter((build) =>
      this.getRevision(build.sourcePath) === build.revision);
    const dependencyPaths = new Set(affectedPaths);
    const dependencyKeys = new Set<string>();
    for (const build of builds) {
      for (const occurrence of build.snapshot?.occurrences ?? []) {
        if (occurrence.targetPath !== null) dependencyPaths.add(occurrence.targetPath);
        dependencyKeys.add(occurrence.lookupKey);
        const pause = scheduler.checkpoint();
        if (pause !== null) await pause;
      }
    }
    const staging = index.fork();
    if (nextFiles !== null) {
      fileRecordUpdates = [
        ...Array.from(index.iterateFiles())
          .filter((file) => !availableSourcePaths.has(file.path))
          .map((file) => ({ path: file.path, file: null })),
        ...nextFiles.map((file) => ({ path: file.path, file })),
      ];
    }
    for (const update of fileRecordUpdates) {
      // Remove source contributions in slices before changing its registry entry.
      if (update.file === null) {
        await consumeSteps(staging.replaceSourceSnapshotSteps(update.path, null), scheduler, () => this.isCurrentEpoch(epoch));
      }
      staging.replaceFileRecord(update.path, update.file);
      const pause = scheduler.checkpoint();
      if (pause !== null) await pause;
      if (!this.isCurrentEpoch(epoch)) return null;
    }
    for (const build of currentBuilds) {
      await consumeSteps(staging.replaceSourceSnapshotSteps(build.sourcePath, build.snapshot), scheduler, () => this.isCurrentEpoch(epoch));
      if (!this.isCurrentEpoch(epoch)) return null;
    }
    // A yield can admit new events, a settings policy change, or a lifecycle change.
    // Never expose an obsolete or partially reduced staging index.
    const conflictingEvent = this.eventRevision !== eventRevision && this.queuedEvents.some((event) =>
      event.type !== "modify" || dependencyPaths.has(event.path) ||
      makeFileLookupKeys(event.path).some((key) => dependencyKeys.has(key)));
    if (!this.isCurrentEpoch(epoch) || conflictingEvent ||
      this.store.current !== index || index.version !== indexVersion) return null;
    this.store.publish(staging);
    this.safelyNotify(() => this.options.onChanges?.(staging.changes));
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

  private async buildSnapshots(
    sourcePaths: readonly string[],
    availableSourcePaths: { readonly has: (path: string) => boolean },
    epoch: number,
    scheduler: WorkScheduler,
  ): Promise<readonly SnapshotBuild[]> {
    const builds: SnapshotBuild[] = [];
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (this.isCurrentEpoch(epoch) && nextIndex < sourcePaths.length) {
        const pathIndex = nextIndex;
        nextIndex += 1;
        const sourcePath = sourcePaths[pathIndex];
        if (sourcePath === undefined) continue;
        const revision = this.getRevision(sourcePath);
        const built = availableSourcePaths.has(sourcePath)
          ? await raceWithAbort(
            this.port.buildSourceSnapshot(sourcePath, scheduler),
            this.options.signal,
          )
          : null;
        if (!this.isCurrentEpoch(epoch)) return;
        builds[pathIndex] = { sourcePath, revision, snapshot: built };
        const pause = scheduler.checkpoint();
        if (pause !== null) await pause;
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(this.concurrency, Math.max(1, sourcePaths.length)) },
      worker,
    ));
    return builds;
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
    return this.active && this.lifecycleEpoch === epoch &&
      this.options.signal?.aborted !== true;
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

async function getChangedLookupKeys(
  previousFiles: readonly FileRecord[],
  nextFiles: readonly FileRecord[],
  scheduler: WorkScheduler,
): Promise<readonly string[]> {
  const previous = new Map<string, FileRecord>();
  const next = new Map<string, FileRecord>();
  for (const [files, map] of [[previousFiles, previous], [nextFiles, next]] as const) {
    for (const file of files) {
      map.set(file.path, file);
      const pause = scheduler.checkpoint();
      if (pause !== null) await pause;
    }
  }
  const changed = new Set<string>();
  for (const path of new Set([...previous.keys(), ...next.keys()])) {
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
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

async function addPaths(target: Set<string>, values: Iterable<string>, scheduler: WorkScheduler): Promise<void> {
  for (const value of values) {
    target.add(value);
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
  }
}
