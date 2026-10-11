import { MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";

import { mentionDisplayFragments } from "../../core/mention-display";
import type { PotentialMentionMatch } from "../../core/potential-mention-model";
import type { PotentialMentionSource } from "../../features/mentions/potential-mention-service";
import { MentionReadingRoot, MENTION_READING_INTERACTIVE } from "./mention-reading-root";

export interface MentionReadingOptions {
  readonly mode: () => "off" | "paragraph" | "document";
  readonly match: (path: string, text: string, ranges: readonly { from: number; to: number }[], signal: AbortSignal) => Promise<PotentialMentionSource>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly pick: (source: PotentialMentionSource, matches: readonly PotentialMentionMatch[], document: Document) => void;
  readonly label?: (text: string) => string;
  readonly onDispose?: (dispose: () => void) => void;
}

/** Rendering is advisory. Source navigation and writing are verified independently by the editor adapter. */
export function decorateMentionReading(element: HTMLElement, context: MarkdownPostProcessorContext, options: MentionReadingOptions): () => void {
  const section = context.getSectionInfo(element);
  if (section === null) return () => undefined;
  const child = new class extends MarkdownRenderChild {
    private abort: AbortController | null = null;
    private coordinator: MentionReadingRoot | null = null;
    private alive = false;
    private disposed = false;
    private readonly root = element.closest(".markdown-preview-view") ?? element;
    private readonly hints = new Map<HTMLElement, readonly PotentialMentionMatch[]>();

    public override onload(): void {
      if (this.disposed || this.alive) return;
      this.alive = true;
      this.coordinator = MentionReadingRoot.attach(this.root, options, this);
    }

    public override onunload(): void {
      if (this.disposed) return;
      this.disposed = true;
      this.alive = false;
      this.cancel();
      this.clear();
      this.coordinator?.remove(this);
      this.coordinator = null;
      options.onDispose?.(dispose);
    }

    public cancel(): void { this.abort?.abort(); }

    public clear(): void {
      for (const hint of this.hints.keys()) {
        this.coordinator?.removeHint(hint);
        if (hint.isConnected) hint.replaceWith(...hint.childNodes);
      }
      this.hints.clear();
    }

    public async refresh(current: Element | null): Promise<void> {
      if (!this.alive || options.mode() === "off" || this.coordinator === null) return;
      const request = new AbortController();
      this.abort = request;
      try {
        const lines = [...section.text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)].filter((line) => line[0].length > 0);
        const start = lines[section.lineStart]?.index ?? 0;
        const last = lines[section.lineEnd];
        const end = last === undefined ? section.text.length : last.index + last[0].length;
        const walker = element.ownerDocument.createTreeWalker(element, 4);
        const nodes: Array<{ node: Text; from: number; to: number; text: string }> = [];
        let node: Node | null;
        while ((node = walker.nextNode()) !== null) {
          if (node.nodeType !== 3) continue;
          const textNode = node as Text;
          const parent = textNode.parentElement;
          if (parent === null || parent.closest(MENTION_READING_INTERACTIVE) !== null || textNode.data.trim().length === 0 ||
            (current !== null && !current.contains(textNode)) || (options.mode() === "paragraph" && current === null)) continue;
          const rect = parent.getBoundingClientRect();
          if (rect.bottom <= 0 || rect.top >= element.ownerDocument.defaultView!.innerHeight) continue;
          // Exact, unique source text only. Transformed/ambiguous rendered spans retain list navigation.
          const from = section.text.indexOf(textNode.data, start);
          if (from < start || from + textNode.length > end || section.text.indexOf(textNode.data, from + 1) < end &&
            section.text.indexOf(textNode.data, from + 1) !== -1) continue;
          nodes.push({ node: textNode, from, to: from + textNode.length, text: textNode.data });
        }
        if (nodes.length === 0) return;
        const source = await options.match(context.sourcePath, section.text, nodes.map(({ from, to }) => ({ from, to })), request.signal);
        if (!this.alive || request.signal.aborted) return;
        for (const mapped of nodes) {
          if (this.coordinator.budget <= 0) break;
          const { node: textNode, from } = mapped;
          if (!textNode.isConnected || textNode.data !== mapped.text || textNode.parentElement?.closest(MENTION_READING_INTERACTIVE) !== null) continue;
          const fragments = mentionDisplayFragments(source.matches, mapped, this.coordinator.budget);
          if (fragments.length === 0) continue;
          const replacement = element.ownerDocument.createDocumentFragment();
          let position = 0;
          for (const fragment of fragments) {
            const offset = fragment.from - from;
            replacement.append(textNode.data.slice(position, offset));
            const hint = element.ownerDocument.createElement("span");
            hint.className = `link-integrity-mention-hint${fragment.tracks === 2 ? " is-overlapping" : ""}`;
            hint.textContent = textNode.data.slice(offset, fragment.to - from);
            hint.tabIndex = 0;
            hint.setAttribute("role", "button");
            hint.setAttribute("aria-label", options.label?.(hint.textContent) ?? hint.textContent);
            replacement.append(hint);
            this.hints.set(hint, fragment.matches);
            this.coordinator.addHint(hint, source, fragment.matches);
            position = fragment.to - from;
          }
          replacement.append(textNode.data.slice(position));
          textNode.replaceWith(replacement);
        }
      } catch { /* Stale rendering is cleared; the manual query remains available. */ }
    }
  }(element);
  const dispose = () => child.onunload();
  context.addChild(child);
  return dispose;
}
