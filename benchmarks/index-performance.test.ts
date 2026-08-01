import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import {
  createFileRecord,
  LinkIndex,
  makeOccurrenceLookupKey,
  type LinkOccurrence,
} from "../src/core";
import { createIsolatedFileProjection } from "../src/features/queries";

const LARGE_MODE = process.env.LINK_INTEGRITY_BENCHMARK_MODE === "large";
const FILE_COUNT = LARGE_MODE ? 50_000 : 10_000;
const MAX_BUILD_MILLISECONDS = LARGE_MODE ? 30_000 : 8_000;

describe(`LinkIndex generated ${FILE_COUNT.toLocaleString()}-file benchmark`, () => {
  it("builds a deterministic graph and projects isolated files within the guardrail", () => {
    const files = Array.from({ length: FILE_COUNT }, (_, index) =>
      createFileRecord(`Generated/Note-${index.toString().padStart(6, "0")}.md`, {
        modifiedAt: index,
      }));
    const index = new LinkIndex(files);
    const startedAt = performance.now();
    for (let fileIndex = 0; fileIndex < files.length - 100; fileIndex += 1) {
      const source = files[fileIndex];
      const target = files[(fileIndex + 1) % (files.length - 100)];
      if (source === undefined || target === undefined) continue;
      index.replaceSourceSnapshot(source.path, {
        sourcePath: source.path,
        occurrences: [resolvedOccurrence(source.path, target.path, fileIndex)],
      });
    }
    const projection = createIsolatedFileProjection(index);
    const elapsed = performance.now() - startedAt;

    expect(projection.mainCount).toBe(100);
    expect(index.getOutgoingNeighborCount(files[0]?.path ?? "missing.md")).toBe(1);
    expect(elapsed).toBeLessThan(MAX_BUILD_MILLISECONDS);
    process.stdout.write(
      `\nLink Integrity benchmark: ${FILE_COUNT} files in ${elapsed.toFixed(1)} ms\n`,
    );
  });
});

function resolvedOccurrence(
  sourcePath: string,
  targetPath: string,
  ordinal: number,
): LinkOccurrence {
  return {
    id: `${sourcePath}:${ordinal}`,
    sourcePath,
    raw: `[[${targetPath}]]`,
    linkpath: targetPath,
    subpath: null,
    lookupKey: makeOccurrenceLookupKey(targetPath, sourcePath),
    kind: "markdown-link",
    position: null,
    destinationKind: "internal",
    targetPath,
    fileStatus: "resolved",
    subpathStatus: "none",
  };
}
