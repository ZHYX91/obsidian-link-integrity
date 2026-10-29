/** Index delimiter boundaries once, including unsuccessful destination attempts. */
export interface MarkdownDestinationIndex {
  readonly closing: Int32Array;
  readonly bareEnd: Int32Array;
  readonly afterWhitespace: Int32Array;
}

export function* indexMarkdownDestinations(source: string): Generator<void, MarkdownDestinationIndex> {
  const length = source.length;
  const closing = new Int32Array(length + 1).fill(-1);
  const bareEnd = new Int32Array(length + 1).fill(-1);
  const afterWhitespace = new Int32Array(length + 1);
  const escaped = new Uint8Array(length);
  const parentheses: number[] = [];
  for (let index = 0; index < length; index += 1) {
    if (index % 1024 === 0) yield;
    const character = source[index];
    if (character === "\\" && /[!-/:-@[-`{-~]/u.test(source[index + 1] ?? "")) {
      escaped[index + 1] = 1;
      index += 1;
    } else if (source.charCodeAt(index) < 33) {
      parentheses.length = 0;
    } else if (character === "(") {
      parentheses.push(index);
    } else if (character === ")") {
      const opening = parentheses.pop();
      if (opening !== undefined) closing[opening] = index;
    }
  }
  const next = new Map<string, number>();
  afterWhitespace[length] = length;
  for (let index = length - 1; index >= 0; index -= 1) {
    if (index % 1024 === 0) yield;
    const character = source[index];
    const whitespace = character === " " || character === "\t";
    const newline = character === "\n" || character === "\r";
    const afterLine = index + (character === "\r" && source[index + 1] === "\n" ? 2 : 1);
    afterWhitespace[index] = whitespace ? afterWhitespace[index + 1]! : index;
    if (character === "\\" && escaped[index] === 0 && escaped[index + 1] === 1) {
      bareEnd[index] = bareEnd[index + 2]!;
    } else if (character === "(" && escaped[index] === 0) {
      const end = closing[index]!;
      bareEnd[index] = end < 0 ? -1 : bareEnd[end + 1]!;
    } else if ((character === ")" || whitespace || newline) && escaped[index] === 0) {
      bareEnd[index] = index;
    } else if (source.charCodeAt(index) < 33) {
      bareEnd[index] = -1;
    } else {
      bareEnd[index] = bareEnd[index + 1]!;
    }
    // Bare destinations need balanced parentheses; titles forbid unescaped
    // nested parentheses. Reuse the closing array after computing bareEnd.
    if (escaped[index] === 0) {
      if (character === "<") closing[index] = (next.get(">") ?? length) <
        Math.min(next.get("<") ?? length, next.get("\n") ?? length) ? next.get(">") ?? -1 : -1;
      if (character === '"' || character === "'") closing[index] = next.get(character) ?? -1;
      if (character === "(") closing[index] = (next.get(")") ?? length) < (next.get("(") ?? length)
        ? next.get(")") ?? -1 : -1;
      if ("<>\"'()".includes(character!)) next.set(character!, index);
    }
    if (newline) {
      // Titles may contain soft line breaks, never a blank line. Angle
      // destinations cannot cross even one line ending.
      if (/[\r\n]/u.test(source[afterWhitespace[afterLine]!] ?? "")) next.clear();
      next.set("\n", index);
    }
  }
  return { closing, bareEnd, afterWhitespace };
}
