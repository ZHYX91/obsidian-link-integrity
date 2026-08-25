export interface ParsedExplicitReference {
  readonly raw: string;
  readonly linktext: string;
  readonly embedded: boolean;
  readonly startOffset: number;
  readonly endOffset: number;
}

const WIKI_LINK = /(!)?\[\[([^\]\n]+)\]\]/gu;
const BASES_LINK_FUNCTION = /\blink\(\s*(["'])((?:\\.|(?!\1)[^\\\r\n])*)\1(?:\s*,[^\r\n)]*)?\)/gu;

export function extractMarkdownExplicitReferences(
  source: string,
): readonly ParsedExplicitReference[] {
  const masked = maskMarkdownNonContent(source);
  const references: ParsedExplicitReference[] = [];
  for (const match of masked.matchAll(WIKI_LINK)) {
    const startOffset = match.index;
    const raw = source.slice(startOffset, startOffset + match[0].length);
    const wikiContent = source.slice(
      startOffset + (match[1] == null ? 2 : 3),
      startOffset + match[0].length - 2,
    );
    const linktext = readWikiLinktext(wikiContent).trim();
    if (linktext.length > 0) {
      references.push({
        raw,
        linktext,
        embedded: match[1] != null,
        startOffset,
        endOffset: startOffset + match[0].length,
      });
    }
  }
  references.push(...extractInlineMarkdownLinks(source, masked));
  return references.sort((left, right) => left.startOffset - right.startOffset);
}

export function extractBasesExplicitReferences(
  source: string,
): readonly ParsedExplicitReference[] {
  const withoutComments = maskYamlComments(source);
  const references = [...extractMarkdownExplicitReferences(withoutComments)];
  for (const match of withoutComments.matchAll(BASES_LINK_FUNCTION)) {
    const startOffset = match.index;
    const encoded = match[2];
    if (encoded == null) continue;
    const linktext = unescapeQuotedValue(encoded).trim();
    if (linktext.length === 0) continue;
    references.push({
      raw: source.slice(startOffset, startOffset + match[0].length),
      linktext,
      embedded: false,
      startOffset,
      endOffset: startOffset + match[0].length,
    });
  }
  return deduplicateReferences(references).sort(
    (left, right) => left.startOffset - right.startOffset,
  );
}

export function isExternalReference(linktext: string): boolean {
  const candidate = linktext.trim();
  return (
    candidate.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/iu.test(candidate) ||
    candidate.startsWith("data:")
  );
}

function extractInlineMarkdownLinks(
  source: string,
  masked: string,
): ParsedExplicitReference[] {
  const references: ParsedExplicitReference[] = [];
  for (let index = 0; index < masked.length; index += 1) {
    const embedded = masked[index] === "!" && masked[index + 1] === "[";
    const labelStart = embedded ? index + 1 : index;
    if (masked[labelStart] !== "[" || masked[labelStart + 1] === "[") continue;
    const labelEnd = findUnescaped(masked, "]", labelStart + 1);
    if (labelEnd < 0 || masked[labelEnd + 1] !== "(") continue;
    const parsedDestination = readMarkdownDestination(masked, labelEnd + 2);
    if (parsedDestination == null) continue;
    const linktext = source
      .slice(parsedDestination.destinationStart, parsedDestination.destinationEnd)
      .replace(/^<|>$/gu, "")
      .trim();
    if (linktext.length > 0) {
      references.push({
        raw: source.slice(index, parsedDestination.linkEnd),
        linktext: unescapeMarkdownDestination(linktext),
        embedded,
        startOffset: index,
        endOffset: parsedDestination.linkEnd,
      });
    }
    index = parsedDestination.linkEnd - 1;
  }
  return references;
}

function readMarkdownDestination(
  source: string,
  start: number,
): { destinationStart: number; destinationEnd: number; linkEnd: number } | null {
  let index = start;
  while (source[index] === " " || source[index] === "\t") index += 1;
  const destinationStart = index;
  if (source[index] === "<") {
    const closing = findUnescaped(source, ">", index + 1);
    if (closing < 0) return null;
    index = closing + 1;
  } else {
    let depth = 0;
    for (; index < source.length; index += 1) {
      const character = source[index];
      if (character === "\\") {
        index += 1;
        continue;
      }
      if (character === "(" && depth < 1) {
        depth += 1;
        continue;
      }
      if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
        continue;
      }
      if ((character === " " || character === "\t") && depth === 0) break;
      if (character === "\n" || character === "\r") return null;
    }
  }
  const destinationEnd = index;
  while (source[index] === " " || source[index] === "\t") index += 1;
  const quote = source[index];
  if (quote === '"' || quote === "'") {
    const titleEnd = findUnescaped(source, quote, index + 1);
    if (titleEnd < 0) return null;
    index = titleEnd + 1;
    while (source[index] === " " || source[index] === "\t") index += 1;
  }
  if (source[index] !== ")") return null;
  return { destinationStart, destinationEnd, linkEnd: index + 1 };
}

function maskMarkdownNonContent(source: string): string {
  // Every offset used by RegExp, indexOf, and slice is a UTF-16 code-unit offset.
  // Keep the mask indexed in the same coordinate system; spreading a string
  // collapses surrogate pairs and shifts every later mask range.
  const characters = source.split("");
  const fencedRanges = maskDelimitedBlocks(
    characters,
    source,
    /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gu,
  );
  const frontmatterRange = findMarkdownFrontmatterRange(source);
  if (frontmatterRange !== null) {
    maskYamlCommentRanges(
      characters,
      source,
      frontmatterRange.start,
      frontmatterRange.end,
    );
  }
  maskIndentedCodeBlocks(characters, source, [
    ...fencedRanges,
    ...(frontmatterRange === null ? [] : [frontmatterRange]),
  ]);
  maskInlineCodeAndComments(characters, source, fencedRanges);
  return characters.join("");
}

interface MaskedRange {
  readonly start: number;
  readonly end: number;
}

function maskDelimitedBlocks(
  characters: string[],
  source: string,
  openingPattern: RegExp,
): MaskedRange[] {
  const ranges: MaskedRange[] = [];
  openingPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = openingPattern.exec(source)) !== null) {
    const fence = match[2];
    if (fence == null) continue;
    const contentStart = match.index + match[0].length;
    const closingPattern = new RegExp(
      `(?:^|\\n)[ \\t]{0,3}${escapeRegExp(fence[0] ?? "")}{${fence.length},}[ \\t]*(?:\\n|$)`,
      "gu",
    );
    closingPattern.lastIndex = contentStart;
    const closing = closingPattern.exec(source);
    const end = closing == null ? source.length : closing.index + closing[0].length;
    maskRange(characters, match.index, end);
    ranges.push({ start: match.index, end });
    openingPattern.lastIndex = end;
  }
  return ranges;
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
  fencedRanges: readonly MaskedRange[],
): void {
  const runs = [...source.matchAll(/`+/gu)].filter((run) => {
    const start = run.index;
    return start !== undefined && characters[start] === "`";
  });
  const runSegments: number[] = [];
  let fencedRangeIndex = 0;
  for (const run of runs) {
    const start = run.index;
    if (start === undefined) continue;
    while (true) {
      const fencedRange = fencedRanges[fencedRangeIndex];
      if (fencedRange === undefined || fencedRange.end > start) break;
      fencedRangeIndex += 1;
    }
    runSegments.push(fencedRangeIndex);
  }
  const nextMatchingRun: Array<number | null> = Array.from({ length: runs.length }, () => null);
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
    const closingIndex = nextMatchingRun[openingIndex];
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
    maskRange(characters, cursor, end);
    cursor = end;
  }
}

