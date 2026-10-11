import { MarkdownView, Notice, getLanguage, parseFrontMatterAliases, type App, type Command, type Editor, type MarkdownFileInfo, type Plugin, type TFile } from "obsidian";

import { createMentionEditorExtension } from "../adapters/obsidian/mention-editor";
import { decorateMentionReading } from "../adapters/obsidian/mention-reading";
import { ObsidianPotentialMentionPort } from "../adapters/obsidian/potential-mention-port";
import { ObsidianPotentialMentionWriter } from "../adapters/obsidian/potential-mention-writer";
import type { LinkIndex, IndexChanges } from "../core/link-index";
import type { PotentialMentionMatch } from "../core/potential-mention-model";
import { MentionRequestCancelledError, mentionDocumentRevision, PotentialMentionService, type PotentialMentionSource, type MentionReverseSnapshot } from "../features/mentions/potential-mention-service";
import { createTranslator } from "../shared/i18n";
import type { LinkIntegritySettings } from "../shared/settings";
import { openMentionPicker, type MentionPicker } from "../ui/mentions/picker";

interface EditorBinding { readonly editor: Editor; readonly file: TFile; readonly currentFile: () => TFile | null; }

/** Host composition for the separate, on-demand mention layer. */
export class MentionRuntime {
  public readonly service: PotentialMentionService;
  private readonly listeners = new Set<() => void>();
  private readonly pickers = new Set<MentionPicker>();
  private readonly readingDisposers = new Set<() => void>();
  private readonly writer: ObsidianPotentialMentionWriter;
  private closed = false;
  private epoch = 0;
  private catalogPaths: Set<string> | null = null;
  private tracking = false;
  private readonly commands: Array<{ command: Command; key: "mentions.current" | "mentions.atCursor" | "mentions.reverse" }> = [];
  private readonly aliasIdentities = new Map<string, string>();
  private beginTracking: () => void = () => undefined;

  public settingsChanged(): void {
    if (this.closed) return;
    if (this.settings().general.mentionDisplayMode === "off") this.service.invalidateSources();
    this.notify();
    for (const { command, key } of this.commands) command.name = this.translator().t(key);
  }

