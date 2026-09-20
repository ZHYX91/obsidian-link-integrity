import { classifyFileExtension, type LinkIndex, type LinkOccurrence } from "../core";
import { occurrenceIdSource } from "../core/occurrence-identity";
import { diagnoseOccurrence } from "../features/queries";
import { WorkScheduler, type WorkSchedulerOptions } from "../scheduling/work-scheduler";
import {
  createOccurrenceIgnoreContext, previewIgnoreRuleSteps,
  type IgnoreEvaluationContext, type IgnoreRule, type IgnoreRulePreview,
} from "../shared/ignore-rules";

export class IgnorePreviewService {
  public constructor(
    private readonly getIndex: () => LinkIndex,
    private readonly options: WorkSchedulerOptions = {},
  ) {}

  public async preview(rule: IgnoreRule, signal?: AbortSignal): Promise<IgnoreRulePreview> {
    while (true) {
      signal?.throwIfAborted();
      const index = this.getIndex();
      const version = index.version;
      const scheduler = new WorkScheduler(this.options);
      const steps = previewIgnoreRuleSteps(rule, previewContexts(index, rule));
      let step = steps.next();
      while (!step.done) {
        const pause = scheduler.checkpoint();
        if (pause !== null) await pause;
        signal?.throwIfAborted();
        if (this.getIndex() !== index || index.version !== version) break;
        step = steps.next();
      }
      if (step.done) return step.value;
      // A published index replaced the one being counted. Retry against its complete snapshot.
      steps.return({ matchCount: 0, samples: [] });
    }
  }
}

function* previewContexts(index: LinkIndex, rule: IgnoreRule): Iterable<IgnoreEvaluationContext | null> {
  if (rule.scope === "exclude-isolated-candidate") {
    for (const file of index.iterateFiles()) yield {
      candidatePath: file.path, extension: file.extension,
      formatFamilyIds: classifyFileExtension(file.path).familyIds,
    };
    return;
  }
  for (const occurrence of occurrenceCandidates(index, rule)) {
    const eligible = rule.scope === "exclude-graph-contribution"
      ? occurrence.fileStatus === "resolved" && occurrence.targetPath !== null
      : diagnoseOccurrence(occurrence) !== null;
    // Even non-diagnostics are work units, so mostly valid Vaults also yield.
    yield eligible ? createOccurrenceIgnoreContext(
      occurrence, index.getFile(occurrence.sourcePath)?.extension ?? null,
    ) : null;
  }
}

function* occurrenceCandidates(index: LinkIndex, rule: IgnoreRule): Iterable<LinkOccurrence> {
  if (rule.matcher.kind === "occurrence-id") {
    const source = occurrenceIdSource(rule.matcher.value);
    if (source !== null) yield* index.getSourceSnapshot(source)?.occurrences ?? [];
    else {
      const occurrence = index.getOccurrence(rule.matcher.value);
      if (occurrence !== null) yield occurrence;
    }
  } else if (rule.matcher.kind === "source-path") {
    yield* index.getSourceSnapshot(rule.matcher.value)?.occurrences ?? [];
  } else {
    yield* index.iterateOccurrences();
  }
}
