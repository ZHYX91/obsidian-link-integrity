import type { WorkScheduler } from "../../scheduling/work-scheduler";

export async function consumeSteps(
  steps: Iterable<void>, scheduler: WorkScheduler, isCurrent: () => boolean = () => true,
): Promise<void> {
  for (const step of steps) {
    if (!isCurrent()) return;
    void step;
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
  }
}
