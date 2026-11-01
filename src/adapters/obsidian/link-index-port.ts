import {
  parseLinktext,
  resolveSubpath,
  type FrontmatterLinkCache,
  type LinkCache,
  type MetadataCache,
  type ReferenceCache,
  type TFile,
  type Vault,
  type CachedMetadata,
} from "obsidian";

import {
  createFileRecord,
  makeOccurrenceLookupKey,
  type LinkOccurrence,
  type LinkOccurrenceKind,
  type SourcePosition,
  type SourceSnapshot,
} from "../../core";
import type { LinkIndexPort } from "../../features/index";
import type { WorkScheduler } from "../../scheduling/work-scheduler";
import {
  createOccurrenceId,
  occurrenceSemanticKey,
} from "../../core/occurrence-identity";
import {
  extractBasesExplicitReferences,
  findMarkdownFrontmatterRange,
  isExternalReference,
  parseMarkdownSourceAsync,
  type ParsedExplicitReference,
} from "./explicit-link-parser";

interface CanvasNode {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly file?: unknown;
  readonly subpath?: unknown;
  readonly text?: unknown;
  readonly background?: unknown;
}

interface CanvasDocument {
  readonly nodes?: unknown;
}

interface OccurrenceInput {
  readonly raw: string;
  readonly linktext: string;
  readonly kind: LinkOccurrenceKind;
  readonly position: SourcePosition | null;
  readonly ordinal?: number;
}

interface OccurrenceIdentityOrdinal {
  readonly duplicateIndex: number;
  readonly duplicateCount: number;
  readonly index: number;
}

