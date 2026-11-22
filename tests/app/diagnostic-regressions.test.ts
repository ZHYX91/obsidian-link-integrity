import { describe, it, expect, vi } from "vitest";
import { MarkdownView } from "obsidian";
import LinkIntegrityPlugin from "../../src/app/plugin";
import { SidebarQueryService } from "../../src/app/sidebar-query-service";
import { LinkIndex, createFileRecord } from "../../src/core";
import { createOccurrenceId, occurrenceIdMatches } from "../../src/core/occurrence-identity";
import { createDefaultSettings } from "../../src/shared/settings";
import { createTranslator } from "../../src/shared/i18n";
import { createSidebarViewModel, renderSidebar } from "../../src/ui/sidebar";
import { occurrence, snapshot } from "../core/test-helpers";

function markdownNavigation(source: () => string) {
  const file = { path: "A.md" };
  const view = new MarkdownView({} as never);
  const setCursor = vi.fn();
  const getValue = vi.fn(source);
  Object.assign(view, { file });
  Object.assign(view.editor, { setCursor, getValue });
  const leaf = { view, openFile: vi.fn(async () => {}) };
  const getFileByPath = vi.fn(() => file);
  const app = { vault: { getFileByPath }, workspace: { getLeaf: () => leaf } };
  const plugin = new LinkIntegrityPlugin(app as never, {} as never);
  Object.assign(plugin, { app });
  const runtime = plugin as unknown as { openBrokenLink(result: unknown): Promise<void> };
  const open = (rawText: string, line: number | null, column: number | null, property: string | null = null) =>
    runtime.openBrokenLink({ sourcePath: file.path, targetText: "Missing", rawText, location: { line, column, property, canvasNodeId: null } });
  return { open, plugin, view, setCursor, getValue, leaf, getFileByPath };
}

