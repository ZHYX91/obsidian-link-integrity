import { isMap, isScalar, isSeq, parseDocument } from "yaml";

import { WorkScheduler } from "../../scheduling/work-scheduler";
import { indexMarkdownDestinations, type MarkdownDestinationIndex } from "./markdown-destination-index";
import {
  expandMarkdownTabs,
  normalizeMarkdownContainerLine,
  stripMarkdownContainers,
  type MarkdownContainer,
} from "./markdown-containers";

export interface ParsedExplicitReference {
  readonly raw: string;
  readonly linktext: string;
  readonly embedded: boolean;
  readonly startOffset: number;
  readonly endOffset: number;
  /** False when YAML decoding prevents exact offsets; offsets then identify the scalar only. */
  readonly exactPosition?: boolean;
}


export function extractMarkdownExplicitReferences(
  source: string,
): readonly ParsedExplicitReference[] {
  const steps = extractMarkdownSteps(source);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export async function extractMarkdownExplicitReferencesAsync(
  source: string,
  scheduler = new WorkScheduler(),
  // Internal adapters may reuse only the same source's UTF-16 mask.
  maskedSource?: string,
): Promise<readonly ParsedExplicitReference[]> {
  const steps = extractMarkdownSteps(source, maskedSource);
  let step = steps.next();
  while (!step.done) {
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    step = steps.next();
  }
  return step.value;
}

function* extractMarkdownSteps(source: string, masked = maskMarkdownNonContent(source)): Generator<void, readonly ParsedExplicitReference[]> {
  yield;
  const { references: wikiReferences, ranges } = yield* extractWikiLinks(source, masked);
  const destinations = yield* indexMarkdownDestinations(masked);
  const markdown = yield* extractInlineMarkdownLinks(source, masked, ranges, destinations);
  const references: ParsedExplicitReference[] = [];
  let wiki = 0;
  let inline = 0;
  while (wiki < wikiReferences.length || inline < markdown.length) {
    const left = wikiReferences[wiki];
    const right = markdown[inline];
    if (left !== undefined && (right === undefined || left.startOffset <= right.startOffset)) {
      references.push(left);
      wiki += 1;
    } else if (right !== undefined) {
      references.push(right);
      inline += 1;
    }
    if (references.length % 128 === 0) yield;
  }
  return references;
}

export function extractBasesExplicitReferences(
  source: string,
): readonly ParsedExplicitReference[] {
  const document = parseDocument(source, {
    schema: "failsafe",
    logLevel: "silent",
    stringKeys: true,
  });
  const root = document.contents;
  if (document.errors.length > 0 || !isMap(root)) {
    throw new Error("Invalid Bases source.");
  }

  const scalars: Array<{ readonly value: string; readonly start: number; readonly end: number }> = [];
  const appendScalar = (node: unknown): void => {
    if (!isScalar(node) || typeof node.value !== "string") return;
    const start = node.range?.[0] ?? 0;
    const end = node.range?.[1] ?? start;
    scalars.push({ value: node.value, start, end });
  };
  const collectFilters = (node: unknown): void => {
    if (isScalar(node)) {
      appendScalar(node);
      return;
    }
    if (isSeq(node)) {
      for (const item of node.items) collectFilters(item);
      return;
    }
    if (!isMap(node)) return;
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") continue;
      if (pair.key.value === "and" || pair.key.value === "or" || pair.key.value === "not") {
        collectFilters(pair.value);
      }
    }
  };
  const collectFormulaMap = (node: unknown): void => {
    if (!isMap(node)) return;
    for (const pair of node.items) appendScalar(pair.value);
  };
  const topLevelValue = (key: string): unknown => {
    for (const pair of root.items) {
      if (isScalar(pair.key) && pair.key.value === key) return pair.value;
    }
    return undefined;
  };

  collectFilters(topLevelValue("filters"));
  collectFormulaMap(topLevelValue("formulas"));
  collectFormulaMap(topLevelValue("summaries"));
  const views = topLevelValue("views");
  if (isSeq(views)) {
    for (const view of views.items) {
      if (!isMap(view)) continue;
      for (const pair of view.items) {
        if (isScalar(pair.key) && pair.key.value === "filters") collectFilters(pair.value);
      }
    }
  }

  const references = scalars.flatMap((scalar) =>
    extractBasesFormulaReferences(source, scalar.value, scalar.start, scalar.end));
  return references.sort(
    (left, right) => left.startOffset - right.startOffset,
  );
}

