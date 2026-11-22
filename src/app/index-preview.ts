import type { LinkIndex } from "../core";
import { WorkScheduler, type WorkSchedulerOptions } from "../scheduling/work-scheduler";

/** Publish a count from one index revision, even when the scan yields to the UI. */
export async function runIndexPreview<Result>(
  getIndex: () => LinkIndex,
  scan: (index: LinkIndex) => Generator<void, Result>,
  signal?: AbortSignal,
  options: WorkSchedulerOptions = {},
): Promise<Result> {
  const scheduler = new WorkScheduler(options);
  while (true) {
    signal?.throwIfAborted();
    const index = getIndex();
    const version = index.version;
    const steps = scan(index);
    let step = steps.next();
    while (!step.done) {
      const pause = scheduler.checkpoint();
      if (pause !== null) {
        await pause;
        signal?.throwIfAborted();
        if (getIndex() !== index || index.version !== version) break;
      }
      step = steps.next();
    }
    if (step.done) return step.value;
  }
}