export class ObsidianLinkIndexPort implements LinkIndexPort {
  public constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
  ) {}

  public async listFiles(scheduler?: WorkScheduler): Promise<readonly ReturnType<typeof createFileRecord>[]> {
    const files: ReturnType<typeof createFileRecord>[] = [];
    for (const file of this.vault.getFiles()) {
      files.push(this.toFileRecord(file));
      const pause = scheduler?.checkpoint();
      if (pause != null) await pause;
    }
    return files;
  }

  public getFileRecord(sourcePath: string): Promise<ReturnType<typeof createFileRecord> | null> {
    const file = this.vault.getFileByPath(sourcePath);
    return Promise.resolve(file === null ? null : this.toFileRecord(file));
  }

  public async buildSourceSnapshot(
    sourcePath: string,
    scheduler?: WorkScheduler,
  ): Promise<SourceSnapshot | null> {
    const file = this.vault.getFileByPath(sourcePath);
    if (file === null) return null;
    switch (file.extension.toLocaleLowerCase("en-US")) {
      case "md":
        return this.buildMarkdownSnapshot(file, scheduler);
      case "canvas":
        return this.buildCanvasSnapshot(file, scheduler);
      case "base":
        return this.buildBasesSnapshot(file, scheduler);
      default:
        return null;
    }
  }

  private toFileRecord(file: TFile): ReturnType<typeof createFileRecord> {
    const cache = file.extension.toLocaleLowerCase("en-US") === "md"
      ? this.metadataCache.getFileCache(file) : undefined;
    return createFileRecord(file.path, {
      modifiedAt: file.stat.mtime,
      targetFingerprint: cache === undefined ? "non-markdown" : targetFingerprint(cache),
    });
  }

  private async buildMarkdownSnapshot(file: TFile, scheduler?: WorkScheduler): Promise<SourceSnapshot> {
    const cache = this.metadataCache.getFileCache(file);
    const source = await this.vault.cachedRead(file);
    const { masked, references: sourceReferences } = await parseMarkdownSourceAsync(source, scheduler);
    const lineStarts = createLineStarts(source);
    const inputs: OccurrenceInput[] = [];
    const covered = new Map<string, number>();
    let ordinal = 0;
    const appendPositioned = (
      references: readonly ReferenceCache[] | undefined,
      kind: LinkOccurrenceKind,
    ): void => {
      for (const reference of references ?? []) {
        const range = cachedSourceRange(reference, source, lineStarts);
        const key = sourceReferenceKey(kind, reference.original, range);
        if (range && masked[range[0]] !== source[range[0]]) continue;
        const nativeOrdinal = ordinal++;
        if (range) {
          if (covered.has(key)) continue;
          covered.set(key, 1);
        } else covered.set(key, (covered.get(key) ?? 0) + 1);
        inputs.push({
          raw: reference.original,
          linktext: reference.link,
          kind,
          position: positionFromCache(reference),
          ordinal: nativeOrdinal,
        });
      }
    };
    appendPositioned(cache?.links, "markdown-link");
    appendPositioned(cache?.embeds, "markdown-embed");
    const frontmatter = (cache?.frontmatterLinks ?? []).map((reference): OccurrenceInput => ({
      raw: reference.original, linktext: reference.link, kind: "frontmatter",
      position: frontmatterPosition(reference), ordinal: ordinal++,
    }));
    const bodyStart = cache === null ? 0 : findMarkdownFrontmatterRange(source)?.end ?? 0;
    for (const reference of sourceReferences) {
      if (reference.startOffset < bodyStart) continue;
      const kind = reference.embedded ? "markdown-embed" : "markdown-link";
      if (covered.has(sourceReferenceKey(kind, reference.raw, [reference.startOffset, reference.endOffset]))) continue;
      const ambiguous = sourceReferenceKey(kind, reference.raw, null);
      const remaining = covered.get(ambiguous) ?? 0;
      // Unprovable cache coordinates remain native. Match their token counts,
      // never invent a source position or suppress every identical occurrence.
      if (remaining > 0) { covered.set(ambiguous, remaining - 1); continue; }
      inputs.push({ ...parsedOccurrenceInput(reference, lineStarts, kind), ordinal: ordinal++ });
    }
    inputs.sort(({ position: left }, { position: right }) => left!.line! - right!.line! || left!.column! - right!.column!);
    return this.resolveSnapshot(file.path, [...inputs, ...frontmatter], scheduler);
  }

  private async buildCanvasSnapshot(file: TFile, scheduler?: WorkScheduler): Promise<SourceSnapshot> {
    const source = await this.vault.cachedRead(file);
    const document = parseCanvas(source);
    if (document === null) {
      throw new Error(`Cannot parse Canvas source: ${file.path}`);
    }
    const inputs: OccurrenceInput[] = [];
    for (const node of document.nodes) {
      const nodeId = typeof node.id === "string" ? node.id : null;
      if (node.type === "file" && typeof node.file === "string") {
        const subpath = typeof node.subpath === "string" ? node.subpath : "";
        inputs.push({
          raw: node.file + subpath,
          linktext: node.file + subpath,
          kind: "canvas-file",
          position: canvasPosition(nodeId),
        });
      }
      if (
        node.type === "group" &&
        typeof node.background === "string" &&
        node.background.trim().length > 0 &&
        !node.background.trim().startsWith("#")
      ) {
        inputs.push({
          raw: node.background,
          linktext: node.background,
          kind: "canvas-background",
          position: canvasPosition(nodeId),
        });
      }
      if (node.type === "text" && typeof node.text === "string") {
        const lineStarts = createLineStarts(node.text);
        for (const reference of (await parseMarkdownSourceAsync(node.text, scheduler)).references) {
          inputs.push(parsedOccurrenceInput(reference, lineStarts, "canvas-text", nodeId));
        }
      }
    }
    return this.resolveSnapshot(file.path, inputs, scheduler);
  }

  private async buildBasesSnapshot(file: TFile, scheduler?: WorkScheduler): Promise<SourceSnapshot> {
    const source = await this.vault.cachedRead(file);
    const lineStarts = createLineStarts(source);
    const inputs = extractBasesExplicitReferences(source).map((reference) =>
      parsedOccurrenceInput(reference, lineStarts, "bases-explicit"));
    return this.resolveSnapshot(file.path, inputs, scheduler);
  }

  private async resolveSnapshot(
    sourcePath: string,
    inputs: readonly OccurrenceInput[],
    scheduler?: WorkScheduler,
  ): Promise<SourceSnapshot> {
    const semanticKeys: string[] = [];
    const totals = new Map<string, number>();
    for (const input of inputs) {
      const key = occurrenceSemanticKey(input);
      semanticKeys.push(key);
      totals.set(key, (totals.get(key) ?? 0) + 1);
      const pause = scheduler?.checkpoint();
      if (pause != null) await pause;
    }
    const seen = new Map<string, number>();
    const occurrences: LinkOccurrence[] = [];
    for (const [index, input] of inputs.entries()) {
      const key = semanticKeys[index] ?? occurrenceSemanticKey(input);
      const duplicateIndex = seen.get(key) ?? 0;
      seen.set(key, duplicateIndex + 1);
      occurrences.push(this.resolveOccurrence(sourcePath, input, {
        duplicateIndex,
        duplicateCount: totals.get(key) ?? 1,
        index: input.ordinal ?? index,
      }));
      const pause = scheduler?.checkpoint();
      if (pause != null) await pause;
    }
    return { sourcePath, occurrences };
  }

  private resolveOccurrence(
    sourcePath: string,
    input: OccurrenceInput,
    identity: OccurrenceIdentityOrdinal,
  ): LinkOccurrence {
    const external = isExternalReference(input.linktext);
    let parsed: { path: string; subpath: string };
    try {
      parsed = parseLinktext(input.linktext);
    } catch {
      return {
        id: occurrenceId(sourcePath, input, identity),
        sourcePath,
        raw: input.raw,
        linkpath: input.linktext,
        subpath: null,
        lookupKey: makeOccurrenceLookupKey(input.linktext, sourcePath),
        kind: input.kind,
        position: input.position,
        destinationKind: external ? "external" : "internal",
        targetPath: null,
        fileStatus: "invalid",
        subpathStatus: "none",
      };
    }
    const linkpath = parsed.path.trim();
    const subpath = parsed.subpath.length === 0 ? null : parsed.subpath;
    const lookupLinkpath = linkpath.length === 0 ? sourcePath : linkpath;
    if (external) {
      return {
        id: occurrenceId(sourcePath, input, identity),
        sourcePath,
        raw: input.raw,
        linkpath,
        subpath,
        lookupKey: makeOccurrenceLookupKey(lookupLinkpath, sourcePath),
        kind: input.kind,
        position: input.position,
        destinationKind: "external",
        targetPath: null,
        fileStatus: "invalid",
        subpathStatus: "none",
      };
    }
    const target = linkpath.length === 0
      ? this.vault.getFileByPath(sourcePath)
      : this.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (target === null) {
      return {
        id: occurrenceId(sourcePath, input, identity),
        sourcePath,
        raw: input.raw,
        linkpath,
        subpath,
        lookupKey: makeOccurrenceLookupKey(lookupLinkpath, sourcePath),
        kind: input.kind,
        position: input.position,
        destinationKind: "internal",
        targetPath: null,
        fileStatus: linkpath.length === 0 ? "invalid" : "missing",
        subpathStatus: subpath === null ? "none" : "pending",
      };
    }
    return {
      id: occurrenceId(sourcePath, input, identity),
      sourcePath,
      raw: input.raw,
      linkpath,
      subpath,
      lookupKey: makeOccurrenceLookupKey(lookupLinkpath, sourcePath),
      kind: input.kind,
      position: input.position,
      destinationKind: "internal",
      targetPath: target.path,
      fileStatus: "resolved",
      subpathStatus: this.resolveSubpathStatus(target, subpath),
    };
  }

  private resolveSubpathStatus(
    target: TFile,
    subpath: string | null,
  ): LinkOccurrence["subpathStatus"] {
    if (subpath === null) return "none";
    if (target.extension.toLocaleLowerCase("en-US") !== "md") return "unsupported";
    const targetCache = this.metadataCache.getFileCache(target);
    if (targetCache === null) return "pending";
    if (resolveSubpath(targetCache, subpath) !== null) return "ok";
    return subpath.startsWith("#^") ? "missing-block" : "missing-heading";
  }
}

