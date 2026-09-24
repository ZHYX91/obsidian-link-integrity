import { performance } from "node:perf_hooks";
import { expect, it, vi } from "vitest";
import { LinkIndex, createFileRecord } from "../src/core";
import { extractMarkdownExplicitReferences } from "../src/adapters/obsidian/explicit-link-parser";
import { IgnorePreviewService } from "../src/app/ignore-preview-service";
import { LinkIndexCoordinator } from "../src/features/index/coordinator";
import { occurrence, snapshot } from "../tests/core/test-helpers";
import { compileBoundedRegex } from "../src/core/bounded-regex";

const large = process.env.LINK_INTEGRITY_BENCHMARK_MODE === "large";
const count = large ? 50_000 : 10_000;

it("bounds ambiguous regex matching across increasing input lengths", () => {
  for (const pattern of ["^((a|aa))+$", "^a+a+a+a+a+$", "a*a*a*a*a*b"]) {
    const matcher = compileBoundedRegex(pattern, "u");
    for (const size of [1000, 10_000, 50_000]) {
      const start = performance.now();
      expect(matcher.test(`${"a".repeat(size)}!`)).toBe(false);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1000);
      console.log(`Bounded regex: ${pattern}, ${size} characters, ${elapsed.toFixed(1)} ms`);
    }
  }
});

it("bounds failed destination scanning across explicit input sizes", () => {
  for (const repeats of [16_000, 32_000, 64_000]) {
    for (const unit of ["[x](", "[x](<", '[x](a "']) {
      const source = unit.repeat(repeats);
      const start = performance.now();
      expect(extractMarkdownExplicitReferences(source)).toEqual([]);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1000);
      console.log(`Failed destination parse: ${source.length} characters, ${elapsed.toFixed(1)} ms`);
    }
  }
});

it(`slices policy regraph and broad preview for ${count} files`, async () => {
  const files = Array.from({ length: count }, (_, n) => createFileRecord(`Notes/N${n}.md`));
  const index = new LinkIndex(files);
  for (const [n, file] of files.entries()) index.replaceSourceSnapshot(file.path, snapshot(file.path,
    Array.from({ length: 3 }, (_, link) => occurrence(`${file.path}:${link}`, file.path, {
      targetPath: files[(n + link + 1) % count]!.path,
    }))));
  const forbiddenRead = vi.fn(async (): Promise<never> => { throw new Error("Unexpected adapter read"); });
  let yields = 0;
  const coordinator = new LinkIndexCoordinator({
    listFiles: forbiddenRead, getFileRecord: forbiddenRead, buildSourceSnapshot: forbiddenRead,
  }, index, {}, { yieldControl: async () => { yields += 1; } });
  coordinator.start();
  let start = performance.now();
  await coordinator.regraph({ allows: () => false });
  const regraphMs = performance.now() - start;
  expect(regraphMs).toBeLessThan(large ? 8000 : 3000);
  expect(yields).toBeGreaterThan(10);
  expect(forbiddenRead).not.toHaveBeenCalled();
  expect(coordinator.index.getOutgoingNeighborCount(files[0]!.path)).toBe(0);
  expect(index.getOutgoingNeighborCount(files[0]!.path)).toBe(3);
  const preview = new IgnorePreviewService(() => coordinator.index, {
    yieldControl: async () => { yields += 1; },
  });
  const beforeYields = yields;
  start = performance.now();
  const result = await preview.preview({ id: "graph", enabled: true, scope: "exclude-graph-contribution",
    matcher: { kind: "format-family", value: "markdown" }, createdAt: 1, note: "" });
  const previewMs = performance.now() - start;
  expect(result.matchCount).toBe(count * 3);
  expect(yields).toBeGreaterThan(beforeYields);
  expect(previewMs).toBeLessThan(large ? 2000 : 1000);
  console.log(`Policy/preview: ${count} files, ${count * 3} occurrences; regraph ${regraphMs.toFixed(1)} ms, ` +
    `preview ${previewMs.toFixed(1)} ms, ${yields} scheduling yields, zero adapter reads`);
  coordinator.stop();
});
