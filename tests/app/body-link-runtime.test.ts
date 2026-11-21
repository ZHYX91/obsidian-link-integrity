import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField, MarkdownView, type MarkdownRenderChild, type Editor, type MarkdownFileInfo, type MarkdownPostProcessorContext, type Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { BodyLinkRuntime } from "../../src/app/body-link-runtime";
import { bodySetup } from "../helpers/body-links";

describe("body runtime composition", () => {
  it("registers only read-only diagnostics, remains dormant, and prevents late UI after close", async () => {
    const test = bodySetup(); let release!: () => void;
    const ensure = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const runtime = new BodyLinkRuntime(test.app, () => test.index, ensure, () => test.settings, () => true, vi.fn());
    const commands: { id: string }[] = []; let reading!: (element: HTMLElement, context: MarkdownPostProcessorContext) => void;
    const plugin = { addCommand: (command: { id: string }) => { commands.push(command); }, registerEditorExtension: vi.fn(),
      registerMarkdownPostProcessor: (callback: typeof reading) => { reading = callback; } } as unknown as Plugin;
    runtime.register(plugin); expect(commands.map((command) => command.id)).toEqual(["broken-links-current-note"]); expect(ensure).not.toHaveBeenCalled();
    for (let index = 0; index < 1_000; index += 1) reading(document.createElement("p"), { getSectionInfo: () => null } as unknown as MarkdownPostProcessorContext);
    expect((runtime as unknown as { reading: Set<unknown> }).reading.size).toBe(0);
    const editor = { getValue: () => test.text } as Editor;
    const promise = runtime.current(editor, { file: test.files.get(test.path) } as MarkdownFileInfo); runtime.close(); release(); await promise;
    expect(document.querySelector("dialog")).toBeNull(); expect(test.app.vault.cachedRead).not.toHaveBeenCalled();
  });
  it("keeps disabled hints idle across Vault events and clears active views once on disable", () => {
    const test = bodySetup();
    const ensure = vi.fn(async () => {});
    const runtime = new BodyLinkRuntime(test.app, () => test.index, ensure, () => test.settings, () => true, vi.fn());
    let extension!: Extension;
    let reading!: (element: HTMLElement, context: MarkdownPostProcessorContext) => void;
    runtime.register({
      addCommand: vi.fn(),
      registerEditorExtension: (value: Extension) => { extension = value; },
      registerMarkdownPostProcessor: (value: typeof reading) => { reading = value; },
    } as unknown as Plugin);
    const view = new EditorView({ parent: document.createElement("div"), state: EditorState.create({
      doc: test.text, extensions: [editorInfoField.init(() => ({ app: test.app, hoverPopover: null, file: test.files.get(test.path)! })), extension],
    }) });
    const element = document.createElement("p");
    const remove = vi.spyOn(element, "removeEventListener");
    const dispatch = vi.spyOn(view, "dispatch");
    reading(element, {
      sourcePath: test.path, getSectionInfo: () => ({ text: test.text, lineStart: 0, lineEnd: 0 }),
      addChild: (child: MarkdownRenderChild) => child.onload(),
    } as unknown as MarkdownPostProcessorContext);
    const sendChanges = () => {
      for (let index = 0; index < 100; index++) runtime.sourceChanged(`other-${index}.md`, true);
    };
    try {
      sendChanges();
      expect(dispatch).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      Object.assign(test.settings.brokenLinks, { bodyHints: true });
      runtime.invalidate();
      expect(dispatch).toHaveBeenCalledOnce();
      Object.assign(test.settings.brokenLinks, { bodyHints: false });
      runtime.invalidate();
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledTimes(5);
      sendChanges();
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledTimes(5);
      expect(ensure).not.toHaveBeenCalled();
    } finally {
      view.destroy();
      runtime.close();
    }
  });
  it("lists proven diagnostics while Off and navigates without changing source text", async () => {
    const test = bodySetup(); const runtime = new BodyLinkRuntime(test.app, () => test.index, async () => {}, () => test.settings, () => true, vi.fn());
    const selection = vi.fn(); const editor = { getValue: () => test.text, offsetToPos: (offset: number) => ({ line: 0, ch: offset }), setSelection: selection, scrollIntoView: vi.fn(), focus: vi.fn() } as unknown as Editor;
    await runtime.current(editor, { file: test.files.get(test.path) } as MarkdownFileInfo);
    document.querySelector<HTMLButtonElement>(".link-integrity-body-diagnostic")!.click(); expect(selection).toHaveBeenCalledWith({ line: 0, ch: 0 }, { line: 0, ch: test.text.length });
    expect(test.bodies.get(test.path)).toBe(test.text); runtime.close();
  });
  it("drops a result if the pane opens a replacement file with the same path and contents", async () => {
    const test = bodySetup();
    const runtime = new BodyLinkRuntime(test.app, () => test.index, async () => {}, () => test.settings, () => true, vi.fn());
    const info = { file: test.files.get(test.path)! };
    const editor = { getValue: () => test.text, setSelection: vi.fn() };
    try {
      await runtime.current(editor as unknown as Editor, info as MarkdownFileInfo);
      const row = document.querySelector<HTMLButtonElement>(".link-integrity-body-diagnostic")!;
      info.file = bodySetup().files.get(test.path)!;
      row.click();
      expect(editor.setSelection).not.toHaveBeenCalled();
    } finally {
      runtime.close();
    }
  });
  it.each(["\n", "\r\n", "\r"])("revalidates Reading diagnostics with editor EOL %j", async (eol) => {
    const test = bodySetup("intro\r\n[[Missing|Label]] [[Missing|Label]]"); const select = vi.fn(); const setViewState = vi.fn(async () => {});
    const view = new MarkdownView(null as never);
    Object.assign(view, { file: test.files.get(test.path), getMode: () => "preview", containerEl: document.createElement("div"),
      editor: { getValue: () => test.text.replace(/\r\n/gu, eol), offsetToPos: (offset: number) => ({ line: 0, ch: offset }), setSelection: select, scrollIntoView: vi.fn(), focus: vi.fn() },
      leaf: { view, setViewState } });
    Object.assign(test.app, { workspace: { getActiveViewOfType: () => view } });
    let command!: { checkCallback: (checking: boolean) => boolean };
    const runtime = new BodyLinkRuntime(test.app, () => test.index, async () => {}, () => test.settings, () => true, vi.fn());
    runtime.register({ addCommand: (value: typeof command) => { command = value; }, registerEditorExtension: vi.fn(), registerMarkdownPostProcessor: vi.fn() } as unknown as Plugin);
    expect(command.checkCallback(true)).toBe(true); expect(document.querySelector("dialog")).toBeNull(); command.checkCallback(false);
    await vi.waitFor(() => expect(document.querySelector(".link-integrity-body-diagnostic")).not.toBeNull());
    document.querySelectorAll<HTMLButtonElement>(".link-integrity-body-diagnostic")[1]!.click(); await vi.waitFor(() => expect(select).toHaveBeenCalledOnce());
    expect(setViewState).toHaveBeenCalledWith({ type: "markdown", state: { file: test.path, mode: "source" } });
    expect(select).toHaveBeenCalledWith({ line: 0, ch: 23 + eol.length }, { line: 0, ch: 40 + eol.length });
    expect(view.editor.focus).toHaveBeenCalledOnce();
    runtime.close(); expect(command.checkCallback(true)).toBe(false);
  });
  it("releases pending metadata for deleted/non-Markdown paths", () => {
    const test = bodySetup(); const runtime = new BodyLinkRuntime(test.app, () => test.index, async () => {}, () => test.settings, () => true, vi.fn());
    Object.assign(test.settings.brokenLinks, { bodyHints: true });
    const pending = (runtime as unknown as { metadataPending: Set<string> }).metadataPending;
    runtime.sourceChanged(test.path, false); expect(pending.size).toBe(1);
    test.files.delete(test.path); runtime.sourceChanged(test.path, false); runtime.sourceChanged("Attachment.png", false); expect(pending.size).toBe(0);
    runtime.sourceChanged("Target.md", false); runtime.sourceChanged(null, true); expect(pending.size).toBe(0); runtime.close();
  });
  it("recognizes a cache update that preceded listener registration", async () => {
    const test = bodySetup(); const runtime = new BodyLinkRuntime(test.app, () => test.index, async () => {}, () => test.settings, () => true, vi.fn());
    Object.assign(test.settings.brokenLinks, { bodyHints: true });
    runtime.sourceChanged(test.path, false);
    const editor = { getValue: () => test.text } as Editor; const info = { file: test.files.get(test.path) } as MarkdownFileInfo;
    await runtime.current(editor, info); expect(document.querySelector(".link-integrity-body-diagnostic")).toBeNull();
    runtime.invalidate(); test.caches.set(test.path, {}); await runtime.current(editor, info);
    expect(document.querySelector(".link-integrity-body-diagnostic")).not.toBeNull(); runtime.close();
  });
});