function maskYamlComments(source: string): string {
  const characters = source.split("");
  maskYamlCommentRanges(characters, source, 0, source.length);
  return characters.join("");
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

function findMarkdownFrontmatterRange(source: string): MaskedRange | null {
  const lines = sourceLineRanges(source);
  const first = lines[0];
  if (first === undefined) return null;
  const firstText = source.slice(first.start, first.contentEnd).replace(/^\uFEFF/u, "").trim();
  if (firstText !== "---") return null;
  for (const line of lines.slice(1)) {
    const text = source.slice(line.start, line.contentEnd).trim();
    if (text === "---" || text === "...") {
      return { start: first.start, end: line.end };
    }
  }
  return { start: first.start, end: source.length };
}

function maskIndentedCodeBlocks(
  characters: string[],
  source: string,
  excludedRanges: readonly MaskedRange[],
): void {
  let inBlock = false;
  let previousBlank = true;
  for (const line of sourceLineRanges(source)) {
    const content = source.slice(line.start, line.contentEnd);
    const blank = content.trim().length === 0;
    const excluded = excludedRanges.some((range) =>
      line.start >= range.start && line.start < range.end);
    const indented = /^(?: {4,}| {0,3}\t)/u.test(content);
    if (excluded) {
      inBlock = false;
    } else if (inBlock) {
      if (indented) maskRange(characters, line.start, line.contentEnd);
      else if (!blank) inBlock = false;
    } else if (indented && previousBlank) {
      inBlock = true;
      maskRange(characters, line.start, line.contentEnd);
    }
    previousBlank = blank;
  }
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
    if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      return content.slice(0, index);
    }
  }
  return content;
}

function findUnescaped(source: string, needle: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
    } else if (source[index] === needle) {
      return index;
    } else if (source[index] === "\n" || source[index] === "\r") {
      return -1;
    }
  }
  return -1;
}

function maskRange(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
  }
}

function unescapeMarkdownDestination(value: string): string {
  return value.replace(/\\([()<>\\])/gu, "$1");
}

function unescapeQuotedValue(value: string): string {
  return value.replace(/\\([\\"'])/gu, "$1");
}

function deduplicateReferences(
  references: readonly ParsedExplicitReference[],
): ParsedExplicitReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const identity = `${reference.startOffset}:${reference.endOffset}:${reference.linktext}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
