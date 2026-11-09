import { classifyFileExtension, normalizeVaultPath, type LinkOccurrence } from "../core";

/** Exact file identity; never use the case-folded, extension-free lookup index. */
export function occurrenceTargetFilePath(occurrence: LinkOccurrence): string | null {
  if (occurrence.destinationKind !== "internal") return null;
  if (occurrence.targetPath !== null) return normalizeExactTargetPath(occurrence.targetPath);
  if (occurrence.fileStatus !== "missing") return null;
  if (occurrence.kind === "canvas-file" || occurrence.kind === "canvas-background") {
    return normalizeExactTargetPath(occurrence.linkpath);
  }

  const linkpath = occurrence.linkpath.trim().replaceAll("\\", "/");
  // A missing short name depends on host lookup/new-note settings. Encoded names
  // also lack proof of whether the host treated an escape as literal file text.
  if (!linkpath.includes("/") || /%[\da-f]{2}/iu.test(linkpath)) return null;
  const relative = linkpath.startsWith("./") || linkpath.startsWith("../");
  const segments = relative ? occurrence.sourcePath.split("/").slice(0, -1) : [];
  for (const segment of linkpath.split("/")) {
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else if (segment !== "" && segment !== ".") segments.push(segment);
  }
  if (linkpath.endsWith("/") || linkpath.endsWith("/.") || linkpath.endsWith("/..")) return null;
  const path = normalizeExactTargetPath(segments.join("/"));
  return path === null ? null : withNoteExtension(path);
}

/** Values in a confirmed target rule are Vault paths, not link text/subpaths. */
export function normalizeExactTargetPath(value: string): string | null {
  const path = value.trim().replaceAll("\\", "/");
  if (path.length === 0 || path.endsWith("/") || /[\r\n\0]/u.test(path) ||
    path.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return normalizeVaultPath(path);
}

/** Only old explicitly rooted/folder paths can be recovered without a source. */
export function recoverTargetRulePath(value: string): string | null {
  if (!value.includes("/") || value.includes("#") || /%[\da-f]{2}/iu.test(value)) return null;
  const path = normalizeExactTargetPath(value);
  // Old values do not identify their source kind. An extensionless value could
  // be an exact Canvas file or Markdown with an omitted .md, so do not infer it.
  return path !== null && classifyFileExtension(path).isKnown ? path : null;
}

function withNoteExtension(path: string): string | null {
  const basename = path.split("/").at(-1)!;
  if (basename.lastIndexOf(".") <= 0) return `${path}.md`;
  // Topic.v1 can be either a custom file or a note whose .md was omitted.
  return classifyFileExtension(path).isKnown ? path : null;
}
