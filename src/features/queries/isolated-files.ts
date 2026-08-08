import {
  DEFAULT_ISOLATED_CANDIDATE_FAMILIES,
  classifyFileExtension,
  type FormatFamilyId,
} from "../../core/file-types";
import type { LinkIndex } from "../../core/link-index";
import type { FileRecord } from "../../core/model";
import { isCandidateFile, type CandidateScope } from "../../core/scopes";
import { countBrokenOutgoing } from "./broken-links";
import {
  matchExpectedIsolatedRules,
  type ExpectedIsolatedRule,
} from "./expected-isolated";

export type IsolatedQueryMode = "isolated" | "no-incoming";
export type IsolationClassification = "isolated" | "expected-isolated" | "no-incoming";
export type IsolationConfidence = "high" | "low" | "expected";

export interface IsolatedFileResult {
  readonly path: string;
  readonly extension: string;
  readonly formatFamilyId: FormatFamilyId;
  readonly formatFamilyIds: readonly FormatFamilyId[];
  readonly modifiedAt: number;
  readonly incomingCount: number;
  readonly outgoingCount: number;
  readonly incomingContributionCount: number;
  readonly outgoingContributionCount: number;
  readonly brokenOutgoingCount: number;
  readonly classification: IsolationClassification;
  readonly confidence: IsolationConfidence;
  readonly expectedRuleIds: readonly string[];
}

export interface IsolatedFileQueryOptions {
  readonly mode?: IsolatedQueryMode;
  readonly candidateScope?: CandidateScope;
  readonly expectedRules?: readonly ExpectedIsolatedRule[];
  readonly expectedFilePaths?: ReadonlySet<string>;
  readonly includeExpected?: boolean;
}

export interface IsolatedFileProjection {
  readonly items: readonly IsolatedFileResult[];
  readonly mainCount: number;
  readonly lowConfidenceCount: number;
  readonly expectedExcludedCount: number;
}

export function createDefaultCandidateScope(): CandidateScope {
  return { familyIds: new Set(DEFAULT_ISOLATED_CANDIDATE_FAMILIES) };
}

export function queryIsolatedFiles(
  index: LinkIndex,
  options: IsolatedFileQueryOptions = {},
): readonly IsolatedFileResult[] {
  return createIsolatedFileProjection(index, options).items;
}

export function createIsolatedFileProjection(
  index: LinkIndex,
  options: IsolatedFileQueryOptions = {},
): IsolatedFileProjection {
  const mode = options.mode ?? "isolated";
  const candidateScope = options.candidateScope ?? createDefaultCandidateScope();
  const expectedRules = options.expectedRules ?? [];
  const expectedFilePaths = options.expectedFilePaths ?? new Set<string>();
  const includeExpected = options.includeExpected ?? false;
  const candidates = index.files.filter((file) => isCandidateFile(file, candidateScope));
  const allResults = candidates
    .map((file) => projectFile(index, file, mode, expectedRules, expectedFilePaths))
    .filter((result): result is IsolatedFileResult => result !== null);
  const expectedExcludedCount = allResults.filter(({ classification }) =>
    classification === "expected-isolated").length;
  const items = allResults
    .filter(({ classification }) => includeExpected || classification !== "expected-isolated")
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    items,
    mainCount: items.filter(({ classification }) => classification !== "expected-isolated").length,
    lowConfidenceCount: items.filter(({ confidence }) => confidence === "low").length,
    expectedExcludedCount,
  };
}

function projectFile(
  index: LinkIndex,
  file: FileRecord,
  mode: IsolatedQueryMode,
  expectedRules: readonly ExpectedIsolatedRule[],
  expectedFilePaths: ReadonlySet<string>,
): IsolatedFileResult | null {
  const incomingCount = index.getIncomingNeighborCount(file.path);
  const outgoingCount = index.getOutgoingNeighborCount(file.path);
  const isolated = incomingCount === 0 && outgoingCount === 0;
  if (mode === "isolated" ? !isolated : incomingCount !== 0) return null;

  const expected = isolated
    ? expectedFilePaths.has(file.path)
      ? { expected: true, matchedRuleIds: [] }
      : matchExpectedIsolatedRules(file, expectedRules)
    : { expected: false, matchedRuleIds: [] };
  const brokenOutgoingCount = countBrokenOutgoing(index, file.path);
  const classification: IsolationClassification = expected.expected
    ? "expected-isolated"
    : isolated
      ? "isolated"
      : "no-incoming";
  const confidence: IsolationConfidence = expected.expected
    ? "expected"
    : brokenOutgoingCount > 0
      ? "low"
      : "high";
  const fileType = classifyFileExtension(file.extension.length > 0 ? file.extension : file.path);
  return {
    path: file.path,
    extension: file.extension,
    formatFamilyId: fileType.primaryFamilyId,
    formatFamilyIds: fileType.familyIds,
    modifiedAt: file.modifiedAt,
    incomingCount,
    outgoingCount,
    incomingContributionCount: index.getIncomingContributionCount(file.path),
    outgoingContributionCount: index.getOutgoingContributionCount(file.path),
    brokenOutgoingCount,
    classification,
    confidence,
    expectedRuleIds: expected.matchedRuleIds,
  };
}
