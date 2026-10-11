import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownView, Notice, type App, type Command, type Editor, type MarkdownPostProcessorContext, type Plugin, type TFile, type WorkspaceLeaf } from "obsidian";
import { MentionRuntime } from "../../src/app/mention-runtime";
import { createFileRecord, LinkIndex } from "../../src/core";
import { createDefaultSettings } from "../../src/shared/settings";

afterEach(() => document.body.replaceChildren());

function setup(raw = "白云山") {
  let text = raw.replace(/\r\n|\r/gu, "\n");
  const source = { path: "Source.md", extension: "md" } as TFile;
  const target = { path: "白云山.md", extension: "md" } as TFile;
  const files = new Map([[source.path, source], [target.path, target]]);
  const bodies = new Map([[source.path, raw], [target.path, "# Target"]]);
  const editor = { getValue: () => text, getCursor: () => ({ line: 0, ch: 0 }), posToOffset: () => 0,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }), setSelection: vi.fn(), scrollIntoView: vi.fn(),
    transaction: vi.fn((transaction: { changes: Array<{ from: { ch: number }; to: { ch: number }; text: string }> }) => {
      const change = transaction.changes[0]!;
      text = text.slice(0, change.from.ch) + change.text + text.slice(change.to.ch);
    }) } as unknown as Editor;
  const view = new MarkdownView({} as WorkspaceLeaf);
  Object.defineProperties(view, { file: { value: source, writable: true }, editor: { value: editor },
    containerEl: { value: document.createElement("div") } });
  const commands: Command[] = [];
  const listeners = new Map<string, () => void>();
  const register = vi.fn();
  const reading = vi.fn();
  const plugin = { addCommand: (command: Command) => { commands.push(command); return command; },
    registerEditorExtension: vi.fn(), registerMarkdownPostProcessor: reading, register,
    registerEvent: vi.fn() } as unknown as Plugin;
  const app = { vault: { getFileByPath: (path: string) => files.get(path) ?? null,
    cachedRead: vi.fn(async (file: TFile) => bodies.get(file.path) ?? ""),
    on: (name: string, callback: () => void) => { listeners.set(name, callback); return {}; } },
    metadataCache: { getFileCache: () => ({}), getFirstLinkpathDest: () => target, on: vi.fn(() => ({})) },
    fileManager: { generateMarkdownLink: () => "[[白云山]]" },
    workspace: { on: vi.fn(() => ({})), getActiveViewOfType: () => view,
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => callback({ view }),
      getLeaf: () => ({ view, openFile: async (file: TFile) => {
        Object.defineProperty(view, "file", { value: file, writable: true });
        text = (bodies.get(file.path) ?? "").replace(/\r\n|\r/gu, "\n");
      } }) },
  } as unknown as App;
  const index = new LinkIndex([...files.keys()].map((path) => createFileRecord(path)));
  const ensure = vi.fn(async (): Promise<void> => undefined);
  const report = vi.fn();
  const settings = createDefaultSettings();
  const runtime = new MentionRuntime(app, () => index, ensure, () => settings, report);
  runtime.register(plugin);
  return { runtime, commands, app, view, source, target, editor, report, ensure, listeners, settings, index, register, reading };
}

async function click(label: string): Promise<void> {
  let button: HTMLButtonElement | undefined;
  await vi.waitFor(() => {
    button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === label);
    expect(button).toBeDefined();
    expect(button!.disabled).toBe(false);
  });
  button!.click();
}

