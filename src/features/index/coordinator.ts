import { LinkIndex } from "../../core/link-index";
import { AtomicLinkIndexStore } from "./atomic-store";
import {
  FullRebuildController,
  type FullRebuildOptions,
  type FullRebuildResult,
} from "./full-rebuild";
import {
  IncrementalIndexController,
  type IncrementalIndexOptions,
} from "./incremental-controller";
import type { LinkIndexPort, SourceEvent } from "./ports";

export type LinkIndexCoordinatorState = "idle" | "ready" | "rebuilding" | "stale" | "failed";

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
  private readonly incrementalOptions: IncrementalIndexOptions;
  private lifecycleEpoch = 0;

  public constructor(
    private readonly port: LinkIndexPort,
    initialIndex: LinkIndex = new LinkIndex(),
    rebuildOptions: FullRebuildOptions = {},
    incrementalOptions: IncrementalIndexOptions = {},
  ) {
    this.incrementalOptions = incrementalOptions;
    this.store = new AtomicLinkIndexStore(initialIndex);
    this.incremental = new IncrementalIndexController(port, this.store, incrementalOptions);
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

  public start(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycleEpoch += 1;
    this.incremental.start();
  }

  public stop(): void {
    this.active = false;
    this.lifecycleEpoch += 1;
    this.incremental.stop();
    this.bufferedEvents = [];
    this.stateValue = "idle";
  }

  public enqueue(event: SourceEvent): void {
    if (!this.active) throw new Error("Link index coordinator is not active.");
    if (this.rebuilding) this.bufferedEvents.push(event);
    else this.incremental.enqueue(event);
  }

  public rebuild(): Promise<FullRebuildResult> {
    if (!this.active) throw new Error("Link index coordinator is not active.");
    if (this.rebuildPromise !== null) return this.rebuildPromise;
    this.rebuildPromise = this.performRebuild().finally(() => {
      this.rebuildPromise = null;
    });
    return this.rebuildPromise;
  }

  private async performRebuild(): Promise<FullRebuildResult> {
    const epoch = this.lifecycleEpoch;
    this.rebuilding = true;
    this.stateValue = "rebuilding";
    this.errorValue = null;
    try {
      await this.incremental.whenIdle();
      this.incremental.stop();
      this.assertCurrentLifecycle(epoch);
      const staging = await this.rebuildController.buildStaging();
      this.assertCurrentLifecycle(epoch);
      await this.replayBufferedEvents(staging);
      this.assertCurrentLifecycle(epoch);
      const result = this.rebuildController.publish(staging);
      this.stateValue = "ready";
      return result;
    } catch (error) {
      if (error instanceof RebuildCancelledError) {
        this.errorValue = null;
        this.stateValue = this.store.generation > 0 ? "ready" : "idle";
        throw error;
      }
      this.errorValue = error;
      this.stateValue = this.store.generation > 0 ? "stale" : "failed";
      throw error;
    } finally {
      const remaining = this.bufferedEvents;
      this.bufferedEvents = [];
      this.rebuilding = false;
      this.incremental.stop();
      this.incremental = new IncrementalIndexController(
        this.port,
        this.store,
        this.incrementalOptions,
      );
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

  public async whenIdle(): Promise<void> {
    await this.incremental.whenIdle();
  }

  private async replayBufferedEvents(staging: LinkIndex): Promise<void> {
    const stagingStore = new AtomicLinkIndexStore(staging);
    const replay = new IncrementalIndexController(
      this.port,
      stagingStore,
      this.incrementalOptions,
    );
    replay.start();
    while (this.bufferedEvents.length > 0) {
      const events = this.bufferedEvents;
      this.bufferedEvents = [];
      for (const event of events) replay.enqueue(event);
      await replay.whenIdle();
    }
    replay.stop();
  }

  private assertCurrentLifecycle(epoch: number): void {
    if (!this.active || this.lifecycleEpoch !== epoch) throw new RebuildCancelledError();
  }
}
