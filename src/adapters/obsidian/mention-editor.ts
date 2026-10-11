import { StateEffect, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorInfoField, type MarkdownFileInfo, type TFile } from "obsidian";

import { mentionDisplayFragments, mentionParagraphRange, type MentionDisplayFragment } from "../../core/mention-display";
import type { PotentialMentionSource } from "../../features/mentions/potential-mention-service";
import type { PotentialMentionMatch } from "../../core/potential-mention-model";

export interface MentionEditorOptions {
  readonly mode: () => "off" | "paragraph" | "document";
  readonly match: (path: string, text: string, range: { from: number; to: number } | undefined,
    signal: AbortSignal) => Promise<PotentialMentionSource>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly pick: (source: PotentialMentionSource, matches: readonly PotentialMentionMatch[], info: MarkdownFileInfo,
    document: Document, getCurrentFile: () => TFile | null) => void;
}

const redraw = StateEffect.define<null>();
export const MAX_MENTION_DECORATIONS = 1_000;

export function createMentionEditorExtension(options: MentionEditorOptions): Extension {
  return ViewPlugin.fromClass(class {
    public decorations: DecorationSet = Decoration.none;
    private fragments: readonly MentionDisplayFragment[] = [];
    private source: PotentialMentionSource | null = null;
    private request: AbortController | null = null;
    private timer: number | null = null;
    private disposed = false;
    private get window(): Window { return this.view.dom.ownerDocument.defaultView!; }
    private readonly unsubscribe: () => void;

    public constructor(private readonly view: EditorView) {
      this.unsubscribe = options.subscribe(() => this.schedule());
      this.schedule();
    }

    public update(update: ViewUpdate): void {
      if (update.docChanged) this.decorations = this.decorations.map(update.changes);
      if (update.docChanged || update.selectionSet || update.viewportChanged) this.schedule();
    }

    public afterComposition(): void { this.schedule(); }

    public destroy(): void {
      this.disposed = true;
      this.request?.abort();
      if (this.timer !== null) this.window.clearTimeout(this.timer);
      this.unsubscribe();
    }

    public open(event: MouseEvent): void {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey ||
        this.view.composing || this.source === null || !this.view.state.selection.main.empty) return;
      const target = event.target;
      if (!(target instanceof this.view.dom.ownerDocument.defaultView!.Element)) return;
      if (target.closest("a,button,input,select,textarea,[contenteditable=false]")) return;
      const hint = target.closest<HTMLElement>(".link-integrity-mention-hint");
      if (hint === null) return;
      const index = Number(hint.dataset.mentionFragment);
      const fragment = this.fragments[index];
      const info = this.view.state.field(editorInfoField, false);
      if (fragment !== undefined && info?.file !== null && info !== undefined) {
        options.pick(this.source, fragment.matches, info, this.view.dom.ownerDocument,
          () => this.disposed || !this.view.dom.isConnected ? null : this.view.state.field(editorInfoField, false)?.file ?? null);
      }
    }

    private schedule(): void {
      this.request?.abort();
      if (this.timer !== null) this.window.clearTimeout(this.timer);
      if (this.disposed) return;
      this.timer = this.window.setTimeout(() => { this.timer = null; void this.refresh(); }, 80);
    }

    private async refresh(): Promise<void> {
      if (this.disposed || this.view.composing) return;
      const mode = options.mode();
      const info = this.view.state.field(editorInfoField, false);
      if (mode === "off" || info?.file === null || info?.file === undefined || info.file.extension !== "md") {
        this.decorations = Decoration.none;
        this.fragments = [];
        this.source = null;
        this.view.dispatch({ effects: redraw.of(null) });
        return;
      }
      const request = new AbortController();
      this.request = request;
      const text = this.view.state.doc.toString();
      const path = info.file.path;
      try {
        const source = await options.match(path, text, mode === "paragraph"
          ? mentionParagraphRange(text, this.view.state.selection.main.head) : undefined, request.signal);
        if (request.signal.aborted || this.disposed || this.view.state.doc.toString() !== text ||
          this.view.state.field(editorInfoField, false)?.file?.path !== path) return;
        const fragments = this.view.visibleRanges.flatMap((range) => mentionDisplayFragments(source.matches, range))
          .slice(0, MAX_MENTION_DECORATIONS);
        this.fragments = fragments;
        this.source = source;
        this.decorations = Decoration.set(fragments.map((fragment, index) => Decoration.mark({
          class: `link-integrity-mention-hint${fragment.tracks === 2 ? " is-overlapping" : ""}`,
          attributes: { "data-mention-fragment": String(index) },
        }).range(fragment.from, fragment.to)), true);
        this.view.dispatch({ effects: redraw.of(null) });
      } catch {
        if (!request.signal.aborted && !this.disposed) {
          this.decorations = Decoration.none;
          this.view.dispatch({ effects: redraw.of(null) });
        }
      }
    }
  }, {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      click(event) { this.open(event); },
      compositionend() { this.afterComposition(); },
    },
  });
}
