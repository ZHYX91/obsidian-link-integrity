import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField, type MarkdownFileInfo, type MarkdownPostProcessorContext, type MarkdownRenderChild } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decorateBodyLinkReading, mapBodyReadingHints } from "../../src/adapters/obsidian/body-link-reading";
import { createBodyLinkEditorExtension } from "../../src/adapters/obsidian/body-link-editor";
import { bodySetup } from "../helpers/body-links";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });
function section(text: string, element: HTMLElement) {
  const children: MarkdownRenderChild[] = [];
  const context = { sourcePath: "Source.md", getSectionInfo: () => ({ text, lineStart: 0, lineEnd: text.split("\n").length - 1 }),
    addChild: (child: MarkdownRenderChild) => { children.push(child); child.onload(); } } as unknown as MarkdownPostProcessorContext;
  document.body.append(element); return { context, children };
}
function anchor(destination = "Missing", label = "Label"): HTMLAnchorElement {
  const element = document.createElement("a"); element.className = "internal-link"; element.dataset.href = destination; element.href = destination; element.textContent = label; return element;
}

describe("native body annotation ownership", () => {
  it("maps exact native anchors without modifying content or intercepting navigation", async () => {
    const test = bodySetup(); const source = await test.service.source(test.path, test.text);
    const element = document.createElement("p"); const link = anchor(); element.append(link);
    expect(mapBodyReadingHints(element, source, 0, 0).get(link)?.diagnostic.reason).toBe("missing-file");
    link.dataset.href = "Different"; expect(mapBodyReadingHints(element, source, 0, 0).size).toBe(0);
  });
  it.each([
    ["[[Missing|Label]] [[Missing|Other]]", [["Missing", "Label"], ["Missing", "Other"]]],
    ["Label and [[Missing|Label]]", [["Missing", "Label"]]],
    ["Missing#^block and [[Missing#^block|Label]]", [["Missing#^block", "Missing#^block"], ["Missing#^block", "Label"]]],
  ] as const)("rejects ambiguous source/third-party ownership: %s", async (text, links) => {
    const test = bodySetup(text); const source = await test.service.source(test.path, text); const element = document.createElement("p");
    for (const [destination, label] of links) element.append(anchor(destination, label));
    expect(mapBodyReadingHints(element, source, 0, 0).size).toBe(0);
  });
  it("distinguishes same labels at different destinations and subpaths", async () => {
    const test = bodySetup("[[Missing|Label]] [[Target#Heading|Label]]"); const source = await test.service.source(test.path, test.text);
    const element = document.createElement("p"); element.append(anchor(), anchor("Target#Heading"));
    expect(mapBodyReadingHints(element, source, 0, 0).size).toBe(2);
    element.firstElementChild!.classList.add("virtual-link-a"); expect(mapBodyReadingHints(element, source, 0, 0).size).toBe(1);
  });
  it("leaves embeds/transformed labels/unavailable sections unannotated", async () => {
    const test = bodySetup("![[Missing|Label]]"); const element = document.createElement("p"); element.append(anchor());
    expect(mapBodyReadingHints(element, await test.service.source(test.path, test.text), 0, 0).size).toBe(0);
    expect(decorateBodyLinkReading(element, { getSectionInfo: () => null } as unknown as MarkdownPostProcessorContext,
      { enabled: () => true, source: () => test.service.source(test.path, test.text), subscribe: () => () => {}, reason: () => "missing" })).toBeNull();
  });
  it("refreshes after extra third-party anchors and restores owned attributes, tooltip and listeners on dispose", async () => {
    const test = bodySetup(); const element = document.createElement("p"); const link = anchor(); link.title = "Native title"; element.append(link);
    const { context, children } = section(test.text, element); const listeners = new Set<() => void>();
    const dispose = decorateBodyLinkReading(element, context, { enabled: () => true, source: () => test.service.source(test.path, test.text),
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, reason: () => "Missing file" })!;
    await vi.waitFor(() => expect(link.classList.contains("link-integrity-broken-body-hint")).toBe(true));
    let prevented = false; link.addEventListener("click", (event) => { prevented = event.defaultPrevented; }); link.click(); expect(prevented).toBe(false);
    link.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Missing file");
    link.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); expect(document.querySelector('[role="tooltip"]')).toBeNull();
    element.append(anchor()); await vi.waitFor(() => expect(link.classList.contains("link-integrity-broken-body-hint")).toBe(false));
    expect(link.title).toBe("Native title"); dispose(); children[0]!.onunload(); expect(listeners.size).toBe(0); expect(link.getAttribute("href")).toBe("Missing");
  });
  it("keeps Off dormant and ignores a proof resolving after child teardown", async () => {
    const test = bodySetup(); const source = vi.fn(() => test.service.source(test.path, test.text)); const element = document.createElement("p"); element.append(anchor());
    const { context } = section(test.text, element); const dispose = decorateBodyLinkReading(element, context,
      { enabled: () => false, source, subscribe: () => () => {}, reason: () => "Missing" })!;
    await new Promise((resolve) => window.setTimeout(resolve, 90)); expect(source).not.toHaveBeenCalled(); dispose();
    let release!: (value: Awaited<ReturnType<typeof source>>) => void;
    const delayed = decorateBodyLinkReading(element, context, { enabled: () => true, source: () => new Promise((resolve) => { release = resolve; }), subscribe: () => () => {}, reason: () => "Missing" })!;
    await vi.waitFor(() => expect(release).toBeDefined()); delayed(); release(await test.service.source(test.path, test.text)); await Promise.resolve();
    expect(element.querySelector(".link-integrity-broken-body-hint")).toBeNull();
  });
  it("installs section observation/interaction only while On and ignores its own annotation mutations", async () => {
    const test = bodySetup(); const element = document.createElement("p"); const link = anchor(); element.append(link);
    const { context } = section(test.text, element); let enabled = false; let notify!: () => void;
    const source = vi.fn(() => test.service.source(test.path, test.text)); const add = vi.spyOn(element, "addEventListener");
    const observe = vi.spyOn(window.MutationObserver.prototype, "observe"); const disconnect = vi.spyOn(window.MutationObserver.prototype, "disconnect");
    const dispose = decorateBodyLinkReading(element, context, { enabled: () => enabled, source,
      subscribe: (listener) => { notify = listener; return () => {}; }, reason: () => "Missing" })!;
    expect(observe).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled();
    enabled = true; notify(); await vi.waitFor(() => expect(link.classList.contains("link-integrity-broken-body-hint")).toBe(true));
    await new Promise((resolve) => window.setTimeout(resolve, 100)); expect(source).toHaveBeenCalledOnce(); expect(observe).toHaveBeenCalledOnce(); expect(add).toHaveBeenCalledTimes(5);
    enabled = false; notify(); expect(disconnect).toHaveBeenCalledOnce(); expect(link.classList.contains("link-integrity-broken-body-hint")).toBe(false);
    element.append(anchor()); await new Promise((resolve) => window.setTimeout(resolve, 100)); expect(source).toHaveBeenCalledOnce();
    enabled = true; notify(); await vi.waitFor(() => expect(source).toHaveBeenCalledTimes(2)); expect(observe).toHaveBeenCalledTimes(2); dispose();
  });
  it.each(["data-href", "href", "class"])("clears and reproves in-place %s changes without affecting native attributes", async (attribute) => {
    const test = bodySetup(); const element = document.createElement("p"); const link = anchor(); link.title = "Native"; element.append(link);
    const { context } = section(test.text, element); const source = vi.fn(() => test.service.source(test.path, test.text));
    const dispose = decorateBodyLinkReading(element, context, { enabled: () => true, source, subscribe: () => () => {}, reason: () => "Missing" })!;
    await vi.waitFor(() => expect(link.classList.contains("link-integrity-broken-body-hint")).toBe(true));
    link.setAttribute(attribute, attribute === "class" ? "internal-link virtual-link-a" : "Different");
    await vi.waitFor(() => expect(link.classList.contains("link-integrity-broken-body-hint")).toBe(false));
    await vi.waitFor(() => expect(source).toHaveBeenCalledTimes(2)); expect(link.title).toBe("Native");
    expect(link.getAttribute(attribute)).toBe(attribute === "class" ? "internal-link virtual-link-a" : "Different"); dispose();
  });
  it("clamps tooltips to their owner viewport, flips above and leaves oversized content scrollable", async () => {
    const test = bodySetup(); const element = document.createElement("p"); const link = anchor(); link.setAttribute("aria-describedby", "native-description"); element.append(link);
    const { context } = section(test.text, element); vi.spyOn(window, "innerWidth", "get").mockReturnValue(320); vi.spyOn(window, "innerHeight", "get").mockReturnValue(240);
    let oversized = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const tooltip = this.classList.contains("link-integrity-body-tooltip");
      return { left: tooltip ? 0 : 290, top: tooltip ? 0 : 200, bottom: tooltip ? 0 : 220,
        width: tooltip ? 180 : 30, height: tooltip ? oversized ? 224 : 60 : 20 } as DOMRect;
    });
    const dispose = decorateBodyLinkReading(element, context, { enabled: () => true, source: () => test.service.source(test.path, test.text), subscribe: () => () => {}, reason: () => "Long missing reason" })!;
    await vi.waitFor(() => expect(link.classList.contains("link-integrity-broken-body-hint")).toBe(true));
    link.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); let tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.style.left).toBe("132px"); expect(tooltip.style.top).toBe("136px"); expect(tooltip.style.maxHeight).toBe("224px"); expect(tooltip.tabIndex).toBe(0);
    link.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: tooltip })); expect(tooltip.isConnected).toBe(true);
    tooltip.focus(); tooltip.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); expect(document.querySelector('[role="tooltip"]')).toBeNull(); expect(link.getAttribute("aria-describedby")).toBe("native-description"); expect(document.activeElement).toBe(link);
    oversized = true; link.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.style.top).toBe("8px"); dispose(); expect(link.getAttribute("aria-describedby")).toBe("native-description");
  });
  it("clears editor marks immediately on text edits and Off while retaining native event behavior", async () => {
    const test = bodySetup(); let enabled = true; let notify!: () => void;
    const extension = createBodyLinkEditorExtension({ enabled: () => enabled, source: (path, text, signal) => test.service.source(path, text, signal),
      subscribe: (listener) => { notify = listener; return () => {}; }, reason: () => "Missing file" });
    const info = editorInfoField.init(() => ({ file: test.files.get(test.path)! } as MarkdownFileInfo));
    const parent = document.createElement("div"); document.body.append(parent);
    const view = new EditorView({ parent, state: EditorState.create({ doc: test.text, extensions: [info, extension] }) });
    await vi.waitFor(() => expect(view.dom.querySelector(".link-integrity-broken-body-hint")).not.toBeNull());
    view.dispatch({ changes: { from: 0, insert: "`" } }); expect(view.dom.querySelector(".link-integrity-broken-body-hint")).toBeNull();
    enabled = false; notify(); expect(view.dom.querySelector(".link-integrity-broken-body-hint")).toBeNull(); view.destroy();
  });
});
