import { parseFrontMatterAliases, parseLinktext, type App, type Editor, type TFile } from "obsidian";

import type { PotentialMentionMatch } from "../../core/potential-mention-model";
import { normalizeMentionText } from "../../core/potential-mention-matcher";
import type { PotentialMentionSource } from "../../features/mentions/potential-mention-service";
import { extractMarkdownExplicitReferences, extractMarkdownExplicitReferencesAsync } from "./explicit-link-parser";
import { extractMarkdownMentionExclusions, normalizeMentionContainerLines } from "./mention-body";

export type MentionWriteFailure = "source-changed" | "target-changed" | "range-unavailable" | "undo-unavailable";

export class MentionWriteError extends Error {
  public constructor(public readonly reason: MentionWriteFailure) {
    super(reason);
    this.name = "MentionWriteError";
  }
}

export interface MentionEditReceipt {
  readonly sourcePath: string;
  readonly linkText: string;
  /** Safe immediate undo is another exact range transaction, never a file rollback. */
  readonly undo: () => void;
}

export class ObsidianPotentialMentionWriter {
  public constructor(private readonly app: App) {}

  public async createLink(
    editor: Editor,
    file: TFile,
    source: PotentialMentionSource,
    match: PotentialMentionMatch,
    targetPath: string,
    getCurrentFile: () => TFile | null,
    isWriteActive: () => boolean = () => true,
  ): Promise<MentionEditReceipt> {
    const sourceText = source.sourceText;
    if (sourceText === undefined) throw new MentionWriteError("range-unavailable");
    const assertSource = (): void => {
      if (!isWriteActive() || getCurrentFile() !== file || file.path !== source.sourcePath || this.app.vault.getFileByPath(source.sourcePath) !== file ||
        editor.getValue() !== sourceText) throw new MentionWriteError("source-changed");
    };
    assertSource();
    if (!Number.isInteger(match.from) || !Number.isInteger(match.to) || match.from < 0 ||
      match.to <= match.from || match.to > sourceText.length ||
      sourceText.slice(match.from, match.to) !== match.text ||
      !match.targets.some(({ path }) => path === targetPath)) throw new MentionWriteError("range-unavailable");
    const excluded = await extractMarkdownMentionExclusions(sourceText);
    if (excluded.some(({ from, to }) => from < match.to && to > match.from)) {
      throw new MentionWriteError("range-unavailable");
    }
    assertSource();
    const target = this.app.vault.getFileByPath(targetPath);
    if (target === null || target === file || !this.matchesCurrentName(target, match.text)) {
      throw new MentionWriteError("target-changed");
    }
    const generated = this.app.fileManager.generateMarkdownLink(target, source.sourcePath, undefined, match.text);
    const references = extractMarkdownExplicitReferences(generated);
    const reference = references[0];
    if (reference === undefined || references.length !== 1 || reference.startOffset !== 0 ||
      reference.endOffset !== generated.length) throw new MentionWriteError("target-changed");
    let linktext = reference.linktext;
    if (!generated.startsWith("[[")) {
      try { linktext = decodeURIComponent(linktext); } catch { throw new MentionWriteError("target-changed"); }
    }
    const parsed = parseLinktext(linktext);
    if (this.app.metadataCache.getFirstLinkpathDest(parsed.path, source.sourcePath)?.path !== targetPath) {
      throw new MentionWriteError("target-changed");
    }
    const table = isTableCell(sourceText, match.from);
    const linkText = table ? escapeTablePipes(generated) : generated;
    const after = sourceText.slice(0, match.from) + linkText + sourceText.slice(match.to);
    if (table && linePipeCount(sourceText, match.from) !== linePipeCount(after, match.from)) {
      throw new MentionWriteError("range-unavailable");
    }
    // A table reader unescapes cell pipes before interpreting links. Check that semantic text
    // in its complete source context, so an escaped opener or accidental embed cannot be written.
    const contextAfter = table ? sourceText.slice(0, match.from) + generated + sourceText.slice(match.to) : after;
    const inserted = (await extractMarkdownExplicitReferencesAsync(contextAfter)).filter((candidate) =>
      candidate.startOffset === match.from && candidate.endOffset === match.from + generated.length && !candidate.embedded);
    if (inserted.length !== 1 || inserted[0]?.linktext !== reference.linktext) throw new MentionWriteError("range-unavailable");
    assertSource();
    if (this.app.vault.getFileByPath(targetPath) !== target || !this.matchesCurrentName(target, match.text) ||
      this.app.metadataCache.getFirstLinkpathDest(parsed.path, source.sourcePath)?.path !== targetPath) {
      throw new MentionWriteError("target-changed");
    }
    editor.transaction({ changes: [{ from: editor.offsetToPos(match.from), to: editor.offsetToPos(match.to), text: linkText }] },
      "link-integrity-create-link");
    let undone = false;
    return {
      sourcePath: source.sourcePath,
      linkText,
      undo: () => {
        if (undone || getCurrentFile() !== file || file.path !== source.sourcePath || this.app.vault.getFileByPath(source.sourcePath) !== file ||
          editor.getValue() !== after) throw new MentionWriteError("undo-unavailable");
        editor.transaction({ changes: [{ from: editor.offsetToPos(match.from),
          to: editor.offsetToPos(match.from + linkText.length), text: match.text }] }, "link-integrity-undo-link");
        undone = true;
      },
    };
  }