  public constructor(private readonly app: App, private readonly getIndex: () => LinkIndex,
    private readonly ensureIndex: () => Promise<void>, private readonly settings: () => LinkIntegritySettings,
    private readonly report: (error: unknown) => void) {
    this.service = new PotentialMentionService(getIndex, new ObsidianPotentialMentionPort(app.vault, app.metadataCache, (path) => {
      let source: string | null = null;
      app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path) source ??= leaf.view.editor.getValue();
      });
      return source;
    }));
    this.writer = new ObsidianPotentialMentionWriter(app);
  }

  public register(plugin: Plugin): void {
    const mode = () => this.closed ? "off" : this.settings().general.mentionDisplayMode;
    const match = async (path: string, text: string, range: readonly { from: number; to: number }[] | undefined, signal: AbortSignal) => {
      const epoch = this.epoch;
      this.assertActive(epoch);
      await this.ensureIndex();
      this.assertActive(epoch);
      this.beginTracking();
      const source = await this.service.matchSource(path, text, range, signal);
      this.assertActive(epoch);
      return source;
    };
    plugin.registerEditorExtension(createMentionEditorExtension({ mode, match, subscribe: this.subscribe,
      pick: (source, matches, info, document, currentFile) => this.pick(source, matches, document, this.binding(info, currentFile)) }));
    plugin.registerMarkdownPostProcessor((element, context) => {
      if (this.closed) return;
      const dispose = decorateMentionReading(element, context, {
      mode, match, subscribe: this.subscribe,
      pick: (source, matches, document) => this.pick(source, matches, document),
      label: (text) => `${this.translator().t("mentions.title")}: ${text}`,
      onDispose: (dispose) => this.readingDisposers.delete(dispose),
      });
      this.readingDisposers.add(dispose);
    });
    for (const cursor of [false, true]) {
      const key = cursor ? "mentions.atCursor" : "mentions.current";
      const command = plugin.addCommand({
      id: cursor ? "potential-mentions-at-cursor" : "potential-mentions-current-note",
      name: this.translator().t(key),
      editorCallback: (editor, info) => { void this.current(editor, info, cursor).catch((error) => { if (!this.closed) this.report(error); }); },
      });
      this.commands.push({ command, key });
    }
    const reverseCommand = plugin.addCommand({ id: "potential-mentions-to-current-note", name: this.translator().t("mentions.reverse"),
      callback: () => { const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file !== null && view?.file !== undefined) void this.reverse(view.file.path, view.containerEl.ownerDocument)
          .catch((error) => { if (!this.closed) this.report(error); }); },
    });
    this.commands.push({ command: reverseCommand, key: "mentions.reverse" });
    this.beginTracking = () => {
      if (this.closed) return;
      this.catalogPaths ??= new Set([...this.getIndex().iterateFiles()].filter((file) => file.extension === "md").map((file) => file.path));
      if (this.tracking) return;
      this.tracking = true;
      plugin.registerEvent(this.app.metadataCache.on("changed", (file) => {
      const identity = JSON.stringify(parseFrontMatterAliases(this.app.metadataCache.getFileCache(file)?.frontmatter ?? null));
      if (this.aliasIdentities.get(file.path) !== identity) {
        this.aliasIdentities.set(file.path, identity);
        this.targetsChanged();
      }
      }));
      plugin.registerEvent(this.app.metadataCache.on("resolved", () => this.targetsChanged()));
      plugin.registerEvent(this.app.vault.on("modify", () => { this.service.invalidateSources(); this.notify(); }));
      plugin.registerEvent(this.app.vault.on("create", () => this.targetsChanged()));
      plugin.registerEvent(this.app.vault.on("delete", () => this.targetsChanged()));
      plugin.registerEvent(this.app.vault.on("rename", () => this.targetsChanged()));
      plugin.registerEvent(this.app.workspace.on("editor-change", () => { this.service.invalidateSources(); this.notify(); }));
    };
    plugin.register(() => this.close());
  }

  public readonly subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public notify(): void {
    if (this.closed) return;
    for (const listener of this.listeners) listener();
  }

  public indexChanged(changes?: IndexChanges): void {
    if (!this.tracking) return;
    if (changes === undefined) {
      this.catalogPaths = null;
      this.service.invalidateTargets();
    } else if (this.catalogPaths !== null) {
      let changed = false;
      for (const path of changes.filePaths) {
        const exists = this.getIndex().getFile(path)?.extension === "md";
        if (exists === this.catalogPaths.has(path)) continue;
        if (exists) this.catalogPaths.add(path); else this.catalogPaths.delete(path);
        changed = true;
      }
      if (changed) this.service.invalidateTargets();
    }
    this.notify();
  }

  public targetsChanged(): void { this.service.invalidateTargets(); this.notify(); }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.epoch += 1;
    this.service.invalidateTargets();
    for (const picker of [...this.pickers]) picker.close();
    for (const dispose of this.readingDisposers) dispose();
    this.readingDisposers.clear();
    this.listeners.clear();
  }

  public async reverse(path: string, document: Document): Promise<void> {
    if (this.closed) return;
    const epoch = this.epoch;
    await this.ensureIndex();
    if (this.closed || epoch !== this.epoch) return;
    this.beginTracking();
    const abort = new AbortController();
    let unsubscribe: () => void = () => undefined;
    const picker = this.makePicker(document, () => { abort.abort(); unsubscribe(); });
    let last: MentionReverseSnapshot | null = null;
    const update = (snapshot: MentionReverseSnapshot) => {
      if (this.closed || epoch !== this.epoch || abort.signal.aborted) return;
      last = snapshot;
      const count = snapshot.matchCount;
      const status = this.translator().t("mentions.coverage", { checked: snapshot.checked,
        total: snapshot.total, count, state: this.translator().t(`mentions.${snapshot.state}`) });
      picker.update(snapshot.sources, status + (this.service.aliasesComplete ? "" : ` · ${this.translator().t("mentions.aliasPending")}`), snapshot.state === "complete");
    };
    unsubscribe = this.subscribe(() => {
      if (last?.state === "complete") update({ ...last, state: "stale" });
    });
    const result = await this.service.reverseLookup(path, { signal: abort.signal, onProgress: update });
    if (!this.closed && epoch === this.epoch && !abort.signal.aborted) update(result);
  }

  private async current(editor: Editor, info: MarkdownFileInfo, atCursor: boolean): Promise<void> {
    if (this.closed) return;
    const epoch = this.epoch;
    const binding = info instanceof MarkdownView ? this.binding(info) : undefined;
    const file = info.file;
    if (file === null) return;
    const text = editor.getValue();
    await this.ensureIndex();
    if (this.closed || epoch !== this.epoch || info.file !== file || editor.getValue() !== text) return;
    this.beginTracking();
    const source = await this.service.matchSource(file.path, text);
    if (this.closed || epoch !== this.epoch || info.file !== file || editor.getValue() !== text) return;
    const cursor = editor.posToOffset(editor.getCursor());
    const matches = atCursor ? source.matches.filter((match) => match.from <= cursor && match.to >= cursor) : source.matches;
    const view = info instanceof MarkdownView ? info : this.app.workspace.getActiveViewOfType(MarkdownView);
    this.pick(source, matches, view?.containerEl.ownerDocument ?? document, binding);
  }

  private binding(info: MarkdownFileInfo, currentFile: () => TFile | null = () => info.file): EditorBinding | undefined {
    if (info.file === null || info.editor === undefined) return undefined;
    return { file: info.file, editor: info.editor, currentFile: () => this.closed ? null : currentFile() };
  }

  private pick(source: PotentialMentionSource, matches: readonly PotentialMentionMatch[], document: Document, binding?: EditorBinding): void {
    if (this.closed) return;
    const selected = { ...source, matches };
    const picker = this.makePicker(document, () => undefined, binding === undefined ? undefined : { source: selected, binding });
    picker.update([selected], this.service.aliasesComplete ? "" : this.translator().t("mentions.aliasPending"), this.service.aliasesComplete);
  }

  private makePicker(document: Document, onClose: () => void, initial?: { source: PotentialMentionSource; binding: EditorBinding }): MentionPicker {
    const epoch = this.epoch;
    this.assertActive(epoch);
    let pickerClosed = false;
    const active = () => { this.assertActive(epoch); if (pickerClosed) throw new MentionRequestCancelledError(); };
    const bindings = new Map<PotentialMentionSource, { binding: EditorBinding; source: PotentialMentionSource; offset: (value: number) => number }>();
    if (initial !== undefined) bindings.set(initial.source, { ...initial, offset: (value) => value });
    const picker = openMentionPicker(document, this.translator(), {
      canCreate: (source) => !this.closed && !pickerClosed && bindings.has(source),
      navigate: async (source, match) => {
        active();
        const file = this.app.vault.getFileByPath(source.sourcePath);
        if (file === null) throw new Error("source-changed");
        const raw = source.sourceText ?? await this.app.vault.cachedRead(file);
        active();
        if (await mentionDocumentRevision(raw) !== source.documentRevision) throw new Error("source-changed");
        active();
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source" } });
        active();
        if (!(leaf.view instanceof MarkdownView) || leaf.view.file !== file) throw new Error("range-unavailable");
        const view = leaf.view;
        const editorText = view.editor.getValue();
        const normalize = (value: string) => value.replace(/\r\n|\r/gu, "\n");
        if (editorText !== raw && editorText !== normalize(raw)) throw new Error("source-changed");
        const offset = editorText === raw ? (value: number) => value : (value: number) => normalize(raw.slice(0, value)).length;
        const converted: PotentialMentionSource = { ...source, sourceText: editorText, documentRevision: await mentionDocumentRevision(editorText) };
        active();
        bindings.set(source, { binding: { editor: view.editor, file, currentFile: () => this.closed ? null : view.file }, source: converted, offset });
        const from = view.editor.offsetToPos(offset(match.from));
        const to = view.editor.offsetToPos(offset(match.to));
        view.editor.setSelection(from, to);
        view.editor.scrollIntoView({ from, to }, true);
      },
      openTarget: async (path) => { active(); const file = this.app.vault.getFileByPath(path);
        if (file !== null) await this.app.workspace.getLeaf("tab").openFile(file); },
      create: async (source, match, targetPath) => {
        active();
        const selected = bindings.get(source);
        if (selected === undefined) throw new Error("range-unavailable");
        const { binding, offset } = selected;
        const receipt = await this.writer.createLink(binding.editor, binding.file, selected.source,
          { ...match, from: offset(match.from), to: offset(match.to) }, targetPath,
          binding.currentFile, () => !this.closed && !pickerClosed);
        active();
        const fragment = document.createDocumentFragment();
        fragment.append(this.translator().t("mentions.created"));
        const undo = document.createElement("button");
        undo.type = "button";
        undo.textContent = this.translator().t("common.undo");
        fragment.append(" ", undo);
        const notice = new Notice(fragment, 10_000);
        undo.addEventListener("click", () => {
          try { receipt.undo(); notice.hide(); } catch { new Notice(this.translator().t("mentions.undoUnavailable")); }
        }, { once: true });
      },
      close: () => { pickerClosed = true; onClose(); this.pickers.delete(picker); },
    });
    this.pickers.add(picker);
    return picker;
  }

  private assertActive(epoch: number): void {
    if (this.closed || epoch !== this.epoch) throw new MentionRequestCancelledError();
  }

  private translator() { return createTranslator(this.settings().general.locale, getLanguage()); }
}
