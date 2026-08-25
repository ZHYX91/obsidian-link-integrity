const OCCURRENCE_ID_PREFIX = "occ-v2";
const SEPARATOR = "\u0000";

export interface OccurrenceIdentityInput {
  readonly sourcePath: string;
  readonly kind: string;
  readonly raw: string;
  readonly linktext: string;
  readonly duplicateIndex: number;
  readonly duplicateCount: number;
  readonly location: string;
  readonly legacyOrdinal: number;
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
    input.location,
    String(input.legacyOrdinal),
  ].join(SEPARATOR);
}

export function occurrenceIdMatches(expected: string, actual: string | null | undefined): boolean {
  if (actual === null || actual === undefined) return false;
  if (expected === actual) return true;
  const saved = expected.split(SEPARATOR);
  const current = actual.split(SEPARATOR);
  if (saved.length === 8 && current.length === 8 &&
      saved[0] === OCCURRENCE_ID_PREFIX && current[0] === OCCURRENCE_ID_PREFIX) {
    return saved.slice(1, 6).every((part, index) => part === current[index + 1]);
  }
  return saved.length === 4 && current.length === 8 && current[0] === OCCURRENCE_ID_PREFIX &&
    saved[0] === current[1] && saved[1] === current[2] &&
    saved[2] === current[6] && saved[3] === current[7];
}

export function renameOccurrenceIdSource(
  occurrenceId: string,
  oldPathInput: string,
  newPathInput: string,
): string {
  const parts = occurrenceId.split(SEPARATOR);
  const sourceIndex = parts[0] === OCCURRENCE_ID_PREFIX ? 1 : parts.length === 4 ? 0 : -1;
  if (sourceIndex < 0) return occurrenceId;
  const sourcePath = parts[sourceIndex];
  if (sourcePath === undefined) return occurrenceId;
  const oldPath = normalizePath(oldPathInput);
  const newPath = normalizePath(newPathInput);
  const renamed = sourcePath === oldPath
    ? newPath
    : sourcePath.startsWith(`${oldPath}/`)
      ? `${newPath}${sourcePath.slice(oldPath.length)}`
      : sourcePath;
  if (renamed === sourcePath) return occurrenceId;
  parts[sourceIndex] = renamed;
  return parts.join(SEPARATOR);
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