  private matchesCurrentName(file: TFile, text: string): boolean {
    const title = file.path.slice(file.path.lastIndexOf("/") + 1).replace(/\.md$/iu, "");
    return normalizeMentionText(title) === normalizeMentionText(text) ||
      (parseFrontMatterAliases(this.app.metadataCache.getFileCache(file)?.frontmatter ?? null) ?? [])
        .some((alias) => normalizeMentionText(alias.trim()) === normalizeMentionText(text));
  }
}

function isTableCell(source: string, offset: number): boolean {
  const lines = normalizeMentionContainerLines(source);
  const lineIndex = source.slice(0, offset).split(/\r\n|\r|\n/u).length - 1;
  const selected = lines[lineIndex];
  if (selected === undefined || !selected.text.includes("|")) return false;
  const container = selected.containers.join(",");
  const sameContainer = (index: number): boolean => lines[index]?.containers.join(",") === container;
  for (let index = lineIndex + 1; index >= 1; index -= 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const cells = tableCells(line.text);
    const header = lines[index - 1];
    if (sameContainer(index) && sameContainer(index - 1) && line.text.includes("|") && header?.text.includes("|") === true &&
      cells.length === tableCells(header.text).length &&
      cells.every((cell) => /^[ \t]*:?-{2,}:?[ \t]*$/u.test(cell))) {
      return index === lineIndex + 1 || lines.slice(index + 1, lineIndex + 1)
        .every((row) => row.containers.join(",") === container && row.text.includes("|"));
    }
    if (index <= lineIndex && (!sameContainer(index) || line.text.trim().length === 0 || !line.text.includes("|"))) return false;
  }
  return false;
}

function tableCells(line: string): readonly string[] {
  const cells = line.trim().split(/(?<!\\)(?:\\\\)*\|/u);
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells;
}

function linePipeCount(source: string, offset: number): number {
  const line = (source.slice(0, offset).split(/\r\n|\r|\n/u).at(-1) ?? "") +
    (source.slice(offset).split(/\r\n|\r|\n/u)[0] ?? "");
  return [...line.matchAll(/(?<!\\)(?:\\\\)*\|/gu)].length;
}

function escapeTablePipes(source: string): string {
  let escaped = "";
  let backslashes = 0;
  for (const character of source) {
    if (character === "|" && backslashes % 2 === 0) escaped += "\\";
    escaped += character;
    backslashes = character === "\\" ? backslashes + 1 : 0;
  }
  return escaped;
}