function extractBasesFormulaReferences(
  source: string,
  formula: string,
  scalarStart: number,
  scalarEnd: number,
): ParsedExplicitReference[] {
  const references: ParsedExplicitReference[] = [];
  const scalarSource = source.slice(scalarStart, scalarEnd);
  const exactValueOffset = scalarSource.indexOf(formula);
  const position = (start: number, end: number): Pick<ParsedExplicitReference,
    "startOffset" | "endOffset" | "exactPosition"> => exactValueOffset < 0
    ? { startOffset: scalarStart, endOffset: scalarEnd, exactPosition: false }
    : { startOffset: scalarStart + exactValueOffset + start,
      endOffset: scalarStart + exactValueOffset + end };
  let index = 0;
  while (index < formula.length) {
    const character = formula[index];
    if (character === "\"" || character === "'") {
      index = skipFormulaString(formula, index);
      continue;
    }
    const embeddedWiki = character === "!" && formula[index + 1] === "[" && formula[index + 2] === "[";
    const plainWiki = character === "[" && formula[index + 1] === "[";
    if (embeddedWiki || plainWiki) {
      const opening = embeddedWiki ? index + 1 : index;
      const closing = findFormulaWikiClosing(formula, opening + 2);
      if (closing >= 0) {
        const linktext = readWikiLinktext(formula.slice(opening + 2, closing)).trim();
        if (linktext.length > 0) {
          references.push({
            raw: formula.slice(index, closing + 2),
            linktext,
            embedded: embeddedWiki,
            ...position(index, closing + 2),
          });
        }
        index = closing + 2;
        continue;
      }
    }
    if (formula.startsWith("link", index) && !isFormulaIdentifierPart(formula[index - 1]) &&
      formula.slice(0, index).trimEnd().at(-1) !== ".") {
      let cursor = index + 4;
      if (!isFormulaIdentifierPart(formula[cursor])) {
        while (cursor < formula.length && /\s/u.test(formula[cursor] ?? "")) cursor += 1;
        if (formula[cursor] === "(") {
          cursor += 1;
          while (cursor < formula.length && /\s/u.test(formula[cursor] ?? "")) cursor += 1;
          const parsed = readFormulaString(formula, cursor);
          if (parsed !== null) {
            const linktext = parsed.value.trim();
            let argumentEnd = parsed.end;
            while (/\s/u.test(formula[argumentEnd] ?? "")) argumentEnd += 1;
            if (linktext.length > 0 && (formula[argumentEnd] === ")" || formula[argumentEnd] === ",")) {
              references.push({
                raw: formula.slice(index, parsed.end),
                linktext,
                embedded: false,
                ...position(index, parsed.end),
              });
            }
            index = parsed.end;
            continue;
          }
        }
      }
    }
    index += 1;
  }
  return references;
}

function findFormulaWikiClosing(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "]" && source[index + 1] === "]") return index;
  }
  return -1;
}

function skipFormulaString(source: string, start: number): number {
  return readFormulaString(source, start)?.end ?? source.length;
}

function readFormulaString(
  source: string,
  start: number,
): { readonly value: string; readonly end: number } | null {
  const quote = source[start];
  if (quote !== "\"" && quote !== "'") return null;
  let value = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      const next = source[index + 1];
      if (next === undefined) return null;
      value += next;
      index += 1;
      continue;
    }
    if (character === quote) return { value, end: index + 1 };
    value += character;
  }
  return null;
}

function isFormulaIdentifierPart(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_$]/u.test(value);
}

export function isExternalReference(linktext: string): boolean {
  const candidate = linktext.trim();
  return (
    candidate.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/iu.test(candidate) ||
    candidate.startsWith("data:")
  );
}

interface ExtractedWikiLinks {
  readonly references: ParsedExplicitReference[];
  readonly ranges: MaskedRange[];
}

function* extractWikiLinks(source: string, masked: string): Generator<void, ExtractedWikiLinks> {
  const references: ParsedExplicitReference[] = [];
  const ranges: MaskedRange[] = [];
  let index = 0;
  while (index < masked.length) {
    if (index % 1024 === 0) yield;
    const embedded = masked[index] === "!" && masked[index + 1] === "[" &&
      masked[index + 2] === "[" && !isEscaped(masked, index + 1);
    const startOffset = index;
    const opening = embedded ? index + 1 : index;
    if (
      masked[opening] !== "[" ||
      masked[opening + 1] !== "[" ||
      isEscaped(masked, opening)
    ) {
      index += 1;
      continue;
    }
    const contentStart = opening + 2;
    const closing = yield* findWikiClosing(masked, contentStart);
    if (closing < 0) {
      index = lineEndOffset(masked, contentStart);
      continue;
    }
    const endOffset = closing + 2;
    ranges.push({ start: startOffset, end: endOffset });
    const wikiContent = source.slice(contentStart, closing);
    const linktext = readWikiLinktext(wikiContent).trim();
    if (linktext.length > 0) {
      references.push({
        raw: source.slice(startOffset, endOffset),
        linktext,
        embedded,
        startOffset,
        endOffset,
      });
    }
    index = endOffset;
  }
  return { references, ranges };
}

