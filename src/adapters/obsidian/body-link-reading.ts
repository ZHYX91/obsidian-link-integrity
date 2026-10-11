import { MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";
import type { BodyLinkHint, BodyLinkSource } from "../../features/body-links/body-link-service";
import { bodyLineStarts, bodySourceRange, canonicalBodyDestination } from "./body-link-port";
import type { BodyEditorOptions } from "./body-link-editor";

export interface BodyReadingOptions extends BodyEditorOptions { readonly onDispose?: (dispose: () => void) => void; }
interface IndexedRange { readonly from: number; readonly to: number; readonly destination: string; }
interface Annotation { readonly title: string | null; readonly description: string | null; readonly reason: string; }
const annotationOwners = new WeakMap<HTMLElement, Annotation>();
const readingRanges = new WeakMap<BodyLinkSource, { starts: readonly number[]; occurrences: readonly IndexedRange[]; hints: readonly BodyLinkHint[] }>();
function sectionRanges<T extends { readonly from: number; readonly to: number }>(ranges: readonly T[], from: number, to: number): readonly T[] {
  let low = 0; let high = ranges.length;
  while (low < high) { const middle = (low + high) >>> 1; if (ranges[middle]!.from < from) low = middle + 1; else high = middle; }
  const result: T[] = [];
  for (let index = low; index < ranges.length && ranges[index]!.from < to; index += 1) if (ranges[index]!.to <= to) result.push(ranges[index]!);
  return result;
}

/** No text-order pairing: every destination must have one source occurrence and one rendered anchor. */
export function mapBodyReadingHints(element: HTMLElement, source: BodyLinkSource, lineStart: number, lineEnd: number): ReadonlyMap<HTMLElement, BodyLinkHint> {
  const result = new Map<HTMLElement, BodyLinkHint>();
  if (source.state !== "ready" || source.snapshot === null) return result;
  let prepared = readingRanges.get(source);
  if (prepared === undefined) {
    const starts = bodyLineStarts(source.text);
    const occurrences: IndexedRange[] = [];
    for (const occurrence of source.snapshot.occurrences) {
      const range = bodySourceRange(source.text, starts, occurrence.position);
      const destination = canonicalBodyDestination(occurrence.linkpath + (occurrence.subpath ?? ""));
      if (range !== null && occurrence.destinationKind === "internal" && (occurrence.kind === "markdown-link" || occurrence.kind === "markdown-embed") && destination !== null) occurrences.push({ ...range, destination });
    }
    prepared = { starts, occurrences: occurrences.sort((left, right) => left.from - right.from), hints: [...source.hints].sort((left, right) => left.from - right.from) };
    readingRanges.set(source, prepared);
  }
  const { starts } = prepared;
  const from = starts[lineStart]; const to = starts[lineEnd + 1] ?? source.text.length;
  if (from === undefined || to < from) return result;
  const occurrences = sectionRanges(prepared.occurrences, from, to);
  const sourceCounts = new Map<string, number>();
  for (const occurrence of occurrences) sourceCounts.set(occurrence.destination, (sourceCounts.get(occurrence.destination) ?? 0) + 1);
  const anchors = [...element.querySelectorAll<HTMLElement>("a.internal-link")];
  const byDestination = new Map<string, HTMLElement[]>();
  for (const anchor of anchors) {
    const destination = canonicalBodyDestination(anchor.getAttribute("data-href") ?? anchor.getAttribute("href") ?? "");
    if (destination === null) continue;
    const group = byDestination.get(destination) ?? []; group.push(anchor); byDestination.set(destination, group);
  }
  const chunks: string[] = []; let position = from;
  for (const range of occurrences) {
    if (range.from > position) chunks.push(source.text.slice(position, range.from));
    position = Math.max(position, range.to);
  }
  chunks.push(source.text.slice(position, to)); const outside = chunks.join(" ");
  const outsideLabels = new Map<string, boolean>();
  for (const hint of sectionRanges(prepared.hints, from, to)) {
    if (result.size >= 1_000) break;
    if (hint.embedded || hint.label === null || hint.label.length === 0 || hint.from < from || hint.to > to) continue;
    const destination = canonicalBodyDestination(hint.linktext);
    if (destination === null || sourceCounts.get(destination) !== 1) continue;
    const matches = byDestination.get(destination) ?? [];
    if (matches.length !== 1) continue;
    const anchor = matches[0]!;
    const nativeHref = anchor.getAttribute("href");
    if (nativeHref !== null && canonicalBodyDestination(nativeHref) !== destination) continue;
    if (anchor.textContent !== hint.label || anchor.closest("button,[contenteditable],.virtual-link-a,.virtual-link-span") !== null) continue;
    // Additional plain text that could have been replaced by a third party makes ownership unprovable.
    if (!outsideLabels.has(hint.label)) outsideLabels.set(hint.label, outside.includes(hint.label));
    if (outsideLabels.get(hint.label)) continue;
    result.set(anchor, hint);
  }
  return result;
}

/** Adds attributes only. Native href, child nodes, clicks, context menus and third-party widgets are untouched. */
export function decorateBodyLinkReading(element: HTMLElement, context: MarkdownPostProcessorContext, options: BodyReadingOptions): (() => void) | null {
  if (context.getSectionInfo(element) === null) return null;
  const child = new class extends MarkdownRenderChild {
    private alive = false;
    private disposed = false;
    private abort: AbortController | null = null;
    private timer: number | null = null;
    private unsubscribe: (() => void) | null = null;
    private observer: MutationObserver | null = null;
    private readonly owned = new Map<HTMLElement, Annotation>();
    private tooltip: HTMLElement | null = null;
    private tooltipAnchor: HTMLElement | null = null;
    private tooltipDescription: string | null = null;
    private returningFocus = false;
    private get window() { return element.ownerDocument.defaultView!; }
    public override onload(): void {
      if (this.alive || this.disposed) return;
      this.alive = true;
      this.unsubscribe = options.subscribe(() => { this.clear(); this.syncEnabled(); });
      this.syncEnabled();
    }
    private syncEnabled(): void {
      if (!this.alive || !options.enabled()) { this.deactivate(); return; }
      if (this.observer === null) {
        this.observer = new this.window.MutationObserver((records) => {
          if (!records.some((record) => record.type !== "attributes" || record.attributeName !== "class" ||
            withoutAnnotation(record.oldValue) !== withoutAnnotation((record.target as Element).getAttribute("class")))) return;
          this.clear(); this.schedule();
        });
        this.observer.observe(element, { childList: true, characterData: true, subtree: true, attributes: true,
          attributeFilter: ["data-href", "href", "class"], attributeOldValue: true });
        this.listen(true);
      }
      this.schedule();
    }
    private listen(enabled: boolean): void {
      const action = enabled ? "addEventListener" : "removeEventListener";
      element[action]("mouseover", this.show);
      element[action]("focusin", this.show);
      element[action]("mouseout", this.leave);
      element[action]("focusout", this.leave);
      element[action]("keydown", this.key);
    }
    private deactivate(): void {
      this.clear(); this.observer?.disconnect(); this.observer = null; this.listen(false);
      if (this.timer !== null) this.window.clearTimeout(this.timer); this.timer = null;
    }
    private readonly show = (event: Event): void => {
      if (this.returningFocus) return;
      const target = event.target;
      if (!(target instanceof this.window.Element)) return;
      const anchor = target.closest<HTMLElement>("a.internal-link"); const owned = anchor === null ? undefined : this.owned.get(anchor);
      if (anchor === null || owned === undefined) return;
      this.hide();
      const tooltip = element.ownerDocument.createElement("div");
      tooltip.className = "link-integrity-body-tooltip"; tooltip.setAttribute("role", "tooltip");
      tooltip.id = `link-integrity-body-tooltip-${++tooltipId}`; tooltip.textContent = owned.reason; tooltip.tabIndex = 0;
      tooltip.addEventListener("mouseout", this.leave); tooltip.addEventListener("focusout", this.leave); tooltip.addEventListener("keydown", this.key);
      const viewport = this.window.visualViewport;
      const left = viewport?.offsetLeft ?? 0; const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? this.window.innerWidth; const height = viewport?.height ?? this.window.innerHeight;
      tooltip.style.maxWidth = `min(28rem, ${Math.max(0, width - 16)}px)`;
      tooltip.style.maxHeight = `${Math.max(0, height - 16)}px`;
      element.ownerDocument.body.append(tooltip); this.tooltip = tooltip; this.tooltipAnchor = anchor;
      const rect = anchor.getBoundingClientRect(); const size = tooltip.getBoundingClientRect();
      const above = rect.top - 4 - size.height; const below = rect.bottom + 4;
      const preferred = below + size.height > top + height - 8 && above >= top + 8 ? above : below;
      tooltip.style.left = `${Math.max(left + 8, Math.min(rect.left, left + width - size.width - 8))}px`;
      tooltip.style.top = `${Math.max(top + 8, Math.min(preferred, top + height - size.height - 8))}px`;
      this.tooltipDescription = anchor.getAttribute("aria-describedby");
      anchor.setAttribute("aria-describedby", [this.tooltipDescription, tooltip.id].filter(Boolean).join(" "));
    };
    private readonly leave = (event: Event): void => {
      const next = (event as MouseEvent | FocusEvent).relatedTarget;
      if (next instanceof this.window.Node && (this.tooltip?.contains(next) || this.tooltipAnchor?.contains(next))) return;
      this.hide();
    };
    private readonly hide = (): void => {
      if (this.tooltipAnchor !== null && this.tooltip !== null) {
        const current = this.tooltipAnchor.getAttribute("aria-describedby")?.split(/\s+/u).filter((id) => id !== this.tooltip!.id).join(" ") ?? "";
        restore(this.tooltipAnchor, "aria-describedby", current.length > 0 ? current : this.tooltipDescription === null ? null : "");
      }
      this.tooltip?.remove(); this.tooltip = null; this.tooltipAnchor = null;
    };
    private readonly key = (event: Event): void => {
      if ((event as KeyboardEvent).key !== "Escape") return;
      const anchor = this.tooltipAnchor; const returnFocus = this.tooltip?.contains(element.ownerDocument.activeElement) ?? false;
      this.hide();
      if (returnFocus) { this.returningFocus = true; try { anchor?.focus(); } finally { this.returningFocus = false; } }
    };
    private clear(): void {
      this.abort?.abort(); this.hide();
      for (const [anchor, value] of this.owned) {
        if (annotationOwners.get(anchor) !== value) continue;
        annotationOwners.delete(anchor);
        anchor.classList.remove("link-integrity-broken-body-hint");
        if (anchor.getAttribute("title") === value.reason) restore(anchor, "title", value.title);
        if (anchor.getAttribute("aria-description") === value.reason) restore(anchor, "aria-description", value.description);
      }
      this.owned.clear();
    }
    private schedule(): void {
      this.abort?.abort(); if (this.timer !== null) this.window.clearTimeout(this.timer);
      if (this.alive && options.enabled()) this.timer = this.window.setTimeout(() => { this.timer = null; void this.refresh(); }, 80);
    }
    private async refresh(): Promise<void> {
      const section = context.getSectionInfo(element);
      if (!this.alive || !options.enabled() || section === null) return;
      const abort = new AbortController(); this.abort = abort;
      try {
        const source = await options.source(context.sourcePath, section.text, abort.signal);
        const current = context.getSectionInfo(element);
        if (!this.alive || abort.signal.aborted || !options.enabled() || current?.text !== section.text ||
          current.lineStart !== section.lineStart || current.lineEnd !== section.lineEnd) return;
        for (const [anchor, hint] of mapBodyReadingHints(element, source, section.lineStart, section.lineEnd)) {
          if (!element.contains(anchor)) continue;
          const reason = options.reason(hint);
          const previous = annotationOwners.get(anchor);
          const annotation = { title: previous === undefined ? anchor.getAttribute("title") : previous.title, description: previous === undefined ? anchor.getAttribute("aria-description") : previous.description, reason };
          this.owned.set(anchor, annotation); annotationOwners.set(anchor, annotation);
          anchor.classList.add("link-integrity-broken-body-hint"); anchor.setAttribute("title", reason); anchor.setAttribute("aria-description", reason);
        }
      } catch { this.clear(); }
    }
    public override onunload(): void {
      if (this.disposed) return;
      this.disposed = true; this.alive = false; this.deactivate(); this.unsubscribe?.();
      options.onDispose?.(dispose);
    }
  }(element);
  const dispose = (): void => child.onunload(); context.addChild(child); return dispose;
}
let tooltipId = 0;
function withoutAnnotation(value: string | null): string {
  return (value ?? "").split(/\s+/u).filter((name) => name.length > 0 && name !== "link-integrity-broken-body-hint").sort().join(" ");
}
function restore(element: HTMLElement, attribute: string, value: string | null): void {
  if (value === null) element.removeAttribute(attribute); else element.setAttribute(attribute, value);
}
