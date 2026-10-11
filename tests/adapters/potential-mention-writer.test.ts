import { describe, expect, it, vi } from "vitest";
import type { App, Editor, EditorTransaction, TFile } from "obsidian";

import { MentionWriteError, ObsidianPotentialMentionWriter } from "../../src/adapters/obsidian/potential-mention-writer";

function setup(content = "白云山 and 白云山", generated = "[[Places/广州|白云山]]") {
  let text = content;
  const sourceFile = { path: "Source.md" };
  const target = { path: "Places/广州.md" };
  const files = new Map([[sourceFile.path, sourceFile], [target.path, target]]);
  const editor = {
    getValue: () => text,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    transaction: vi.fn((transaction: EditorTransaction) => {
      const change = transaction.changes?.[0];
      if (change !== undefined) text = text.slice(0, change.from.ch) + change.text + text.slice(change.to?.ch);
    }),
  };
  const metadata = {
    getFileCache: vi.fn(() => ({ frontmatter: { aliases: ["白云山"] } })),
    getFirstLinkpathDest: vi.fn(() => target),
  };
  const app = { vault: { getFileByPath: (path: string) => files.get(path) ?? null },
    metadataCache: metadata, fileManager: { generateMarkdownLink: vi.fn(() => generated) } };
  const writer = new ObsidianPotentialMentionWriter(app as unknown as App);
  const from = content.indexOf("白云山");
  const match = { from, to: from + 3, text: "白云山", targets: [{ path: target.path, nameKinds: ["alias" as const] }] };
  const source = { sourcePath: sourceFile.path, sourceText: content, documentRevision: "test", matches: [match] };
  let currentFile = sourceFile;
  return { editor, sourceFile, target, files, metadata, app, writer, source, match, setText: (value: string) => { text = value; },
    setCurrentFile: (file: typeof sourceFile) => { currentFile = file; },
    create: () => writer.createLink(editor as unknown as Editor, sourceFile as TFile, source, match, target.path, () => currentFile as TFile) };
}

describe("explicit single-mention editor transactions", () => {
  it("writes only the chosen occurrence with the official generator and safely reverses it once", async () => {
    const { create, editor, app, source } = setup();
    const receipt = await create();
    expect(app.fileManager.generateMarkdownLink).toHaveBeenCalledWith(expect.objectContaining({ path: "Places/广州.md" }),
      "Source.md", undefined, "白云山");
    expect(editor.getValue()).toBe("[[Places/广州|白云山]] and 白云山");
    expect(editor.transaction).toHaveBeenCalledTimes(1);
    receipt.undo();
    expect(editor.getValue()).toBe(source.sourceText);
    expect(() => receipt.undo()).toThrow(MentionWriteError);
  });

  it("rejects changed source, stale target names, mismatched official resolution, and non-body ranges", async () => {
    const changed = setup();
    changed.setText("Changed 白云山");
    await expect(changed.create()).rejects.toMatchObject({ reason: "source-changed" });
    const renamedAlias = setup();
    renamedAlias.metadata.getFileCache.mockReturnValue({ frontmatter: { aliases: ["Other alias"] } });
    await expect(renamedAlias.create()).rejects.toMatchObject({ reason: "target-changed" });
    const wrongTarget = setup();
    wrongTarget.metadata.getFirstLinkpathDest.mockReturnValue({ path: "Other/广州.md" });
    await expect(wrongTarget.create()).rejects.toMatchObject({ reason: "target-changed" });
    const missing = setup();
    missing.files.delete(missing.target.path);
    await expect(missing.create()).rejects.toMatchObject({ reason: "target-changed" });
    const code = setup("`白云山`");
    await expect(code.create()).rejects.toMatchObject({ reason: "range-unavailable" });
    expect(code.editor.transaction).not.toHaveBeenCalled();
  });

  it("refuses Notice undo after later editing and preserves all later text", async () => {
    const { create, editor, setText } = setup();
    const receipt = await create();
    const later = `${editor.getValue()} Later edit`;
    setText(later);
    expect(() => receipt.undo()).toThrow(MentionWriteError);
    expect(editor.getValue()).toBe(later);
    expect(editor.transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects a rebound editor even when the other document contains identical text", async () => {
    const test = setup();
    test.setCurrentFile({ path: "Other.md" });
    await expect(test.create()).rejects.toMatchObject({ reason: "source-changed" });
    const undo = setup();
    const receipt = await undo.create();
    undo.setCurrentFile({ path: "Other.md" });
    expect(() => receipt.undo()).toThrow(MentionWriteError);
  });

  it("rejects escaped openers, accidental embeds and protected attributes in final source context", async () => {
    for (const content of ["\\白云山", "!白云山", 'text <span\n title="白云山">end</span>', "- ```\n  白云山\n"]) {
      const test = setup(content);
      await expect(test.create()).rejects.toMatchObject({ reason: "range-unavailable" });
      expect(test.editor.getValue()).toBe(content);
      expect(test.editor.transaction).not.toHaveBeenCalled();
    }
  });

  it("supports Markdown preference and escapes Wiki alias pipes inside real table rows", async () => {
    const markdown = setup("白云山", "[白云山](Places/My%20Note.md)");
    await markdown.create();
    expect(markdown.metadata.getFirstLinkpathDest).toHaveBeenCalledWith("Places/My Note.md", "Source.md");
    const table = setup("| Location |\n| --- |\n| 白云山 |");
    await table.create();
    expect(table.editor.getValue()).toContain("[[Places/广州\\|白云山]]");
    const prose = setup("A | 白云山 in prose");
    await prose.create();
    expect(prose.editor.getValue()).toContain("[[Places/广州|白云山]]");
    const cr = setup("| Location |\r| --- |\r| 白云山 |");
    await cr.create();
    expect(cr.editor.getValue()).toContain("[[Places/广州\\|白云山]]");
  });
});
