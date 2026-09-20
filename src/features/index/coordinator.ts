import { LinkIndex } from "../../core/link-index";
import type { GraphContributionPolicy } from "../../core/scopes";
import { WorkScheduler } from "../../scheduling/work-scheduler";
import { AtomicLinkIndexStore } from "./atomic-store";
import {
  FullRebuildController,
  type FullRebuildOptions,
  type FullRebuildResult,
} from "./full-rebuild";
import {
  IncrementalIndexController,
  type IncrementalBatchDiagnostics,
  type IncrementalIndexOptions,
} from "./incremental-controller";
import { consumeSteps } from "./consume-steps";
import type { LinkIndexPort, SourceEvent } from "./ports";

export type LinkIndexCoordinatorState = "idle" | "ready" | "rebuilding" | "stale" | "failed";

export interface CompletedIndexOperationDiagnostics {
  readonly completedAt: number;
  readonly durationMs: number;
}

export interface FullRebuildDiagnostics extends CompletedIndexOperationDiagnostics {
  readonly fileCount: number;
  readonly sourceCount: number;
  readonly occurrenceCount: number;
}

export interface IncrementalUpdateDiagnostics extends CompletedIndexOperationDiagnostics {
  readonly eventCount: number;
  readonly affectedSourceCount: number;
}

export interface IndexDiagnosticsSnapshot {
  readonly fileCount: number;
  readonly sourceCount: number;
  readonly occurrenceCount: number;
  readonly pendingEventCount: number;
  readonly lastFullRebuild: FullRebuildDiagnostics | null;
  readonly lastIncrementalUpdate: IncrementalUpdateDiagnostics | null;
}

export class RebuildCancelledError extends Error {
  public constructor() {
    super("Full rebuild was cancelled by a lifecycle change.");
    this.name = "RebuildCancelledError";
  }
}

export class LinkIndexCoordinator {
  public readonly store: AtomicLinkIndexStore;
  private incremental: IncrementalIndexController;
  private readonly rebuildController: FullRebuildController;
  private bufferedEvents: SourceEvent[] = [];
  private rebuilding = false;
  private active = false;
  private stateValue: LinkIndexCoordinatorState = "idle";
  private errorValue: unknown = null;
  private rebuildPromise: Promise<FullRebuildResult> | null = null;
  private rebuildEpoch = -1;
  private rebuildOperation = 0;
  private rebuildAbortController: AbortController | null = null;
  private readonly incrementalOptions: IncrementalIndexOptions;
  private readonly now: () => number;
  private lifecycleEpoch = 0;
  private diagnosticsValue: IndexDiagnosticsSnapshot;
  private readonly diagnosticsListeners = new Set<(snapshot: IndexDiagnosticsSnapshot) => void>();
  private graphContributionPolicy: GraphContributionPolicy;
  private regraphRevision = 0;
  private regraphPromise: Promise<void> | null = null;

  public constructor(
    private readonly port: LinkIndexPort,
    initialIndex: LinkIndex = new LinkIndex(),
    rebuildOptions: FullRebuildOptions = {},
    incrementalOptions: IncrementalIndexOptions = {},
  ) {
    this.incrementalOptions = incrementalOptions;
    this.now = rebuildOptions.now ?? incrementalOptions.now ?? Date.now;
    this.store = new AtomicLinkIndexStore(initialIndex);
    this.graphContributionPolicy = initialIndex.graphContributionPolicy;
    this.diagnosticsValue = Object.freeze({
      ...initialIndex.getStatistics(),
      pendingEventCount: 0,
      lastFullRebuild: null,
      lastIncrementalUpdate: null,
    });
    this.incremental = this.createIncrementalController();
    this.rebuildController = new FullRebuildController(port, this.store, rebuildOptions);
  }

  public get index(): LinkIndex {
    return this.store.current;
  }

  public get state(): LinkIndexCoordinatorState {
    return this.stateValue;
  }

  public get error(): unknown {
    return this.errorValue;
  }

  public get diagnostics(): IndexDiagnosticsSnapshot {
    return this.diagnosticsValue;
  }

  public subscribeDiagnostics(
    listener: (snapshot: IndexDiagnosticsSnapshot) => void,
  ): () => void {
    this.diagnosticsListeners.add(listener);
    return () => this.diagnosticsListeners.delete(listener);
  }

