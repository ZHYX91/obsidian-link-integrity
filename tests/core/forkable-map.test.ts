import { describe, expect, it } from "vitest";
import { ForkableMap } from "../../src/core/forkable-map";
import { WorkScheduler } from "../../src/scheduling/work-scheduler";
import { sortSteps } from "../../src/scheduling/sort-steps";

describe("copy-on-write map", () => {
  it("matches Map across forks, deletion, clearing and collision-heavy writes", () => {
    const original = new ForkableMap<number>();
    const expected = new Map<string, number>();
    for (let i = 0; i < 2000; i += 1) { original.set(`key-${i}`, i); expected.set(`key-${i}`, i); }
    const fork = original.fork();
    for (let i = 0; i < 2000; i += 3) { fork.delete(`key-${i}`); expected.delete(`key-${i}`); }
    for (let i = 0; i < 2000; i += 5) { fork.set(`key-${i}`, -i); expected.set(`key-${i}`, -i); }
    expect(fork.size).toBe(expected.size);
    expect(new Map(fork)).toEqual(expected);
    expect(original.size).toBe(2000);
    expect(original.get("key-5")).toBe(5);
    expect(fork.delete("absent")).toBe(false);
    original.clear();
    expect(original.size).toBe(0);
    expect([...original.keys()]).toEqual([]);
    expect([...fork.values()]).toHaveLength(expected.size);
  });
});

describe("work scheduling", () => {
  it("shares an outstanding yield and restarts the budget afterward", async () => {
    let now = 0;
    let resume!: () => void;
    const scheduler = new WorkScheduler({
      now: () => now, yieldEvery: 100, yieldIntervalMs: 8,
      yieldControl: () => new Promise<void>((resolve) => { resume = resolve; }),
    });
    expect(scheduler.checkpoint()).toBeNull();
    now = 9;
    const pending = scheduler.checkpoint();
    expect(scheduler.checkpoint()).toBe(pending);
    resume();
    await pending;
    expect(scheduler.checkpoint()).toBeNull();
  });

  it.each([[], [1], [4, 3, 2, 1], [2, 1, 2, 1, 3]].map((values) => ({ values })))("sorts scheduled steps stably: $values", ({ values }) => {
    const items = values.map((key, order) => ({ key, order }));
    const steps = sortSteps(items, (a, b) => a.key - b.key);
    let step = steps.next();
    while (!step.done) step = steps.next();
    expect(step.value).toEqual([...items].sort((a, b) => a.key - b.key));
  });
});
