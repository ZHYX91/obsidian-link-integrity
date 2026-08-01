export type SettingsSaveState = "saved" | "scheduled" | "saving" | "pending";

export interface SettingsSaveStatus {
  readonly state: SettingsSaveState;
  readonly error: unknown;
}

export interface SettingsSaveClock {
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (handle: number) => void;
}

export interface SettingsSaveCoordinatorOptions {
  readonly delayMs?: number;
  readonly clock?: SettingsSaveClock;
  readonly onError?: (error: unknown) => void;
}

const BROWSER_CLOCK: SettingsSaveClock = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

/**
 * Serializes settings writes and coalesces queued snapshots to the newest one.
 * A failed snapshot remains pending until retry or a newer explicit save succeeds.
 */
export class SettingsSaveCoordinator<T> {
  private readonly clock: SettingsSaveClock;
  private readonly delayMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly listeners = new Set<(status: SettingsSaveStatus) => void>();
  private pendingSnapshot: T | null = null;
  private timer: number | null = null;
  private queue: Promise<void> = Promise.resolve();
  private status: SettingsSaveStatus = { state: "saved", error: null };

  constructor(
    private readonly persist: (snapshot: T) => Promise<void>,
    options: SettingsSaveCoordinatorOptions = {},
  ) {
    this.clock = options.clock ?? BROWSER_CLOCK;
    this.delayMs = options.delayMs ?? 250;
    this.onError = options.onError ?? (() => undefined);
  }

  schedule(snapshot: T): void {
    this.pendingSnapshot = snapshot;
    this.cancelTimer();
    this.setStatus("scheduled", this.status.error);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      void this.saveNow().catch((error: unknown) => this.reportError(error));
    }, this.delayMs);
  }

  save(snapshot: T): Promise<void> {
    this.pendingSnapshot = snapshot;
    return this.saveNow();
  }

  saveNow(): Promise<void> {
    this.cancelTimer();
    const operation = this.queue.then(() => this.persistPendingSnapshot());
    // Keep the internal tail fulfilled so one failed write cannot poison later retries,
    // while returning the original operation to the caller for honest error reporting.
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  flush(): Promise<void> {
    this.cancelTimer();
    if (this.pendingSnapshot !== null) return this.saveNow();
    return this.queue;
  }

  retry(): Promise<void> {
    if (this.pendingSnapshot === null) return Promise.resolve();
    return this.saveNow();
  }

  close(): Promise<void> {
    return this.flush();
  }

  getStatus(): SettingsSaveStatus {
    return this.status;
  }

  subscribe(listener: (status: SettingsSaveStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private async persistPendingSnapshot(): Promise<void> {
    const snapshot = this.pendingSnapshot;
    if (snapshot === null) return;
    this.pendingSnapshot = null;
    this.setStatus("saving", null);
    try {
      await this.persist(snapshot);
      this.setStatus(this.pendingSnapshot === null ? "saved" : "scheduled", null);
    } catch (error) {
      // A newer snapshot always wins; otherwise retain the failed one.
      this.pendingSnapshot ??= snapshot;
      this.setStatus("pending", error);
      throw error;
    }
  }

  private setStatus(state: SettingsSaveState, error: unknown): void {
    this.status = Object.freeze({ state, error });
    for (const listener of this.listeners) listener(this.status);
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch {
      // Error reporting must not create a second unhandled failure.
    }
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