  public regraph(policy: GraphContributionPolicy): Promise<void> {
    this.graphContributionPolicy = policy;
    this.regraphRevision += 1;
    if (!this.active) {
      this.store.current.setGraphContributionPolicy(policy);
      return Promise.resolve();
    }
    return this.ensureGraphPolicy();
  }

  public start(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycleEpoch += 1;
    this.incremental.start();
    if (this.store.current.graphContributionPolicy !== this.graphContributionPolicy) {
      void this.ensureGraphPolicy().catch(() => undefined);
    }
  }

  public stop(): void {
    this.active = false;
    this.lifecycleEpoch += 1;
    this.regraphRevision += 1;
    this.rebuildAbortController?.abort(new RebuildCancelledError());
    this.incremental.stop();
    this.bufferedEvents = [];
    this.rebuilding = false;
    this.stateValue = "idle";
  }

  public enqueue(event: SourceEvent): void {
    if (!this.active) throw new Error("Link index coordinator is not active.");
    if (this.rebuilding) this.bufferedEvents.push(event);
    else this.incremental.enqueue(event);
  }

  public rebuild(): Promise<FullRebuildResult> {
    if (!this.active) throw new Error("Link index coordinator is not active.");
    if (this.rebuildPromise !== null) {
      if (this.rebuildEpoch === this.lifecycleEpoch) return this.rebuildPromise;
      const obsolete = this.rebuildPromise;
      return obsolete.catch(() => undefined).then(() => this.rebuild());
    }
    const epoch = this.lifecycleEpoch;
    const operation = this.rebuildOperation + 1;
    this.rebuildOperation = operation;
    const abortController = new AbortController();
    this.rebuildEpoch = epoch;
    this.rebuildAbortController = abortController;
    const request = this.performRebuild(operation, epoch, abortController.signal);
    this.rebuildPromise = request;
    void request.then(
      () => this.finishRebuildOperation(request, operation),
      () => this.finishRebuildOperation(request, operation),
    );
    return request;
  }

  private async performRebuild(
    operation: number,
    epoch: number,
    signal: AbortSignal,
  ): Promise<FullRebuildResult> {
    const startedAt = this.now();
    this.rebuilding = true;
    this.stateValue = "rebuilding";
    this.errorValue = null;
    try {
      await this.incremental.whenIdle();
      // Once rebuilding is true, any in-flight policy staging is unable to
      // publish. The full rebuild starts from the latest desired policy and
      // synchronizes it again immediately before publication, so waiting for
      // that obsolete staging here would only create a dependency cycle.
      this.incremental.stop();
      this.assertCurrentLifecycle(epoch);
      let staging = await this.rebuildController.buildStaging(
        this.graphContributionPolicy,
        signal,
      );
      this.assertCurrentLifecycle(epoch);
      staging = await this.replayBufferedEvents(staging, signal);
      this.assertCurrentLifecycle(epoch);
      staging = await this.synchronizeStagingPolicy(staging, epoch, signal);
      this.assertCurrentLifecycle(epoch);
      const result = this.rebuildController.publish(staging);
      this.stateValue = "ready";
      const completedAt = this.now();
      const statistics = result.index.getStatistics();
      this.updateDiagnostics({
        ...statistics,
        lastFullRebuild: Object.freeze({
          ...statistics,
          completedAt,
          durationMs: Math.max(0, completedAt - startedAt),
        }),
      });
      return result;
    } catch (error) {
      if (error instanceof RebuildCancelledError) {
        if (this.isCurrentOperation(operation, epoch)) {
          this.errorValue = null;
          this.stateValue = this.store.generation > 0 ? "ready" : "idle";
        }
        throw error;
      }
      if (this.isCurrentOperation(operation, epoch)) {
        this.errorValue = error;
        this.stateValue = this.store.generation > 0 ? "stale" : "failed";
      }
      throw error;
    } finally {
      if (this.isCurrentOperation(operation, epoch)) {
        const remaining = this.bufferedEvents;
        this.bufferedEvents = [];
        this.rebuilding = false;
        this.incremental.stop();
        this.incremental = this.createIncrementalController();
        if (this.active) {
          this.incremental.start();
          // A failed first baseline has no trustworthy graph onto which events
          // can be applied. The next rebuild reads current Vault state in full.
          // With a published baseline, remaining events still update the
          // last-known-good index while its status remains stale.
          if (this.store.generation > 0 || this.stateValue !== "failed") {
            for (const event of remaining) this.incremental.enqueue(event);
          }
          if (this.store.current.graphContributionPolicy !== this.graphContributionPolicy) {
            void this.ensureGraphPolicy().catch(() => undefined);
          }
        }
      }
    }
  }

