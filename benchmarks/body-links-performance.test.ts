import { Window } from "happy-dom";
import { expect, it, vi } from "vitest";
import { mapBodyReadingHints } from "../src/adapters/obsidian/body-link-reading";
import { bodySetup } from "../tests/helpers/body-links";

const count = process.env.LINK_INTEGRITY_BENCHMARK_MODE === "large" ? 50_000 : 10_000;
it(`shares one dense ${count}-reference source across reading sections`, async () => {
  const text = Array.from({ length: count }, (_, index) => `[[Missing-${index}|Label]]`).join("\n");
  const test = bodySetup(text);
  const enumeration = vi.spyOn(test.index, "iterateFiles");
  const confirm = vi.spyOn(test.port, "isConfirmed");
  const before = process.memoryUsage().heapUsed; const started = performance.now();
  const results = await Promise.all(Array.from({ length: 50 }, () => test.service.source(test.path, text)));
  expect(new Set(results).size).toBe(1); expect(results[0]!.hints).toHaveLength(count);
  expect(test.app.vault.cachedRead).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledTimes(count);
  expect(enumeration).not.toHaveBeenCalled();
  const window = new Window(); let mapped = 0;
  for (let section = 0; section < 50; section += 1) {
    const from = Math.floor(section * count / 50); const element = window.document.createElement("p");
    for (let index = from; index < from + 40; index += 1) {
      const anchor = window.document.createElement("a"); anchor.className = "internal-link"; anchor.dataset.href = `Missing-${index}`; anchor.textContent = "Label"; element.append(anchor);
    }
    mapped += mapBodyReadingHints(element as unknown as HTMLElement, results[0]!, from, from + 39).size;
  }
  expect(mapped).toBe(2_000);
  const repeated = bodySetup(Array.from({ length: 1_000 }, () => "[[Missing|Label]]").join("\n"));
  const source = await repeated.service.source(repeated.path, repeated.text); const element = window.document.createElement("p");
  for (let index = 0; index < 1_000; index += 1) {
    const anchor = window.document.createElement("a"); anchor.className = "internal-link"; anchor.dataset.href = "Missing"; anchor.textContent = "Label"; element.append(anchor);
  }
  expect(mapBodyReadingHints(element as unknown as HTMLElement, source, 0, 999).size).toBe(0);
  console.log(`Body diagnostics: 1 source, ${count} references, ${text.length} UTF16 units; 50 shared requests, 1 proof/projection, ` +
    `50 sections x40 mapped anchors, 1000 duplicate-destination negatives; ${Math.round(performance.now() - started)} ms, ` +
    `heap delta ${Math.round((process.memoryUsage().heapUsed - before) / 1024 / 1024)} MiB (diagnostic only; output grows with references).`);
  await window.happyDOM.close();
});