function targetFingerprint(cache: CachedMetadata | null): string | null {
  if (cache === null) return null;
  // Keep heading order and levels: duplicate/nested headings are resolver inputs.
  // Positions and ordinary body text do not change subpath existence.
  return JSON.stringify([
    (cache.headings ?? []).map(({ heading, level }) => [heading, level]),
    Object.keys(cache.blocks ?? {}).sort(),
    (cache.footnotes ?? []).map(({ id }) => id),
  ]);
}

function positionFromCache(reference: LinkCache | ReferenceCache): SourcePosition {
  return {
    line: reference.position.start.line,
    column: reference.position.start.col,
    endLine: reference.position.end.line,
    endColumn: reference.position.end.col,
    property: null,
    canvasNodeId: null,
  };
}

function frontmatterPosition(reference: FrontmatterLinkCache): SourcePosition {
  return {
    line: null,
    column: null,
    endLine: null,
    endColumn: null,
    property: reference.key,
    canvasNodeId: null,
  };
}

function positionFromParsedReference(
  lineStarts: readonly number[],
  reference: ParsedExplicitReference,
  canvasNodeId: string | null,
): SourcePosition | null {
  if (reference.exactPosition === false) return null;
  const start = offsetToLineColumn(lineStarts, reference.startOffset);
  const end = offsetToLineColumn(lineStarts, reference.endOffset);
  return {
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    property: null,
    canvasNodeId,
  };
}