  public async whenIdle(): Promise<void> {
    while (true) {
      const pendingRebuild = this.rebuildPromise;
      if (pendingRebuild !== null) await pendingRebuild;
      await this.incremental.whenIdle();
      const pendingRegraph = this.regraphPromise;
      if (pendingRegraph === null && this.rebuildPromise === null) return;
      await pendingRegraph;
    }
  }

  private ensureGraphPolicy(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.rebuilding || this.rebuildPromise !== null) {
      const rebuilding = this.rebuildPromise;
      return (rebuilding === null ? Promise.resolve() : rebuilding.catch(() => undefined))
        .then(() => this.ensureGraphPolicy());
    }
    if (this.store.current.graphContributionPolicy === this.graphContributionPolicy) {
      return Promise.resolve();
    }
    if (this.regraphPromise !== null) return this.regraphPromise;

    const request = this.performRegraph();
    let tracked: Promise<void>;
    tracked = request.then(
      () => {
        if (this.regraphPromise === tracked) this.regraphPromise = null;
        return this.ensureGraphPolicy();
      },
      (error: unknown) => {
        if (this.regraphPromise === tracked) this.regraphPromise = null;
        throw error;
      },
    );
    // Track the complete policy-settling operation, not only one staging pass.
    // Callers awaiting regraph() and whenIdle() now observe the same boundary.
    this.regraphPromise = tracked;
    return tracked;
  }

  private async performRegraph(): Promise<void> {
    while (this.active && !this.rebuilding) {
      const base = this.store.current;
      const policy = this.graphContributionPolicy;
      if (base.graphContributionPolicy === policy) return;
      const revision = this.regraphRevision;
      const scheduler = new WorkScheduler(this.incrementalOptions);
      const isCurrent = (): boolean => this.active && !this.rebuilding &&
        this.regraphRevision === revision && this.store.current === base &&
        this.graphContributionPolicy === policy;
      const staging = await this.materializePolicy(base, policy, scheduler, isCurrent);
      if (staging === null) {
        if (!this.active || this.rebuilding) return;
        continue;
      }
      if (!isCurrent()) continue;
      this.store.publish(staging);
      this.notifyGraphChanged(staging);
      this.updateDiagnostics(staging.getStatistics());
      if (this.graphContributionPolicy === policy) return;
    }
  }

  private async synchronizeStagingPolicy(
    initial: LinkIndex,
    epoch: number,
    signal: AbortSignal,
  ): Promise<LinkIndex> {
    let staging = initial;
    while (staging.graphContributionPolicy !== this.graphContributionPolicy) {
      const policy = this.graphContributionPolicy;
      const scheduler = new WorkScheduler(this.incrementalOptions);
      const isCurrent = (): boolean => this.active && this.lifecycleEpoch === epoch &&
        signal.aborted !== true && this.graphContributionPolicy === policy;
      const rematerialized = await this.materializePolicy(staging, policy, scheduler, isCurrent);
      if (signal.aborted) throw signal.reason ?? new RebuildCancelledError();
      this.assertCurrentLifecycle(epoch);
      if (rematerialized === null) continue;
      staging = rematerialized;
    }
    return staging;
  }

  private async materializePolicy(
    base: LinkIndex,
    policy: GraphContributionPolicy,
    scheduler: WorkScheduler,
    isCurrent: () => boolean,
  ): Promise<LinkIndex | null> {
    const staging = new LinkIndex([], { contributionPolicy: policy });
    for (const file of base.iterateFiles()) {
      if (!isCurrent()) return null;
      staging.replaceFileRecord(file.path, file);
      const pause = scheduler.checkpoint();
      if (pause !== null) await pause;
    }
    for (const file of base.iterateFiles()) {
      if (!isCurrent()) return null;
      const snapshot = base.getSourceSnapshot(file.path);
      if (snapshot !== null) {
        await consumeSteps(staging.replaceSourceSnapshotSteps(file.path, snapshot), scheduler, isCurrent);
        if (!isCurrent()) return null;
      }
      const pause = scheduler.checkpoint();
      if (pause !== null) await pause;
    }
    return isCurrent() ? staging : null;
  }

  private notifyGraphChanged(index: LinkIndex): void {
    const graphPaths = new Set<string>();
    for (const file of index.iterateFiles()) graphPaths.add(file.path);
    try {
      this.incrementalOptions.onChanges?.({
        sourcePaths: new Set(),
        filePaths: new Set(),
        graphPaths,
      });
    } catch {
      // Query observers are observational and must not interrupt publication.
    }
  }

  private async replayBufferedEvents(
    staging: LinkIndex,
    signal: AbortSignal,
  ): Promise<LinkIndex> {
    const stagingStore = new AtomicLinkIndexStore(staging);
    const replay = new IncrementalIndexController(
      this.port,
      stagingStore,
      {
        ...(this.incrementalOptions.concurrency === undefined
          ? {}
          : { concurrency: this.incrementalOptions.concurrency }),
        signal,
        now: this.incrementalOptions.now ?? this.now,
      },
    );
    replay.start();
    try {
      while (this.bufferedEvents.length > 0) {
        const events = this.bufferedEvents;
        this.bufferedEvents = [];
        for (const event of events) replay.enqueue(event);
        await replay.whenIdle();
      }
      return stagingStore.current;
    } finally {
      replay.stop();
    }
  }

  private assertCurrentLifecycle(epoch: number): void {
    if (!this.active || this.lifecycleEpoch !== epoch) throw new RebuildCancelledError();
  }

  private isCurrentOperation(operation: number, epoch: number): boolean {
    return this.active && this.lifecycleEpoch === epoch &&
      this.rebuildOperation === operation;
  }

  private finishRebuildOperation(
    request: Promise<FullRebuildResult>,
    operation: number,
  ): void {
    if (this.rebuildPromise !== request || this.rebuildOperation !== operation) return;
    this.rebuildPromise = null;
    this.rebuildAbortController = null;
  }

  private createIncrementalController(): IncrementalIndexController {
    return new IncrementalIndexController(this.port, this.store, {
      ...this.incrementalOptions,
      now: this.incrementalOptions.now ?? this.now,
      onPendingEventCountChange: (pendingEventCount) => {
        this.incrementalOptions.onPendingEventCountChange?.(pendingEventCount);
        this.updateDiagnostics({ pendingEventCount });
      },
      onBatchComplete: (diagnostics) => {
        this.incrementalOptions.onBatchComplete?.(diagnostics);
        this.recordIncrementalUpdate(diagnostics);
      },
    });
  }

  private recordIncrementalUpdate(diagnostics: IncrementalBatchDiagnostics): void {
    this.updateDiagnostics({
      ...this.store.current.getStatistics(),
      lastIncrementalUpdate: Object.freeze({ ...diagnostics }),
    });
  }

  private updateDiagnostics(changes: Partial<IndexDiagnosticsSnapshot>): void {
    const next = Object.freeze({ ...this.diagnosticsValue, ...changes });
    if (areDiagnosticsEqual(this.diagnosticsValue, next)) return;
    this.diagnosticsValue = next;
    for (const listener of this.diagnosticsListeners) {
      try {
        listener(next);
      } catch {
        // A settings observer must not be able to interrupt indexing.
      }
    }
  }
}

function areDiagnosticsEqual(
  left: IndexDiagnosticsSnapshot,
  right: IndexDiagnosticsSnapshot,
): boolean {
  return left.fileCount === right.fileCount &&
    left.sourceCount === right.sourceCount &&
    left.occurrenceCount === right.occurrenceCount &&
    left.pendingEventCount === right.pendingEventCount &&
    left.lastFullRebuild === right.lastFullRebuild &&
    left.lastIncrementalUpdate === right.lastIncrementalUpdate;
}
