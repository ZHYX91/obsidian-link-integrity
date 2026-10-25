export interface BodyRange { readonly from: number; readonly to: number; }
import { WorkScheduler } from "../../scheduling/work-scheduler";
import {
  expandMarkdownTabs as expandTabs,
  normalizeMarkdownContainerLine as normalizeBodyContainerLine,
  stripMarkdownContainers as stripKnownBodyContainers,
  type MarkdownContainer as BodyContainer,
  type MarkdownContainerLine as BodyContainerLine,
} from "./markdown-containers";

/** Conservative current-source syntax guard; complete explicit links remain eligible. */
export async function extractMarkdownNonLinkExclusions(source: string, scheduler = new WorkScheduler()): Promise<readonly BodyRange[]> {
  const ranges: BodyRange[] = [];
  const lines = [...source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)].filter((line) => line[0].length > 0);
  let properties = source.replace(/^\uFEFF/u, "").startsWith("---") && lines[0]?.[0].trim().replace(/^\uFEFF/u, "") === "---";
  let fence: { character: string; length: number; from: number; containers: readonly BodyContainer[] } | null = null;
  let html: { name: string; from: number; containers: readonly BodyContainer[]; openingQuote: string | null; openingComplete: boolean;
    bodyState: HtmlBodyState } | null = null;
  let containers: readonly BodyContainer[] = [];
  let indented = false;
  let previousBlank = true;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const from = line.index;
    const to = from + line[0].length;
    const text = line[0].replace(/[\r\n]+$/u, "");
    const active: { containers: readonly BodyContainer[] } | null = fence ?? html;
    // Inside an established block, '- ~~~' is content, never a new container or a fence closer.
    const normalized: BodyContainerLine | null = active === null ? normalizeBodyContainerLine(text, containers) : null;
    const blockContent = active === null ? null : stripKnownBodyContainers(expandTabs(text), active.containers).text;
    const content: string = normalized?.text ?? blockContent ?? text;
    if (normalized !== null) containers = normalized.containers;
    if (properties) {
      ranges.push({ from, to });
      if (index > 0 && /^(?:---|\.\.\.)[ \t]*$/u.test(text)) properties = false;
    } else if (fence !== null) {
      const closing = blockContent === null ? undefined : /^ {0,3}(`+|~+)[ \t]*$/u.exec(content)?.[1];
      if (closing !== undefined && closing[0] === fence.character && closing.length >= fence.length) {
        ranges.push({ from: fence.from, to });
        fence = null;
      }
    } else if (html !== null) {
      let body = content;
      if (!html.openingComplete) {
        const opening = htmlOpeningEnd(content, html.openingQuote);
        html.openingQuote = opening.quote;
        html.openingComplete = opening.end !== undefined;
        body = opening.end === undefined ? "" : content.slice(opening.end);
      }
      if (html.openingComplete && (await htmlBodyHasClosing(body, html.name, html.bodyState, scheduler) ||
        (!RAW_HTML_TEXT_TAGS.has(html.name) && content.trim().length === 0))) {
        ranges.push({ from: html.from, to });
        html = null;
      }
    } else {
      const opening: string | undefined = /^ {0,3}(`{3,}|~{3,})/u.exec(content)?.[1];
      const htmlName = /^ {0,3}<([A-Za-z][A-Za-z0-9-]*)\b/u.exec(content)?.[1]?.toLowerCase();
      const container = { containers };
      if (opening !== undefined) fence = { character: opening[0] ?? "`", length: opening.length, from, ...container };
      else if (htmlName !== undefined) {
        const tag = htmlOpeningEnd(content, null);
        const bodyState: HtmlBodyState = { tag: false, quote: null, comment: false };
        if (tag.end !== undefined && (await htmlBodyHasClosing(content.slice(tag.end), htmlName, bodyState, scheduler) ||
          (!RAW_HTML_TEXT_TAGS.has(htmlName) && (/\/\s*>$/u.test(content.slice(0, tag.end)) ||
            ["br", "hr", "img", "input", "meta", "link"].includes(htmlName))))) ranges.push({ from, to });
        else html = { name: htmlName, from, ...container, openingQuote: tag.quote, openingComplete: tag.end !== undefined, bodyState };
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
    /^[ \t]{0,3}\[[^\]\r\n]+\]:[^\r\n]*/gmu,
    /\\\[[\s\S]*?(?:\\\]|$)/gu,
    /(?:^|[\s(])#[\p{L}\p{N}_/-]+/gmu,
  ]) {
    for (const match of source.matchAll(pattern)) {
      ranges.push({ from: match.index, to: match.index + match[0].length });
      const pause = scheduler.checkpoint();
      if (pause !== null) await pause;
    }
  }
  await appendBodyUrlExclusions(source, ranges, scheduler);
  // An incomplete label/destination reaches the line end. Index the last closing delimiter
  // once per line, instead of retrying a failed suffix search at every opening bracket.
  for (const line of lines) {
    const content = line[0].replace(/[\r\n]+$/u, "");
    const lastBracket = content.lastIndexOf("]"); const lastParenthesis = content.lastIndexOf(")");
    let opening = -1;
    for (let index = 0; index < content.length; index += 1) {
      const character = content[index];
      if (character === "[" && opening < 0) opening = content[index - 1] === "!" ? index - 1 : index;
      if (character === "]") {
        if (opening >= 0 && content[index + 1] === "(" && lastParenthesis < index + 2) {
          ranges.push({ from: line.index + opening, to: line.index + content.length }); break;
        }
        opening = -1;
      } else if (index > lastBracket && opening >= 0) {
        ranges.push({ from: line.index + opening, to: line.index + content.length }); break;
      }
      const pause = scheduler.checkpoint(); if (pause !== null) await pause;
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
  const lastWikiClosing = source.lastIndexOf("]]");
  for (const opening of source.matchAll(/!?\[\[/gu)) {
    if (lastWikiClosing < opening.index + opening[0].length) {
      ranges.push({ from: opening.index, to: source.length }); break;
    }
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
  return ranges;
}

const RAW_HTML_TEXT_TAGS = new Set(["pre", "script", "style", "textarea"]);

/** Bounded tokens and delimiter indexes preserve leftmost, non-overlapping URL/email matches. */
async function appendBodyUrlExclusions(source: string, ranges: BodyRange[], scheduler: WorkScheduler): Promise<void> {
  for (const token of source.matchAll(/[^\s<>]+/gu)) {
    const end = token.index + token[0].length;
    const schemes: { from: number; to: number }[] = [];
    const emails: { from: number; to: number; end: number }[] = [];
    let fixedUrl = false;
    let schemeLetter = -1; let localStart = -1;
    for (let index = token.index; index < end; index += 1) {
      const character = source[index]!;
      if (character === ":" && schemeLetter >= 0 && source[index + 1] === "/" && source[index + 2] === "/" && index + 3 < end) schemes.push({ from: schemeLetter, to: index });
      if ((character === "m" || character === "M") && asciiLiteralAt(source, index, "mailto:") && index + 7 < end) fixedUrl = true;
      if ((character === "w" || character === "W") && !bodyWord(source[index - 1] ?? "") && asciiLiteralAt(source, index, "www.") && index + 4 < end) fixedUrl = true;
      if (character === "@" && localStart >= 0) {
        const emailEnd = await bodyEmailEnd(source, index + 1, end, scheduler);
        if (emailEnd !== null) emails.push({ from: localStart, to: index, end: emailEnd });
      }
      if (bodyWord(character) && character !== "_" || character === "+" || character === "." || character === "-") {
        if (schemeLetter < 0 && bodyLetter(character)) schemeLetter = index;
      } else schemeLetter = -1;
      if (bodyWord(character) || character === "." || character === "+" || character === "-") {
        if (localStart < 0) localStart = index;
      } else localStart = -1;
      const pause = scheduler.checkpoint(); if (pause !== null) await pause;
    }
    if (schemes.length === 0 && emails.length === 0 && !fixedUrl) continue;
    let schemeIndex = 0; let emailIndex = 0;
    for (let index = token.index; index < end; index += 1) {
      while (schemes[schemeIndex] !== undefined && schemes[schemeIndex]!.to <= index) schemeIndex += 1;
      while (emails[emailIndex] !== undefined && emails[emailIndex]!.to <= index) emailIndex += 1;
      const scheme = schemes[schemeIndex]; const email = emails[emailIndex]; const character = source[index]!;
      if (scheme !== undefined && scheme.from <= index && bodyLetter(character) ||
        (character === "m" || character === "M") && asciiLiteralAt(source, index, "mailto:") && index + 7 < end ||
        (character === "w" || character === "W") && !bodyWord(source[index - 1] ?? "") && asciiLiteralAt(source, index, "www.") && index + 4 < end) {
        ranges.push({ from: index, to: end }); break;
      }
      if (email !== undefined && email.from <= index) { ranges.push({ from: index, to: email.end }); index = email.end - 1; }
      const pause = scheduler.checkpoint(); if (pause !== null) await pause;
    }
  }
}

function bodyWord(character: string): boolean {
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122 ||
    character === "_" || character === "\u017f" || character === "\u212a";
}
function bodyLetter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code >= 65 && code <= 90 || code >= 97 && code <= 122 || character === "\u017f" || character === "\u212a";
}
function asciiLiteralAt(source: string, from: number, literal: string): boolean {
  for (let index = 0; index < literal.length; index += 1) {
    const expected = literal.charCodeAt(index); const actual = source.charCodeAt(from + index);
    if ((expected >= 97 && expected <= 122 ? actual | 32 : actual) !== expected) return false;
  }
  return true;
}

async function bodyEmailEnd(source: string, from: number, end: number, scheduler: WorkScheduler): Promise<number | null> {
  let dot = -1; let letters = 0; let result: number | null = null; let index = from;
  for (; index < end; index += 1) {
    const character = source[index]!;
    if (!bodyWord(character) && character !== "." && character !== "-") break;
    if (character === ".") { dot = index > from ? index : -1; letters = 0; }
    else if (dot >= 0 && bodyLetter(character)) { letters += 1; if (letters >= 2) result = index + 1; }
    else { dot = -1; letters = 0; }
    const pause = scheduler.checkpoint(); if (pause !== null) await pause;
  }
  // The final TLD may include Unicode letters even though the domain grammar is ASCII word text.
  while (dot >= 0 && index < end) {
    const character = String.fromCodePoint(source.codePointAt(index)!);
    if (!/\p{L}/u.test(character)) break;
    letters += 1; index += character.length; if (letters >= 2) result = index;
    const pause = scheduler.checkpoint(); if (pause !== null) await pause;
  }
  return result;
}

interface HtmlBodyState { tag: boolean; quote: string | null; comment: boolean; }

/** A conservative write guard, deliberately stricter than CommonMark's line-based HTML end condition. */
async function htmlBodyHasClosing(text: string, name: string, state: HtmlBodyState, scheduler: WorkScheduler): Promise<boolean> {
  const closing = new RegExp(`</${name}\\s*>`, "iyu");
  const tag = /<(?=\/?[A-Za-z]|!|\?)/uy;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (state.comment) {
      if (text.startsWith("-->", index)) { state.comment = false; index += 2; }
    } else if (state.tag) {
      if (state.quote !== null) { if (character === state.quote) state.quote = null; }
      else if (character === '"' || character === "'") state.quote = character;
      else if (character === ">") state.tag = false;
    } else if (text.startsWith("<!--", index)) { state.comment = true; index += 3; }
    else if (character === "<") {
      closing.lastIndex = index;
      if (closing.test(text)) return true;
      tag.lastIndex = index;
      state.tag = tag.test(text);
    }
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
  }
  return false;
}

function htmlOpeningEnd(text: string, initialQuote: string | null): { end: number | undefined; quote: string | null } {
  let quote = initialQuote;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) { if (character === quote) quote = null; }
    else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return { end: index + 1, quote: null };
  }
  return { end: undefined, quote };
}
