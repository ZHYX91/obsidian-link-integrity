import { Notice, TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import LinkIntegrityPlugin from "../../src/app/plugin";
import { applySidebarIgnore } from "../../src/app/sidebar-ignore-actions";
import { LinkIndex } from "../../src/core/link-index";
import { createFileRecord } from "../../src/core/model";
import type { GraphContributionPolicy } from "../../src/core/scopes";
import { createDefaultSettings, type LinkIntegritySettings, type SettingsChangeImpact } from "../../src/shared/settings";
import { SettingsSaveCoordinator } from "../../src/shared/settings-save-coordinator";
import { occurrence, snapshot } from "../core/test-helpers";

const savers: SettingsSaveCoordinator<LinkIntegritySettings>[] = [];
afterEach(async () => { await Promise.all(savers.splice(0).map((saver) => saver.close())); });

function setup() {
  const file = new (TFile as unknown as new (path: string) => TFile)("A.md");
  const files = new Map([[file.path, file]]);
  const app = { vault: { getFileByPath: (path: string) => files.get(path) ?? null } };
  const persisted: LinkIntegritySettings[] = [];
  const saver = new SettingsSaveCoordinator<LinkIntegritySettings>(async (value) => { persisted.push(value); }, {
    clock: { setTimeout: () => 1, clearTimeout: () => undefined },
  });
  savers.push(saver);
  const index = new LinkIndex([createFileRecord("A.md"), createFileRecord("B.md")]);
  index.replaceSourceSnapshot("A.md", snapshot("A.md", [occurrence("edge", "A.md", { targetPath: "B.md" })]));
  const regraph = vi.fn(async (policy: GraphContributionPolicy) => { index.setGraphContributionPolicy(policy); });
  const plugin = new LinkIntegrityPlugin(app as never, {} as never);
  Object.assign(plugin, {
    app, settings: createDefaultSettings(), saveCoordinator: saver, refreshEntrypoints: () => undefined,
    query: { notify: () => undefined, notifyResults: () => undefined },
    bodyLinks: { invalidate: () => undefined, close: () => undefined },
    coordinator: { regraph, stop: () => undefined },
  });
  const runtime = plugin as unknown as {
    setExpectedFile(path: string, expected: boolean, document: Document): void;
    addExpectedFolderRule(path: string, mode: "recursive", document: Document): void;
    renameExpectedFilePath(oldPath: string, newPath: string): void;
    renameExpectedFolderPath(oldPath: string, newPath: string): void;
  };
  const rename = (path: string): void => {
    const previous = file.path;
    files.delete(previous);
    Object.assign(file, { path });
    files.set(path, file);
    runtime.renameExpectedFilePath(previous, path);
  };
  return { plugin, runtime, file, files, rename, persisted, saver, index, regraph };
}

function undoButton(): HTMLButtonElement {
  const messages = (Notice as unknown as { messages: unknown[] }).messages;
  return (messages.at(-1) as DocumentFragment).querySelector<HTMLButtonElement>("button")!;
}

function lastMessage(): unknown { return (Notice as unknown as { messages: unknown[] }).messages.at(-1); }

describe("settings mutation ownership", () => {
  it("drains accepted settings but ignores retained file/folder Undo and update callbacks after unload", async () => {
    const h = setup();
    h.runtime.setExpectedFile("A.md", true, document);
    const fileUndo = undoButton();
    h.runtime.addExpectedFolderRule("Archive", "recursive", document);
    const folderUndo = undoButton();
    const accepted = h.plugin.getSettings();
    h.plugin.onunload();
    await h.saver.close();
    const count = h.persisted.length;
    fileUndo.click();
    folderUndo.click();
    h.plugin.updateSettings(createDefaultSettings());
    await h.plugin.retrySettingsSave();
    await h.saver.flush();
    expect(h.plugin.getSettings()).toBe(accepted);
    expect(h.persisted).toHaveLength(count);
    expect(h.persisted.at(-1)?.isolatedFiles.expectedFilePaths).toEqual(["A.md"]);
  });

  it.each([true, false])("follows original file identity through rename when marking=%s", (mark) => {
    const h = setup();
    if (!mark) h.plugin.updateSettings({ ...h.plugin.getSettings(), isolatedFiles: {
      ...h.plugin.getSettings().isolatedFiles, expectedFilePaths: ["A.md"],
    } });
    h.runtime.setExpectedFile("A.md", mark, document);
    const undo = undoButton();
    h.rename("Moved.md");
    h.plugin.updateSettings({ ...h.plugin.getSettings(), isolatedFiles: {
      ...h.plugin.getSettings().isolatedFiles,
      expectedFilePaths: [...h.plugin.getSettings().isolatedFiles.expectedFilePaths, "Other.md"],
    } });
    undo.click();
    expect(h.plugin.getSettings().isolatedFiles.expectedFilePaths).toEqual(mark ? ["Other.md"] : ["Moved.md", "Other.md"]);
  });

  it("follows a parent-folder rename and rejects same-path replacement", () => {
    const h = setup();
    h.rename("Old/A.md");
    h.runtime.setExpectedFile(h.file.path, true, document);
    const firstUndo = undoButton();
    h.files.delete(h.file.path);
    Object.assign(h.file, { path: "New/A.md" });
    h.files.set(h.file.path, h.file);
    h.runtime.renameExpectedFolderPath("Old", "New");
    firstUndo.click();
    expect(h.plugin.getSettings().isolatedFiles.expectedFilePaths).toEqual([]);
    h.runtime.setExpectedFile(h.file.path, true, document);
    const staleUndo = undoButton();
    h.files.set(h.file.path, new (TFile as unknown as new (path: string) => TFile)(h.file.path));
    staleUndo.click();
    expect(h.plugin.getSettings().isolatedFiles.expectedFilePaths).toEqual(["New/A.md"]);
    expect(lastMessage()).toContain("Cannot undo");
  });

  it("keeps later folder-rule edits when an old Undo expires", () => {
    const h = setup();
    h.runtime.addExpectedFolderRule("Archive", "recursive", document);
    const undo = undoButton();
    h.plugin.updateSettings({ ...h.plugin.getSettings(), isolatedFiles: {
      ...h.plugin.getSettings().isolatedFiles,
      expectedRules: h.plugin.getSettings().isolatedFiles.expectedRules.map((rule) => ({ ...rule, name: "Edited" })),
    } });
    undo.click();
    expect(h.plugin.getSettings().isolatedFiles.expectedRules[0]?.name).toBe("Edited");
    expect(lastMessage()).toContain("Cannot undo");
  });
});

describe("central graph contribution updates", () => {
  it("retains a later graph edit when the old hide-rule Undo expires", async () => {
    const h = setup();
    await applySidebarIgnore({
      getSettings: () => h.plugin.getSettings(), isActive: () => true,
      preview: async () => ({ matchCount: 1, samples: [] }),
      update: (settings: LinkIntegritySettings, impact: SettingsChangeImpact) => h.plugin.updateSettings(settings, impact),
    }, "hide-broken-result", "source-path", "A.md", "Hide A", document.createElement("div"));
    const undo = undoButton();
    h.plugin.updateSettings({ ...h.plugin.getSettings(), ignoreRules: h.plugin.getSettings().ignoreRules
      .map((rule) => ({ ...rule, scope: "exclude-graph-contribution" as const })) }, "query-only");
    expect(h.index.getOutgoingNeighborCount("A.md")).toBe(0);
    expect(h.index.getIncomingNeighborCount("B.md")).toBe(0);
    undo.click();
    expect(h.plugin.getSettings().ignoreRules[0]?.scope).toBe("exclude-graph-contribution");
    expect(h.index.getOutgoingNeighborCount("A.md")).toBe(0);
    expect(lastMessage()).toContain("Cannot undo");
  });

  it("regraphs semantic add, disable, matcher and removal changes even with query-only impact", () => {
    const h = setup();
    const rule = { id: "graph", enabled: true, scope: "exclude-graph-contribution" as const,
      matcher: { kind: "source-path" as const, value: "A.md" }, createdAt: 1, note: "" };
    const apply = (ignoreRules: LinkIntegritySettings["ignoreRules"], count: number): void => {
      h.plugin.updateSettings({ ...h.plugin.getSettings(), ignoreRules }, "query-only");
      expect(h.index.getOutgoingNeighborCount("A.md")).toBe(count);
      expect(h.index.getIncomingNeighborCount("B.md")).toBe(count);
    };
    apply([rule], 0);
    const calls = h.regraph.mock.calls.length;
    apply([{ ...rule, id: "different", note: "documentation only" }], 0);
    expect(h.regraph).toHaveBeenCalledTimes(calls);
    apply([{ ...rule, enabled: false }], 1);
    apply([rule], 0);
    apply([{ ...rule, matcher: { kind: "source-path", value: "Other.md" } }], 1);
    apply([rule], 0);
    apply([], 1);
  });
});
