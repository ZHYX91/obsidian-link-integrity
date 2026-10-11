import { getLanguage, MarkdownView, type App, type CachedMetadata, type Editor, type MarkdownFileInfo, type Plugin } from "obsidian";
import { normalizedBodyText } from "../adapters/obsidian/body-link-port";
import type { LinkIndex } from "../core";
import { ObsidianBodyLinkPort } from "../adapters/obsidian/body-link-port";
import { createBodyLinkEditorExtension } from "../adapters/obsidian/body-link-editor";
import { decorateBodyLinkReading } from "../adapters/obsidian/body-link-reading";
import { BodyLinkService, type BodyLinkHint, type BodyLinkSource } from "../features/body-links/body-link-service";
import { isBrokenDiagnosticVisible } from "./broken-link-visibility";
import { IgnoreService } from "../shared/ignore-rules";
import { createTranslator } from "../shared/i18n";
import type { LinkIntegritySettings } from "../shared/settings";
import { bodyReasonKey, openBodyLinkDiagnostics } from "../ui/body-links/diagnostics";

export class BodyLinkRuntime {
  private closed = false;
  private proofActivated = false;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly reading = new Set<() => void>();
  private readonly dialogs = new Set<() => void>();
  private readonly metadataPending = new Map<string, CachedMetadata | null>();
  private readonly service: BodyLinkService;
  public constructor(private readonly app: App, index: () => LinkIndex, private readonly ensureIndex: () => Promise<void>,
    private readonly settings: () => LinkIntegritySettings, ready: () => boolean, private readonly report: (error: unknown) => void) {
    this.service = new BodyLinkService(index, () => !this.closed && ready(), new ObsidianBodyLinkPort(app, (path) => this.metadataReady(path)), (current) => {
      const value = settings(); const ignore = new IgnoreService(value.ignoreRules);
      return (diagnostic) => isBrokenDiagnosticVisible(diagnostic, current, value, ignore);
    });
  }
  public register(plugin: Plugin): void {
    const options = { enabled: () => !this.closed && this.settings().brokenLinks.bodyHints,
      source: (path: string, text: string, signal: AbortSignal) => this.source(path, text, signal),
      subscribe: (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; },
      reason: (hint: BodyLinkHint) => this.translator().t(bodyReasonKey(hint.diagnostic.reason)),
    };
    plugin.registerEditorExtension(createBodyLinkEditorExtension(options));
    plugin.registerMarkdownPostProcessor((element, context) => {
      if (this.closed) return;
      const dispose = decorateBodyLinkReading(element, context, { ...options, onDispose: (disposer) => { this.reading.delete(disposer); } });
      if (dispose !== null) this.reading.add(dispose);
    });
    plugin.addCommand({ id: "broken-links-current-note", name: this.translator().t("body.command"),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (this.closed || view?.file?.extension !== "md") return false;
        if (!checking) void (view.getMode() === "preview" ? this.preview(view) : this.current(view.editor, view)).catch(this.report);
        return true;
      },
    });
  }
  public sourceChanged(path: string | null, metadata: boolean): void {
    if (!this.proofActivated && !this.settings().brokenLinks.bodyHints) { this.invalidate(); return; }
    if (metadata && path === null) this.metadataPending.clear();
    if (path !== null) {
      if (metadata || this.app.vault.getFileByPath(path)?.extension !== "md") this.metadataPending.delete(path);
      else this.metadataPending.set(path, this.app.metadataCache.getFileCache(this.app.vault.getFileByPath(path)!));
    }
    this.invalidate();
  }
  public invalidate(): void {
    this.generation += 1; this.service.invalidate();
    for (const close of this.dialogs) close(); this.dialogs.clear();
    for (const listener of this.listeners) listener();
  }
  public close(): void {
    if (this.closed) return;
    this.closed = true; this.invalidate();
    for (const dispose of this.reading) dispose(); this.reading.clear(); this.listeners.clear(); this.metadataPending.clear();
  }
  private translator(): ReturnType<typeof createTranslator> { return createTranslator(this.settings().general.locale, getLanguage()); }
  private metadataReady(path: string): boolean {
    if (!this.metadataPending.has(path)) return true;
    const file = this.app.vault.getFileByPath(path);
    if (file === null) { this.metadataPending.delete(path); return false; }
    const current = this.app.metadataCache.getFileCache(file);
    if (current !== null && current !== this.metadataPending.get(path)) { this.metadataPending.delete(path); return true; }
    return false;
  }
  private async source(path: string, text: string, signal: AbortSignal): Promise<BodyLinkSource> {
    this.proofActivated = true;
    if (!this.closed && !signal.aborted) await this.ensureIndex();
    return this.service.source(path, text, signal);
  }
  public async preview(view: MarkdownView): Promise<void> {
    if (this.closed || view.file?.extension !== "md") return;
    this.proofActivated = true;
    const file = view.file;
    await this.ensureIndex();
    if (this.closed || view.file !== file) return;
    const epoch = this.generation;
    const text = await this.app.vault.cachedRead(file);
    if (this.closed || epoch !== this.generation || view.file !== file) return;
    const source = await this.service.source(file.path, text);
    if (this.closed || epoch !== this.generation || view.file !== file) return;
    const close = openBodyLinkDiagnostics(view.containerEl.ownerDocument, this.translator(), source, (hint) => {
      void (async () => {
        if (this.closed || epoch !== this.generation || view.file !== file) return;
        await view.leaf.setViewState({ type: "markdown", state: { file: file.path, mode: "source" } });
        const current = view.leaf.view;
        if (this.closed || epoch !== this.generation || !(current instanceof MarkdownView) || current.file?.path !== file.path ||
          normalizedBodyText(current.editor.getValue()) !== normalizedBodyText(text)) return;
        const editorText = current.editor.getValue();
        const projected = await this.service.source(file.path, editorText);
        if (this.closed || epoch !== this.generation || current.file?.path !== file.path || current.editor.getValue() !== editorText) return;
        const exact = projected.hints.find((entry) => entry.diagnostic.targetText === hint.diagnostic.targetText &&
          entry.occurrence.position?.line === hint.occurrence.position?.line && entry.from === normalizedBodyText(text.slice(0, hint.from)).length);
        if (exact === undefined) return;
        const from = current.editor.offsetToPos(exact.from); const to = current.editor.offsetToPos(exact.to);
        current.editor.setSelection(from, to); current.editor.scrollIntoView({ from, to }, true);
      })().catch(this.report);
    }, () => { this.dialogs.delete(close); });
    this.dialogs.add(close);
  }
  public async current(editor: Editor, info: MarkdownFileInfo): Promise<void> {
    if (this.closed || info.file?.extension !== "md") return;
    this.proofActivated = true;
    const path = info.file.path; const text = editor.getValue();
    await this.ensureIndex();
    // The rebuild itself can invalidate; take a fresh epoch after ensuring a baseline.
    if (this.closed || info.file?.path !== path || editor.getValue() !== text) return;
    const epoch = this.generation;
    const source = await this.service.source(path, text);
    if (this.closed || epoch !== this.generation || info.file?.path !== path || editor.getValue() !== text) return;
    const document = (info as MarkdownView).containerEl?.ownerDocument ?? (typeof activeDocument === "undefined" ? window.document : activeDocument);
    const close = openBodyLinkDiagnostics(document, this.translator(), source, (hint) => {
      if (this.closed || epoch !== this.generation || info.file?.path !== path || editor.getValue() !== text) return;
      const from = editor.offsetToPos(hint.from); const to = editor.offsetToPos(hint.to);
      editor.setSelection(from, to); editor.scrollIntoView({ from, to }, true);
    }, () => { this.dialogs.delete(close); });
    this.dialogs.add(close);
  }
}
