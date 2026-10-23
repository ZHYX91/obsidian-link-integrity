import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField, type MarkdownFileInfo, type TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBodyLinkEditorExtension,
  type BodyEditorOptions,
} from "../../src/adapters/obsidian/body-link-editor";
import { canonicalBodyDestination } from "../../src/adapters/obsidian/body-link-port";
import { mapBodyReadingHints } from "../../src/adapters/obsidian/body-link-reading";
import type { BodyLinkSource } from "../../src/features/body-links/body-link-service";
import { bodySetup } from "../helpers/body-links";

const views: EditorView[] = [];
const markSelector = ".link-integrity-broken-body-hint";

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function openEditor(
  info: { file: TFile | null },
  text: string,
  source: BodyEditorOptions["source"],
): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const extension = createBodyLinkEditorExtension({
    enabled: () => true,
    source,
    subscribe: () => () => {},
    reason: () => "Missing file",
  });
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [editorInfoField.init(() => info as MarkdownFileInfo), extension],
    }),
  });
  views.push(view);
  return view;
}

async function settleRefresh(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
}

describe("literal percent body destinations", () => {
  it.each([
    ["100% Missing", "100% Missing", ""],
    ["Missing%ZZ", "Missing%ZZ", ""],
    ["Missing%2", "Missing%2", ""],
    ["Target#100%", "Target", "#100%"],
    ["100%25%20Missing", "100% Missing", ""],
    ["A%20B#100%25", "A B", "#100%"],
    ["%E4%B8%AD%E6%96%87", "中文", ""],
    [" Ordinary#Heading", "Ordinary", "#Heading"],
  ])("canonicalizes %s without losing a literal destination", (input, path, subpath) => {
    expect(canonicalBodyDestination(input)).toBe(JSON.stringify([path, subpath]));
  });

  it.each([
    ["[[100% Missing|Label]]", "missing-file"],
    ["[[Missing%ZZ|Label]]", "missing-file"],
    ["[[Missing%2|Label]]", "missing-file"],
    ["[[Target#100%|Label]]", "missing-heading"],
    ["[Label](100%25%20Missing.md)", "missing-file"],
  ])("keeps confirmed diagnostics for %s", async (text, reason) => {
    const test = bodySetup(text);
    const source = await test.service.source(test.path, test.text);
    expect(source.state).toBe("ready");
    expect(source.links).toHaveLength(1);
    expect(source.hints).toHaveLength(1);
    expect(source.hints[0]?.diagnostic.reason).toBe(reason);
    expect(source.hints[0]?.occurrence.raw).toBe(text);
    expect(test.bodies.get(test.path)).toBe(text);
  });

  it("matches an encoded native anchor to the literal-percent source", async () => {
    const test = bodySetup("[[100% Missing|Label]]");
    const source = await test.service.source(test.path, test.text);
    const element = document.createElement("p");
    const link = document.createElement("a");
    link.className = "internal-link";
    link.dataset.href = "100%25%20Missing";
    link.setAttribute("href", "100%25%20Missing");
    link.textContent = "Label";
    element.append(link);
    expect(mapBodyReadingHints(element, source, 0, 0).get(link)?.diagnostic.reason)
      .toBe("missing-file");
    link.dataset.href = "Other%25Missing";
    link.setAttribute("href", "Other%25Missing");
    expect(mapBodyReadingHints(element, source, 0, 0).size).toBe(0);
  });

  it("does not turn a resolved percent target into a diagnostic", async () => {
    const test = bodySetup("[[Target%|Label]]");
    test.files.set("Target%.md", test.files.get("Target.md")!);
    const source = await test.service.source(test.path, test.text);
    expect(source.links).toHaveLength(1);
    expect(source.hints).toEqual([]);
  });
});

