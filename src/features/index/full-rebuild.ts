import { LinkIndex } from "../../core/link-index";
import { normalizeVaultPath, type FileRecord } from "../../core/model";
import type { GraphContributionPolicy } from "../../core/scopes";
import { AtomicLinkIndexStore } from "./atomic-store";
import type { LinkIndexPort } from "./ports";
import { raceWithAbort, throwIfAborted } from "./cancellation";
import { WorkScheduler } from "../../scheduling/work-scheduler";
import { consumeSteps } from "./consume-steps";

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

  public constructor(
    private readonly port: LinkIndexPort,
    private readonly store: AtomicLinkIndexStore,
    private readonly options: FullRebuildOptions = {},
  ) {
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
  }

  public async buildStaging(
    contributionPolicy: GraphContributionPolicy = this.store.current.graphContributionPolicy,
    signal?: AbortSignal,
  ): Promise<LinkIndex> {
    const scheduler = new WorkScheduler(this.options);
    const files = await raceWithAbort(this.port.listFiles(scheduler), signal);
    throwIfAborted(signal);
    const staging = new LinkIndex([], { contributionPolicy });
    const registeredPaths = new Set<string>();
    for (const file of files) {
      const path = normalizeVaultPath(file.path);
      if (registeredPaths.has(path)) throw new Error(`Duplicate file path: ${path}`);
      registeredPaths.add(path);
      staging.replaceFileRecord(file.path, file);
      const pause = scheduler.checkpoint();
      if (pause !== null) await raceWithAbort(pause, signal);
      throwIfAborted(signal);
    }
    await this.populate(staging, files, scheduler, signal);
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
    scheduler: WorkScheduler,
    signal?: AbortSignal,
  ): Promise<void> {
    let nextIndex = 0;
    let completed = 0;
    let failed = false;
    let reduction = Promise.resolve();
    let lastProgressAt = Number.NEGATIVE_INFINITY;
    const now = this.options.now ?? Date.now;
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
          if (failed) return;
          const fileIndex = nextIndex;
          nextIndex += 1;
          const file = files[fileIndex];
          if (file === undefined) continue;
          const snapshot = await raceWithAbort(
            this.port.buildSourceSnapshot(file.path, scheduler),
            signal,
          );
          throwIfAborted(signal);
          if (snapshot !== null) {
            reduction = reduction.then(() => consumeSteps(
              index.replaceSourceSnapshotSteps(file.path, snapshot), scheduler,
              () => signal?.aborted !== true && !failed,
            ));
            await raceWithAbort(reduction, signal);
          }
          completed += 1;
          reportProgress(completed === files.length);
          const pause = scheduler.checkpoint();
          if (pause !== null) await raceWithAbort(pause, signal);
          throwIfAborted(signal);
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
