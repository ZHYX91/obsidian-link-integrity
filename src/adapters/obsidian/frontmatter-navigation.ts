import { isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from "yaml";

/** Locate cached property paths using YAML source ranges, never text resemblance. */
export function findFrontmatterPropertyLine(source: string, property: string): number | null {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/u.exec(source);
  if (opening === null) return null;
  const rest = source.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/mu.exec(rest);
  if (closing === null) return null;
  const lineCounter = new LineCounter();
  const document = parseDocument(rest.slice(0, closing.index), {
    lineCounter, schema: "failsafe", logLevel: "silent", stringKeys: true,
  });
  if (document.errors.length > 0 || !isMap(document.contents)) return null;
  const pending: Array<{ node: unknown; path: string; offset: number | null }> = [
    { node: document.contents, path: "", offset: null },
  ];
  const matches: number[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current.path === property && current.offset !== null) matches.push(current.offset);
    if (isMap(current.node)) {
      for (const pair of current.node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== "string") continue;
        pending.push({
          node: pair.value,
          path: current.path ? `${current.path}.${pair.key.value}` : pair.key.value,
          offset: pair.key.range?.[0] ?? null,
        });
      }
    } else if (isSeq(current.node)) {
      current.node.items.forEach((node, index) => pending.push({
        node, path: `${current.path}.${index}`, offset: isNode(node) ? node.range?.[0] ?? null : null,
      }));
    }
  }
  // A literal dotted key can collide with a nested path: decline ambiguous navigation.
  const offset = matches.length === 1 ? matches[0] : undefined;
  return offset === undefined ? null : lineCounter.linePos(offset).line;
}
