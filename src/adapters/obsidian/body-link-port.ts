import { parseLinktext, resolveSubpath, type App } from "obsidian";
import type { SourcePosition, SourceSnapshot } from "../../core/model";
import type { BodyLinkPort, ProvenBodyLink } from "../../features/body-links/body-link-service";
import { WorkScheduler, yieldBrowserTask } from "../../scheduling/work-scheduler";
import { parseMarkdownSourceAsync } from "./explicit-link-parser";
import { extractProvenMarkdownNonLinkExclusions } from "./body-link-syntax";

export function normalizedBodyText(text: string): string { return text.replace(/\r\n|\r/gu, "\n"); }

export function bodyLineStarts(text: string): number[] {
  const starts = [0];
  for (const match of text.matchAll(/\r\n|\r|\n/gu)) starts.push(match.index + match[0].length);
  return starts;
}

export function bodySourceRange(text: string, starts: readonly number[], position: SourcePosition | null): { from: number; to: number } | null {
  if (position?.line == null || position.column === null || position.endLine === null || position.endColumn === null ||
    position.property !== null || position.canvasNodeId !== null) return null;
  if (![position.line, position.column, position.endLine, position.endColumn].every((value) => Number.isInteger(value) && value >= 0)) return null;
  const start = starts[position.line]; const end = starts[position.endLine];
  if (start === undefined || end === undefined) return null;
  const from = start + position.column; const to = end + position.endColumn;
  return from >= start && to > from && to <= text.length && from <= (starts[position.line + 1] ?? text.length) &&
    to <= (starts[position.endLine + 1] ?? text.length) ? { from, to } : null;
}

export function canonicalBodyDestination(value: string): string | null {
  let destination = value;
  try { destination = decodeURIComponent(value); } catch {
    // Wiki targets and decoded cache values may contain a literal percent sign.
    // A URI decoding failure does not make that Vault destination invalid.
  }
  try {
    const parsed = parseLinktext(destination);
    return JSON.stringify([parsed.path.trim(), parsed.subpath]);
  } catch { return null; }
}

/** Public resolution-map keys omit fragments and a Markdown extension on the basename. */
export function bodyUnresolvedKey(linktext: string): string {
  const marker = linktext.indexOf("#");
  const path = marker < 0 ? linktext : linktext.slice(0, marker);
  const basename = path.slice(path.lastIndexOf("/") + 1); const dot = basename.lastIndexOf(".");
  return dot > 0 && basename.slice(dot + 1).toLowerCase() === "md" ? path.slice(0, -3) : path;
}

function referenceLabel(raw: string, embedded: boolean): string | null {
  const text = embedded ? raw.slice(1) : raw;
  if (text.startsWith("[[") && text.endsWith("]]")) {
    const inside = text.slice(2, -2);
    const pipe = inside.indexOf("|");
    return pipe < 0 ? inside : inside.slice(pipe + 1);
  }
  const label = /^\[([^\]\r\n]*)\]\(/u.exec(text)?.[1];
  return label ?? null;
}

export class ObsidianBodyLinkPort implements BodyLinkPort {
  public constructor(private readonly app: App, private readonly metadataReady: (path: string) => boolean = () => true) {}

  public async proveSource(path: string, text: string, snapshot: SourceSnapshot, signal: AbortSignal): Promise<readonly ProvenBodyLink[] | null> {
    const file = this.app.vault.getFileByPath(path);
    const cache = file === null ? null : this.app.metadataCache.getFileCache(file);
    if (signal.aborted || file?.extension !== "md" || cache === null || !this.metadataReady(path)) return null;
    const raw = await this.app.vault.cachedRead(file);
    if (signal.aborted || normalizedBodyText(raw) !== normalizedBodyText(text) || this.app.metadataCache.getFileCache(file) !== cache) return null;
    const scheduler = new WorkScheduler({ yieldControl: async () => {
      if (signal.aborted) throw new Error("Body source proof cancelled.");
      await yieldBrowserTask();
      if (signal.aborted) throw new Error("Body source proof cancelled.");
    } });
    const { references, syntaxRanges } = await parseMarkdownSourceAsync(text, scheduler);
    const exclusions = await extractProvenMarkdownNonLinkExclusions(text, scheduler, syntaxRanges);
    if (signal.aborted || this.app.metadataCache.getFileCache(file) !== cache) return null;
    const byRange = new Map(references.map((reference) => [`${reference.startOffset}:${reference.endOffset}`, reference]));
    const protectedRanges = [...exclusions].sort((left, right) => left.from - right.from);
    const merged: { from: number; to: number }[] = [];
    for (const range of protectedRanges) {
      const last = merged.at(-1);
      if (last !== undefined && range.from <= last.to) last.to = Math.max(last.to, range.to);
      else merged.push({ ...range });
    }
    const protectedAt = (from: number, to: number): boolean => {
      let low = 0; let high = merged.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (merged[middle]!.to <= from) low = middle + 1; else high = middle;
      }
      return (merged[low]?.from ?? Infinity) < to;
    };
    const starts = bodyLineStarts(text);
    const links: ProvenBodyLink[] = [];
    for (const occurrence of snapshot.occurrences) {
      const pause = scheduler.checkpoint(); if (pause !== null) await pause;
      if (occurrence.kind !== "markdown-link" && occurrence.kind !== "markdown-embed") continue;
      const range = bodySourceRange(text, starts, occurrence.position);
      if (range === null || text.slice(range.from, range.to) !== occurrence.raw ||
        protectedAt(range.from, range.to)) continue;
      const reference = byRange.get(`${range.from}:${range.to}`);
      const destination = reference === undefined ? null : canonicalBodyDestination(reference.linktext);
      if (reference === undefined || reference.raw !== occurrence.raw ||
        reference.embedded !== (occurrence.kind === "markdown-embed") ||
        destination === null || destination !== canonicalBodyDestination(occurrence.linkpath + (occurrence.subpath ?? ""))) continue;
      links.push({ ...range, occurrence, linktext: reference.linktext, label: referenceLabel(reference.raw, reference.embedded), embedded: reference.embedded });
    }
    return signal.aborted || this.app.vault.getFileByPath(path) !== file || this.app.metadataCache.getFileCache(file) !== cache ? null : links;
  }

  public isConfirmed(link: ProvenBodyLink): boolean {
    const { occurrence } = link;
    if (occurrence.destinationKind !== "internal" || !this.metadataReady(occurrence.sourcePath)) return false;
    const target = occurrence.linkpath.length === 0 ? this.app.vault.getFileByPath(occurrence.sourcePath)
      : this.app.metadataCache.getFirstLinkpathDest(occurrence.linkpath, occurrence.sourcePath);
    if (occurrence.fileStatus === "missing") {
      // Public source resolution maps also work when the initial global event preceded enablement.
      const unresolved = this.app.metadataCache.unresolvedLinks?.[occurrence.sourcePath];
      // Cache destinations are already decoded by the host; the source Markdown
      // may still contain URI escapes, so use the same path as the resolver.
      return target === null && (unresolved?.[bodyUnresolvedKey(occurrence.linkpath)] ?? 0) > 0;
    }
    if (occurrence.fileStatus !== "resolved" || target === null || !this.metadataReady(target.path) || target.path !== occurrence.targetPath ||
      target.extension !== "md" || occurrence.subpath === null) return false;
    const cache = this.app.metadataCache.getFileCache(target);
    return cache !== null && resolveSubpath(cache, occurrence.subpath) === null &&
      (occurrence.subpathStatus === "missing-heading" || occurrence.subpathStatus === "missing-block");
  }
}
