import { performance } from "node:perf_hooks";

import { describe, expect, it, vi } from "vitest";

import {
  classifyFileExtension,
  createFileRecord,
  LinkIndex,
  makeOccurrenceLookupKey,
  type FileRecord,
  type LinkOccurrence,
} from "../src/core";
import { SidebarQueryService } from "../src/app/sidebar-query-service";
import { createIsolatedFileProjection } from "../src/features/queries";
import { IgnoreService, type IgnoreRule } from "../src/shared/ignore-rules";
import { createDefaultSettings } from "../src/shared/settings";

const LARGE_MODE = process.env.LINK_INTEGRITY_BENCHMARK_MODE === "large";
const FILE_COUNT = LARGE_MODE ? 50_000 : 10_000;
const MAX_BUILD_MILLISECONDS = LARGE_MODE ? 30_000 : 8_000;
const GRAPH_IGNORE_BATCH_COUNT = LARGE_MODE ? 6 : 12;
const OCCURRENCES_PER_SOURCE = 3;
const QUERY_REFRESH_COUNT = LARGE_MODE ? 3 : 6;

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

  it("keeps graph-ignore single-source updates local", () => {
    const files = createGeneratedFiles();
    const index = buildGeneratedIndex(files);
    const service = new IgnoreService([graphIgnoreRule()]);
    applyLegacyGraphContributionRules(index, service);
    const source = files[0];
    expect(source).toBeDefined();
    const rebuildGraphState = vi.spyOn(
      index as unknown as { rebuildGraphState(): void },
      "rebuildGraphState",
    );
    let legacyEvaluationCount = 0;
    const legacyHeapBefore = process.memoryUsage().heapUsed;
    const legacyStartedAt = performance.now();
    for (let batch = 0; batch < GRAPH_IGNORE_BATCH_COUNT; batch += 1) {
      index.replaceSourceSnapshot(source!.path, generatedSnapshot(files, 0, batch + 1));
      legacyEvaluationCount += applyLegacyGraphContributionRules(index, service);
    }
    const legacyElapsed = performance.now() - legacyStartedAt;
    const legacyHeapDelta = process.memoryUsage().heapUsed - legacyHeapBefore;
    const legacyGraphRebuildCount = rebuildGraphState.mock.calls.length;
    const totalOccurrences = (FILE_COUNT - 100) * OCCURRENCES_PER_SOURCE;

    index.setContributionScope({});
    let optimizedEvaluationCount = 0;
    index.setGraphContributionPolicy({
      allows: ({ occurrence, sourceFile }) => {
        optimizedEvaluationCount += 1;
        const classification = classifyFileExtension(sourceFile.path);
        return !service.shouldExcludeGraphContribution({
          sourcePath: occurrence.sourcePath,
          targetPath: occurrence.targetPath,
          occurrenceId: occurrence.id,
          formatFamilyIds: classification.familyIds,
          extension: sourceFile.extension,
        });
      },
    });
    optimizedEvaluationCount = 0;
    rebuildGraphState.mockClear();
    const optimizedHeapBefore = process.memoryUsage().heapUsed;
    const optimizedStartedAt = performance.now();
    for (let batch = 0; batch < GRAPH_IGNORE_BATCH_COUNT; batch += 1) {
      const revision = GRAPH_IGNORE_BATCH_COUNT + batch + 1;
      index.replaceSourceSnapshot(source!.path, generatedSnapshot(files, 0, revision));
    }
    const optimizedElapsed = performance.now() - optimizedStartedAt;
    const optimizedHeapDelta = process.memoryUsage().heapUsed - optimizedHeapBefore;
    const optimizedGraphRebuildCount = rebuildGraphState.mock.calls.length;

    expect(index.getOutgoingNeighborCount(source!.path)).toBe(0);
    expect(legacyEvaluationCount).toBe(totalOccurrences * GRAPH_IGNORE_BATCH_COUNT);
    expect(legacyGraphRebuildCount).toBe(GRAPH_IGNORE_BATCH_COUNT);
    expect(optimizedEvaluationCount).toBe(
      OCCURRENCES_PER_SOURCE * 2 * GRAPH_IGNORE_BATCH_COUNT,
    );
    expect(optimizedGraphRebuildCount).toBe(0);
    expect(optimizedElapsed).toBeLessThan(legacyElapsed);
    expect(optimizedElapsed).toBeLessThan(LARGE_MODE ? 1_000 : 500);
    process.stdout.write(
      `\nLink Integrity graph-ignore benchmark: ${FILE_COUNT} files, ` +
      `${totalOccurrences} occurrences, ${GRAPH_IGNORE_BATCH_COUNT} single-source batches, ` +
      `legacy ${legacyEvaluationCount} evaluations/${legacyGraphRebuildCount} graph rebuilds ` +
      `in ${legacyElapsed.toFixed(1)} ms ` +
      `(heap ${(legacyHeapDelta / 1_048_576).toFixed(1)} MiB), ` +
      `optimized ${optimizedEvaluationCount} evaluations/${optimizedGraphRebuildCount} rebuilds ` +
      `in ${optimizedElapsed.toFixed(1)} ms ` +
      `(heap ${(optimizedHeapDelta / 1_048_576).toFixed(1)} MiB)\n`,
    );
  });

  it("bounds repeated all-isolated sidebar projections", () => {
    const index = new LinkIndex(createGeneratedFiles());
    const query = new SidebarQueryService(
      () => index,
      () => createDefaultSettings(),
    );
    const startedAt = performance.now();
    let isolatedCount = 0;
    for (let refresh = 0; refresh < QUERY_REFRESH_COUNT; refresh += 1) {
      query.notify();
      isolatedCount = query.getSnapshot().isolatedFiles.length;
    }
    const elapsed = performance.now() - startedAt;

    expect(isolatedCount).toBe(FILE_COUNT);
    expect(elapsed).toBeLessThan(LARGE_MODE ? 8_000 : 2_000);
    process.stdout.write(
      `\nLink Integrity sidebar-query benchmark: ${FILE_COUNT} isolated files, ` +
      `${QUERY_REFRESH_COUNT} full projections in ${elapsed.toFixed(1)} ms\n`,
    );
  });
});

