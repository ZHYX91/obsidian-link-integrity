import { MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";

import { mentionDisplayFragments } from "../../core/mention-display";
import type { PotentialMentionMatch } from "../../core/potential-mention-model";
import type { PotentialMentionSource } from "../../features/mentions/potential-mention-service";

const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote";
const INTERACTIVE = "a,button,input,select,textarea,code,pre,math,svg,[contenteditable],[role=button],[role=link]";
const focusedBlocks = new WeakMap<Element, Element>();

export interface MentionReadingOptions {
  readonly mode: () => "off" | "paragraph" | "document";
  readonly match: (path: string, text: string, signal: AbortSignal) => Promise<PotentialMentionSource>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly pick: (source: PotentialMentionSource, matches: readonly PotentialMentionMatch[], document: Document) => void;
}

/** Rendering is advisory. Source navigation and writing are verified independently by the editor adapter. */
export function decorateMentionReading(element: HTMLElement, context: MarkdownPostProcessorContext, options: MentionReadingOptions): void {
  const section = context.getSectionInfo(element);
  if (section === null) return;
  context.addChild(new class extends MarkdownRenderChild {
    private abort: AbortController | null = null;
    private unsubscribe: (() => void) | null = null;
    private timer: number | null = null;
    private alive = false;
    private get window(): Window { return element.ownerDocument.defaultView!; }
    private readonly root = element.closest(".markdown-preview-view") ?? element;
    private readonly hints = new Map<HTMLElement, readonly PotentialMentionMatch[]>();
    private source: PotentialMentionSource | null = null;

    public override onload(): void {
      this.alive = true;
      this.unsubscribe = options.subscribe(() => this.schedule());
      this.registerDomEvent(this.root as HTMLElement, "click", (event) => this.focus(event));
      this.registerDomEvent(this.root as HTMLElement, "focusin", (event) => this.focus(event));
      this.registerDomEvent(this.root as HTMLElement, "touchstart", (event) => this.focus(event));
      this.registerDomEvent(this.root as HTMLElement, "scroll", () => this.schedule(), { passive: true });
      this.registerDomEvent(element, "click", (event) => this.open(event));
      this.schedule();
    }

    public override onunload(): void {
      this.alive = false;
      this.abort?.abort();
      this.unsubscribe?.();
      if (this.timer !== null) this.window.clearTimeout(this.timer);
      this.clear();
    }

    private focus(event: Event): void {
      const target = event.target;
      if (!(target instanceof element.ownerDocument.defaultView!.Element)) return;
      const block = target.closest(BLOCKS);
      if (block !== null && this.root.contains(block)) focusedBlocks.set(this.root, block);
      this.schedule();
    }

    private open(event: MouseEvent): void {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey ||
        element.ownerDocument.getSelection()?.isCollapsed === false) return;
      const target = event.target;
      if (!(target instanceof element.ownerDocument.defaultView!.Element) || target.closest(INTERACTIVE) !== null) return;
      const hint = target.closest<HTMLElement>(".link-integrity-mention-hint");
      const matches = hint === null ? undefined : this.hints.get(hint);
      if (matches !== undefined && this.source !== null) options.pick(this.source, matches, element.ownerDocument);
    }

    private schedule(): void {
      this.abort?.abort();
      if (this.timer !== null) this.window.clearTimeout(this.timer);
      this.timer = this.window.setTimeout(() => { this.timer = null; void this.refresh(); }, 80);
    }

    private clear(): void {
      for (const hint of this.hints.keys()) if (hint.isConnected) hint.replaceWith(...hint.childNodes);
      this.hints.clear();
      this.source = null;
    }

    private currentBlock(): Element | null {
      const focused = focusedBlocks.get(this.root);
      if (focused?.isConnected === true && this.root.contains(focused)) return focused;
      const rect = this.root.getBoundingClientRect();
      const center = (Math.max(0, rect.top) + Math.min(element.ownerDocument.defaultView!.innerHeight, rect.bottom)) / 2;
      let result: Element | null = null;
      let distance = Infinity;
      for (const block of this.root.querySelectorAll(BLOCKS)) {
        if (block.closest(INTERACTIVE) !== null) continue;
        const bounds = block.getBoundingClientRect();
        if (bounds.bottom <= 0 || bounds.top >= element.ownerDocument.defaultView!.innerHeight) continue;
        const next = Math.abs((bounds.top + bounds.bottom) / 2 - center);
        if (next < distance) { result = block; distance = next; }
      }
      return result;
    }

    private async refresh(): Promise<void> {
      this.clear();
      if (!this.alive || options.mode() === "off") return;
      const request = new AbortController();
      this.abort = request;
      try {
        const source = await options.match(context.sourcePath, section.text, request.signal);
        if (!this.alive || request.signal.aborted) return;
        this.source = source;
        const lines = [...section.text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)].filter((line) => line[0].length > 0);
        const start = lines[section.lineStart]?.index ?? 0;
        const last = lines[section.lineEnd];
        const end = last === undefined ? section.text.length : last.index + last[0].length;
        const current = options.mode() === "paragraph" ? this.currentBlock() : null;
        const walker = element.ownerDocument.createTreeWalker(element, 4);
        const nodes: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode()) !== null) if (node.nodeType === 3) nodes.push(node as Text);
        let budget = Math.max(0, 1_000 - this.root.querySelectorAll(".link-integrity-mention-hint").length);
        for (const textNode of nodes) {
          const parent = textNode.parentElement;
          if (parent === null || parent.closest(INTERACTIVE) !== null || textNode.data.trim().length === 0 ||
            (current !== null && !current.contains(textNode)) || (options.mode() === "paragraph" && current === null)) continue;
          const rect = parent.getBoundingClientRect();
          if (rect.bottom <= 0 || rect.top >= element.ownerDocument.defaultView!.innerHeight) continue;
          // Exact, unique source text only. Transformed/ambiguous rendered spans retain list navigation.
          const from = section.text.indexOf(textNode.data, start);
          if (from < start || from + textNode.length > end || section.text.indexOf(textNode.data, from + 1) < end &&
            section.text.indexOf(textNode.data, from + 1) !== -1) continue;
          const fragments = mentionDisplayFragments(source.matches, { from, to: from + textNode.length }).slice(0, budget);
          if (fragments.length === 0) continue;
          const replacement = element.ownerDocument.createDocumentFragment();
          let position = 0;
          for (const fragment of fragments) {
            const offset = fragment.from - from;
            replacement.append(textNode.data.slice(position, offset));
            const hint = element.ownerDocument.createElement("span");
            hint.className = `link-integrity-mention-hint${fragment.tracks === 2 ? " is-overlapping" : ""}`;
            hint.textContent = textNode.data.slice(offset, fragment.to - from);
            replacement.append(hint);
            this.hints.set(hint, fragment.matches);
            position = fragment.to - from;
          }
          replacement.append(textNode.data.slice(position));
          textNode.replaceWith(replacement);
          budget -= fragments.length;
          if (budget <= 0) break;
        }
      } catch { /* Stale rendering is cleared; the manual query remains available. */ }
    }
  }(element));
}
