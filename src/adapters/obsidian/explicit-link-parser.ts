import { CST, isMap, isScalar, isSeq, parseDocument, Parser } from "yaml";
/*!
 * entities 7.0.1, BSD-2-Clause
 * Copyright (c) Felix Böhm. All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 * Redistributions of source code must retain the above copyright notice, this list
 * of conditions and the following disclaimer.
 * Redistributions in binary form must reproduce the above copyright notice, this
 * list of conditions and the following disclaimer in the documentation and/or other
 * materials provided with the distribution.
 * THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
 * OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
 * SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */
import { decodeHTMLStrict } from "entities/decode";

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

export interface MarkdownSyntaxRange {
  readonly start: number;
  readonly end: number;
  readonly kind: "metadata" | "code" | "comment" | "raw-html" | "frontmatter" | "math";
}

export function extractMarkdownExplicitReferences(
  source: string,
): readonly ParsedExplicitReference[] {
  return finishSteps(extractMarkdownSteps(source)).references;
}

type ReferenceLinkVisitor = (start: number, end: number, lines: readonly SourceLineRange[], destination: string) => void;

export async function parseMarkdownSourceAsync(
  source: string, scheduler = new WorkScheduler(), properties: "include" | "skip" = "include",
  visitReferenceLink?: ReferenceLinkVisitor,
) {
  const steps = extractMarkdownSteps(source, properties, visitReferenceLink);
  let step = steps.next();
  while (!step.done) {
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    step = steps.next();
  }
  return step.value;
}

function* extractMarkdownSteps(
  source: string, properties: "include" | "skip" = "include", visitReferenceLink?: ReferenceLinkVisitor,
) {
  const lines = yield* scanSourceLines(source);
  const linesByStart = new Map<number, SourceLineRange>();
  for (const [i, line] of lines.entries()) {
    if (i % 128 === 0) yield;
    linesByStart.set(line.start, line);
  }
  const frontmatter = yield* frontmatterFromLines(source, lines);
  const blocks = { lines, linesByStart, opaqueClosers: yield* indexOpaqueClosers(source), frontmatter,
    propertyValues: frontmatter === null || properties === "skip" ? [] : yield* yamlScalarRanges(source, frontmatter) };
  let destinations = yield* indexMarkdownDestinations(source);
  const definitions = new Map<string, string>();
  let syntax = source;
  // Definitions belong to blocks and may follow their uses. Establish their
  // source grammar before reference links can deactivate outer inline labels.
  if (source.includes(">") || source.includes("]:")) {
    const projection = source.split("");
    yield* maskMarkdownNonContent(source, blocks, destinations, source, definitions, projection);
    syntax = yield* joinMask(projection);
    if (syntax !== source) {
      destinations = yield* indexMarkdownDestinations(syntax);
      definitions.clear();
      yield* maskMarkdownNonContent(source, blocks, destinations, syntax, definitions, projection);
    }
  }
  const { masked, inline: established, frontmatterEnd, syntaxRanges } =
    yield* maskMarkdownNonContent(source, blocks, destinations, syntax, definitions, undefined, visitReferenceLink);
  const { wikiReferences, markdown } = yield* extractMarkdownLinks(source, masked, destinations, established, frontmatterEnd, blocks.propertyValues);
  const references: ParsedExplicitReference[] = [];
  let wiki = 0;
  let inline = 0;
  while (wiki < wikiReferences.length || inline < markdown.length) {
    const takeWiki = inline >= markdown.length || wiki < wikiReferences.length &&
      wikiReferences[wiki]!.startOffset <= markdown[inline]!.startOffset;
    references.push(takeWiki ? wikiReferences[wiki++]! : markdown[inline++]!);
    if (references.length % 128 === 0) yield;
  }
  return { references, inlineLinks: established, masked, syntaxRanges, frontmatterEnd, lines };
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
  let expectsOperand = true;
  let previousToken = "";
  while (index < formula.length) {
    const character = formula[index]!;
    if (/\s/u.test(character)) { index += 1; continue; }
    const followsDot = previousToken === ".";
    previousToken = character;
    if (character === "/" && expectsOperand) {
      index = skipFormulaRegex(formula, index);
      expectsOperand = false;
      continue;
    }
    if (character === "\"" || character === "'") {
      index = skipFormulaString(formula, index);
      expectsOperand = false;
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
        expectsOperand = false;
        continue;
      }
    }
    if (formula.startsWith("link", index) && !isFormulaIdentifierPart(formula[index - 1]) &&
      !followsDot) {
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
            expectsOperand = false;
            continue;
          }
        }
      }
    }
    // A slash after a value divides it. After an operator or an opening
    // delimiter it starts a regular expression, whose contents are literal.
    expectsOperand = "([,{:=!&|?<>+-*/%".includes(character);
    index += 1;
  }
  return references;
}

