export interface BodyRange { readonly from: number; readonly to: number; }
import { WorkScheduler } from "../../scheduling/work-scheduler";

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
    if (end < 0) ranges.push({ from: opening.index, to: end < 0 ? source.length : end + 2 });
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

type BodyContainer = "quote" | number;

interface BodyContainerLine {
  readonly text: string;
  readonly containers: readonly BodyContainer[];
}

function expandTabs(line: string): string {
  let column = 0;
  return line.replace(/[^\t]*\t/gu, (part) => {
    column += part.length - 1;
    const spaces = 4 - column % 4;
    column += spaces;
    return part.slice(0, -1) + " ".repeat(spaces);
  });
}

function stripKnownBodyContainers(line: string, containers: readonly BodyContainer[]): {
  text: string | null;
  remainder: string;
  consumed: readonly BodyContainer[];
} {
  let text = line;
  const consumed: BodyContainer[] = [];
  for (const container of containers) {
    const prefix = container === "quote" ? /^ {0,3}> ?/u.exec(text)?.[0] :
      text.startsWith(" ".repeat(container)) ? " ".repeat(container) : undefined;
    if (prefix === undefined) return { text: null, remainder: text, consumed };
    text = text.slice(prefix.length);
    consumed.push(container);
  }
  return { text, remainder: text, consumed };
}

function normalizeBodyContainerLine(line: string, previous: readonly BodyContainer[]): BodyContainerLine {
  const stripped = stripKnownBodyContainers(expandTabs(line), previous);
  let text = stripped.remainder;
  const containers = [...stripped.consumed];
  // New containers are recognized only outside protected blocks. Their continuation indentation
  // is retained individually so nested lists and lists containing quotes can be stripped in order.
  while (text.length > 0) {
    const quote = /^ {0,3}> ?/u.exec(text)?.[0];
    if (quote !== undefined) { containers.push("quote"); text = text.slice(quote.length); continue; }
    const marker = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?: +|$)/u.exec(text)?.[0];
    if (marker === undefined) break;
    const spacing = / *$/u.exec(marker)?.[0].length ?? 0;
    const indent = marker.length - spacing + (spacing > 4 || spacing === 0 ? 1 : spacing);
    containers.push(indent);
    text = text.slice(Math.min(indent, marker.length));
  }
  return { text, containers: text.trim().length === 0 && containers.length === stripped.consumed.length ? previous : containers };
}