function* extractInlineMarkdownLinks(
  source: string,
  masked: string,
  wikiRanges: readonly MaskedRange[],
  destinations: MarkdownDestinationIndex,
): Generator<void, ParsedExplicitReference[]> {
  const references: ParsedExplicitReference[] = [];
  const labelStack: number[] = [];
  let wikiRangeIndex = 0;
  let index = 0;
  while (index < masked.length) {
    if (index % 1024 === 0) yield;
    const wikiRange = wikiRanges[wikiRangeIndex];
    if (wikiRange !== undefined && index >= wikiRange.end) {
      wikiRangeIndex += 1;
      continue;
    }
    if (wikiRange !== undefined && index >= wikiRange.start) {
      labelStack.length = 0;
      index = wikiRange.end;
      wikiRangeIndex += 1;
      continue;
    }

    const character = masked[index];
    if (character === "\n" || character === "\r") {
      labelStack.length = 0;
      index += 1;
      continue;
    }
    if (character === "\\") {
      index += Math.min(2, masked.length - index);
      continue;
    }
    if (character === "[" && masked[index + 1] !== "[") {
      labelStack.push(index);
      index += 1;
      continue;
    }
    if (character !== "]" || labelStack.length === 0) {
      index += 1;
      continue;
    }

    const labelStart = labelStack.pop();
    if (labelStart === undefined || masked[index + 1] !== "(") {
      index += 1;
      continue;
    }
    const parsedDestination = readMarkdownDestination(masked, index + 2, destinations);
    if (parsedDestination === null) {
      index += 1;
      continue;
    }
    const embedded = labelStart > 0 && source[labelStart - 1] === "!" &&
      !isEscaped(source, labelStart - 1);
    const startOffset = embedded ? labelStart - 1 : labelStart;
    const linktext = source
      .slice(parsedDestination.destinationStart, parsedDestination.destinationEnd)
      .replace(/^<|>$/gu, "")
      .trim();
    if (linktext.length > 0) {
      references.push({
        raw: source.slice(startOffset, parsedDestination.linkEnd),
        linktext: unescapeMarkdownDestination(linktext),
        embedded,
        startOffset,
        endOffset: parsedDestination.linkEnd,
      });
    }
    labelStack.length = 0;
    index = parsedDestination.linkEnd;
  }
  return references;
}

function* findWikiClosing(source: string, start: number): Generator<void, number> {
  for (let index = start; index < source.length; index += 1) {
    if (index % 1024 === 0) yield;
    const character = source[index];
    if (character === "\n" || character === "\r") return -1;
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "]" && source[index + 1] === "]") return index;
  }
  return -1;
}

function lineEndOffset(source: string, start: number): number {
  let index = start;
  while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
  return index < source.length ? index + 1 : source.length;
}

