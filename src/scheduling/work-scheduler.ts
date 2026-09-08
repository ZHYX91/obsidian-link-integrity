export interface WorkSchedulerOptions {
  readonly yieldEvery?: number;
  readonly yieldIntervalMs?: number;
  readonly yieldControl?: () => Promise<void>;
  readonly now?: () => number;
}

/** Cooperating workers share one budget and one outstanding browser task yield. */
export class WorkScheduler {
  private readonly now: () => number;
  private readonly yieldControl: () => Promise<void>;
  private readonly interval: number;
  private readonly every: number;
  private startedAt: number;
  private count = 0;
  private pending: Promise<void> | null = null;

  public constructor(options: WorkSchedulerOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.yieldControl = options.yieldControl ?? yieldBrowserTask;
    this.interval = Math.max(1, options.yieldIntervalMs ?? 8);
    this.every = Math.max(1, Math.floor(options.yieldEvery ?? 128));
    this.startedAt = this.now();
  }

  public checkpoint(): Promise<void> | null {
    if (this.pending !== null) return this.pending;
    this.count += 1;
    if (this.count < this.every && this.now() - this.startedAt < this.interval) return null;
    this.pending = this.yieldControl().finally(() => {
      this.startedAt = this.now();
      this.count = 0;
      this.pending = null;
    });
    return this.pending;
  }
}

export function yieldBrowserTask(): Promise<void> {
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
