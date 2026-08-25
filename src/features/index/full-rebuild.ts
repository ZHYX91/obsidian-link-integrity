import { LinkIndex } from "../../core/link-index";
import type { FileRecord } from "../../core/model";
import type { GraphContributionPolicy } from "../../core/scopes";
import { AtomicLinkIndexStore } from "./atomic-store";
import type { LinkIndexPort } from "./ports";
import { raceWithAbort, throwIfAborted } from "./cancellation";

export interface FullRebuildOptions {
  readonly concurrency?: number;
  readonly onProgress?: (completed: number, total: number) => void;
  readonly progressThrottleMs?: number;
  readonly yieldEvery?: number;
  readonly yieldIntervalMs?: number;
  readonly yieldControl?: () => Promise<void>;
  readonly now?: () => number;
}

export interface FullRebuildResult {
  readonly index: LinkIndex;
  readonly generation: number;
  readonly fileCount: number;
  readonly sourceCount: number;
}

export class FullRebuildController {
  private readonly concurrency: number;
  private readonly yieldEvery: number;
  private readonly yieldIntervalMs: number;
  private readonly yieldControl: () => Promise<void>;

  public constructor(
    private readonly port: LinkIndexPort,
    private readonly store: AtomicLinkIndexStore,
    private readonly options: FullRebuildOptions = {},
  ) {
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
    this.yieldEvery = Math.max(1, Math.floor(options.yieldEvery ?? 128));
    this.yieldIntervalMs = Math.max(1, options.yieldIntervalMs ?? 8);
    this.yieldControl = options.yieldControl ?? defaultYieldControl;
  }

  public async buildStaging(
    contributionPolicy: GraphContributionPolicy = this.store.current.graphContributionPolicy,
    signal?: AbortSignal,
  ): Promise<LinkIndex> {
    const files = await raceWithAbort(this.port.listFiles(), signal);
    throwIfAborted(signal);
    const staging = new LinkIndex(files, { contributionPolicy });
    await this.populate(staging, files, signal);
    return staging;
  }

  public publish(staging: LinkIndex): FullRebuildResult {
    const published = this.store.publish(staging);
    return {
      index: published.index,
      generation: published.generation,
      fileCount: staging.files.length,
      sourceCount: staging.snapshots.length,
    };
  }

  public async rebuild(signal?: AbortSignal): Promise<FullRebuildResult> {
    return this.publish(await this.buildStaging(undefined, signal));
  }

  private async populate(
    index: LinkIndex,
    files: readonly FileRecord[],
    signal?: AbortSignal,
  ): Promise<void> {
    let nextIndex = 0;
    let completed = 0;
    let failed = false;
    let lastProgressAt = Number.NEGATIVE_INFINITY;
    const now = this.options.now ?? Date.now;
    let lastYieldAt = now();
    let pendingYield: Promise<void> | null = null;
    const throttleMs = Math.max(0, this.options.progressThrottleMs ?? 50);
    const reportProgress = (force: boolean): void => {
      if (this.options.onProgress === undefined) return;
      const currentTime = now();
      if (!force && currentTime - lastProgressAt < throttleMs) return;
      lastProgressAt = currentTime;
      this.options.onProgress(completed, files.length);
    };
    reportProgress(true);
    const worker = async (): Promise<void> => {
      try {
        while (!failed && nextIndex < files.length) {
          throwIfAborted(signal);
          if (pendingYield !== null) {
            await raceWithAbort(pendingYield, signal);
            throwIfAborted(signal);
          }
          if (failed) return;
          const fileIndex = nextIndex;
          nextIndex += 1;
          const file = files[fileIndex];
          if (file === undefined) continue;
          const snapshot = await raceWithAbort(
            this.port.buildSourceSnapshot(file.path),
            signal,
          );
          throwIfAborted(signal);
          if (snapshot !== null) index.replaceSourceSnapshot(file.path, snapshot);
          completed += 1;
          reportProgress(completed === files.length);
          const currentTime = now();
          const countBudgetReached = completed % this.yieldEvery === 0;
          const timeBudgetReached = currentTime - lastYieldAt >= this.yieldIntervalMs;
          if (completed < files.length && (countBudgetReached || timeBudgetReached)) {
            pendingYield ??= this.yieldControl().finally(() => {
              lastYieldAt = now();
              pendingYield = null;
            });
            await raceWithAbort(pendingYield, signal);
            throwIfAborted(signal);
          }
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(this.concurrency, Math.max(1, files.length)) },
      worker,
    ));
  }
}

function defaultYieldControl(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}
