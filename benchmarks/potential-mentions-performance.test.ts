import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { PotentialMentionMatcher } from "../src/core/potential-mention-matcher";
import { mentionDisplayFragments } from "../src/core/mention-display";
import { WorkScheduler } from "../src/scheduling/work-scheduler";
import type { MentionName } from "../src/core/potential-mention-model";

const large = process.env.LINK_INTEGRITY_BENCHMARK_MODE === "large";
const count = large ? 50_000 : 10_000;

it(`builds and matches ${count} titles, long aliases and same-name targets in slices`, async () => {
  const names: MentionName[] = [];
  for (let index = 0; index < count; index += 1) {
    const targetPath = `Places/Target-${index}.md`;
    names.push({ text: `Title-${index}`, targetPath, kind: "title" },
      { text: `Long alias ${"shared context ".repeat(4)}${index}`, targetPath, kind: "alias" },
      { text: "白云山", targetPath, kind: "alias" });
  }
  names.push({ text: "山", targetPath: "山.md", kind: "title" }, { text: "山南路", targetPath: "山南路.md", kind: "title" });
  let slices = 0;
  let longestSlice = 0;
  let sliceStart = performance.now();
  const scheduler = new WorkScheduler({ yieldControl: async () => {
    longestSlice = Math.max(longestSlice, performance.now() - sliceStart);
    slices += 1;
    await new Promise<void>((resolve) => setImmediate(resolve));
    sliceStart = performance.now();
  } });
  const consume = async <T>(steps: Generator<void, T>): Promise<T> => {
    let step = steps.next();
    while (!step.done) {
      const pause = scheduler.checkpoint();
      if (pause !== null) await pause;
      step = steps.next();
    }
    longestSlice = Math.max(longestSlice, performance.now() - sliceStart);
    return step.value;
  };
  const heap = process.memoryUsage().heapUsed;
  const started = performance.now();
  const matcher = await consume(PotentialMentionMatcher.createSteps(names));
  const buildMs = performance.now() - started;
  const source = `${"unrelated prose ".repeat(count)}${"白云山南路\n".repeat(2_000)}`;
  const matching = performance.now();
  const matches = await consume(matcher.matchSteps(source, { sourcePath: "Places/Target-0.md" }));
  const matchMs = performance.now() - matching;
  expect(matches).toHaveLength(6_000);
  expect(matches[0]?.targets).toHaveLength(count - 1);
  expect(matches[3]?.targets).toBe(matches[0]?.targets);
  const viewport = { from: source.length - 600, to: source.length };
  const fragments = mentionDisplayFragments(matches, viewport);
  expect(fragments).toHaveLength(300);
  expect(fragments.every((fragment) => fragment.tracks <= 2)).toBe(true);
  expect(slices).toBeGreaterThan(100);
  expect(buildMs).toBeLessThan(large ? 20_000 : 8_000);
  expect(matchMs).toBeLessThan(large ? 10_000 : 5_000);
  console.log(`Potential mentions: ${count} files, ${names.length} names, ${source.length} UTF16 units, 6000 ranges; ` +
    `build ${buildMs.toFixed(1)} ms, match ${matchMs.toFixed(1)} ms, ${slices} yields, longest observed slice ${longestSlice.toFixed(1)} ms, ` +
    `heap delta ${((process.memoryUsage().heapUsed - heap) / 1024 / 1024).toFixed(1)} MiB (diagnostic only)`);
});
