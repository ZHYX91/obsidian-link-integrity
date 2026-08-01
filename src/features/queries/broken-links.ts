import type { LinkIndex } from "../../core/link-index";
import type { LinkOccurrence } from "../../core/model";
import {
  isDiagnosticVisible,
  type DiagnosticScope,
} from "../../core/scopes";

export type BrokenLinkReason =
  | "missing-file"
  | "invalid"
  | "missing-heading"
  | "missing-block";

export interface BrokenLinkDiagnostic {
  readonly id: string;
  readonly sourcePath: string;
  readonly targetText: string;
  readonly resolvedTargetPath: string | null;
  readonly raw: string;
  readonly reason: BrokenLinkReason;
  readonly occurrence: LinkOccurrence;
}

export interface BrokenLinkQueryOptions {
  readonly scope?: DiagnosticScope;
}

export function getBrokenLinkReason(
  occurrence: LinkOccurrence,
): BrokenLinkReason | null {
  if (occurrence.destinationKind !== "internal") return null;
  if (occurrence.fileStatus === "missing") return "missing-file";
  if (occurrence.fileStatus === "invalid") return "invalid";
  if (occurrence.fileStatus !== "resolved") return null;
  if (occurrence.subpathStatus === "missing-heading") return "missing-heading";
  if (occurrence.subpathStatus === "missing-block") return "missing-block";
  return null;
}

export function isBrokenLinkOccurrence(occurrence: LinkOccurrence): boolean {
  return getBrokenLinkReason(occurrence) !== null;
}

export function queryBrokenLinks(
  index: LinkIndex,
  options: BrokenLinkQueryOptions = {},
): readonly BrokenLinkDiagnostic[] {
  const diagnostics: BrokenLinkDiagnostic[] = [];
  for (const occurrence of index.occurrences) {
    const reason = getBrokenLinkReason(occurrence);
    if (reason === null || !isDiagnosticVisible(occurrence, options.scope)) continue;
    diagnostics.push({
      id: occurrence.id,
      sourcePath: occurrence.sourcePath,
      targetText: occurrence.linkpath + (occurrence.subpath ?? ""),
      resolvedTargetPath: occurrence.targetPath,
      raw: occurrence.raw,
      reason,
      occurrence,
    });
  }
  return diagnostics.sort(compareDiagnostics);
}

export function countBrokenOutgoing(index: LinkIndex, sourcePath: string): number {
  const snapshot = index.getSourceSnapshot(sourcePath);
  if (snapshot === null) return 0;
  return snapshot.occurrences.filter(isBrokenLinkOccurrence).length;
}

function compareDiagnostics(
  left: BrokenLinkDiagnostic,
  right: BrokenLinkDiagnostic,
): number {
  return left.sourcePath.localeCompare(right.sourcePath) ||
    comparePosition(left.occurrence, right.occurrence) ||
    left.id.localeCompare(right.id);
}

function comparePosition(left: LinkOccurrence, right: LinkOccurrence): number {
  return (left.position?.line ?? Number.MAX_SAFE_INTEGER) -
    (right.position?.line ?? Number.MAX_SAFE_INTEGER) ||
    (left.position?.column ?? Number.MAX_SAFE_INTEGER) -
    (right.position?.column ?? Number.MAX_SAFE_INTEGER);
}
