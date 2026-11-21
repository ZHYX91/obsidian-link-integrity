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
      const original = { path: "A.md" };
      let file = original;
      let release!: () => void;
      const view = new MarkdownView({} as never);
      const leaf = { view, openFile: () => new Promise<void>((resolve) => { release = resolve; }) };
      const buffer = change === "buffer-edited" ? "something else" : "[[Missing]]";
      Object.assign(view, { file });
      Object.assign(view.editor, { setCursor: vi.fn(), lineCount: () => 1, getRange: () => buffer, getLine: () => buffer });
      const app = { vault: { getFileByPath: () => file }, workspace: { getLeaf: () => leaf } };
      const plugin = new LinkIntegrityPlugin(app as never, {} as never);
      Object.assign(plugin, { app });
      const runtime = plugin as unknown as { openBrokenLink(result: unknown): Promise<void> };
      const opening = runtime.openBrokenLink({ sourcePath: "A.md", rawText: "[[Missing]]",
        location: { line: 0, column: 0, property: null, canvasNodeId: null } });
      if (change === "pane-reused") Object.assign(view, { file: { path: "B.md" } });
      if (change === "same-path-replaced") { file = { path: original.path }; Object.assign(view, { file }); }
      if (change === "unloaded") plugin.onunload();
      release();
      await opening;
      expect(view.editor.setCursor).not.toHaveBeenCalled();
    },
  );

  it("keeps the newer of two sidebar jumps within the same note", async () => {
    const file = { path: "A.md" };
    const view = new MarkdownView({} as never);
    const setCursor = vi.fn();
    const text = ["[[One]]", "[[Two]]"];
    Object.assign(view, { file });
    Object.assign(view.editor, { lineCount: () => text.length, getRange: (from: { line: number }) => text[from.line],
      getLine: (line: number) => text[line], setCursor });
    const pending: Array<() => void> = [];
    const leaf = { view, openFile: () => new Promise<void>((resolve) => pending.push(resolve)) };
    const app = { vault: { getFileByPath: () => file }, workspace: { getLeaf: () => leaf } };
    const plugin = new LinkIntegrityPlugin(app as never, {} as never);
    Object.assign(plugin, { app });
    const runtime = plugin as unknown as { openBrokenLink(result: unknown): Promise<void> };
    const open = (line: number) => runtime.openBrokenLink({ sourcePath: file.path, rawText: text[line],
      location: { line, column: 0, property: null, canvasNodeId: null } });
    const first = open(0);
    const second = open(1);
    pending[1]!(); await second;
    pending[0]!(); await first;
    expect(setCursor.mock.calls).toEqual([[{ line: 1, ch: 0 }]]);
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
    const second = plugin.openVaultFile(file.path);
    leaf = makeLeaf();
    const separate = plugin.openVaultFile(file.path);
    const error = new Error("Host open failed");
    releases[0]!(error); await expect(first).resolves.toBeUndefined();
    releases[1]!(error); await expect(second).rejects.toBe(error);
    releases[2]!(error); await expect(separate).rejects.toBe(error);
  });

  it("revalidates a multi-line reference and declines missing lines in a shortened buffer", async () => {
    const file = { path: "A.md" };
    const view = new MarkdownView({} as never);
    Object.assign(view, { file });
    const setCursor = vi.fn();
    const lines = ["intro", 'x [label](Missing "first', 'second")'];
    const getRange = vi.fn((start: { line: number; ch: number }, end: { line: number; ch: number }) =>
      [lines[start.line]!.slice(start.ch), lines[end.line]!.slice(0, end.ch)].join("\n"));
    Object.assign(view.editor, { setCursor, lineCount: () => lines.length, getLine: (line: number) => lines[line]!, getRange });
    const app = { vault: { getFileByPath: () => file }, workspace: { getLeaf: () => ({ view, openFile: async () => {} }) } };
    const plugin = new LinkIntegrityPlugin(app as never, {} as never);
    Object.assign(plugin, { app });
    const runtime = plugin as unknown as { openBrokenLink(result: unknown): Promise<void> };
    const row = { sourcePath: file.path, rawText: '[label](Missing "first\r\nsecond")',
      location: { line: 1, column: 2, property: null, canvasNodeId: null } };
    await runtime.openBrokenLink(row);
    expect(setCursor).toHaveBeenCalledWith({ line: 1, ch: 2 });
    lines.pop();
    await runtime.openBrokenLink(row);
    lines.pop();
    await runtime.openBrokenLink(row);
    expect(getRange).toHaveBeenCalledOnce();
    expect(setCursor).toHaveBeenCalledOnce();
  });

  it.each(["\n", "\r\n", "\r"])("locates the full YAML path with newline %j", async (newline) => {
    const source = '---\nfirst:\n  target: "[[Other]]"\nsecond:\n  target: "[[Missing]]"\n---'.replaceAll("\n", newline);
    const view = new MarkdownView({} as never);
    const setCursor = vi.fn();
    Object.assign(view.editor, { getValue: () => source, setCursor });
    const plugin = new LinkIntegrityPlugin({} as never, {} as never);
    const file = { path: "A.md" };
    Object.assign(view, { file });
    Object.assign(plugin, { app: { vault: { getFileByPath: () => file },
      workspace: { getLeaf: () => ({ view, openFile: async () => {} }) } } });
    const runtime = plugin as unknown as { openBrokenLink(result: unknown): Promise<void> };
    await runtime.openBrokenLink({ sourcePath: "A.md", location: {
      line: null, column: null, property: "second.target", canvasNodeId: null,
    } });
    expect(setCursor).toHaveBeenCalledWith({ line: 4, ch: 0 });
  });

  it("does not treat YAML block-scalar content as a property key", async () => {
    const source = '---\ndescription: |\n  target: this is description text\ntarget: "[[Missing]]"\n---';
    const view = new MarkdownView({} as never);
    const setCursor = vi.fn();
    Object.assign(view.editor, { getValue: () => source, setCursor });
    const plugin = new LinkIntegrityPlugin({} as never, {} as never);
    const file = { path: "A.md" };
    Object.assign(view, { file });
    Object.assign(plugin, { app: { vault: { getFileByPath: () => file },
      workspace: { getLeaf: () => ({ view, openFile: async () => {} }) } } });
    const runtime = plugin as unknown as { openBrokenLink(result: unknown): Promise<void> };
    await runtime.openBrokenLink({ sourcePath: "A.md", location: {
      line: null, column: null, property: "target", canvasNodeId: null,
    } });
    expect(setCursor).toHaveBeenCalledWith({ line: 3, ch: 0 });
  });
});
