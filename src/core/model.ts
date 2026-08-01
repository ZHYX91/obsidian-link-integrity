import { classifyFileExtension, normalizeExtension } from "./file-types";

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
    readonly modifiedAt?: number;
  } = {},
): FileRecord {
  const normalizedPath = normalizeVaultPath(path);
  const extension = normalizeExtension(normalizedPath);
  return {
    path: normalizedPath,
    extension,
    lookupKeys: options.lookupKeys === undefined
      ? makeFileLookupKeys(normalizedPath)
      : normalizeLookupKeys(options.lookupKeys),
    modifiedAt: options.modifiedAt ?? 0,
  };
}

export function normalizeFileRecord(file: FileRecord): FileRecord {
  const path = normalizeVaultPath(file.path);
  return {
    path,
    extension: normalizeExtension(file.extension.length > 0 ? file.extension : path),
    lookupKeys: normalizeLookupKeys(file.lookupKeys),
    modifiedAt: Number.isFinite(file.modifiedAt) ? file.modifiedAt : 0,
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
  const normalized = key.trim().split("\\").join("/").toLocaleLowerCase("en-US");
  const withoutLeadingSlash = normalized.replace(/^\/+|\/+$/gu, "");
  const withoutExtension = classifyFileExtension(withoutLeadingSlash).isKnown
    ? withoutLeadingSlash.replace(/\.[^/.]+$/u, "")
    : withoutLeadingSlash;
  return collapsePathSegments(withoutExtension);
}

export function makeFileLookupKeys(path: string): readonly string[] {
  const normalizedPath = normalizeVaultPath(path);
  const fullPathKey = normalizeLookupKey(normalizedPath);
  const pathSegments = fullPathKey.split("/");
  const basenameKey = pathSegments[pathSegments.length - 1] ?? fullPathKey;
  return Array.from(new Set([fullPathKey, basenameKey]));
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
}

export function isFileLevelResolved(occurrence: LinkOccurrence): boolean {
  return occurrence.destinationKind === "internal" &&
    occurrence.fileStatus === "resolved" &&
    occurrence.targetPath !== null;
}

export function getFileClassification(file: FileRecord) {
  return classifyFileExtension(file.extension.length > 0 ? file.extension : file.path);
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
  return Array.from(new Set(keys.map(normalizeLookupKey).filter((key) => key.length > 0)));
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
