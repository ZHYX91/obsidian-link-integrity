import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { createFileRecord, LinkIndex } from "../src/core";
import type { MentionName } from "../src/core/potential-mention-model";
import { MentionRequestCancelledError, PotentialMentionService } from "../src/features/mentions/potential-mention-service";

const count = process.env.LINK_INTEGRITY_BENCHMARK_MODE === "large" ? 50_000 : 10_000;
const perSource = 100;

it(`counts dense mentions in ${count} sources with bounded retained rows and exact lazy pages`, async () => {
  const paths = Array.from({ length: count }, (_, position) => `Sources/source-${String(position).padStart(5, "0")}.md`);
  const index = new LinkIndex([...paths, "Target.md", "Other.md"].map((path) => createFileRecord(path)));
  const body = (path: string) => `${path}\n${"山 ".repeat(perSource)}`;
  let changedPath: string | null = null;
  let reads = 0;
  let yields = 0;
  const states: string[] = [];
  const service = new PotentialMentionService(() => index, {
    collectNames: async (files, scheduler) => {
      const names: MentionName[] = [];
      for (const file of files) {
        names.push({ text: file.path.split("/").at(-1)!.slice(0, -3), targetPath: file.path, kind: "title" });
        const pause = scheduler.checkpoint();
        if (pause !== null) await pause;
      }
      names.push({ text: "山", targetPath: "Target.md", kind: "alias" }, { text: "山", targetPath: "Other.md", kind: "alias" });
      return names;
    },
    readSource: async (path) => {
      reads += 1;
      if (!path.startsWith("Sources/")) return "";
      return body(path) + (path === changedPath ? " changed" : "");
    },
    // Every generated body is plain prose; no host parser or file I/O is involved.
    excludedRanges: async () => [],
  }, { yieldControl: async () => {
    yields += 1;
    await new Promise<void>((resolve) => setImmediate(resolve));
  } });
  const heap = process.memoryUsage().heapUsed;
  const started = performance.now();
  const result = await service.reverseLookup("Target.md", { onProgress: ({ state }) => states.push(state) });
  const scanMs = performance.now() - started;
  expect(result.state).toBe("complete");
  expect(result.checked).toBe(count + 2);
  expect(result.matchCount).toBe(count * perSource);
  expect(result.sources).toHaveLength(count);
  const retained = result.sources.reduce((sum, source) => sum + source.matches.length, 0);
  expect(retained).toBe(50);
  expect(result.sources.every((source) => source.sourceText === undefined && source.matchCount === perSource)).toBe(true);
  const first = await result.sources[0]!.loadMatches!(50, 50);
  const lastSource = result.sources.at(-1)!;
  const last = await lastSource.loadMatches!(50, 50);
  expect(first).toHaveLength(50);
  expect(last).toHaveLength(50);
  expect(last.at(-1)?.from).toBe(body(lastSource.sourcePath).length - 2);
  expect(last[0]?.targets.map(({ path }) => path)).toEqual(["Other.md", "Target.md"]);
  expect(last[0]?.targets).toBe(last[49]?.targets);
  expect(result.sources.reduce((sum, source) => sum + source.matches.length, 0)).toBe(50);
  const heapMiB = (process.memoryUsage().heapUsed - heap) / 1024 / 1024;
  changedPath = lastSource.sourcePath;
  await expect(lastSource.loadMatches!(50, 50)).rejects.toBeInstanceOf(MentionRequestCancelledError);
  expect(states.at(-1)).toBe("stale");
  changedPath = null;
  const abort = new AbortController();
  const partial = await service.reverseLookup("Target.md", { signal: abort.signal,
    onProgress: ({ checked }) => { if (checked === 1) abort.abort(); } });
  expect(partial).toMatchObject({ state: "cancelled", checked: 1, matchCount: perSource });
  const before = reads;
  await expect(partial.sources[0]!.loadMatches!(50, 50)).rejects.toBeInstanceOf(MentionRequestCancelledError);
  expect(reads).toBe(before);
  console.log(`Dense mention reverse: ${count} sources, ${body(paths[0]!).length * count} UTF16 units, ` +
    `${result.matchCount} ranges; ${result.sources.length} source metadata entries, ${retained} retained range/context rows, ` +
    `50 rows per lazy page, last range reachable, revision stale and cancellation verified; ` +
    `${scanMs.toFixed(1)} ms, ${yields} yields, heap delta ${heapMiB.toFixed(1)} MiB (diagnostic only)`);
});
