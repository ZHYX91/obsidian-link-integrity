import { classifyFileExtension, extensionFromPath, normalizeExtension } from "./file-types";

export const LINK_OCCURRENCE_KINDS = [
  "markdown-link",
  "markdown-embed",
  "frontmatter",
  "canvas-file",
  "canvas-background",
  "canvas-text",
  "bases-explicit",
] as const;

export type LinkOccurrenceKind = (typeof LINK_OCCURRENCE_KINDS)[number];

export type LinkDestinationKind = "internal" | "external";
export type FileStatus = "resolved" | "missing" | "invalid" | "pending";
export type SubpathStatus =
  | "none"
  | "ok"
  | "missing-heading"
  | "missing-block"
  | "unsupported"
  | "pending";

export interface SourcePosition {
  readonly line: number | null;
  readonly column: number | null;
  readonly endLine: number | null;
  readonly endColumn: number | null;
  readonly property: string | null;
  readonly canvasNodeId: string | null;
}

export interface FileRecord {
  readonly path: string;
  readonly extension: string;
  readonly lookupKeys: readonly string[];
  readonly modifiedAt: number;
  /** Null means host metadata is not ready; absent ports retain conservative invalidation. */
  readonly targetFingerprint?: string | null;
}

export interface LinkOccurrence {
  readonly id: string;
  readonly sourcePath: string;
  readonly raw: string;
  readonly linkpath: string;
  readonly subpath: string | null;
  readonly lookupKey: string;
  readonly kind: LinkOccurrenceKind;
  readonly position: SourcePosition | null;
  readonly destinationKind: LinkDestinationKind;
  readonly targetPath: string | null;
  readonly fileStatus: FileStatus;
  readonly subpathStatus: SubpathStatus;
}

export interface SourceSnapshot {
  readonly sourcePath: string;
  readonly occurrences: readonly LinkOccurrence[];
}

export function createFileRecord(
  path: string,
  options: {
    readonly lookupKeys?: readonly string[];
    readonly extension?: string;
    readonly targetFingerprint?: string | null;
    readonly modifiedAt?: number;
  } = {},
): FileRecord {
  const normalizedPath = normalizeVaultPath(path);
  const extension = options.extension === undefined ? extensionFromPath(normalizedPath) : normalizeExtension(options.extension);
  return {
    path: normalizedPath,
    extension,
    lookupKeys: options.lookupKeys === undefined
      ? makeFileLookupKeys(normalizedPath)
      : normalizeLookupKeys(options.lookupKeys),
    modifiedAt: options.modifiedAt ?? 0,
    ...(options.targetFingerprint === undefined ? {} : { targetFingerprint: options.targetFingerprint }),
  };
}

export function normalizeFileRecord(file: FileRecord): FileRecord {
  const path = normalizeVaultPath(file.path);
  return {
    path,
    extension: normalizeExtension(file.extension),
    lookupKeys: normalizeLookupKeys(file.lookupKeys),
    modifiedAt: Number.isFinite(file.modifiedAt) ? file.modifiedAt : 0,
    ...(file.targetFingerprint === undefined ? {} : { targetFingerprint: file.targetFingerprint }),
  };
}

export function normalizeVaultPath(path: string): string {
  const normalized = path.trim().split("\\").join("/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`Vault path cannot contain parent traversal: ${path}`);
  }
  if (segments.length === 0) throw new Error("Vault path cannot be empty.");
  return segments.join("/");
}

export function normalizeLookupKey(key: string): string {
  const path = canonicalLookupKey(key);
  const extension = extensionFromPath(path);
  return extension && classifyFileExtension(extension).isKnown ? path.slice(0, -(extension.length + 1)) : path;
}

/** Normalize a dependency key already derived from a link, preserving its remaining suffixes. */
export function canonicalLookupKey(key: string): string {
  return collapsePathSegments(key.trim().replaceAll("\\", "/").toLocaleLowerCase("en-US"));
}

