import type {
  FileStatus,
  LinkOccurrence,
  LinkOccurrenceKind,
  SourceSnapshot,
  SubpathStatus,
} from "../../src/core/model";

export function occurrence(
  id: string,
  sourcePath: string,
  options: {
    readonly linkpath?: string;
    readonly lookupKey?: string;
    readonly targetPath?: string | null;
    readonly fileStatus?: FileStatus;
    readonly subpath?: string | null;
    readonly subpathStatus?: SubpathStatus;
    readonly kind?: LinkOccurrenceKind;
    readonly destinationKind?: "internal" | "external";
  } = {},
): LinkOccurrence {
  const fileStatus = options.fileStatus ?? "resolved";
  const targetPath = options.targetPath === undefined
    ? fileStatus === "resolved" ? options.linkpath ?? "Target.md" : null
    : options.targetPath;
  const linkpath = options.linkpath ?? targetPath ?? "Missing";
  return {
    id,
    sourcePath,
    raw: `[[${linkpath}${options.subpath ?? ""}]]`,
    linkpath,
    subpath: options.subpath ?? null,
    lookupKey: options.lookupKey ?? linkpath,
    kind: options.kind ?? "markdown-link",
    position: null,
    destinationKind: options.destinationKind ?? "internal",
    targetPath,
    fileStatus,
    subpathStatus: options.subpathStatus ?? "none",
  };
}

export function snapshot(
  sourcePath: string,
  occurrences: readonly LinkOccurrence[],
): SourceSnapshot {
  return { sourcePath, occurrences };
}