describe("editor source identity with unchanged text", () => {
  it("clears marks and reproves a new file in the same mutable host info", async () => {
    const test = bodySetup();
    const original = await test.service.source(test.path, test.text);
    const info = { file: test.files.get(test.path)! as TFile | null };
    const source = vi.fn(async (path: string) => path === test.path
      ? original : { ...original, sourcePath: path, hints: [] });
    const view = openEditor(info, test.text, source);
    await vi.waitFor(() => expect(view.dom.querySelector(markSelector)).not.toBeNull());

    info.file = test.files.get("Target.md")!;
    view.dispatch({});
    expect(view.dom.querySelector(markSelector)).toBeNull();
    await vi.waitFor(() => expect(source.mock.calls.some(([path]) => path === "Target.md")).toBe(true));
    expect(view.dom.querySelector(markSelector)).toBeNull();
    expect(view.state.doc.toString()).toBe(test.text);

    info.file = test.files.get(test.path)!;
    view.dispatch({});
    await vi.waitFor(() => expect(view.dom.querySelector(markSelector)).not.toBeNull());
  });

  it("detects a path changed in place on the same file object", async () => {
    const test = bodySetup();
    const original = await test.service.source(test.path, test.text);
    const file = test.files.get(test.path)!;
    const source = vi.fn(async (path: string) => path === test.path
      ? original : { ...original, sourcePath: path, hints: [] });
    const view = openEditor({ file }, test.text, source);
    await vi.waitFor(() => expect(view.dom.querySelector(markSelector)).not.toBeNull());

    Reflect.set(file, "path", "Renamed.md");
    view.dispatch({});
    expect(view.dom.querySelector(markSelector)).toBeNull();
    await vi.waitFor(() => expect(source.mock.calls.some(([path]) => path === "Renamed.md")).toBe(true));
    expect(view.state.doc.toString()).toBe(test.text);
  });

  it("clears marks when file context disappears without changing the text", async () => {
    const test = bodySetup();
    const original = await test.service.source(test.path, test.text);
    const info = { file: test.files.get(test.path)! as TFile | null };
    const source = vi.fn(async () => original);
    const view = openEditor(info, test.text, source);
    await vi.waitFor(() => expect(view.dom.querySelector(markSelector)).not.toBeNull());
    const calls = source.mock.calls.length;

    info.file = null;
    view.dispatch({});
    expect(view.dom.querySelector(markSelector)).toBeNull();
    await settleRefresh();
    expect(source).toHaveBeenCalledTimes(calls);
  });

  it("aborts a pending proof across same-text A-to-B-to-A switches", async () => {
    const test = bodySetup();
    const original = await test.service.source(test.path, test.text);
    const info = { file: test.files.get(test.path)! as TFile | null };
    let release!: (value: BodyLinkSource) => void;
    let pendingSignal!: AbortSignal;
    let first = true;
    const source = vi.fn(async (path: string, _text: string, signal: AbortSignal): Promise<BodyLinkSource> => {
      if (first) {
        first = false;
        pendingSignal = signal;
        return new Promise<BodyLinkSource>((resolve) => { release = resolve; });
      }
      return { ...original, sourcePath: path, hints: [] };
    });
    const view = openEditor(info, test.text, source);
    await vi.waitFor(() => expect(release).toBeDefined());

    info.file = test.files.get("Target.md")!;
    view.dispatch({});
    expect(pendingSignal.aborted).toBe(true);
    info.file = test.files.get(test.path)!;
    view.dispatch({});
    release(original);
    await settleRefresh();
    expect(source.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(view.dom.querySelector(markSelector)).toBeNull();
  });

  it("keeps the current proof on selection-only updates for the same path", async () => {
    const test = bodySetup();
    const original = await test.service.source(test.path, test.text);
    const source = vi.fn(async () => original);
    const view = openEditor({ file: test.files.get(test.path)! }, test.text, source);
    await vi.waitFor(() => expect(view.dom.querySelector(markSelector)).not.toBeNull());
    await settleRefresh();
    const calls = source.mock.calls.length;
    view.dispatch({ selection: { anchor: 1 } });
    await settleRefresh();
    expect(source).toHaveBeenCalledTimes(calls);
    expect(view.dom.querySelector(markSelector)).not.toBeNull();
  });
});
