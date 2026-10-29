export type MarkdownContainer = "quote" | number;

export interface MarkdownContainerLine {
  readonly text: string;
  readonly containers: readonly MarkdownContainer[];
  readonly opensContainer: boolean;
}

/** Expand only the working line; source offsets always refer to the original text. */
export function expandMarkdownTabs(line: string): string {
  let column = 0;
  let previous = 0;
  return line.replace(/\t/gu, (_tab, index: number) => {
    column += index - previous;
    const spaces = 4 - column % 4;
    column += spaces;
    previous = index + 1;
    return " ".repeat(spaces);
  });
}

export function stripMarkdownContainers(line: string, containers: readonly MarkdownContainer[]): {
  text: string | null;
  remainder: string;
  consumed: readonly MarkdownContainer[];
} {
  let text = line;
  const consumed: MarkdownContainer[] = [];
  for (const container of containers) {
    const prefix = container === "quote" ? /^ {0,3}> ?/u.exec(text)?.[0] :
      text.startsWith(" ".repeat(container)) ? " ".repeat(container) : undefined;
    if (prefix === undefined) return { text: null, remainder: text, consumed };
    text = text.slice(prefix.length);
    consumed.push(container);
  }
  return { text, remainder: text, consumed };
}

export function normalizeMarkdownContainerLine(
  line: string,
  previous: readonly MarkdownContainer[],
  paragraph = false,
): MarkdownContainerLine {
  const stripped = stripMarkdownContainers(expandMarkdownTabs(line), previous);
  paragraph &&= stripped.text !== null;
  let text = stripped.remainder;
  const containers = [...stripped.consumed];
  // New containers are recognized only outside protected blocks. Keep each list's
  // continuation indentation so lists and quotes can be stripped in nesting order.
  while (text.length > 0) {
    const quote = /^ {0,3}> ?/u.exec(text)?.[0];
    if (quote !== undefined) { containers.push("quote"); text = text.slice(quote.length); paragraph = false; continue; }
    // A thematic break is not a sequence of empty nested list items.
    if (/^ {0,3}(?:(?:\* *){3,}|(?:_ *){3,}|(?:- *){3,})$/u.test(text)) break;
    const marker = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?: +|$)/u.exec(text)?.[0];
    if (marker === undefined) break;
    // Only a nonempty item (ordered start 1) can interrupt the open paragraph.
    // This also leaves a bare '-' available as a setext underline.
    if (paragraph && (marker.length === text.length || /^ {0,3}\d/u.test(marker) && !/^ {0,3}0*1[.)]/u.test(marker))) break;
    const spacing = / *$/u.exec(marker)?.[0].length ?? 0;
    const indent = marker.length - spacing + (spacing > 4 || spacing === 0 || marker.length === text.length ? 1 : spacing);
    containers.push(indent);
    text = text.slice(Math.min(indent, marker.length));
    paragraph = false;
  }
  const missingQuote = previous.indexOf("quote", stripped.consumed.length);
  return {
    text,
    containers: text.trim().length === 0 && containers.length === stripped.consumed.length
      ? previous.slice(0, missingQuote < 0 ? previous.length : missingQuote) : containers,
    opensContainer: containers.length > stripped.consumed.length,
  };
}
