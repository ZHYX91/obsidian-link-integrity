import { LINK_OCCURRENCE_KINDS, type LinkOccurrenceKind } from "./model";

const OCCURRENCE_ID_PREFIX = "occ-v2";
const SEPARATOR = "\u0000";

export interface OccurrenceIdentityInput {
  readonly sourcePath: string;
  readonly kind: LinkOccurrenceKind;
  readonly raw: string;
  readonly linktext: string;
  readonly duplicateIndex: number;
  readonly duplicateCount: number;
}

export function occurrenceSemanticKey(
  input: Pick<OccurrenceIdentityInput, "kind" | "raw" | "linktext">,
): string {
  return `${input.kind}${SEPARATOR}${input.raw}${SEPARATOR}${input.linktext}`;
}

export function createOccurrenceId(input: OccurrenceIdentityInput): string {
  return [
    OCCURRENCE_ID_PREFIX,
    normalizePath(input.sourcePath),
    input.kind,
    stableTextHash(occurrenceSemanticKey(input)),
    String(input.duplicateIndex),
    String(input.duplicateCount),
  ].join(SEPARATOR);
}

export function occurrenceIdMatches(expected: string, actual: string | null | undefined): boolean {
  return expected === actual && isCurrentOccurrenceId(expected);
}

/** Import known persisted semantic IDs once; positional and unknown IDs need review. */
export function normalizeOccurrenceRuleId(value: string): string | null {
  const parts = value.split(SEPARATOR);
  if (parts.length === 8) {
    if (!isUnsignedInteger(parts[7])) return null;
    parts.length = 6;
  }
  return isSemanticIdentity(parts) ? parts.join(SEPARATOR) : null;
}

export function isCurrentOccurrenceId(value: string): boolean {
  return isSemanticIdentity(value.split(SEPARATOR));
}

export function occurrenceIdSource(occurrenceId: string): string | null {
  const parts = occurrenceId.split(SEPARATOR);
  return isSemanticIdentity(parts) ? parts[1] ?? null : null;
}

export function renameOccurrenceIdSource(
  occurrenceId: string,
  oldPathInput: string,
  newPathInput: string,
): string {
  const parts = occurrenceId.split(SEPARATOR);
  if (!isSemanticIdentity(parts)) return occurrenceId;
  const sourcePath = parts[1]!;
  const oldPath = normalizePath(oldPathInput);
  const newPath = normalizePath(newPathInput);
  const renamed = sourcePath === oldPath
    ? newPath
    : sourcePath.startsWith(`${oldPath}/`)
      ? `${newPath}${sourcePath.slice(oldPath.length)}`
      : sourcePath;
  if (renamed === sourcePath) return occurrenceId;
  parts[1] = renamed;
  return parts.join(SEPARATOR);
}

function isSemanticIdentity(parts: readonly string[]): boolean {
  const [prefix, source, kind, hash, duplicateIndex, duplicateCount] = parts;
  return parts.length === 6 && prefix === OCCURRENCE_ID_PREFIX && source !== undefined && source.length > 0 &&
    normalizePath(source) === source && LINK_OCCURRENCE_KINDS.includes(kind as LinkOccurrenceKind) &&
    hash !== undefined && /^[0-9a-f]{32}$/u.test(hash) &&
    isUnsignedInteger(duplicateIndex) && isUnsignedInteger(duplicateCount) &&
    Number(duplicateIndex) < Number(duplicateCount);
}

function isUnsignedInteger(value: string | undefined): boolean {
  return value !== undefined && /^(?:0|[1-9][0-9]*)$/u.test(value) && Number.isSafeInteger(Number(value));
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
}

function stableTextHash(value: string): string {
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
    .map((seed) => {
      let hash = seed;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    })
    .join("");
}
