import { describe, expect, it, vi } from "vitest";

import { PreviewRequestCoordinator } from "../../src/ui/settings";

describe("PreviewRequestCoordinator", () => {
  it("cancels work when a newer draft or generation replaces it", async () => {
    const coordinator = new PreviewRequestCoordinator<string, number>();
    const signals: AbortSignal[] = [];
    const load = (signal: AbortSignal): Promise<number> => {
      signals.push(signal);
      return Promise.resolve(1);
    };
    const first = coordinator.request("rule", load, vi.fn());
    const second = coordinator.request("rule", load, vi.fn());
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    coordinator.beginGeneration();
    expect(signals[1]?.aborted).toBe(true);
    await Promise.all([first, second]);
  });

  it("drops completion from a hidden or re-rendered generation", async () => {
    const coordinator = new PreviewRequestCoordinator<string, number>();
    const first = deferred<number>();
    const publish = vi.fn();
    coordinator.beginGeneration();
    const request = coordinator.request("rule", () => first.promise, publish);
    coordinator.invalidate();
    first.resolve(3);
    await request;
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith({
      state: "loading",
      value: null,
      error: null,
    });
  });

  it("allows only the newest request for a key to publish", async () => {
    const coordinator = new PreviewRequestCoordinator<string, number>();
    const first = deferred<number>();
    const second = deferred<number>();
    const publish = vi.fn();
    coordinator.beginGeneration();
    const firstRequest = coordinator.request("rule", () => first.promise, publish);
    const secondRequest = coordinator.request("rule", () => second.promise, publish);
    first.resolve(1);
    second.resolve(2);
    await Promise.all([firstRequest, secondRequest]);
    expect(publish).not.toHaveBeenCalledWith({ state: "ready", value: 1, error: null });
    expect(publish).toHaveBeenCalledWith({ state: "ready", value: 2, error: null });
  });

  it("turns synchronous preview errors into guarded failed state", async () => {
    const coordinator = new PreviewRequestCoordinator<string, number>();
    const publish = vi.fn();
    coordinator.beginGeneration();
    await coordinator.request("rule", () => {
      throw new Error("bad regex");
    }, publish);
    expect(publish).toHaveBeenLastCalledWith({
      state: "failed",
      value: null,
      error: expect.objectContaining({ message: "bad regex" }),
    });
  });
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
