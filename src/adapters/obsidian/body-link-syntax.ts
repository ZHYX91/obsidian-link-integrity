export interface BodyRange { readonly from: number; readonly to: number; }
import { isEscaped, maskRange, parseMarkdownSourceAsync, sourceLineRanges, type MarkdownSyntaxRange } from "./explicit-link-parser";
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
  const proof = (await parseMarkdownSourceAsync(source, scheduler)).syntaxRanges
    .filter(({ kind }) => kind !== "metadata");
  return extractProvenMarkdownNonLinkExclusions(source, scheduler, proof);
}

/** Reuse a current-source proof, including its literal metadata contexts. */
export async function extractProvenMarkdownNonLinkExclusions(source: string, scheduler: WorkScheduler,
  syntaxRanges: readonly MarkdownSyntaxRange[]): Promise<readonly BodyRange[]> {
  const ranges: BodyRange[] = [];
  if (syntaxRanges.length > 0) {
    const syntax = source.split("");
    for (const { start, end, kind } of syntaxRanges) {
      const metadata = kind === "metadata";
      if (!metadata) ranges.push({ from: start, to: end });
      // Keep raw HTML for the stricter child-attribute/comment closing guard.
      // Other established syntax cannot open a second conservative context.
      if (kind !== "raw-html") maskRange(syntax, start, end);
    }
    source = syntax.join("");
  }
  const lines = sourceLineRanges(source);
  let html: { name: string; from: number; containers: readonly BodyContainer[]; openingQuote: string | null; openingComplete: boolean;
    bodyState: HtmlBodyState } | null = null;
  let containers: readonly BodyContainer[] = [];
  for (const line of lines) {
    const from = line.start;
    const to = line.end;
    const text = source.slice(from, line.contentEnd);
    const active: { containers: readonly BodyContainer[] } | null = html;
    const normalized: BodyContainerLine | null = active === null ? normalizeBodyContainerLine(text, containers) : null;
    const blockContent = active === null ? null : stripKnownBodyContainers(expandTabs(text), active.containers).text;
    const content: string = normalized?.text ?? blockContent ?? text;
    if (normalized !== null) containers = normalized.containers;
    if (html !== null) {
      let body = content;
      if (!html.openingComplete) {
        const opening = await htmlOpeningEnd(content, html.openingQuote, scheduler);
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
      const htmlName = /^ {0,3}<([A-Za-z][A-Za-z0-9-]*)\b/u.exec(content)?.[1]?.toLowerCase();
      if (htmlName !== undefined) {
        const tag = await htmlOpeningEnd(content, null, scheduler);
        const bodyState: HtmlBodyState = { tag: false, quote: null, comment: false };
        if (tag.end !== undefined && (await htmlBodyHasClosing(content.slice(tag.end), htmlName, bodyState, scheduler) ||
          (!RAW_HTML_TEXT_TAGS.has(htmlName) && (/\/\s*>$/u.test(content.slice(0, tag.end)) ||
            ["br", "hr", "img", "input", "meta", "link"].includes(htmlName))))) ranges.push({ from, to });
        else html = { name: htmlName, from, containers, openingQuote: tag.quote, openingComplete: tag.end !== undefined, bodyState };
      }
    }
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
  }
  if (html !== null) ranges.push({ from: html.from, to: source.length });
  for (const pattern of [
    /%%[\s\S]*?(?:%%|$)/gu,
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
    const content = source.slice(line.start, line.contentEnd);
    const lastBracket = content.lastIndexOf("]"); const lastParenthesis = content.lastIndexOf(")");
    let opening = -1;
    for (let index = 0; index < content.length; index += 1) {
      const character = content[index];
      if (character === "[" && opening < 0) opening = content[index - 1] === "!" ? index - 1 : index;
      if (character === "]") {
        if (opening >= 0 && content[index + 1] === "(" && lastParenthesis < index + 2) {
          ranges.push({ from: line.start + opening, to: line.contentEnd }); break;
        }
        opening = -1;
      } else if (index > lastBracket && opening >= 0) {
        ranges.push({ from: line.start + opening, to: line.contentEnd }); break;
      }
      const pause = scheduler.checkpoint(); if (pause !== null) await pause;
    }
  }
  // Dollar delimiters use backslash parity; escaped closers do not terminate math.
  const dollars = [...source.matchAll(/\$+/gu)];
  const nextDollar = new Map<number, number>();
  const dollarClosers = new Map<number, number>();
  for (let index = dollars.length - 1; index >= 0; index -= 1) {
    const run = dollars[index]!;
    if (isEscaped(source, run.index)) continue;
    const next = nextDollar.get(run[0].length);
    if (next !== undefined) dollarClosers.set(index, next);
    nextDollar.set(run[0].length, index);
  }
  for (let index = 0; index < dollars.length; index += 1) {
    const run = dollars[index]!;
    if (isEscaped(source, run.index)) continue;
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
    const to = opening.index + ((await htmlOpeningEnd(source.slice(opening.index), null, scheduler)).end ?? source.length - opening.index);
    ranges.push({ from: opening.index, to });
    tagEnd = to;
  }
  const lastWikiClosing = source.lastIndexOf("]]");
  for (const opening of source.matchAll(/!?\[\[/gu)) {
    if (lastWikiClosing < opening.index + opening[0].length) {
      ranges.push({ from: opening.index, to: source.length }); break;
    }
  }
  // Matched spans already use the shared block-bound proof. Keep unmatched
  // delimiter bytes conservative without pairing across unrelated blocks.
  for (const run of source.matchAll(/`+/gu)) {
    if (isEscaped(source, run.index)) continue;
    ranges.push({ from: run.index, to: run.index + run[0].length });
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
  return code >= 48 && code <= 57 || character === "_" || bodyLetter(character);
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

async function htmlOpeningEnd(text: string, initialQuote: string | null, scheduler: WorkScheduler): Promise<{ end: number | undefined; quote: string | null }> {
  let quote = initialQuote;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) { if (character === quote) quote = null; }
    else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return { end: index + 1, quote: null };
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
  }
  return { end: undefined, quote };
}
