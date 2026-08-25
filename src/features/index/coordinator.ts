import { LinkIndex } from "../../core/link-index";
import type { GraphContributionPolicy } from "../../core/scopes";
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

  public constructor(
    private readonly port: LinkIndexPort,
    initialIndex: LinkIndex = new LinkIndex(),
    rebuildOptions: FullRebuildOptions = {},
    incrementalOptions: IncrementalIndexOptions = {},
  ) {
    this.incrementalOptions = incrementalOptions;
    this.now = rebuildOptions.now ?? incrementalOptions.now ?? Date.now;
    this.store = new AtomicLinkIndexStore(initialIndex);
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

  public setGraphContributionPolicy(policy: GraphContributionPolicy): void {
    this.store.current.setGraphContributionPolicy(policy);
  }

  public regraph(policy: GraphContributionPolicy): void {
    this.setGraphContributionPolicy(policy);
  }

  public start(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycleEpoch += 1;
    this.incremental.start();
  }

  public stop(): void {
    this.active = false;
    this.lifecycleEpoch += 1;
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
      this.incremental.stop();
      this.assertCurrentLifecycle(epoch);
      const staging = await this.rebuildController.buildStaging(undefined, signal);
      this.assertCurrentLifecycle(epoch);
      await this.replayBufferedEvents(staging, signal);
      this.assertCurrentLifecycle(epoch);
      staging.setGraphContributionPolicy(this.store.current.graphContributionPolicy);
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
        }
      }
    }
  }

  public async whenIdle(): Promise<void> {
    await this.incremental.whenIdle();
  }

  private async replayBufferedEvents(
    staging: LinkIndex,
    signal: AbortSignal,
  ): Promise<void> {
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
