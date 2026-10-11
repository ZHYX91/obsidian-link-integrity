import type { MentionRange } from "../../core/potential-mention-model";
import { WorkScheduler } from "../../scheduling/work-scheduler";
import { extractMarkdownExplicitReferencesAsync } from "./explicit-link-parser";

/** Conservative source protection, independent of the explicit-link diagnostic parser. */
export async function extractMarkdownMentionExclusions(source: string, scheduler = new WorkScheduler()): Promise<readonly MentionRange[]> {
  const ranges: MentionRange[] = [];
  const lines = [...source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)].filter((line) => line[0].length > 0);
  let properties = source.replace(/^\uFEFF/u, "").startsWith("---") && lines[0]?.[0].trim().replace(/^\uFEFF/u, "") === "---";
  let fence: { character: string; length: number; from: number } | null = null;
  let html: { name: string; from: number } | null = null;
  let indented = false;
  let previousBlank = true;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const from = line.index;
    const to = from + line[0].length;
    const text = line[0].replace(/[\r\n]+$/u, "");
    const content = text.replace(/^(?:[ \t]{0,3}>[ \t]?)+/u, "")
      .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/u, "");
    if (properties) {
      ranges.push({ from, to });
      if (index > 0 && /^(?:---|\.\.\.)[ \t]*$/u.test(text)) properties = false;
    } else if (fence !== null) {
      const closing = /^[ \t]{0,3}(`+|~+)[ \t]*$/u.exec(content)?.[1];
      if (closing !== undefined && closing[0] === fence.character && closing.length >= fence.length) {
        ranges.push({ from: fence.from, to });
        fence = null;
      }
    } else if (html !== null) {
      if (content.toLowerCase().includes(`</${html.name}`) || content.trim().length === 0) {
        ranges.push({ from: html.from, to });
        html = null;
      }
    } else {
      const opening = /^[ \t]{0,3}(`{3,}|~{3,})/u.exec(content)?.[1];
      const htmlName = /^[ \t]{0,3}<([A-Za-z][A-Za-z0-9-]*)\b/u.exec(content)?.[1]?.toLowerCase();
      if (opening !== undefined) fence = { character: opening[0] ?? "`", length: opening.length, from };
      else if (htmlName !== undefined) {
        if (content.toLowerCase().includes(`</${htmlName}`) || /\/\s*>/u.test(content) ||
          ["br", "hr", "img", "input", "meta", "link"].includes(htmlName)) ranges.push({ from, to });
        else html = { name: htmlName, from };
      } else if (/^(?: {4,}| {0,3}\t)/u.test(content) && (indented || previousBlank)) {
        ranges.push({ from, to });
        indented = true;
      } else if (content.trim().length > 0) indented = false;
    }
    previousBlank = content.trim().length === 0;
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
  }
  if (fence !== null) ranges.push({ from: fence.from, to: source.length });
  if (html !== null) ranges.push({ from: html.from, to: source.length });
  for (const pattern of [
    /%%[\s\S]*?(?:%%|$)/gu,
    /<!--[\s\S]*?(?:-->|$)/gu,
    /!?\[[^\]\r\n]*\](?:\[[^\]\r\n]*\])?/gu,
    /^[ \t]{0,3}\[[^\]\r\n]+\]:[^\r\n]*/gmu,
    /\\\[[\s\S]*?(?:\\\]|$)/gu,
    /[a-z][a-z0-9+.-]*:\/\/[^\s<>]+|mailto:[^\s<>]+|\bwww\.[^\s<>]+|[\w.+-]+@[\w.-]+\.[\p{L}]{2,}/giu,
    /(?:^|[\s(])#[\p{L}\p{N}_/-]+/gmu,
    /!?\[[^\]\r\n]*(?=\r|\n|$)/gu,
    /!?\[[^\]\r\n]*\]\([^\r\n)]*(?=\r|\n|$)/gu,
  ]) {
    for (const match of source.matchAll(pattern)) {
      ranges.push({ from: match.index, to: match.index + match[0].length });
      const pause = scheduler.checkpoint();
      if (pause !== null) await pause;
    }
  }
  // Dollar delimiters use backslash parity; escaped closers do not terminate math.
  const dollars = [...source.matchAll(/\$+/gu)];
  const nextDollar = new Map<number, number>();
  const dollarClosers = new Map<number, number>();
  const escaped = (offset: number): boolean => {
    let slashes = 0;
    for (let before = offset - 1; before >= 0 && source[before] === "\\"; before -= 1) slashes += 1;
    return slashes % 2 === 1;
  };
  for (let index = dollars.length - 1; index >= 0; index -= 1) {
    const run = dollars[index]!;
    if (escaped(run.index)) continue;
    const next = nextDollar.get(run[0].length);
    if (next !== undefined) dollarClosers.set(index, next);
    nextDollar.set(run[0].length, index);
  }
  for (let index = 0; index < dollars.length; index += 1) {
    const run = dollars[index]!;
    if (escaped(run.index)) continue;
    const endIndex = dollarClosers.get(index);
    const end = endIndex === undefined ? undefined : dollars[endIndex];
    const lineBreak = run[0].length === 1 ? /[\r\n]/u.exec(source.slice(run.index + 1, end?.index)) : null;
    if (lineBreak !== null) ranges.push({ from: run.index, to: run.index + 1 + lineBreak.index });
    else {
      ranges.push({ from: run.index, to: end === undefined ? source.length : end.index + end[0].length });
      if (endIndex !== undefined) index = endIndex;
    }
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
  }
  // HTML attributes can span lines and contain quoted '>'; do not expose them as prose.
  let tagEnd = 0;
  for (const opening of source.matchAll(/<(?=\/?[A-Za-z][\w:-]*\b|!|\?)/gu)) {
    if (opening.index < tagEnd) continue;
    let quote: string | null = null;
    let to = opening.index + 1;
    for (; to < source.length; to += 1) {
      const character = source[to];
      if (quote !== null) { if (character === quote) quote = null; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === ">") { to += 1; break; }
      const pause = scheduler.checkpoint();
      if (pause !== null) await pause;
    }
    ranges.push({ from: opening.index, to });
    tagEnd = to;
  }
  for (const opening of source.matchAll(/!?\[\[/gu)) {
    const end = source.indexOf("]]", opening.index + opening[0].length);
    ranges.push({ from: opening.index, to: end < 0 ? source.length : end + 2 });
  }
  // Pair equal backtick runs in one pass, avoiding a separate scan per opening delimiter.
  const runs = [...source.matchAll(/`+/gu)];
  const next = new Map<number, number>();
  const closing = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run === undefined) continue;
    const end = next.get(run[0].length);
    if (end !== undefined) closing.set(index, end);
    next.set(run[0].length, index);
  }
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (run === undefined) continue;
    let slashes = 0;
    for (let offset = run.index - 1; offset >= 0 && source[offset] === "\\"; offset -= 1) slashes += 1;
    if (slashes % 2 === 1) continue;
    const endIndex = closing.get(index);
    const end = endIndex === undefined ? undefined : runs[endIndex];
    ranges.push({ from: run.index, to: end === undefined ? run.index + run[0].length : end.index + end[0].length });
    if (endIndex !== undefined) index = endIndex;
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
  }
  for (const reference of await extractMarkdownExplicitReferencesAsync(source, scheduler)) {
    ranges.push({ from: reference.startOffset, to: reference.endOffset });
  }
  return ranges;
}