function skipFormulaRegex(formula: string, start: number): number {
  let inClass = false;
  for (let index = start + 1; index < formula.length; index += 1) {
    const character = formula[index];
    if (character === "\\") { index += 1; continue; }
    if (character === "[") inClass = true;
    else if (character === "]") inClass = false;
    else if (character === "/" && !inClass) {
      let end = index + 1;
      while (/[a-z]/iu.test(formula[end] ?? "")) end += 1;
      return end;
    }
  }
  return formula.length;
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
    /^[a-z][a-z\d+.-]*:/iu.test(candidate)
  );
}

function* extractMarkdownLinks(
  source: string,
  masked: string,
  destinations: MarkdownDestinationIndex,
  inline: ReadonlyMap<number, ParsedExplicitReference>,
  frontmatterEnd: number,
  propertyValues: readonly MaskedRange[],
): Generator<void, { wikiReferences: ParsedExplicitReference[]; markdown: ParsedExplicitReference[] }> {
  const wikiReferences: ParsedExplicitReference[] = [];
  const markdown: ParsedExplicitReference[] = [];
  // Each YAML value has its own inline syntax. The last region is the Markdown body.
  for (let region = 0; region <= propertyValues.length; region += 1) {
    if (region % 128 === 0) yield;
    const property = propertyValues[region];
    const end = property?.end ?? masked.length;
    const labelStack: number[] = [];
    let index = property?.start ?? frontmatterEnd;
    while (index < end) {
      if (index % 1024 === 0) yield;
      const established = inline.get(index);
      if (established !== undefined) markdown.push(established);
      const character = masked[index];
      if (character === "\n" || character === "\r") {
        const nextLine = index + (character === "\r" && masked[index + 1] === "\n" ? 2 : 1);
        if (/[\r\n]/u.test(masked[destinations.afterWhitespace[nextLine]!] ?? "")) labelStack.length = 0;
        index += 1;
        continue;
      }
      if (character === "\\") {
        index += Math.min(2, masked.length - index);
        continue;
      }
      const embeddedWiki = character === "!" && masked[index + 1] === "[" && masked[index + 2] === "[";
      const opening = embeddedWiki ? index + 1 : index;
      if (masked[opening] === "[" && masked[opening + 1] === "[") {
        const closing = yield* findWikiClosing(masked, opening + 2, end);
        if (closing < 0) { index = opening + 1; continue; }
        const linktext = readWikiLinktext(source.slice(opening + 2, closing)).trim();
        if (linktext.length > 0) wikiReferences.push({ raw: source.slice(index, closing + 2),
          linktext, embedded: embeddedWiki, startOffset: index, endOffset: closing + 2 });
        index = closing + 2;
        continue;
      }
      if (property === undefined) { index += 1; continue; }
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
      const parsedDestination = readMarkdownDestination(source, index + 2, destinations);
      if (parsedDestination === null || parsedDestination.linkEnd > end) {
        index += 1;
        continue;
      }
      const reference = markdownReference(source, labelStart, parsedDestination);
      if (reference.linktext.length > 0) markdown.push(reference);
      if (!reference.embedded) labelStack.length = 0;
      index = parsedDestination.linkEnd;
    }
  }
  return { wikiReferences, markdown };
}

// An unfinished opener must release the following Markdown. Stopping at the
// next opener also bounds total lookahead on a line of unfinished tokens.
function* findWikiClosing(source: string, start: number, end: number,
  literalAt?: (offset: number) => InlineLiteral | null): Generator<void, number> {
  for (let index = start; index + 1 < end; index += 1) {
    if (index % 1024 === 0) yield;
    const character = source[index];
    if (character === "\n" || character === "\r") return -1;
    if (character === "\\") {
      if (source[index + 1] === "\n" || source[index + 1] === "\r") return -1;
      index += 1;
      continue;
    }
    if (literalAt && (character === "`" || character === "%" || character === "<")) {
      const literal = literalAt(index);
      if (literal !== null) { index = literal.end - 1; continue; }
    }
    if (character === "[" && source[index + 1] === "[") return -1;
    if (character === "]" && source[index + 1] === "]") return index;
  }
  return -1;
}