function readMarkdownDestination(
  source: string,
  start: number,
  boundaries: MarkdownDestinationIndex,
): { destinationStart: number; destinationEnd: number; linkEnd: number } | null {
  const destinationStart = boundaries.afterWhitespace[start] ?? source.length;
  const closing = boundaries.closing[destinationStart] ?? -1;
  const destinationEnd = source[destinationStart] === "<"
    ? closing < 0 ? -1 : closing + 1
    : boundaries.bareEnd[destinationStart] ?? -1;
  if (destinationEnd < 0) return null;
  let index = boundaries.afterWhitespace[destinationEnd] ?? source.length;
  const quote = source[index];
  if (quote === '"' || quote === "'") {
    const titleEnd = boundaries.closing[index] ?? -1;
    if (titleEnd < 0) return null;
    index = boundaries.afterWhitespace[titleEnd + 1] ?? source.length;
  }
  if (source[index] !== ")") return null;
  return { destinationStart, destinationEnd, linkEnd: index + 1 };
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/** Same-length UTF-16 mask shared by fallback parsing and positioned cache filtering. */
export function maskMarkdownNonContent(source: string): string {
  // Every offset used by RegExp, indexOf, and slice is a UTF-16 code-unit offset.
  // Keep the mask indexed in the same coordinate system; spreading a string
  // collapses surrogate pairs and shifts every later mask range.
  const characters = source.split("");
  const frontmatterRange = findMarkdownFrontmatterRange(source);
  const blockRanges = maskDelimitedBlocks(characters, source, frontmatterRange);
  if (frontmatterRange !== null) {
    maskYamlCommentRanges(
      characters,
      source,
      frontmatterRange.start,
      frontmatterRange.end,
    );
  }
  maskInlineCodeAndComments(characters, source, blockRanges);
  return characters.join("");
}

interface MaskedRange {
  readonly start: number;
  readonly end: number;
}

function maskDelimitedBlocks(
  characters: string[],
  source: string,
  frontmatter: MaskedRange | null,
): MaskedRange[] {
  const ranges: MaskedRange[] = [];
  let fence: {
    readonly character: string;
    readonly length: number;
    readonly start: number;
    readonly containers: readonly MarkdownContainer[];
  } | null = null;
  let opaque: { readonly start: number; readonly end: number; readonly containers: readonly MarkdownContainer[] } | null = null;
  let containers: readonly MarkdownContainer[] = [];
  let indentedCode = false;
  let paragraph = false;
  let paragraphBody = false;
  let emptyItemDepth = 0;
  let definitionEnd = 0;
  let inlineEnd = 0;
  let literalTagEnd = 0;
  const lines = sourceLineRanges(source);
  const linesByStart = new Map(lines.map((line) => [line.start, line]));
  const inlineClosers = indexInlineCodeClosers(source, lines);
  const opaqueClosers = indexOpaqueClosers(source);
  const rawOpening = /<(pre|script|style|textarea)(?=[\s>])/iyu;
  const mask = (start: number, end: number) => {
    maskRange(characters, start, end);
    ranges.push({ start, end });
  };
  for (const [lineIndex, line] of lines.entries()) {
    if (frontmatter !== null && line.start < frontmatter.end) continue;
    if (line.start < definitionEnd) continue;
    const text = source.slice(line.start, line.contentEnd);
    let cursor = line.start;
    if (opaque !== null) {
      if (!continuesContainers(text, opaque.containers)) {
        mask(opaque.start, line.start);
        opaque = null;
      } else if (opaque.end > line.end) continue;
      else {
        cursor = opaque.end;
        mask(opaque.start, opaque.end);
        opaque = null;
      }
    }
    if (fence !== null) {
      if (continuesContainers(text, fence.containers)) {
        const content = stripMarkdownContainers(expandMarkdownTabs(text), fence.containers).text;
        const closing = content === null ? undefined : /^ {0,3}(`+|~+)[ \t]*$/u.exec(content)?.[1];
        if (closing !== undefined && closing[0] === fence.character && closing.length >= fence.length) {
          mask(fence.start, line.end);
          fence = null;
        }
        continue;
      }
      mask(fence.start, line.start);
      fence = null;
    }
    const continues = continuesContainers(text, containers);
    if (!continues) inlineEnd = 0;
    cursor = Math.max(cursor, literalTagEnd);
    // A closing opaque block or literal attribute is not a new paragraph. Keep
    // the state from its opener unless actual prose follows the closing token.
    if (cursor > line.start && source.slice(cursor, line.contentEnd).trim().length === 0) continue;
    const normalized = normalizeMarkdownContainerLine(text, containers, paragraph);
    const blank = normalized.text.trim().length === 0;
    // A lazy paragraph continuation can omit its quote/list prefixes. Keep that
    // stack for a later indented continuation, but never carry it across a blank
    // or a new block. Code cannot interrupt the paragraph itself.
    const lazy = !continues && paragraph && !blank && !normalized.opensContainer &&
      !startsMarkdownBlock(normalized.text);
    if ((!continues && !lazy) || normalized.opensContainer) {
      indentedCode = false;
      paragraph = false;
      paragraphBody = false;
      emptyItemDepth = 0;
    }
    if (!lazy) containers = normalized.containers;
    const indented = normalized.text.startsWith("    ");
    if (!blank && indented && (indentedCode || !paragraph) && cursor === line.start) {
      indentedCode = true;
      paragraph = false;
      paragraphBody = false;
      emptyItemDepth = 0;
      mask(line.start, line.contentEnd);
      continue;
    }
    if (!blank) indentedCode = false;
    // The marker itself is the first blank line of an empty list item. A second
    // blank closes it; populated items can contain any number of blank lines.
    if (blank) {
      if (normalized.opensContainer && typeof containers.at(-1) === "number") emptyItemDepth = containers.length;
      else if (emptyItemDepth > 0) { containers = containers.slice(0, emptyItemDepth - 1); emptyItemDepth = 0; }
    } else emptyItemDepth = 0;
    let definitionLines = 0;
    if (!paragraphBody && !blank && /^ {0,3}\[/u.test(normalized.text)) {
      let next = lineIndex + 1;
      definitionLines = referenceDefinitionLines(normalized.text, () => {
        const following = lines[next++];
        if (following === undefined) return null;
        const text = source.slice(following.start, following.contentEnd);
        const content = normalizeMarkdownContainerLine(text, containers, true);
        return content.opensContainer || startsMarkdownBlock(content.text) ||
          continuesContainers(text, containers) && isSetextUnderline(content.text) ? null : content.text;
      });
      if (definitionLines > 0) {
        definitionEnd = lines[lineIndex + definitionLines - 1]!.end;
        // Definitions are metadata, not inline content. Their labels, titles and
        // literal delimiters must not create links or change following syntax.
        mask(line.start, definitionEnd);
        cursor = definitionEnd;
      }
    }
    // Definitions remain in the open paragraph until it closes. Only the body
    // left after stripping its leading definitions can become a setext heading.
    paragraph = !blank && !startsMarkdownBlock(normalized.text) &&
      !(paragraph && paragraphBody && continues && isSetextUnderline(normalized.text));
    paragraphBody = paragraph && definitionLines === 0;
    const rawStart = /^ {0,3}<(?:pre|script|style|textarea)(?=[\s>]|$)/iu.test(normalized.text)
      ? line.start + text.indexOf("<") : -1;
    const opening = cursor === line.start ? /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/u.exec(normalized.text) : null;
    const delimiter = opening?.[1];
    if (delimiter !== undefined && !(delimiter[0] === "`" && opening?.[2]?.includes("`"))) {
      fence = { character: delimiter[0] ?? "", length: delimiter.length, start: line.start, containers };
      inlineEnd = 0;
      paragraph = false;
      continue;
    }
    // Recognize opaque syntax in source order so fences inside comments/raw HTML
    // and HTML openers inside code spans never become a second active block.
    while (cursor < line.contentEnd) {
      if (cursor < inlineEnd) { cursor = inlineEnd; continue; }
      if (characters[cursor] !== source[cursor]) { cursor += 1; continue; }
      let end: number | null = null;
      if (source.startsWith("<!--", cursor) && !isEscaped(source, cursor)) {
        end = source.startsWith("<!-->", cursor) ? cursor + 5
          : source.startsWith("<!--->", cursor) ? cursor + 6
            : nextOpaqueEnd(opaqueClosers.get("-->"), cursor + 4) ?? source.length;
      } else if (source.startsWith("%%", cursor)) {
        end = nextOpaqueEnd(opaqueClosers.get("%%"), cursor + 2);
      } else if (source[cursor] === "<" && !isEscaped(source, cursor)) {
        rawOpening.lastIndex = cursor;
        const name = cursor === rawStart ? rawOpening.exec(source)?.[1]?.toLowerCase() : undefined;
        if (name !== undefined) {
          const openingEnd = htmlTagEnd(source, rawOpening.lastIndex, containers, linesByStart);
          end = nextOpaqueEnd(opaqueClosers.get(name), openingEnd) ?? source.length;
        } else if (/^\/?[A-Za-z]/u.test(source.slice(cursor + 1, cursor + 3))) {
          // Attributes are literal HTML, not new raw tags/comments. Keep their
          // bytes for the link parser, which also recognizes angle destinations.
          const tag = scanLiteralHtmlTag(source, cursor, containers, linesByStart);
          if (tag.valid) {
            literalTagEnd = tag.end;
            cursor = literalTagEnd;
            continue;
          }
        }
      }
      if (end !== null) {
        if (end > line.end) { opaque = { start: cursor, end, containers }; break; }
        mask(cursor, end);
        cursor = end;
        continue;
      }
      inlineEnd = inlineClosers.get(cursor) ?? 0;
      cursor = inlineEnd > cursor ? inlineEnd : cursor + 1;
    }
  }
  if (fence !== null) mask(fence.start, source.length);
  if (opaque !== null) mask(opaque.start, source.length);
  return ranges;
}

function startsMarkdownBlock(text: string): boolean {
  return /^ {0,3}(?:#{1,6}(?:\s|$)|`{3,}[^`]*$|~{3,}|(?:\* *){3,}$|(?:_ *){3,}$|(?:- *){3,}$|<(?:pre|script|style|textarea)(?=[\s>]|$)|<!--)/iu.test(text);
}

function isSetextUnderline(text: string): boolean {
  return /^ {0,3}(?:=+|-+) *$/u.test(text);
}

/** Leading definitions supply no setext body. Read only their needed lines. */
function referenceDefinitionLines(first: string, readLine: () => string | null): number {
  let text = first;
  let lines = 1;
  const append = (): boolean => {
    const next = readLine();
    if (next === null || next.trim().length === 0) return false;
    text += `\n${next}`;
    lines += 1;
    return true;
  };
  // Labels are bounded; an unfinished label must not scan a whole source again.
  while (/^ {0,3}\[(?:\\.|[^[\]\\]){0,999}$/su.test(text) && append()) { /* continue label */ }
  const label = /^ {0,3}\[((?:\\.|[^[\]\\]){1,999})\]: */su.exec(text);
  if (label === null || label[1]!.trim().length === 0) return 0;
  let cursor = label[0].length;
  if (cursor === text.length) {
    if (!append()) return 0;
    cursor += /^\n */u.exec(text.slice(cursor))![0].length;
  }
  const start = cursor;
  const angle = text[cursor] === "<";
  if (angle) cursor += 1;
  let depth = 0;
  for (; cursor < text.length; cursor += 1) {
    const character = text[cursor]!;
    if (character === "\\" && /[!-/:-@[-`{-~]/u.test(text[cursor + 1] ?? "")) { cursor += 1; continue; }
    if (angle && character === ">") { depth = -1; cursor += 1; break; }
    if (angle && (character === "<" || character === "\n")) return 0;
    if (!angle) {
      if (character <= " " || character === "\u007f") break;
      if (character === "(") depth += 1;
      if (character === ")" && --depth < 0) return 0;
    }
  }
  if (angle ? depth !== -1 : cursor === start || depth !== 0) return 0;
  const destinationLines = lines;
  const end = cursor;
  while (text[cursor] === " ") cursor += 1;
  const sameLine = cursor < text.length;
  if (!sameLine) {
    if (!append()) return destinationLines;
    cursor += /^\n */u.exec(text.slice(cursor))![0].length;
  } else if (cursor === end) return 0;
  const opening = text[cursor];
  const closing = opening === "(" ? ")" : opening;
  const fallback = sameLine ? 0 : destinationLines;
  if (opening !== '"' && opening !== "'" && opening !== "(") return fallback;
  cursor += 1;
  for (;;) {
    if (cursor === text.length) {
      text = "";
      cursor = 0;
      if (!append()) return fallback;
    }
    const character = text[cursor++];
    if (character === "\\" && /[!-/:-@[-`{-~]/u.test(text[cursor] ?? "")) { cursor += 1; continue; }
    if (character === closing) return text.slice(cursor).trim().length === 0 ? lines : fallback;
    if (opening === "(" && character === "(") return fallback;
  }
}

function continuesContainers(text: string, containers: readonly MarkdownContainer[]): boolean {
  const stripped = stripMarkdownContainers(expandMarkdownTabs(text), containers);
  if (stripped.text !== null) return true;
  // A blank list continuation may omit indentation; a quote must retain its marker.
  return stripped.remainder.trim().length === 0 && !containers.slice(stripped.consumed.length).includes("quote");
}

function indexInlineCodeClosers(source: string, lines: readonly SourceLineRange[]): ReadonlyMap<number, number> {
  const runs = [...source.matchAll(/`+/gu)];
  const nextByLength = new Map<number, number>();
  const result = new Map<number, number>();
  const barriers: number[] = [];
  let containers: readonly MarkdownContainer[] = [];
  for (const line of lines) {
    const normalized = normalizeMarkdownContainerLine(source.slice(line.start, line.contentEnd), containers);
    containers = normalized.containers;
    if (/^ {0,3}(?:`{3,}[^`]*|~{3,}.*)$/u.test(normalized.text)) barriers.push(line.start);
  }
  let barrier = barriers.length - 1;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index]!;
    while (barrier >= 0 && barriers[barrier]! > run.index) {
      nextByLength.clear();
      barrier -= 1;
    }
    const effectiveLength = run[0].length - (isEscaped(source, run.index) ? 1 : 0);
    const end = nextByLength.get(effectiveLength);
    if (effectiveLength > 0 && end !== undefined) result.set(run.index, end);
    nextByLength.set(run[0].length, run.index + run[0].length);
  }
  return result;
}

function indexOpaqueClosers(source: string): ReadonlyMap<string, readonly MaskedRange[]> {
  const result = new Map<string, MaskedRange[]>();
  for (const match of source.matchAll(/-->|%%|<\/(pre|script|style|textarea)\s*>/giu)) {
    const key = match[1]?.toLowerCase() ?? match[0];
    const ranges = result.get(key) ?? [];
    ranges.push({ start: match.index, end: match.index + match[0].length });
    result.set(key, ranges);
  }
  return result;
}

function nextOpaqueEnd(ranges: readonly MaskedRange[] | undefined, start: number): number | null {
  if (ranges === undefined) return null;
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle]!.start < start) low = middle + 1;
    else high = middle;
  }
  return ranges[low]?.end ?? null;
}

