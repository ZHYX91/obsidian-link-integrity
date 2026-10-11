import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField, type MarkdownFileInfo, type MarkdownPostProcessorContext } from "obsidian";
import { createMentionEditorExtension } from "../../src/adapters/obsidian/mention-editor";
import { decorateMentionReading } from "../../src/adapters/obsidian/mention-reading";
import { PotentialMentionMatcher } from "../../src/core/potential-mention-matcher";
import type { PotentialMentionSource } from "../../src/core/potential-mention-model";
import { openMentionPicker } from "../../src/ui/mentions/picker";
import { createTranslator } from "../../src/shared/i18n";

const matcher = new PotentialMentionMatcher([
  { text: "白云山", targetPath: "A.md", kind: "alias" },
  { text: "山", targetPath: "B.md", kind: "alias" },
  { text: "山南路", targetPath: "C.md", kind: "alias" },
]);
const source = (text: string): PotentialMentionSource => ({ sourcePath: "Source.md", sourceText: text,
  documentRevision: "revision", matches: matcher.match(text) });
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe("mention source rendering", () => {
  it("refreshes viewport marks independently, clears Off mode and detaches editor hooks", async () => {
    vi.useFakeTimers();
    let mode: "off" | "document" = "document";
    let notify: () => void = () => undefined;
    const unsubscribe = vi.fn();
    const pick = vi.fn();
    const match = vi.fn(async (_path: string, text: string) => source(text));
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: "白云山南路", extensions: [
      editorInfoField.init(() => ({ file: { path: "Source.md", extension: "md" } } as unknown as MarkdownFileInfo)),
      createMentionEditorExtension({ mode: () => mode, match, pick,
        subscribe: (listener) => { notify = listener; return unsubscribe; } }),
    ] }) });
    await vi.advanceTimersByTimeAsync(120);
    expect(document.querySelectorAll(".link-integrity-mention-hint")).toHaveLength(3);
    document.querySelector<HTMLElement>(".link-integrity-mention-hint.is-overlapping")!.click();
    expect(pick.mock.calls[0]?.[1]).toHaveLength(3);
    const currentFile = pick.mock.calls[0]?.[4] as () => unknown;
    expect(currentFile()).toEqual({ path: "Source.md", extension: "md" });
    view.dispatch({ changes: { from: 0, to: 5, insert: "白云山" } });
    await vi.advanceTimersByTimeAsync(120);
    expect(match.mock.calls.at(-1)?.[1]).toBe("白云山");
    mode = "off"; notify();
    await vi.advanceTimersByTimeAsync(120);
    expect(document.querySelector(".link-integrity-mention-hint")).toBeNull();
    view.destroy();
    expect(currentFile()).toBeNull();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("maps reading text conservatively and protects interactive nodes across lifecycle", async () => {
    vi.useFakeTimers();
    const element = document.createElement("div");
    element.innerHTML = '<p>白云山南路</p><a href="#">白云山</a><code>山</code>';
    document.body.append(element);
    element.getBoundingClientRect = () => ({ top: 0, bottom: 200 } as DOMRect);
    element.querySelector("p")!.getBoundingClientRect = () => ({ top: 20, bottom: 40 } as DOMRect);
    let child!: { onload: () => void; onunload: () => void };
    const unsubscribe = vi.fn();
    const pick = vi.fn();
    const context = { sourcePath: "Source.md", getSectionInfo: () => ({ text: "白云山南路", lineStart: 0, lineEnd: 0 }),
      addChild: (value: typeof child) => { child = value; child.onload(); } } as unknown as MarkdownPostProcessorContext;
    decorateMentionReading(element, context, { mode: () => "paragraph", match: async (_path, text) => source(text),
      subscribe: () => unsubscribe, pick });
    await vi.advanceTimersByTimeAsync(120);
    expect(element.querySelectorAll("p .link-integrity-mention-hint")).toHaveLength(3);
    expect(element.querySelector("a .link-integrity-mention-hint")).toBeNull();
    element.querySelector<HTMLElement>(".is-overlapping")!.click();
    expect(pick.mock.calls[0]?.[1]).toHaveLength(3);
    child.onunload();
    expect(element.querySelector(".link-integrity-mention-hint")).toBeNull();
    expect(element.querySelector("p")!.textContent).toBe("白云山南路");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("opens reading candidates from the keyboard and restores hint focus on Escape", async () => {
    vi.useFakeTimers();
    const element = document.createElement("div");
    element.innerHTML = '<p>白云山南路 <span role="button">白云山</span></p>';
    document.body.append(element);
    element.getBoundingClientRect = () => ({ top: 0, bottom: 200 } as DOMRect);
    element.querySelector("p")!.getBoundingClientRect = () => ({ top: 20, bottom: 40 } as DOMRect);
    let child!: { onload: () => void; onunload: () => void };
    const pick = vi.fn(() => openMentionPicker(document, createTranslator("en", "en"), {
      navigate: async () => undefined, openTarget: async () => undefined, create: async () => undefined, canCreate: () => false, close: () => undefined,
    }));
    decorateMentionReading(element, { sourcePath: "Source.md", getSectionInfo: () => ({ text: "白云山南路 白云山", lineStart: 0, lineEnd: 0 }),
      addChild: (value: typeof child) => { child = value; child.onload(); } } as unknown as MarkdownPostProcessorContext,
    { mode: () => "paragraph", match: async (_path, text) => source(text), subscribe: () => () => undefined, pick,
      label: (text) => `Potential mentions: ${text}` });
    await vi.advanceTimersByTimeAsync(120);
    const hint = element.querySelector<HTMLElement>(".link-integrity-mention-hint")!;
    expect(hint.tabIndex).toBe(0);
    expect(hint.getAttribute("role")).toBe("button");
    expect(hint.getAttribute("aria-label")).toContain("Potential mentions:");
    hint.focus();
    hint.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(pick).toHaveBeenCalledOnce();
    document.querySelector("dialog")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(hint);
    await vi.advanceTimersByTimeAsync(120);
    expect(hint.isConnected).toBe(true);
    hint.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(pick).toHaveBeenCalledTimes(2);
    document.querySelector("dialog")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    element.querySelector<HTMLElement>('span[role="button"]:not(.link-integrity-mention-hint)')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(pick).toHaveBeenCalledTimes(2);
    child.onunload();
  });

  it("shares root listeners and paragraph selection across multiple reading sections", async () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    root.className = "markdown-preview-view";
    root.innerHTML = "<div><p>白云山</p></div><div><p>山南路</p></div>";
    document.body.append(root);
    root.getBoundingClientRect = () => ({ top: 0, bottom: 200 } as DOMRect);
    for (const [index, paragraph] of [...root.querySelectorAll("p")].entries()) {
      paragraph.getBoundingClientRect = () => ({ top: 20 + index * 40, bottom: 40 + index * 40 } as DOMRect);
    }
    const listeners = vi.spyOn(root, "addEventListener");
    const removals = vi.spyOn(root, "removeEventListener");
    const traversal = vi.spyOn(root, "querySelectorAll");
    let mode: "document" | "paragraph" = "document";
    let notify: () => void = () => undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((listener: () => void) => { notify = listener; return unsubscribe; });
    const children: Array<{ onload: () => void; onunload: () => void }> = [];
    for (const [index, element] of [...root.children].entries()) decorateMentionReading(element as HTMLElement,
      { sourcePath: "Source.md", getSectionInfo: () => ({ text: "白云山\n山南路", lineStart: index, lineEnd: index }),
        addChild: (child: typeof children[number]) => { children.push(child); child.onload(); } } as unknown as MarkdownPostProcessorContext,
      { mode: () => mode, match: async (_path, text) => source(text), subscribe, pick: () => undefined });
    await vi.advanceTimersByTimeAsync(120);
    expect(subscribe).toHaveBeenCalledOnce();
    expect(listeners).toHaveBeenCalledTimes(6);
    traversal.mockClear();
    mode = "paragraph";
    notify();
    await vi.advanceTimersByTimeAsync(120);
    expect(traversal).toHaveBeenCalledTimes(1);
    children[0]!.onunload();
    expect(unsubscribe).not.toHaveBeenCalled();
    children[1]!.onunload();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(removals).toHaveBeenCalledTimes(6);
    expect(root.querySelector(".link-integrity-mention-hint")).toBeNull();
  });
});
