import { LinkIndex } from "../../core/link-index";
import type { FileRecord } from "../../core/model";
import { AtomicLinkIndexStore } from "./atomic-store";
import type { LinkIndexPort } from "./ports";

export interface FullRebuildOptions {
  readonly concurrency?: number;
  readonly onProgress?: (completed: number, total: number) => void;
  readonly progressThrottleMs?: number;
  readonly yieldEvery?: number;
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
  private readonly yieldControl: () => Promise<void>;

  public constructor(
    private readonly port: LinkIndexPort,
    private readonly store: AtomicLinkIndexStore,
    private readonly options: FullRebuildOptions = {},
  ) {
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
    this.yieldEvery = Math.max(1, Math.floor(options.yieldEvery ?? 128));
    this.yieldControl = options.yieldControl ?? defaultYieldControl;
  }

  public async buildStaging(): Promise<LinkIndex> {
    const files = await this.port.listFiles();
    const staging = new LinkIndex(files);
    await this.populate(staging, files);
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

  public async rebuild(): Promise<FullRebuildResult> {
    return this.publish(await this.buildStaging());
  }

  private async populate(index: LinkIndex, files: readonly FileRecord[]): Promise<void> {
    let nextIndex = 0;
    let completed = 0;
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
      while (nextIndex < files.length) {
        const fileIndex = nextIndex;
        nextIndex += 1;
        const file = files[fileIndex];
        if (file === undefined) continue;
        const snapshot = await this.port.buildSourceSnapshot(file.path);
        if (snapshot !== null) index.replaceSourceSnapshot(file.path, snapshot);
        completed += 1;
        reportProgress(completed === files.length);
        if (completed < files.length && completed % this.yieldEvery === 0) {
          await this.yieldControl();
        }
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
