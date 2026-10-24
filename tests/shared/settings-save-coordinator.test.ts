import { describe, expect, it, vi } from "vitest";

import {
  SettingsSaveCoordinator,
  type SettingsSaveClock,
} from "../../src/shared/settings-save-coordinator";

describe("SettingsSaveCoordinator", () => {
  it("closes new entry points immediately while draining accepted snapshots", async () => {
    const first = deferred();
    const second = deferred();
    const persisted: number[] = [];
    const coordinator = new SettingsSaveCoordinator<number>(async (snapshot) => {
      persisted.push(snapshot);
      await (snapshot === 1 ? first.promise : second.promise);
    });
    const initial = coordinator.save(1);
    await Promise.resolve();
    coordinator.schedule(2);
    const closing = coordinator.close();
    expect(coordinator.close()).toBe(closing);
    coordinator.schedule(3);
    const stale = coordinator.save(4);
    const retry = coordinator.retry();
    let closed = false;
    void closing.then(() => { closed = true; });
    first.resolve();
    await initial;
    await vi.waitFor(() => expect(persisted).toEqual([1, 2]));
    expect(closed).toBe(false);
    second.resolve();
    await Promise.all([closing, stale, retry, coordinator.flush()]);
    expect(persisted).toEqual([1, 2]);
    expect(coordinator.getStatus().state).toBe("saved");
  });

  it("keeps a failed close pending without allowing a late retry to restart it", async () => {
    const persist = vi.fn(async () => { throw new Error("disk full"); });
    const coordinator = new SettingsSaveCoordinator<number>(persist);
    coordinator.schedule(1);
    await expect(coordinator.close()).rejects.toThrow("disk full");
    coordinator.schedule(2);
    await expect(coordinator.retry()).rejects.toThrow("disk full");
    await expect(coordinator.save(3)).rejects.toThrow("disk full");
    await expect(coordinator.saveNow()).rejects.toThrow("disk full");
    expect(persist).toHaveBeenCalledOnce();
    expect(coordinator.getStatus().state).toBe("pending");
  });

  it("debounces and coalesces scheduled snapshots", async () => {
    const clock = new FakeClock();
    const persisted: number[] = [];
    const coordinator = new SettingsSaveCoordinator<number>(async (snapshot) => {
      persisted.push(snapshot);
    }, { delayMs: 20, clock });
    coordinator.schedule(1);
    coordinator.schedule(2);
    expect(coordinator.getStatus().state).toBe("scheduled");
    clock.runLatest();
    await coordinator.flush();
    expect(persisted).toEqual([2]);
    expect(coordinator.getStatus().state).toBe("saved");
  });

  it("serializes writes while allowing the newest queued snapshot to win", async () => {
    const first = deferred();
    const persisted: number[] = [];
    const coordinator = new SettingsSaveCoordinator<number>(async (snapshot) => {
      persisted.push(snapshot);
      if (snapshot === 1) await first.promise;
    });
    const firstSave = coordinator.save(1);
    await Promise.resolve();
    const secondSave = coordinator.save(2);
    coordinator.schedule(3);
    first.resolve();
    await Promise.all([firstSave, secondSave]);
    await coordinator.flush();
    expect(persisted).toEqual([1, 3]);
  });

  it("retains a failed snapshot and exposes retry state", async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const coordinator = new SettingsSaveCoordinator<number>(persist);
    await expect(coordinator.save(7)).rejects.toThrow("disk full");
    expect(coordinator.getStatus().state).toBe("pending");
    await coordinator.retry();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(coordinator.getStatus()).toEqual({ state: "saved", error: null });
  });
});

class FakeClock implements SettingsSaveClock {
  private callbacks = new Map<number, () => void>();
  private nextHandle = 1;

  setTimeout(callback: () => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: number): void {
    this.callbacks.delete(handle);
  }

  runLatest(): void {
    const handle = Math.max(...this.callbacks.keys());
    const callback = this.callbacks.get(handle);
    this.callbacks.delete(handle);
    callback?.();
  }
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
