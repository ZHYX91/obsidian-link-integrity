import {
  parseLinktext,
  resolveSubpath,
  type FrontmatterLinkCache,
  type LinkCache,
  type MetadataCache,
  type ReferenceCache,
  type TFile,
  type Vault,
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
import {
  extractBasesExplicitReferences,
  extractMarkdownExplicitReferences,
  isExternalReference,
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
  readonly ordinal: number;
}

export class ObsidianLinkIndexPort implements LinkIndexPort {
  public constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
  ) {}

  public listFiles(): Promise<readonly ReturnType<typeof createFileRecord>[]> {
    return Promise.resolve(this.vault.getFiles().map(toFileRecord));
  }

  public getFileRecord(sourcePath: string): Promise<ReturnType<typeof createFileRecord> | null> {
    const file = this.vault.getFileByPath(sourcePath);
    return Promise.resolve(file === null ? null : toFileRecord(file));
  }

  public async buildSourceSnapshot(sourcePath: string): Promise<SourceSnapshot | null> {
    const file = this.vault.getFileByPath(sourcePath);
    if (file === null) return null;
    switch (file.extension.toLocaleLowerCase("en-US")) {
      case "md":
        return this.buildMarkdownSnapshot(file);
      case "canvas":
        return this.buildCanvasSnapshot(file);
      case "base":
        return this.buildBasesSnapshot(file);
      default:
        return null;
    }
  }

  private async buildMarkdownSnapshot(file: TFile): Promise<SourceSnapshot> {
    const cache = this.metadataCache.getFileCache(file);
    if (cache === null) {
      const source = await this.vault.cachedRead(file);
      return this.buildParsedTextSnapshot(file, source, "markdown-link");
    }
    const inputs: OccurrenceInput[] = [];
    let ordinal = 0;
    const appendPositioned = (
      references: readonly ReferenceCache[] | undefined,
      kind: LinkOccurrenceKind,
    ): void => {
      for (const reference of references ?? []) {
        inputs.push({
          raw: reference.original,
          linktext: reference.link,
          kind,
          position: positionFromCache(reference),
          ordinal,
        });
        ordinal += 1;
      }
    };
    appendPositioned(cache.links, "markdown-link");
    appendPositioned(cache.embeds, "markdown-embed");
    for (const reference of cache.frontmatterLinks ?? []) {
      inputs.push({
        raw: reference.original,
        linktext: reference.link,
        kind: "frontmatter",
        position: frontmatterPosition(reference),
        ordinal: ordinal++,
      });
    }
    return this.resolveSnapshot(file.path, inputs);
  }

  private async buildCanvasSnapshot(file: TFile): Promise<SourceSnapshot> {
    const source = await this.vault.cachedRead(file);
    const document = parseCanvas(source);
    if (document === null) {
      throw new Error(`Cannot parse Canvas source: ${file.path}`);
    }
    const inputs: OccurrenceInput[] = [];
    let ordinal = 0;
    for (const node of document.nodes) {
      const nodeId = typeof node.id === "string" ? node.id : null;
      if (node.type === "file" && typeof node.file === "string") {
        const subpath = typeof node.subpath === "string" ? node.subpath : "";
        inputs.push({
          raw: node.file + subpath,
          linktext: node.file + subpath,
          kind: "canvas-file",
          position: canvasPosition(nodeId),
          ordinal: ordinal++,
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
          ordinal: ordinal++,
        });
      }
      if (node.type === "text" && typeof node.text === "string") {
        for (const reference of extractMarkdownExplicitReferences(node.text)) {
          inputs.push({
            raw: reference.raw,
            linktext: reference.linktext,
            kind: "canvas-text",
            position: positionFromParsedReference(node.text, reference, nodeId),
            ordinal: ordinal++,
          });
        }
      }
    }
    return this.resolveSnapshot(file.path, inputs);
  }

  private async buildBasesSnapshot(file: TFile): Promise<SourceSnapshot> {
    const source = await this.vault.cachedRead(file);
    const inputs = extractBasesExplicitReferences(source).map((reference, ordinal) => ({
      raw: reference.raw,
      linktext: reference.linktext,
      kind: "bases-explicit" as const,
      position: positionFromParsedReference(source, reference, null),
      ordinal,
    }));
    return this.resolveSnapshot(file.path, inputs);
  }

  private async buildParsedTextSnapshot(
    file: TFile,
    source: string,
    kind: LinkOccurrenceKind,
  ): Promise<SourceSnapshot> {
    return this.resolveSnapshot(file.path, extractMarkdownExplicitReferences(source).map(
      (reference, ordinal) => ({
        raw: reference.raw,
        linktext: reference.linktext,
        kind: reference.embedded ? "markdown-embed" : kind,
        position: positionFromParsedReference(source, reference, null),
        ordinal,
      }),
    ));
  }

  private resolveSnapshot(
    sourcePath: string,
    inputs: readonly OccurrenceInput[],
  ): SourceSnapshot {
    return {
      sourcePath,
      occurrences: inputs.map((input) => this.resolveOccurrence(sourcePath, input)),
    };
  }

  private resolveOccurrence(sourcePath: string, input: OccurrenceInput): LinkOccurrence {
    const external = isExternalReference(input.linktext);
    let parsed: { path: string; subpath: string };
    try {
      parsed = parseLinktext(input.linktext);
    } catch {
      return {
        id: occurrenceId(sourcePath, input),
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
        id: occurrenceId(sourcePath, input),
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
        id: occurrenceId(sourcePath, input),
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
      id: occurrenceId(sourcePath, input),
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

function toFileRecord(file: TFile): ReturnType<typeof createFileRecord> {
  return createFileRecord(file.path, { modifiedAt: file.stat.mtime });
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
  source: string,
  reference: ParsedExplicitReference,
  canvasNodeId: string | null,
): SourcePosition {
  const start = offsetToLineColumn(source, reference.startOffset);
  const end = offsetToLineColumn(source, reference.endOffset);
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

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 0;
  let column = 0;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function occurrenceId(sourcePath: string, input: OccurrenceInput): string {
  const location = input.position?.canvasNodeId ??
    `${String(input.position?.line ?? "-")}:${String(input.position?.column ?? "-")}`;
  return `${sourcePath}\u0000${input.kind}\u0000${location}\u0000${input.ordinal}`;
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
  if (!Array.isArray(document.nodes)) return null;
  return {
    nodes: document.nodes.filter((node): node is CanvasNode =>
      typeof node === "object" && node !== null && !Array.isArray(node)),
  };
}
