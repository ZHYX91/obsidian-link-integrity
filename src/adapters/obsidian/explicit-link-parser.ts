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
  maskDelimitedBlocks(characters, source, /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gu);
  maskPairs(characters, source, "%%", "%%", true);
  maskInlineCode(characters, source);
  return characters.join("");
}

function maskDelimitedBlocks(
  characters: string[],
  source: string,
  openingPattern: RegExp,
): void {
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
    openingPattern.lastIndex = end;
  }
}

function maskPairs(
  characters: string[],
  source: string,
  opening: string,
  closing: string,
  multiline: boolean,
): void {
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(opening, cursor);
    if (start < 0) return;
    const end = source.indexOf(closing, start + opening.length);
    if (end < 0 || (!multiline && source.slice(start, end).includes("\n"))) {
      cursor = start + opening.length;
      continue;
    }
    maskRange(characters, start, end + closing.length);
    cursor = end + closing.length;
  }
}

function maskInlineCode(characters: string[], source: string): void {
  const runs = [...source.matchAll(/`+/gu)];
  const runLines = lineNumbersForMatches(source, runs);
  const nextMatchingRun: Array<number | null> = Array.from({ length: runs.length }, () => null);
  const nextByLength = new Map<number, number>();
  let currentLine = -1;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const line = runLines[index];
    if (line !== currentLine) {
      nextByLength.clear();
      currentLine = line ?? -1;
    }
    const length = runs[index]?.[0].length;
    if (length === undefined) continue;
    nextMatchingRun[index] = nextByLength.get(length) ?? null;
    nextByLength.set(length, index);
  }
  for (let index = 0; index + 1 < runs.length; index += 1) {
    const opening = runs[index];
    if (opening === undefined) continue;
    const openingText = opening[0];
    if (openingText.length >= 3) continue;
    const closingIndex = nextMatchingRun[index];
    if (closingIndex == null) continue;
    const closing = runs[closingIndex];
    if (closing === undefined) continue;
    maskRange(
      characters,
      opening.index ?? 0,
      (closing.index ?? 0) + closing[0].length,
    );
    index = closingIndex;
  }
}

function lineNumbersForMatches(
  source: string,
  matches: readonly RegExpMatchArray[],
): readonly number[] {
  const result: number[] = [];
  let line = 0;
  let nextLineBreak = source.indexOf("\n");
  for (const match of matches) {
    const offset = match.index ?? 0;
    while (nextLineBreak >= 0 && nextLineBreak < offset) {
      line += 1;
      nextLineBreak = source.indexOf("\n", nextLineBreak + 1);
    }
    result.push(line);
  }
  return result;
}

function maskYamlComments(source: string): string {
  const characters = source.split("");
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\n") {
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
      const end = source.indexOf("\n", index);
      maskRange(characters, index, end < 0 ? source.length : end);
      index = end < 0 ? source.length : end - 1;
    }
  }
  return characters.join("");
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