function readMarkdownDestination(
  source: string,
  start: number,
  boundaries: MarkdownDestinationIndex,
): MarkdownDestination | null {
  const skipSpace = (from: number): number => {
    let index = boundaries.afterWhitespace[from]!;
    if (source[index] === "\n" || source[index] === "\r") {
      index += source[index] === "\r" && source[index + 1] === "\n" ? 2 : 1;
      index = boundaries.afterWhitespace[index]!;
    }
    return index;
  };
  const destinationStart = skipSpace(start);
  const closing = boundaries.closing[destinationStart]!;
  const destinationEnd = source[destinationStart] === "<"
    ? closing < 0 ? -1 : closing + 1
    : boundaries.bareEnd[destinationStart]!;
  if (destinationEnd < 0) return null;
  let index = skipSpace(destinationEnd);
  const quote = source[index];
  if (index > destinationEnd && /["'(]/u.test(quote ?? "")) {
    const titleEnd = boundaries.closing[index]!;
    if (titleEnd < 0) return null;
    index = skipSpace(titleEnd + 1);
  }
  if (source[index] !== ")") return null;
  return { destinationStart, destinationEnd, linkEnd: index + 1 };
}

interface MarkdownDestination {
  readonly destinationStart: number;
  readonly destinationEnd: number;
  readonly linkEnd: number;
}

function markdownReference(source: string, label: number, destination: MarkdownDestination): ParsedExplicitReference {
  const embedded = isEmbedded(source, label);
  const startOffset = embedded ? label - 1 : label;
  return { raw: source.slice(startOffset, destination.linkEnd), embedded, startOffset,
    endOffset: destination.linkEnd,
    linktext: unescapeMarkdownDestination(source.slice(destination.destinationStart, destination.destinationEnd)
      .replace(/^<|>$/gu, "").trim()) };
}

export function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function isEmbedded(source: string, start: number): boolean {
  return source[start - 1] === "!" && !isEscaped(source, start - 1);
}

/** Same-length UTF-16 mask shared by fallback parsing and positioned cache filtering. */
interface BlockIndex {
  lines: SourceLineRange[];
  linesByStart: ReadonlyMap<number, SourceLineRange>;
  opaqueClosers: ReadonlyMap<string, readonly MaskedRange[]>;
  frontmatter: MaskedRange | null;
  propertyValues: readonly MaskedRange[];
}

function* maskMarkdownNonContent(source: string, blocks: BlockIndex, destinations: MarkdownDestinationIndex,
  syntax: string, definitions: Map<string, string>, projection?: string[], visitReferenceLink?: ReferenceLinkVisitor) {
  // Every offset used by RegExp, indexOf, and slice is a UTF-16 code-unit offset.
  // Keep the mask indexed in the same coordinate system; spreading a string
  // collapses surrogate pairs and shifts every later mask range.
  const characters = source.split("");
  const inline = new Map<number, ParsedExplicitReference>();
  const syntaxRanges: MarkdownSyntaxRange[] = [];
  const frontmatterRange = blocks.frontmatter;
  if (frontmatterRange !== null) {
    syntaxRanges.push({ ...frontmatterRange, kind: "frontmatter" });
    let gapStart = frontmatterRange.start;
    for (const value of blocks.propertyValues) {
      yield* maskGap(characters, gapStart, value.start);
      gapStart = value.end;
    }
    yield* maskGap(characters, gapStart, frontmatterRange.end);
  }
  yield* maskDelimitedBlocks(characters, source, blocks, frontmatterRange, destinations, inline,
    syntax, definitions, syntaxRanges, projection, visitReferenceLink);
  const masked = projection === undefined ? yield* joinMask(characters) : "";
  return { masked, inline, syntaxRanges, frontmatterEnd: frontmatterRange?.end ?? 0 };
}

function* maskGap(characters: string[], start: number, end: number): Generator<void, void> {
  for (let offset = start; offset < end; offset += 4096) {
    yield;
    maskRange(characters, offset, Math.min(offset + 4096, end));
  }
}

function* joinMask(characters: string[]): Generator<void, string> {
  const pieces: string[] = [];
  for (let i = 0; i < characters.length; i += 8192) {
    if (i > 0) yield;
    pieces.push(characters.slice(i, i + 8192).join(""));
  }
  return pieces.join("");
}

interface MaskedRange {
  readonly start: number;
  readonly end: number;
}

interface InlineLiteral {
  readonly kind: "code" | "comment" | "raw-html" | "tag";
  readonly end: number;
}

function* maskDelimitedBlocks(
  characters: string[],
  source: string,
  blocks: BlockIndex,
  frontmatter: MaskedRange | null,
  destinations: MarkdownDestinationIndex,
  inline: Map<number, ParsedExplicitReference>,
  syntax: string,
  definitions: Map<string, string>,
  syntaxRanges: MarkdownSyntaxRange[],
  projection?: string[],
  visitReferenceLink?: ReferenceLinkVisitor,
): Generator<void, void> {
  let fence: {
    readonly character: string;
    readonly length: number;
    readonly start: number;
    readonly containers: readonly MarkdownContainer[];
  } | null = null;
  let opaque: { readonly start: number; readonly end: number; readonly containers: readonly MarkdownContainer[];
    readonly kind: "comment" | "raw-html" } | null = null;
  let containers: readonly MarkdownContainer[] = [];
  let indentedCode = false;
  let paragraph = false;
  let paragraphBody = false;
  let emptyItemDepth = 0;
  let definitionEnd = 0;
  let inlineEnd = 0;
  let literalTagEnd = 0;
  const labels: { offset: number; image: boolean; epoch: number }[] = [];
  // A successful ordinary link invalidates every older ordinary opener in O(1),
  // including openers behind image labels. Images remain eligible across epochs.
  let linkEpoch = 0;
  let paragraphEnd = 0;
  const { lines, linesByStart, opaqueClosers } = blocks;
  const inlineClosers = source.includes("`")
    ? yield* indexInlineCodeClosers(frontmatter === null ? source : yield* joinMask(characters))
    : new Map<number, number>();
  const rawOpening = /<(pre|script|style|textarea)(?=[\s>])/iyu;
  const mask = function* (start: number, end: number, kind: MarkdownSyntaxRange["kind"] = "code") {
    for (let offset = start; offset < end; offset += 4096) {
      if (offset > start) yield;
      maskRange(characters, offset, Math.min(offset + 4096, end));
    }
    syntaxRanges.push({ start, end, kind });
  };
  for (const value of blocks.propertyValues) {
    for (let cursor = value.start; cursor < value.end; cursor += 1) {
      if (cursor % 1024 === 0) yield;
      const commentEnd = source.startsWith("%%", cursor)
        ? nextOpaqueEnd(opaqueClosers.get("%%"), cursor + 2) : null;
      const end = commentEnd ?? inlineClosers.get(cursor) ?? 0;
      if (end > cursor && end <= value.end) {
        yield* mask(cursor + (commentEnd === null && isEscaped(source, cursor) ? 1 : 0), end);
        cursor = end - 1;
      }
    }
  }
  const inlineBoundary = function* (lineIndex: number, text: string): Generator<void, number> {
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/u.test(text)) {
      paragraphEnd = lines[lineIndex]!.contentEnd;
      return paragraphEnd;
    }
    if (paragraphEnd <= lines[lineIndex]!.start) {
      paragraphEnd = source.length;
      for (let next = lineIndex + 1; next < lines.length; next += 1) {
        if (next % 128 === 0) yield;
        const following = lines[next]!;
        const content = normalizeMarkdownContainerLine(source.slice(following.start, following.contentEnd), containers, true);
        if (content.opensContainer || content.text.trim().length === 0 || startsMarkdownBlock(content.text) || isSetextUnderline(content.text)) {
          paragraphEnd = following.start;
          break;
        }
      }
    }
    return paragraphEnd;
  };
  for (const [lineIndex, line] of lines.entries()) {
    if (lineIndex % 64 === 0) yield;
    if (frontmatter !== null && line.start < frontmatter.end) continue;
    if (line.start < definitionEnd) continue;
    const text = source.slice(line.start, line.contentEnd);
    if (projection !== undefined) {
      const content = normalizeMarkdownContainerLine(text, containers, paragraph);
      const prefixColumns = expandMarkdownTabs(text).length - content.text.length;
      let column = 0;
      for (let offset = 0; offset < text.length && column < prefixColumns; offset += 1) {
        column += text[offset] === "\t" ? 4 - column % 4 : 1;
        projection[line.start + offset] = " ";
      }
    }
    let cursor = line.start;
    if (opaque !== null) {
      if (!continuesContainers(text, opaque.containers)) {
        yield* mask(opaque.start, line.start, opaque.kind);
        opaque = null;
      } else if (opaque.end > line.end) continue;
      else {
        cursor = opaque.end;
        yield* mask(opaque.start, opaque.end, opaque.kind);
        opaque = null;
      }
    }
    if (fence !== null) {
      if (continuesContainers(text, fence.containers)) {
        const content = stripMarkdownContainers(expandMarkdownTabs(text), fence.containers).text;
        const closing = content === null ? undefined : fence.character === "$"
          ? /^[^$]*(\$+)[ ]*$/u.exec(content)?.[1]
          : /^ {0,3}(`+|~+)[ \t]*$/u.exec(content)?.[1];
        if (closing !== undefined && closing[0] === fence.character && closing.length >= fence.length) {
          yield* mask(fence.start, line.end, fence.character === "$" ? "math" : "code");
          fence = null;
        }
        continue;
      }
      yield* mask(fence.start, line.start, fence.character === "$" ? "math" : "code");
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
    if (line.start >= paragraphEnd) labels.length = 0;
    if (startsMarkdownBlock(normalized.text) || isSetextUnderline(normalized.text)) labels.length = 0;
    // A lazy paragraph continuation can omit its quote/list prefixes. Keep that
    // stack for a later indented continuation, but never carry it across a blank
    // or a new block. Code cannot interrupt the paragraph itself.
    const lazy = !continues && paragraph && !blank && !normalized.opensContainer &&
      !startsMarkdownBlock(normalized.text);
    if ((!continues && !lazy) || normalized.opensContainer) {
      labels.length = 0;
      indentedCode = false;
      paragraph = false;
      paragraphBody = false;
      emptyItemDepth = 0;
    }
    if (!lazy) containers = normalized.containers;
    const indented = normalized.text.startsWith("    ");
    if (!blank && indented && (indentedCode || !paragraph) && cursor === line.start) {
      labels.length = 0;
      indentedCode = true;
      paragraph = false;
      paragraphBody = false;
      emptyItemDepth = 0;
      yield* mask(line.start, line.contentEnd);
      continue;
    }
    if (!blank) indentedCode = false;
    // The marker itself is the first blank line of an empty list item. A second
    // blank closes it; populated items can contain any number of blank lines.
    if (blank) {
      labels.length = 0;
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
      }, definitions);
      if (definitionLines > 0) {
        definitionEnd = lines[lineIndex + definitionLines - 1]!.end;
        // Definitions are metadata, not inline content. Their labels, titles and
        // literal delimiters must not create links or change following syntax.
        yield* mask(line.start, definitionEnd, "metadata");
        cursor = definitionEnd;
      }
    }
    const boundary = yield* inlineBoundary(lineIndex, normalized.text);
    // Definitions remain in the open paragraph until it closes. Only the body
    // left after stripping its leading definitions can become a setext heading.
    paragraph = !blank && !startsMarkdownBlock(normalized.text) &&
      !(paragraph && paragraphBody && continues && isSetextUnderline(normalized.text));
    paragraphBody = paragraph && definitionLines === 0;
    const rawStart = /^ {0,3}<(?:pre|script|style|textarea)(?=[\s>]|$)/iu.test(normalized.text)
      ? line.start + text.indexOf("<") : -1;
    const opening = cursor === line.start ? /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/u.exec(normalized.text) : null;
    const mathFence = cursor === line.start && line.end > line.contentEnd
      ? /^ {0,3}(\${2,})[^$]*$/u.exec(normalized.text)?.[1] : undefined;
    const delimiter = opening?.[1] ?? mathFence;
    if (delimiter !== undefined && !(delimiter[0] === "`" && opening?.[2]?.includes("`"))) {
      labels.length = 0;
      fence = { character: delimiter[0] ?? "", length: delimiter.length, start: line.start, containers };
      inlineEnd = 0;
      paragraph = false;
      continue;
    }
    // Recognize opaque syntax in source order so fences inside comments/raw HTML
    // and HTML openers inside code spans never become a second active block.
    const literalAt = (offset: number): InlineLiteral | null => {
      if (source.startsWith("<!--", offset) && !isEscaped(source, offset)) {
        const end = source.startsWith("<!-->", offset) ? offset + 5
          : source.startsWith("<!--->", offset) ? offset + 6
            : nextOpaqueEnd(opaqueClosers.get("-->"), offset + 4) ?? source.length;
        return { kind: "comment", end };
      }
      if (source.startsWith("%%", offset)) {
        const end = nextOpaqueEnd(opaqueClosers.get("%%"), offset + 2);
        if (end !== null) return { kind: "comment", end };
      }
      if (source[offset] === "<" && !isEscaped(source, offset)) {
        rawOpening.lastIndex = offset;
        const name = offset === rawStart ? rawOpening.exec(source)?.[1]?.toLowerCase() : undefined;
        if (name !== undefined) {
          const openingEnd = htmlTagEnd(source, rawOpening.lastIndex, containers, linesByStart);
          return { kind: "raw-html", end: nextOpaqueEnd(opaqueClosers.get(name), openingEnd) ?? source.length };
        }
        if (/^\/?[A-Za-z]/u.test(source.slice(offset + 1, offset + 3))) {
          const tag = scanLiteralHtmlTag(source, offset, containers, linesByStart);
          if (tag.valid) return { kind: "tag", end: tag.end };
        }
      }
      const end = inlineClosers.get(offset);
      return end !== undefined && end <= boundary ? { kind: "code", end } : null;
    };
    let wikiEnd = 0;
    let checkpointOffset = cursor + 1024;
    while (cursor < line.contentEnd) {
      if (cursor >= checkpointOffset) {
        yield;
        checkpointOffset = cursor + 1024;
      }
      if (cursor < inlineEnd) { cursor = inlineEnd; continue; }
      if (characters[cursor] !== source[cursor]) { cursor += 1; continue; }
      const literal = literalAt(cursor);
      if (literal !== null) {
        const { end, kind } = literal;
        if (kind === "tag") {
          yield* mask(cursor, end, "raw-html");
          literalTagEnd = end;
        } else if (kind === "code") {
          yield* mask(cursor + (isEscaped(source, cursor) ? 1 : 0), end);
          inlineEnd = end;
        } else if (end > line.end) {
          opaque = { start: cursor, end, containers, kind };
          break;
        } else yield* mask(cursor, end, kind);
        cursor = end;
        continue;
      }
      if (source[cursor] === "\\" && source[cursor + 1] !== "`") { cursor += 2; continue; }
      if (cursor < wikiEnd) { cursor += 1; continue; }
      if (source.startsWith("[[", cursor)) {
        const closing = yield* findWikiClosing(source, cursor + 2, line.contentEnd, literalAt);
        if (closing >= 0) { wikiEnd = closing + 2; cursor += 2; continue; }
      }
      if (source[cursor] === "$") {
        const double = source[cursor + 1] === "$";
        const width = double ? 2 : 1;
        const canOpen = double || !/[ \t]/u.test(source[cursor + 1] ?? "");
        const close = canOpen ? nextOpaqueEnd(opaqueClosers.get(double ? "$$" : "$"), cursor + width) : null;
        if (close !== null && close <= boundary) {
          yield* mask(cursor, close, "math");
          inlineEnd = close;
        }
        cursor += width;
        continue;
      }
      if (source[cursor] === "[") {
        labels.push({ offset: cursor, image: isEmbedded(source, cursor), epoch: linkEpoch });
      }
      if (source[cursor] === "]") {
        const opening = labels.pop();
        if (opening === undefined || !opening.image && opening.epoch !== linkEpoch) { cursor += 1; continue; }
        let destination = source[cursor + 1] === "("
          ? readMarkdownDestination(syntax, cursor + 2, destinations) : null;
        if (destination !== null && destination.linkEnd > boundary) destination = null;
        if (destination !== null) {
          // Only an established link outside code/comments makes its metadata
          // literal. Keep label content and invalid outer syntax as body text.
          yield* mask(cursor + 2, destination.linkEnd - 1, "metadata");
          const reference = markdownReference(source, opening.offset, destination);
          if (reference.linktext.length > 0) inline.set(reference.startOffset, reference);
          literalTagEnd = destination.linkEnd;
          if (!opening.image) linkEpoch += 1;
          cursor = destination.linkEnd;
          continue;
        }
        // Reference syntax affects outer link validity without replacing the
        // host's reference-style target interpretation or fallback contract.
        const following = source[cursor + 1] === "["
          ? /^\[((?:\\.|[^[\]\\]){0,999})\]/su.exec(syntax.slice(cursor + 1, boundary)) : null;
        const label = following?.[1] || (cursor - opening.offset <= 1000 ? syntax.slice(opening.offset + 1, cursor) : "");
        const definition = projection === undefined && label && label.length <= 999
          ? definitions.get(normalizeReferenceLabel(label)) : undefined;
        if (definition !== undefined) {
          const end = cursor + 1 + (following?.[0].length ?? 0);
          visitReferenceLink?.(opening.offset - (opening.image ? 1 : 0), end, blocks.lines, definition);
          if (!opening.image) linkEpoch += 1;
          if (following !== null) {
            syntaxRanges.push({ start: cursor + 1, end, kind: "metadata" });
            cursor = end;
            continue;
          }
        }
      }
      cursor += 1;
    }
  }
  if (fence !== null) yield* mask(fence.start, source.length, fence.character === "$" ? "math" : "code");
  if (opaque !== null) yield* mask(opaque.start, source.length, opaque.kind);
}

function startsMarkdownBlock(text: string): boolean {
  return /^ {0,3}(?:#{1,6}(?:[ \t]|$)|`{3,}[^`]*$|~{3,}|(?:\* *){3,}$|(?:_ *){3,}$|(?:- *){3,}$|<(?:pre|script|style|textarea)(?=[\s>]|$)|<!--)/iu.test(text);
}

function normalizeReferenceLabel(value: string): string {
  return value.trim().replace(/[ \t\r\n]+/gu, " ").toLowerCase().toUpperCase();
}

function isSetextUnderline(text: string): boolean {
  return /^ {0,3}(?:=+|-+) *$/u.test(text);
}

/** Leading definitions supply no setext body. Read only their needed lines. */
function referenceDefinitionLines(first: string, readLine: () => string | null, definitions: Map<string, string>): number {
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
  const destination = text.slice(angle ? start + 1 : start, angle ? end - 1 : end);
  const complete = (count: number): number => {
    if (count > 0) {
      const key = normalizeReferenceLabel(label[1]!);
      if (!definitions.has(key)) definitions.set(key, destination);
    }
    return count;
  };
  while (text[cursor] === " ") cursor += 1;
  const sameLine = cursor < text.length;
  if (!sameLine) {
    if (!append()) return complete(destinationLines);
    cursor += /^\n */u.exec(text.slice(cursor))![0].length;
  } else if (cursor === end) return 0;
  const opening = text[cursor];
  const closing = opening === "(" ? ")" : opening;
  const fallback = sameLine ? 0 : destinationLines;
  if (opening !== '"' && opening !== "'" && opening !== "(") return complete(fallback);
  cursor += 1;
  for (;;) {
    if (cursor === text.length) {
      text = "";
      cursor = 0;
      if (!append()) return complete(fallback);
    }
    const character = text[cursor++];
    if (character === "\\" && /[!-/:-@[-`{-~]/u.test(text[cursor] ?? "")) { cursor += 1; continue; }
    if (character === closing) return complete(text.slice(cursor).trim().length === 0 ? lines : fallback);
    if (opening === "(" && character === "(") return complete(fallback);
  }
}

function continuesContainers(text: string, containers: readonly MarkdownContainer[]): boolean {
  const stripped = stripMarkdownContainers(expandMarkdownTabs(text), containers);
  if (stripped.text !== null) return true;
  // A blank list continuation may omit indentation; a quote must retain its marker.
  return stripped.remainder.trim().length === 0 && !containers.slice(stripped.consumed.length).includes("quote");
}

function* indexInlineCodeClosers(source: string): Generator<void, ReadonlyMap<number, number>> {
  const runs = [];
  for (const run of source.matchAll(/`+/gu)) {
    runs.push(run);
    if (runs.length % 128 === 0) yield;
  }
  const nextByLength = new Map<number, number>();
  const result = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    if (index % 128 === 0) yield;
    const run = runs[index]!;
    const effectiveLength = run[0].length - (isEscaped(source, run.index) ? 1 : 0);
    const end = nextByLength.get(effectiveLength);
    if (end !== undefined) result.set(run.index, end);
    nextByLength.set(run[0].length, run.index + run[0].length);
  }
  return result;
}

function* indexOpaqueClosers(source: string): Generator<void, ReadonlyMap<string, readonly MaskedRange[]>> {
  const result = new Map<string, MaskedRange[]>();
  for (const match of source.matchAll(/-->|%%|<\/(pre|script|style|textarea)\s*>/giu)) {
    const key = match[1]?.toLowerCase() ?? match[0];
    const ranges = result.get(key) ?? [];
    ranges.push({ start: match.index, end: match.index + match[0].length });
    if (ranges.length % 128 === 0) yield;
    result.set(key, ranges);
  }
  // Index each eligible closing dollar once; unmatched openers must not repeatedly scan a paragraph.
  const single: MaskedRange[] = [];
  const double: MaskedRange[] = [];
  let dollars = 0;
  for (const match of source.matchAll(/\$/gu)) {
    if (++dollars % 128 === 0) yield;
    const offset = match.index;
    if (isEscaped(source, offset)) continue;
    if (!/[ \t]/u.test(source[offset - 1] ?? "") && !/[0-9]/u.test(source[offset + 1] ?? "")) {
      single.push({ start: offset, end: offset + 1 });
    }
    if (source[offset + 1] === "$") double.push({ start: offset, end: offset + 2 });
  }
  result.set("$", single);
  result.set("$$", double);
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

interface FrontmatterRange extends MaskedRange {
  readonly contentStart: number;
  readonly contentEnd: number;
}

/** Only source text inside YAML scalar values can contribute property links. */
function* yamlScalarRanges(source: string, region: FrontmatterRange): Generator<void, MaskedRange[]> {
  const yaml = source.slice(region.contentStart, region.contentEnd).replace(/\r(?!\n)/gu, "\n");
  // No source link can start here. Avoid parsing normal link-free metadata.
  if (!yaml.includes("[")) return [];
  // We need source ranges only. Feeding the YAML concrete-syntax parser in
  // slices avoids composing an entire document just to rediscover those ranges.
  const parser = new Parser();
  const pending: CST.Token[] = [];
  for (let offset = 0; offset < yaml.length; offset += 2048) {
    const end = Math.min(offset + 2048, yaml.length);
    for (const token of parser.parse(yaml.slice(offset, end), end < yaml.length)) {
      if (token.type === "document") {
        const root = token.value;
        if (root?.type === "block-map" || root?.type === "flow-collection" && root.start.type === "flow-map-start") {
          pending.push(root);
        }
      }
    }
    yield;
  }
  const values: MaskedRange[] = [];
  let visited = 0;
  // Keep only mapping values and sequence entries, in source order. Tags,
  // aliases, keys and actual comments remain outside scalar content ranges.
  while (pending.length > 0) {
    const token = pending.pop()!;
    if (++visited % 128 === 0) yield;
    if (CST.isCollection(token)) {
      for (let i = token.items.length - 1; i >= 0; i -= 1) {
        if (i % 256 === 0) yield;
        const value = token.items[i]!.value;
        if (value) pending.push(value);
      }
    } else if (CST.isScalar(token)) {
      let start = region.contentStart + token.offset;
      if (token.type === "block-scalar") {
        const last = token.props.at(-1);
        if (last?.type !== "newline") continue;
        start = region.contentStart + last.offset + last.source.length;
      }
      if (token.source.includes("[")) values.push({ start, end: start + token.source.length });
    }
  }
  return values;
}

const frontmatterOpening = /^(?:\uFEFF)?---[ \t]*(?:[\r\n]|$)/u;

function* frontmatterFromLines(source: string, lines: SourceLineRange[]): Generator<void, FrontmatterRange | null> {
  if (!frontmatterOpening.test(source)) return null;
  for (let i = 1; i < lines.length; i += 1) {
    if (i % 128 === 0) yield;
    const line = lines[i]!;
    if (/^(?:---|\.\.\.)[ \t]*$/u.test(source.slice(line.start, line.contentEnd))) {
      return { start: 0, end: line.end, contentStart: lines[0]!.end, contentEnd: line.start };
    }
  }
  return null;
}

export interface SourceLineRange {
  readonly start: number;
  readonly contentEnd: number;
  readonly end: number;
}

function finishSteps<T>(steps: Generator<void, T>): T {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Editor coordinates include the empty line following a final line break. */
export function sourceLineStarts(source: string | readonly SourceLineRange[]): number[] {
  if (typeof source === "string") {
    const starts = [0];
    for (const match of source.matchAll(/\r\n|\r|\n/gu)) starts.push(match.index + match[0].length);
    return starts;
  }
  const lines = source;
  const starts = lines.map((line) => line.start);
  const last = lines.at(-1);
  if (last !== undefined && last.end > last.contentEnd) starts.push(last.end);
  return starts;
}

function* scanSourceLines(source: string): Generator<void, SourceLineRange[]> {
  const ranges: SourceLineRange[] = [];
  let start = 0;
  while (start < source.length) {
    if (ranges.length % 128 === 0) yield;
    let contentEnd = start;
    while (contentEnd < source.length && source[contentEnd] !== "\n" && source[contentEnd] !== "\r") {
      contentEnd += 1;
      if (contentEnd % 4096 === 0) yield;
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
  const separator = content.indexOf("|");
  if (separator < 0) return content;
  // Obsidian accepts both | and the table spelling \| as alias separators.
  const end = content[separator - 1] === "\\" ? separator - 1 : separator;
  return content.slice(0, end);
}

export function maskRange(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
  }
}

export function unescapeMarkdownDestination(value: string): string {
  // Decode at the Markdown destination boundary, in one lexical pass. An
  // escaped ampersand or a decoded backslash must not start a second escape.
  return value.replace(/\\([!-/:-@[-`{-~])|&(?:#[xX][\da-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z\d]*);/gu,
    (token, escaped: string | undefined) => escaped ?? decodeMarkdownEntity(token));
}

function decodeMarkdownEntity(token: string): string {
  if (token[1] !== "#") return decodeHTMLStrict(token);
  const hexadecimal = token[2] === "x" || token[2] === "X";
  const codepoint = Number.parseInt(token.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
  // CommonMark uses Unicode code points, without HTML's legacy C1 remapping.
  return String.fromCodePoint(codepoint === 0 || codepoint > 0x10ffff ||
    codepoint >= 0xd800 && codepoint <= 0xdfff ? 0xfffd : codepoint);
}