describe("mention host composition", () => {
  it("keeps Off dormant but supplies explicit current/cursor actions and graph-independent writes", async () => {
    const test = setup();
    expect(test.ensure).not.toHaveBeenCalled();
    expect(test.app.vault.cachedRead).not.toHaveBeenCalled();
    expect(test.app.workspace.on).not.toHaveBeenCalled();
    const enumeration = vi.spyOn(test.index, "iterateFiles");
    const changes = { filePaths: new Set(["Source.md"]), sourcePaths: new Set(["Source.md"]), graphPaths: new Set<string>() };
    test.runtime.indexChanged(changes);
    expect(enumeration).not.toHaveBeenCalled();
    const command = test.commands.find((command) => command.id === "potential-mentions-current-note")!;
    command.editorCallback!(test.editor, test.view);
    await vi.waitFor(() => expect(document.querySelector(".link-integrity-mention-picker-results button")).not.toBeNull());
    document.querySelector<HTMLButtonElement>(".link-integrity-mention-picker-results button")!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 5));
    await click("Create link");
    await vi.waitFor(() => expect(test.editor.getValue()).toBe("[[白云山]]"));
    expect(test.index.toCanonicalState().edges).toEqual([]);
    expect(test.report).not.toHaveBeenCalled();
    expect(test.register).toHaveBeenCalledOnce();
    enumeration.mockClear();
    test.runtime.indexChanged(changes);
    expect(enumeration).not.toHaveBeenCalled();
    test.runtime.close();
  });

  it("reacquires a reverse source and proves CRLF to editor coordinates before creating", async () => {
    const test = setup("🌤️\r\n白云山");
    Object.defineProperty(test.view, "file", { value: test.target, writable: true });
    await test.runtime.reverse(test.target.path, document);
    const range = document.querySelector<HTMLButtonElement>(".link-integrity-mention-picker-results button")!;
    expect(range.textContent).toContain("L2");
    range.click();
    await new Promise((resolve) => window.setTimeout(resolve, 5));
    const create = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Create link")!;
    expect(create.disabled).toBe(true);
    await click("Open source and validate range");
    await click("Create link");
    await vi.waitFor(() => expect(test.editor.getValue()).toBe("🌤️\n[[白云山]]"));
    expect(test.editor.setSelection).toHaveBeenCalledWith({ line: 0, ch: 4 }, { line: 0, ch: 7 });
    test.runtime.close();
  });

  it("invalidates completed reverse results and clears picker state on unload", async () => {
    const test = setup();
    await test.runtime.reverse(test.target.path, document);
    expect(document.body.textContent).toContain("Checked");
    test.listeners.get("modify")!();
    expect(document.body.textContent).toContain("Stale");
    test.runtime.close();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it.each(["index", "match"])("never reopens a picker after closing during the pending %s request", async (stage) => {
    const test = setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    if (stage === "index") test.ensure.mockReturnValue(pending);
    else vi.spyOn(test.runtime.service, "matchSource").mockImplementation(async () => {
      await pending;
      return { sourcePath: "Source.md", sourceText: "白云山", documentRevision: "revision", matches: [] };
    });
    const runtime = test.runtime as unknown as { current: (editor: Editor, info: MarkdownView, atCursor: boolean) => Promise<void> };
    const completion = runtime.current(test.editor, test.view, false);
    await Promise.resolve();
    test.runtime.close();
    release();
    await completion;
    expect(document.querySelector("dialog")).toBeNull();
    expect(test.report).not.toHaveBeenCalled();
  });

  it("keeps Notice Undo available after successful creation closes the picker", async () => {
    const test = setup();
    const runtime = test.runtime as unknown as { current: (editor: Editor, info: MarkdownView, atCursor: boolean) => Promise<void> };
    await runtime.current(test.editor, test.view, false);
    document.querySelector<HTMLButtonElement>(".link-integrity-mention-picker-results button")!.click();
    await click("Create link");
    await vi.waitFor(() => expect(document.querySelector("dialog")).toBeNull());
    expect(test.editor.getValue()).toBe("[[白云山]]");
    const notice = (Notice as unknown as { messages: DocumentFragment[] }).messages.at(-1)!;
    notice.querySelector<HTMLButtonElement>("button")!.click();
    expect(test.editor.getValue()).toBe("白云山");
    expect(test.editor.transaction).toHaveBeenCalledTimes(2);
    test.runtime.close();
  });

  it("rejects an already closed runtime before any index or match work", async () => {
    const test = setup();
    test.runtime.close();
    await test.runtime.reverse("白云山.md", document);
    expect(test.ensure).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("disposes reading roots on runtime close without host unload and supports re-enabling on the same root", async () => {
    const element = document.createElement("div");
    element.className = "markdown-preview-view";
    element.innerHTML = "<p>白云山</p>";
    document.body.append(element);
    element.querySelector("p")!.getBoundingClientRect = () => ({ top: 20, bottom: 40 } as DOMRect);
    const children: Array<{ onload: () => void; onunload: () => void }> = [];
    const context = { sourcePath: "Source.md", getSectionInfo: () => ({ text: "白云山", lineStart: 0, lineEnd: 0 }),
      addChild: (child: typeof children[number]) => { children.push(child); child.onload(); } } as unknown as MarkdownPostProcessorContext;
    const first = setup();
    Object.defineProperty(first.settings.general, "mentionDisplayMode", { value: "document" });
    first.reading.mock.calls[0]![0](element, context);
    await vi.waitFor(() => expect(element.querySelector(".link-integrity-mention-hint")).not.toBeNull());
    first.runtime.close();
    expect(element.querySelector(".link-integrity-mention-hint")).toBeNull();
    const second = setup();
    Object.defineProperty(second.settings.general, "mentionDisplayMode", { value: "document" });
    second.reading.mock.calls[0]![0](element, context);
    await vi.waitFor(() => expect(element.querySelector(".link-integrity-mention-hint")).not.toBeNull());
    children[0]!.onunload();
    const hint = element.querySelector<HTMLElement>(".link-integrity-mention-hint")!;
    hint.click();
    expect(document.querySelector("dialog")).not.toBeNull();
    second.runtime.close();
    expect(element.querySelector(".link-integrity-mention-hint")).toBeNull();
    children[1]!.onunload();
  });
});
