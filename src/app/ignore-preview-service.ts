import { classifyFileExtension, type FileRecord, type LinkIndex, type LinkOccurrence } from "../core";
import { occurrenceIdSource } from "../core/occurrence-identity";
import { diagnoseOccurrence } from "../features/queries";
import { runIndexPreview } from "./index-preview";
import type { WorkSchedulerOptions } from "../scheduling/work-scheduler";
import {
  createOccurrenceIgnoreContext, previewIgnoreRuleSteps,
  type IgnoreEvaluationContext, type IgnoreRule, type IgnoreRulePreview,
} from "../shared/ignore-rules";

export class IgnorePreviewService {
  public constructor(
    private readonly getIndex: () => LinkIndex,
    private readonly options: WorkSchedulerOptions = {},
  ) {}

  public preview(rule: IgnoreRule, signal?: AbortSignal): Promise<IgnoreRulePreview> {
    return runIndexPreview(this.getIndex, (index) => previewIgnore(index, rule), signal, this.options);
  }
}

function* previewIgnore(index: LinkIndex, rule: IgnoreRule): Generator<void, IgnoreRulePreview> {
  const files = new Set<string>();
  const targetsBySource = new Map<string, Set<string>>();
  let connectionCount = 0;
  const preview = yield* previewIgnoreRuleSteps(rule, previewContexts(index, rule), undefined, (context) => {
    const source = context.candidatePath ?? context.sourcePath;
    if (source == null) return;
    files.add(source);
    const target = context.targetPath;
    if (rule.scope !== "exclude-graph-contribution" || target == null) return;
    files.add(target);
    let targets = targetsBySource.get(source);
    if (targets === undefined) {
      targets = new Set<string>();
      targetsBySource.set(source, targets);
    }
    if (!targets.has(target)) {
      targets.add(target);
      connectionCount += 1;
    }
  });
  return { ...preview, affectedFileCount: files.size, affectedConnectionCount: connectionCount };
}

function* previewContexts(index: LinkIndex, rule: IgnoreRule): Iterable<IgnoreEvaluationContext | null> {
  if (rule.scope === "exclude-isolated-candidate") {
    for (const file of index.iterateFiles()) yield {
      candidatePath: file.path, extension: file.extension,
      formatFamilyIds: classifyFileExtension(file.path).familyIds,
    };
    return;
  }
  // The index owns each file's extension. Cache classifications within this scan
  // so a restart after a Vault change always uses fresh source metadata.
  const records = new Map<string, FileRecord | null>();
  const fileAt = (path: string) => {
    let record = records.get(path);
    if (record === undefined) {
      record = index.getFile(path);
      records.set(path, record);
    }
    return record;
  };
  const sourceTypes = new Map<string, ReturnType<typeof classifyFileExtension>>();
  const classifySource = (value: string) => {
    let type = sourceTypes.get(value);
    if (type === undefined) {
      type = classifyFileExtension(value);
      sourceTypes.set(value, type);
    }
    return type;
  };
  for (const occurrence of occurrenceCandidates(index, rule)) {
    const eligible = rule.scope === "exclude-graph-contribution"
      ? occurrence.fileStatus === "resolved" && occurrence.targetPath !== null &&
        occurrence.sourcePath !== occurrence.targetPath && fileAt(occurrence.targetPath) !== null
      : diagnoseOccurrence(occurrence) !== null;
    // Even non-diagnostics are work units, so mostly valid Vaults also yield.
    yield eligible ? createOccurrenceIgnoreContext(
      occurrence, fileAt(occurrence.sourcePath)?.extension ?? null, classifySource,
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