describe("diagnostic preview and navigation regressions", () => {
  it.each([false, true])("preview agrees with actual filtering after link movement=%s", async (moved) => {
    const saved = createOccurrenceId({
      sourcePath: "Notes/A.md", kind: "markdown-link", raw: "[[Missing]]", linktext: "Missing",
      duplicateIndex: 0, duplicateCount: 1,
    });
    const current = saved;
    const index = new LinkIndex([createFileRecord("Notes/A.md")]);
    index.replaceSourceSnapshot("Notes/A.md", snapshot("Notes/A.md", [{
      ...occurrence(current, "Notes/A.md", { fileStatus: "missing", linkpath: "Missing" }),
      position: { line: moved ? 5 : 0, column: 0, endLine: moved ? 5 : 0, endColumn: 11,
        property: null, canvasNodeId: null },
    }]));
    const rule = { id: "review-rule", enabled: true, scope: "ignore-occurrence" as const,
      matcher: { kind: "occurrence-id" as const, value: saved }, createdAt: 1, note: "" };
    const plugin = new LinkIntegrityPlugin({} as never, {} as never);
    Object.assign(plugin, { coordinator: { index } });
    const settings = { ...createDefaultSettings(), ignoreRules: [rule] };
    const query = new SidebarQueryService(() => index, () => settings);
    expect(occurrenceIdMatches(saved, current)).toBe(true);
    expect(query.getSnapshot("broken-links").brokenLinks).toHaveLength(0);
    expect((await plugin.previewIgnoreRule(rule)).matchCount).toBe(1);
  });

  it.each(["frontmatter", "markdown-link"] as const)("keeps an indexed %s result in its source region", async (kind) => {
    let source = '---\nx: "[[Missing]]"\n---';
    const h = markdownNavigation(() => source);
    const index = new LinkIndex([createFileRecord("A.md")]);
    index.replaceSourceSnapshot("A.md", snapshot("A.md", [{
      ...occurrence("link", "A.md", { kind, fileStatus: "missing" }),
      position: { line: 1, column: 4, endLine: 1, endColumn: 15, property: null, canvasNodeId: null },
    }]));
    const query = new SidebarQueryService(() => index, createDefaultSettings);
    const [result] = query.getSnapshot("broken-links").brokenLinks;
    expect(result).toBeDefined();
    const runtime = h.plugin as unknown as { openBrokenLink(item: unknown): Promise<void> };
    await runtime.openBrokenLink(result);
    expect(h.setCursor).toHaveBeenCalledTimes(kind === "frontmatter" ? 1 : 0);
    h.setCursor.mockClear();
    source = 'intro\nx: "[[Missing]]"\noutro';
    await runtime.openBrokenLink(result);
    expect(h.setCursor).toHaveBeenCalledTimes(kind === "markdown-link" ? 1 : 0);
  });

  it("shows the Canvas node locator for a text-node diagnostic with a line number", () => {
    const container = document.createElement("div");
    const state = {
      activeTab: "broken-links" as const, search: "", brokenView: "list" as const,
      brokenGrouping: "target" as const, brokenSort: "count" as const,
      isolatedView: "list" as const, isolatedSort: "path" as const, isolatedMode: "isolated" as const,
      showExpectedIsolated: false, selectedFormatFamilyIds: new Set(["markdown"]),
      brokenResultOffset: 0, isolatedResultOffset: 0, expandedBrokenFolderPaths: new Set<string>(),
    };
    const data = {
      status: { state: "ready" as const, current: 1, total: 1, errorMessage: null },
      brokenLinksKnown: true, isolatedFilesKnown: true, isolatedFiles: [], noIncomingFiles: [],
      brokenLinks: [{ id: "canvas-link", sourcePath: "Board.canvas", targetText: "Missing",
        resolvedTargetPath: null, rawText: "[[Missing]]", context: "[[Missing]]", reason: "missing-file" as const,
        location: { line: 0, column: 0, property: null, canvasNodeId: "node-review-123" } }],
    };
    renderSidebar(container, {
      state, model: createSidebarViewModel(data, state), translator: createTranslator("en", "en"),
      navigation: { openBrokenLink: vi.fn(), openFile: vi.fn(), rebuildIndex: vi.fn() },
      fileTypeCategories: [], defaultFormatFamilyIds: new Set(["markdown"]),
      allowNoIncomingFilter: false, onStateChange: vi.fn(),
    });
    expect(container.querySelector(".link-integrity-result-main")?.textContent).toContain("node-review-123");
  });

  it.each(["pane-reused", "same-path-replaced", "unloaded", "buffer-edited"] as const)(
    "leaves the cursor alone when a sidebar result loses its source: %s", async (change) => {
      const h = markdownNavigation(() => change === "buffer-edited" ? "something else" : "[[Missing]]");
      let release!: () => void;
      h.leaf.openFile.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
      const opening = h.open("[[Missing]]", 0, 0);
      await Promise.resolve();
      if (change === "pane-reused") Object.assign(h.view, { file: { path: "B.md" } });
      if (change === "same-path-replaced") {
        const replacement = { path: "A.md" };
        h.getFileByPath.mockReturnValue(replacement);
        Object.assign(h.view, { file: replacement });
      }
      if (change === "unloaded") h.plugin.onunload();
      release();
      await opening;
      expect(h.setCursor).not.toHaveBeenCalled();
    },
  );

  it("keeps the newer of two sidebar jumps within the same note", async () => {
    const h = markdownNavigation(() => "[[One]]\n[[Two]]");
    const pending: Array<() => void> = [];
    h.leaf.openFile.mockImplementation(() => new Promise<void>((resolve) => { pending.push(resolve); }));
    const first = h.open("[[One]]", 0, 0);
    await Promise.resolve();
    const second = h.open("[[Two]]", 1, 0);
    pending[0]!(); await first;
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!(); await second;
    expect(h.setCursor.mock.calls).toEqual([[{ line: 1, ch: 0 }]]);
  });

  it("finishes on the last requested file even when the host changes the visible file on completion", async () => {
    const files = ["A.md", "B.md", "C.md"].map((path) => ({ path }));
    const view = new MarkdownView({} as never);
    const pending: Array<() => void> = [];
    const leaf = { view, openFile: vi.fn((file: { path: string }) => new Promise<void>((resolve) =>
      pending.push(() => { Object.assign(view, { file }); resolve(); }))) };
    const app = { vault: { getFileByPath: (path: string) => files.find((file) => file.path === path) },
      workspace: { getLeaf: () => leaf } };
    const plugin = new LinkIntegrityPlugin(app as never, {} as never);
    Object.assign(plugin, { app });
    const first = plugin.openVaultFile("A.md");
    await Promise.resolve();
    const intermediate = plugin.openVaultFile("B.md");
    const last = plugin.openVaultFile("C.md");
    pending[0]!();
    await Promise.all([first, intermediate]);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!(); await last;
    expect(leaf.openFile.mock.calls.map(([file]) => file.path)).toEqual(["A.md", "C.md"]);
    expect(view.file).toBe(files[2]);
  });

  it("only moves the cursor while a reference definition still points at the reported target", async () => {
    let target = "Missing";
    const h = markdownNavigation(() => `[see][ref]\n\n[ref]: ${target}`);
    await h.open("[see][ref]", 0, 0);
    expect(h.setCursor).toHaveBeenCalledOnce();
    target = "Fixed";
    await h.open("[see][ref]", 0, 0);
    expect(h.leaf.openFile).toHaveBeenCalledTimes(2);
    expect(h.setCursor).toHaveBeenCalledOnce();
  });

  it("drops a source position when the editor changes during verification", async () => {
    const h = markdownNavigation(() => "revised");
    h.getValue.mockReturnValueOnce("[[Missing]]");
    await h.open("[[Missing]]", 0, 0);
    expect(h.setCursor).not.toHaveBeenCalled();
  });

  it("reports a failed open only while that request still owns its pane", async () => {
    const file = { path: "A.md" };
    const releases: Array<(reason: Error) => void> = [];
    const makeLeaf = () => ({ openFile: () => new Promise<void>((_, reject) => releases.push(reject)) });
    let leaf = makeLeaf();
    const app = { vault: { getFileByPath: () => file }, workspace: { getLeaf: () => leaf } };
    const plugin = new LinkIntegrityPlugin(app as never, {} as never);
    Object.assign(plugin, { app });
    const first = plugin.openVaultFile(file.path);
    await Promise.resolve();
    const second = plugin.openVaultFile(file.path);
    leaf = makeLeaf();
    const separate = plugin.openVaultFile(file.path);
    await Promise.resolve();
    const error = new Error("Host open failed");
    releases[0]!(error); await expect(first).resolves.toBeUndefined();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases[2]!(error); await expect(second).rejects.toBe(error);
    releases[1]!(error); await expect(separate).rejects.toBe(error);
  });

  it("revalidates a multi-line reference and declines missing lines in a shortened buffer", async () => {
    const lines = ["intro", 'x [label](Missing "first', 'second")'];
    const h = markdownNavigation(() => lines.join("\n"));
    const open = () => h.open('[label](Missing "first\r\nsecond")', 1, 2);
    await open();
    expect(h.setCursor).toHaveBeenCalledWith({ line: 1, ch: 2 });
    lines.pop(); await open();
    lines.pop(); await open();
    expect(h.setCursor).toHaveBeenCalledOnce();
  });

  it.each(["\n", "\r\n", "\r"])("locates the full YAML path with newline %j", async (newline) => {
    const source = '---\nfirst:\n  target: "[[Other]]"\nsecond:\n  target: "[[Missing]]"\n---'.replaceAll("\n", newline);
    const h = markdownNavigation(() => source);
    await h.open("[[Missing]]", null, null, "second.target");
    expect(h.setCursor).toHaveBeenCalledWith({ line: 4, ch: 0 });
  });

  it("does not treat YAML block-scalar content as a property key", async () => {
    const source = '---\ndescription: |\n  target: this is description text\ntarget: "[[Missing]]"\n---';
    const h = markdownNavigation(() => source);
    await h.open("[[Missing]]", null, null, "target");
    expect(h.setCursor).toHaveBeenCalledWith({ line: 3, ch: 0 });
  });
});