function canvasPosition(canvasNodeId: string | null): SourcePosition {
  return {
    line: null,
    column: null,
    endLine: null,
    endColumn: null,
    property: null,
    canvasNodeId,
  };
}

function createLineStarts(source: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r") {
      if (source[index + 1] === "\n") index += 1;
      starts.push(index + 1);
    } else if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function cachedSourceRange(
  reference: ReferenceCache,
  source: string,
  lineStarts: readonly number[],
): readonly [number, number] | null {
  const start = cachePointOffset(reference.position.start, source, lineStarts);
  const end = cachePointOffset(reference.position.end, source, lineStarts);
  if (start === null || end === null || end <= start ||
    source.slice(start, end) !== reference.original) return null;
  return [start, end];
}

function sourceReferenceKey(kind: LinkOccurrenceKind, raw: string, range: readonly [number, number] | null): string {
  return `${kind}\u0000${range?.join(":")}\u0000${range ? raw : raw.replace(/\r\n?/gu, "\n")}`;
}

function parsedOccurrenceInput(reference: ParsedExplicitReference, lineStarts: readonly number[], kind: LinkOccurrenceKind, nodeId: string | null = null): OccurrenceInput {
  return { raw: reference.raw, linktext: reference.linktext, kind,
    position: positionFromParsedReference(lineStarts, reference, nodeId) };
}

function cachePointOffset(
  point: { readonly line: number; readonly col: number },
  source: string,
  lineStarts: readonly number[],
): number | null {
  if (!Number.isInteger(point.line) || !Number.isInteger(point.col) || point.col < 0) return null;
  const start = lineStarts[point.line];
  if (start === undefined) return null;
  let end = lineStarts[point.line + 1] ?? source.length;
  if (source[end - 1] === "\n") end -= 1;
  if (source[end - 1] === "\r") end -= 1;
  const offset = start + point.col;
  return offset <= end ? offset : null;
}

function offsetToLineColumn(
  lineStarts: readonly number[],
  offset: number,
): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = lineStarts[middle] ?? 0;
    if (start <= offset) low = middle + 1;
    else high = middle - 1;
  }
  const line = Math.max(0, high);
  return { line, column: offset - (lineStarts[line] ?? 0) };
}

function occurrenceId(
  sourcePath: string,
  input: OccurrenceInput,
  identity: OccurrenceIdentityOrdinal,
): string {
  const location = input.position?.canvasNodeId ??
    `${String(input.position?.line ?? "-")}:${String(input.position?.column ?? "-")}`;
  return createOccurrenceId({
    sourcePath,
    kind: input.kind,
    raw: input.raw,
    linktext: input.linktext,
    duplicateIndex: identity.duplicateIndex,
    duplicateCount: identity.duplicateCount,
    location,
    legacyOrdinal: identity.index,
  });
}

function parseCanvas(source: string): { readonly nodes: readonly CanvasNode[] } | null {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const document = value as CanvasDocument;
  if (document.nodes === undefined) return { nodes: [] };
  if (!Array.isArray(document.nodes)) return null;
  return {
    nodes: document.nodes.filter((node): node is CanvasNode =>
      typeof node === "object" && node !== null && !Array.isArray(node)),
  };
}
