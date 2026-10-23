import { StateEffect, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type { BodyLinkHint, BodyLinkSource } from "../../features/body-links/body-link-service";

export interface BodyEditorOptions {
  readonly enabled: () => boolean;
  readonly source: (path: string, text: string, signal: AbortSignal) => Promise<BodyLinkSource>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly reason: (hint: BodyLinkHint) => string;
}
const redraw = StateEffect.define<null>();
export const MAX_BODY_DECORATIONS = 1_000;

/** Marks source text only; native link events and replacement widgets retain ownership. */
export function createBodyLinkEditorExtension(options: BodyEditorOptions): Extension {
  return ViewPlugin.fromClass(class {
    public decorations: DecorationSet = Decoration.none;
    private abort: AbortController | null = null;
    private timer: number | null = null;
    private disposed = false;
    private sourcePath: string | null;
    private readonly unsubscribe: () => void;
    private get window(): Window { return this.view.dom.ownerDocument.defaultView!; }
    public constructor(private readonly view: EditorView) {
      this.sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? null;
      this.unsubscribe = options.subscribe(() => { this.clear(); this.view.dispatch({ effects: redraw.of(null) }); this.schedule(); });
      this.schedule();
    }
    public update(update: ViewUpdate): void {
      // Host file info can mutate in place, including a rename with unchanged text.
      // Retain the path value rather than comparing shared objects in the two states.
      const sourcePath = this.view.state.field(editorInfoField, false)?.file?.path ?? null;
      const sourceChanged = sourcePath !== this.sourcePath;
      this.sourcePath = sourcePath;
      if (update.docChanged || sourceChanged) this.clear();
      if (update.docChanged || update.viewportChanged || sourceChanged) this.schedule();
    }
    public destroy(): void {
      this.disposed = true; this.clear(); this.unsubscribe();
      if (this.timer !== null) this.window.clearTimeout(this.timer);
    }
    private clear(): void { this.abort?.abort(); this.decorations = Decoration.none; }
    public schedule(): void {
      this.abort?.abort();
      if (this.timer !== null) this.window.clearTimeout(this.timer);
      if (!this.disposed && options.enabled()) this.timer = this.window.setTimeout(() => { this.timer = null; void this.refresh(); }, 80);
    }
    private async refresh(): Promise<void> {
      const file = this.view.state.field(editorInfoField, false)?.file;
      if (this.disposed || this.view.composing || !options.enabled() || file?.extension !== "md") return;
      const text = this.view.state.doc.toString(); const path = file.path;
      const abort = new AbortController(); this.abort = abort;
      try {
        const source = await options.source(path, text, abort.signal);
        if (abort.signal.aborted || this.disposed || !options.enabled() || this.view.state.doc.toString() !== text ||
          this.view.state.field(editorInfoField, false)?.file?.path !== path) return;
        const ranges = source.hints.filter((hint) => this.view.visibleRanges.some(({ from, to }) => hint.from < to && hint.to > from)).slice(0, MAX_BODY_DECORATIONS);
        this.decorations = Decoration.set(ranges.map((hint) => Decoration.mark({ class: "link-integrity-broken-body-hint",
          attributes: { title: options.reason(hint), "aria-description": options.reason(hint) },
        }).range(hint.from, hint.to)), true);
        this.view.dispatch({ effects: redraw.of(null) });
      } catch { if (!this.disposed && !abort.signal.aborted) { this.clear(); this.view.dispatch({ effects: redraw.of(null) }); } }
    }
  }, { decorations: (plugin) => plugin.decorations, eventHandlers: { compositionend() { this.schedule(); } } });
}