function createGeneratedFiles(): readonly FileRecord[] {
  return Array.from({ length: FILE_COUNT }, (_, index) =>
    createFileRecord(`Generated/Note-${index.toString().padStart(6, "0")}.md`, {
      modifiedAt: index,
    }));
}

function buildGeneratedIndex(files: readonly FileRecord[]): LinkIndex {
  const index = new LinkIndex(files);
  for (let fileIndex = 0; fileIndex < files.length - 100; fileIndex += 1) {
    const source = files[fileIndex];
    if (source !== undefined) {
      index.replaceSourceSnapshot(source.path, generatedSnapshot(files, fileIndex, 0));
    }
  }
  return index;
}

function generatedSnapshot(
  files: readonly FileRecord[],
  sourceIndex: number,
  revision: number,
) {
  const source = files[sourceIndex];
  if (source === undefined) throw new Error(`Missing generated source at ${sourceIndex}.`);
  return {
    sourcePath: source.path,
    occurrences: Array.from({ length: OCCURRENCES_PER_SOURCE }, (_, occurrenceIndex) => {
      const targetIndex = (sourceIndex + occurrenceIndex + revision + 1) % (files.length - 100);
      const target = files[targetIndex];
      if (target === undefined) throw new Error(`Missing generated target at ${targetIndex}.`);
      return resolvedOccurrence(
        source.path,
        target.path,
        revision * OCCURRENCES_PER_SOURCE + occurrenceIndex,
      );
    }),
  };
}

function graphIgnoreRule(): IgnoreRule {
  return {
    id: "benchmark-graph-ignore",
    enabled: true,
    scope: "exclude-graph-contribution",
    matcher: { kind: "path-prefix", value: "Generated" },
    createdAt: 0,
    note: "",
  };
}

function applyLegacyGraphContributionRules(
  index: LinkIndex,
  service: IgnoreService,
): number {
  const excludedOccurrenceIds = new Set<string>();
  let evaluationCount = 0;
  for (const occurrence of index.occurrences) {
    evaluationCount += 1;
    const sourceFile = index.getFile(occurrence.sourcePath);
    const classification = sourceFile === null
      ? null
      : classifyFileExtension(sourceFile.path);
    if (service.shouldExcludeGraphContribution({
      sourcePath: occurrence.sourcePath,
      targetPath: occurrence.targetPath,
      occurrenceId: occurrence.id,
      formatFamilyIds: classification?.familyIds,
      extension: sourceFile?.extension ?? null,
    })) excludedOccurrenceIds.add(occurrence.id);
  }
  index.setContributionScope({ excludedOccurrenceIds });
  return evaluationCount;
}

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
