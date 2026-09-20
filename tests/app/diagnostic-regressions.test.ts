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
    const id = (location: string) => createOccurrenceId({
      sourcePath: "Notes/A.md", kind: "markdown-link", raw: "[[Missing]]", linktext: "Missing",
      duplicateIndex: 0, duplicateCount: 1, location, legacyOrdinal: 0,
    });
    const saved = id("0:0");
    const current = id(moved ? "5:0" : "0:0");
    const index = new LinkIndex([createFileRecord("Notes/A.md")]);
    index.replaceSourceSnapshot("Notes/A.md", snapshot("Notes/A.md", [{
      ...occurrence(current, "Notes/A.md", { fileStatus: "missing", linkpath: "Missing" }),
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

  it("does not jump to a sibling YAML key with the same leaf name", async () => {
    const source = '---\nfirst:\n  target: "[[Other]]"\nsecond:\n  target: "[[Missing]]"\n---';
    const view = new MarkdownView({} as never);
    const setCursor = vi.fn();
    Object.assign(view.editor, { getValue: () => source, setCursor });
    const plugin = new LinkIntegrityPlugin({} as never, {} as never);
    Object.assign(plugin, { openFile: async () => ({ view }) });
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
    Object.assign(plugin, { openFile: async () => ({ view }) });
    const runtime = plugin as unknown as { openBrokenLink(result: unknown): Promise<void> };
    await runtime.openBrokenLink({ sourcePath: "A.md", location: {
      line: null, column: null, property: "target", canvasNodeId: null,
    } });
    expect(setCursor).toHaveBeenCalledWith({ line: 3, ch: 0 });
  });
});