function findUnmaskedDelimiter(
  characters: readonly string[],
  source: string,
  delimiter: string,
  start: number,
): number {
  let cursor = start;
  while (cursor < source.length) {
    const index = source.indexOf(delimiter, cursor);
    if (index < 0) return -1;
    let unmasked = true;
    for (let offset = 0; offset < delimiter.length; offset += 1) {
      if (characters[index + offset] !== delimiter[offset]) {
        unmasked = false;
        break;
      }
    }
    if (unmasked) return index;
    cursor = index + delimiter.length;
  }
  return -1;
}

function maskInlineCodeAndComments(
  characters: string[],
  source: string,
  blockRanges: readonly MaskedRange[],
): void {
  const runs = [...source.matchAll(/`+/gu)].filter((run) => {
    const start = run.index;
    return start !== undefined && characters[start] === "`";
  });
  const runSegments: number[] = [];
  let blockRangeIndex = 0;
  for (const run of runs) {
    const start = run.index;
    if (start === undefined) continue;
    while (true) {
      const blockRange = blockRanges[blockRangeIndex];
      if (blockRange === undefined || blockRange.end > start) break;
      blockRangeIndex += 1;
    }
    runSegments.push(blockRangeIndex);
  }
  const nextMatchingRun: Array<number | null> = Array.from({ length: runs.length }, () => null);
  // An escaped first backtick is literal outside code. A longer run can
  // still open code with the remaining backticks, whereas a backslash
  // inside an already open code span does not escape its closing delimiter.
  const nextMatchingAfterEscapedFirst: Array<number | null> = Array.from({ length: runs.length }, () => null);
  const nextByLength = new Map<number, number>();
  const runIndexByStart = new Map<number, number>();
  let segment = -1;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run === undefined || run.index === undefined) continue;
    const runSegment = runSegments[index] ?? -1;
    if (runSegment !== segment) {
      nextByLength.clear();
      segment = runSegment;
    }
    const length = run[0].length;
    nextMatchingRun[index] = nextByLength.get(length) ?? null;
    if (length > 1) nextMatchingAfterEscapedFirst[index] = nextByLength.get(length - 1) ?? null;
    nextByLength.set(length, index);
    runIndexByStart.set(run.index, index);
  }

  let cursor = 0;
  while (cursor < source.length) {
    if (characters[cursor] !== source[cursor]) {
      cursor += 1;
      continue;
    }
    if (source.startsWith("%%", cursor)) {
      const closing = findUnmaskedDelimiter(characters, source, "%%", cursor + 2);
      if (closing < 0) {
        cursor += 2;
        continue;
      }
      maskRange(characters, cursor, closing + 2);
      cursor = closing + 2;
      continue;
    }
    if (source[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    const openingIndex = runIndexByStart.get(cursor);
    const opening = openingIndex === undefined ? undefined : runs[openingIndex];
    if (opening === undefined || openingIndex === undefined) {
      cursor += 1;
      continue;
    }
    let precedingBackslashes = 0;
    for (let at = cursor - 1; at >= 0 && source[at] === "\\"; at -= 1) {
      precedingBackslashes += 1;
    }
    const escapedFirst = precedingBackslashes % 2 === 1;
    const effectiveLength = opening[0].length - (escapedFirst ? 1 : 0);
    if (effectiveLength === 0) {
      cursor += opening[0].length;
      continue;
    }
    const closingIndex = escapedFirst
      ? nextMatchingAfterEscapedFirst[openingIndex]
      : nextMatchingRun[openingIndex];
    if (closingIndex == null) {
      cursor += opening[0].length;
      continue;
    }
    const closing = runs[closingIndex];
    if (closing === undefined || closing.index === undefined) {
      cursor += opening[0].length;
      continue;
    }
    const end = closing.index + closing[0].length;
    maskRange(characters, cursor + (escapedFirst ? 1 : 0), end);
    cursor = end;
  }
}

function scanLiteralHtmlTag(
  source: string,
  start: number,
  containers: readonly MarkdownContainer[],
  linesByStart: ReadonlyMap<number, SourceLineRange>,
): { readonly end: number; readonly valid: boolean } {
  let cursor = start + 1;
  const closing = source[cursor] === "/";
  if (closing) cursor += 1;
  while (/[A-Za-z0-9-]/u.test(source[cursor] ?? "")) cursor += 1;
  const inContainer = (): boolean => {
    const character = source[cursor];
    if (character !== "\n" && character !== "\r") return true;
    const nextStart = cursor + (character === "\r" && source[cursor + 1] === "\n" ? 2 : 1);
    const next = linesByStart.get(nextStart);
    return next === undefined || continuesContainers(source.slice(next.start, next.contentEnd), containers);
  };
  const whitespace = (): boolean => {
    while (/\s/u.test(source[cursor] ?? "")) {
      if (!inContainer()) return false;
      cursor += 1;
    }
    return true;
  };
  const invalid = () => ({ end: cursor, valid: false });
  while (cursor < source.length) {
    const beforeSpace = cursor;
    if (!whitespace()) return invalid();
    if (source[cursor] === ">") return { end: cursor + 1, valid: true };
    if (!closing && source.startsWith("/>", cursor)) return { end: cursor + 2, valid: true };
    if (closing || cursor === beforeSpace || !/[A-Za-z_:]/u.test(source[cursor] ?? "")) return invalid();
    cursor += 1;
    while (/[A-Za-z0-9_.:-]/u.test(source[cursor] ?? "")) cursor += 1;
    const afterName = cursor;
    if (!whitespace()) return invalid();
    if (source[cursor] !== "=") { cursor = afterName; continue; }
    cursor += 1;
    if (!whitespace()) return invalid();
    const quote = source[cursor];
    if (quote === "\"" || quote === "'") {
      cursor += 1;
      while (cursor < source.length && source[cursor] !== quote) {
        if (!inContainer()) return invalid();
        cursor += 1;
      }
      if (source[cursor] !== quote) return invalid();
      cursor += 1;
    } else {
      const valueStart = cursor;
      while (cursor < source.length && !/[\s"'=<>`]/u.test(source[cursor] ?? "")) cursor += 1;
      if (cursor === valueStart) return invalid();
    }
  }
  return invalid();
}

function htmlTagEnd(
  source: string,
  start: number,
  containers: readonly MarkdownContainer[],
  linesByStart: ReadonlyMap<number, SourceLineRange>,
): number {
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) { if (character === quote) quote = null; }
    else if (character === "\"" || character === "'") quote = character;
    else if (character === ">") return index + 1;
    if (character === "\n" || character === "\r") {
      const nextStart = index + (character === "\r" && source[index + 1] === "\n" ? 2 : 1);
      const next = linesByStart.get(nextStart);
      if (next !== undefined && !continuesContainers(source.slice(next.start, next.contentEnd), containers)) return nextStart;
    }
  }
  return source.length;
}

function maskYamlCommentRanges(
  characters: string[],
  source: string,
  start: number,
  end: number,
): void {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (character === "\n" || character === "\r") {
      quote = null;
      escaped = false;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote === '"') {
      escaped = true;
      continue;
    }
    if ((character === "'" || character === '"') && (quote == null || quote === character)) {
      quote = quote == null ? character : null;
      continue;
    }
    if (
      character === "#" &&
      quote == null &&
      (index === 0 || /[\s,:[\]{}]/u.test(source[index - 1] ?? ""))
    ) {
      const newline = source.indexOf("\n", index);
      const commentEnd = Math.min(newline < 0 ? end : newline, end);
      maskRange(characters, index, commentEnd);
      index = commentEnd - 1;
    }
  }
}

