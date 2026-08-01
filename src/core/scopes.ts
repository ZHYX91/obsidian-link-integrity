import type { FileTypeCategoryId, FormatFamilyId } from "./file-types";
import { classifyFileExtension, normalizeExtension } from "./file-types";
import type { FileRecord, LinkOccurrence } from "./model";
import { normalizeLookupKey } from "./model";

export interface CandidateScope {
  readonly familyIds: ReadonlySet<FormatFamilyId>;
  readonly categoryIds?: ReadonlySet<FileTypeCategoryId>;
  readonly customExtensions?: ReadonlySet<string>;
  readonly excludedPaths?: ReadonlySet<string>;
}

export interface DiagnosticScope {
  readonly excludedSourcePaths?: ReadonlySet<string>;
  readonly excludedTargetPaths?: ReadonlySet<string>;
  readonly excludedLookupKeys?: ReadonlySet<string>;
  readonly excludedOccurrenceIds?: ReadonlySet<string>;
}

export interface GraphContributionScope {
  readonly excludedSourcePaths?: ReadonlySet<string>;
  readonly excludedTargetPaths?: ReadonlySet<string>;
  readonly excludedOccurrenceIds?: ReadonlySet<string>;
}

export const EMPTY_GRAPH_CONTRIBUTION_SCOPE: GraphContributionScope = Object.freeze({});

export function isCandidateFile(file: FileRecord, scope: CandidateScope): boolean {
  if (scope.excludedPaths?.has(file.path) === true) return false;
  const classification = classifyFileExtension(file.extension.length > 0
    ? file.extension
    : file.path);
  if (classification.isKnown &&
    classification.familyIds.some((id) => scope.familyIds.has(id))) return true;
  if (classification.isKnown && scope.categoryIds !== undefined &&
    classification.categoryIds.some((id) => scope.categoryIds?.has(id) === true)) return true;
  const extension = normalizeExtension(file.extension.length > 0 ? file.extension : file.path);
  const customFamilySelected = scope.familyIds.has("other-custom") ||
    scope.categoryIds?.has("other") === true;
  return customFamilySelected && scope.customExtensions !== undefined &&
    Array.from(scope.customExtensions, normalizeExtension).includes(extension);
}

export function isDiagnosticVisible(
  occurrence: LinkOccurrence,
  scope: DiagnosticScope = {},
): boolean {
  return scope.excludedSourcePaths?.has(occurrence.sourcePath) !== true &&
    scope.excludedOccurrenceIds?.has(occurrence.id) !== true &&
    !hasNormalizedLookupKey(scope.excludedLookupKeys, occurrence.lookupKey) &&
    (occurrence.targetPath === null || scope.excludedTargetPaths?.has(occurrence.targetPath) !== true);
}

function hasNormalizedLookupKey(
  keys: ReadonlySet<string> | undefined,
  lookupKey: string,
): boolean {
  if (keys === undefined) return false;
  const normalized = normalizeLookupKey(lookupKey);
  for (const key of keys) {
    if (normalizeLookupKey(key) === normalized) return true;
  }
  return false;
}

export function isGraphContributionAllowed(
  occurrence: LinkOccurrence,
  scope: GraphContributionScope = EMPTY_GRAPH_CONTRIBUTION_SCOPE,
): boolean {
  return scope.excludedSourcePaths?.has(occurrence.sourcePath) !== true &&
    scope.excludedOccurrenceIds?.has(occurrence.id) !== true &&
    (occurrence.targetPath === null || scope.excludedTargetPaths?.has(occurrence.targetPath) !== true);
}