export function makeFileLookupKeys(path: string): readonly string[] {
  const normalizedPath = normalizeVaultPath(path);
  const fullPathKey = normalizeLookupKey(normalizedPath);
  // The host can resolve any path suffix, not only the basename or full path.
  // These are conservative dependencies; the host still chooses the target.
  const keys: string[] = [];
  const addSuffixes = (key: string): void => {
    keys.push(key);
    for (let slash = key.indexOf("/"); slash >= 0; slash = key.indexOf("/", slash + 1)) {
      keys.push(key.slice(slash + 1));
    }
  };
  addSuffixes(fullPathKey);
  // The host can also resolve a note with its .md omitted (e.g. A.tar.gz
  // can resolve A.tar.gz.md). Index that authored spelling as a dependency.
  if (normalizedPath.toLowerCase().endsWith(".md") && fullPathKey.includes(".")) {
    const omitted = normalizeLookupKey(fullPathKey);
    if (omitted !== fullPathKey) addSuffixes(omitted);
  }
  return keys;
}

export function makeOccurrenceLookupKey(linkpath: string, sourcePath: string): string {
  const normalizedLinkpath = linkpath.trim().split("\\").join("/");
  const isRelative = normalizedLinkpath === "." ||
    normalizedLinkpath === ".." ||
    normalizedLinkpath.startsWith("./") ||
    normalizedLinkpath.startsWith("../");
  if (!isRelative) return normalizeLookupKey(normalizedLinkpath);

  const normalizedSource = normalizeVaultPath(sourcePath);
  const sourceFolder = normalizedSource.split("/").slice(0, -1);
  return normalizeLookupKey([...sourceFolder, normalizedLinkpath].join("/"));
}

export function validateSourceSnapshot(snapshot: SourceSnapshot): void {
  const sourcePath = normalizeVaultPath(snapshot.sourcePath);
  const ids = new Set<string>();
  for (const occurrence of snapshot.occurrences) {
    validateLinkOccurrence(occurrence, sourcePath, ids);
  }
}

export function validateLinkOccurrence(
  occurrence: LinkOccurrence,
  sourcePath: string,
  ids: Set<string>,
): void {
  if (occurrence.id.length === 0) throw new Error("Occurrence ID cannot be empty.");
  if (ids.has(occurrence.id)) {
    throw new Error(`Duplicate occurrence ID in ${sourcePath}: ${occurrence.id}`);
  }
  ids.add(occurrence.id);
  if (normalizeVaultPath(occurrence.sourcePath) !== sourcePath) {
    throw new Error(`Occurrence ${occurrence.id} belongs to a different source path.`);
  }
  validateOccurrenceResolution(occurrence);
}

export function isFileLevelResolved(occurrence: LinkOccurrence): boolean {
  return occurrence.destinationKind === "internal" &&
    occurrence.fileStatus === "resolved" &&
    occurrence.targetPath !== null;
}

export function getFileClassification(file: FileRecord) {
  return classifyFileExtension(file.extension);
}

function validateOccurrenceResolution(occurrence: LinkOccurrence): void {
  if (occurrence.destinationKind === "external") {
    if (occurrence.targetPath !== null) {
      throw new Error(`External occurrence ${occurrence.id} cannot have a Vault target.`);
    }
    return;
  }
  if (occurrence.fileStatus === "resolved" && occurrence.targetPath === null) {
    throw new Error(`Resolved occurrence ${occurrence.id} must have a target path.`);
  }
  if (occurrence.fileStatus !== "resolved" && occurrence.targetPath !== null) {
    throw new Error(`Unresolved occurrence ${occurrence.id} cannot have a target path.`);
  }
}

function normalizeLookupKeys(keys: readonly string[]): readonly string[] {
  return Array.from(new Set(keys.map(canonicalLookupKey).filter((key) => key.length > 0)));
}

function collapsePathSegments(path: string): string {
  const result: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") result.pop();
    else result.push(segment);
  }
  return result.join("/");
}
