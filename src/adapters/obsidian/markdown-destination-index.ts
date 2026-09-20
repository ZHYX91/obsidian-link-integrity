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
    if (character === "\\") {
      if (index + 1 < length) escaped[index + 1] = 1;
      index += 1;
    } else if (character === "\n" || character === "\r") {
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
    afterWhitespace[index] = character === " " || character === "\t"
      ? afterWhitespace[index + 1] ?? length : index;
    if (character === "\n" || character === "\r") {
      next.clear();
      continue;
    }
    if (escaped[index] === 0) {
      if (character === "<") closing[index] = next.get(">") ?? -1;
      if (character === '"' || character === "'") closing[index] = next.get(character) ?? -1;
      if (character === ">" || character === '"' || character === "'") next.set(character, index);
    }
    if (character === "\\" && escaped[index] === 0) {
      bareEnd[index] = bareEnd[Math.min(index + 2, length)] ?? -1;
    } else if (character === "(" && escaped[index] === 0) {
      const end = closing[index] ?? -1;
      bareEnd[index] = end < 0 ? -1 : bareEnd[end + 1] ?? -1;
    } else if ((character === ")" || character === " " || character === "\t") && escaped[index] === 0) {
      bareEnd[index] = index;
    } else {
      bareEnd[index] = bareEnd[index + 1] ?? -1;
    }
  }
  return { closing, bareEnd, afterWhitespace };
}