export function findMarkdownFrontmatterRange(source: string): MaskedRange | null {
  if (!/^[^\S\r\n]*---[^\S\r\n]*(?:[\r\n]|$)/u.test(source)) return null;
  const lines = sourceLineRanges(source);
  for (const line of lines.slice(1)) {
    const text = source.slice(line.start, line.contentEnd).trim();
    if (text === "---" || text === "...") {
      return { start: 0, end: line.end };
    }
  }
  return { start: 0, end: source.length };
}

interface SourceLineRange {
  readonly start: number;
  readonly contentEnd: number;
  readonly end: number;
}

function sourceLineRanges(source: string): SourceLineRange[] {
  const ranges: SourceLineRange[] = [];
  let start = 0;
  while (start < source.length) {
    let contentEnd = start;
    while (contentEnd < source.length && source[contentEnd] !== "\n" && source[contentEnd] !== "\r") {
      contentEnd += 1;
    }
    let end = contentEnd;
    if (source[end] === "\r" && source[end + 1] === "\n") end += 2;
    else if (source[end] === "\r" || source[end] === "\n") end += 1;
    ranges.push({ start, contentEnd, end });
    start = end;
  }
  if (source.length === 0) ranges.push({ start: 0, contentEnd: 0, end: 0 });
  return ranges;
}

function readWikiLinktext(content: string): string {
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") escaped = true;
    else if (character === "|") return content.slice(0, index);
  }
  return content;
}

function maskRange(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
  }
}

function unescapeMarkdownDestination(value: string): string {
  return value.replace(/\\([()<>\\])/gu, "$1");
}
