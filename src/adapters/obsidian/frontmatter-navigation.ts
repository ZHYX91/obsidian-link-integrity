import { Composer, type CST, isMap, isNode, isScalar, isSeq, LineCounter, Parser } from "yaml";
import { WorkScheduler } from "../../scheduling/work-scheduler";

interface PropertyMatch { node: unknown; line: number; }

/** Preserve YAML ranges and errors while releasing the editor between parser chunks. */
function* findProperty(source: string, property: string): Generator<void, PropertyMatch | null> {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r\n|[\r\n])/u.exec(source);
  if (opening === null) return null;
  const rest = source.slice(opening[0].length);
  const closing = /(^|[\r\n])(?:---|\.\.\.)[ \t]*(?=[\r\n]|$)/u.exec(rest);
  if (closing === null) return null;
  const yaml = rest.slice(0, closing.index + closing[1]!.length).replace(/\r\n?/gu, "\n");
  const counter = new LineCounter();
  const parser = new Parser(counter.addNewLine);
  let document: CST.Document | undefined;
  for (let start = 0; start < yaml.length; start += 2048) {
    const end = Math.min(start + 2048, yaml.length);
    for (const token of parser.parse(yaml.slice(start, end), end < yaml.length)) {
      if (token.type === "document" && document === undefined) document = token;
      else if (token.type !== "space" && token.type !== "comment" && token.type !== "newline") return null;
    }
    yield;
  }
  if (!document) return null;

  // A flat property map may contain thousands of keys. Compose its CST in
  // groups while keeping absolute node ranges and checking keys across groups.
  const root = document.value;
  if (root === undefined) return null;
  const keys = new Set<string>();
  let match: PropertyMatch | null = null;
  const groups = root.type === "block-map" ? Math.ceil(root.items.length / 64) : 1;
  for (let group = 0; group < groups; group++) {
    let value = root;
    if (root.type === "block-map") {
      const items = root.items.slice(group * 64, (group + 1) * 64);
      const first = items[0]!;
      value = { ...root, items, offset: first.start[0]?.offset ?? first.key?.offset ?? root.offset };
    }
    const composer = new Composer({ schema: "failsafe", logLevel: "silent", stringKeys: true, uniqueKeys: false });
    const parsed = composer.compose([{ ...document, value }], true).next().value;
    if (!parsed || parsed.errors.length > 0 || !isMap(parsed.contents)) return null;
    const pending: Array<{ node: unknown; path: string; offset: number | null }> = [
      { node: parsed.contents, path: "", offset: null },
    ];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current.path === property && current.offset !== null) {
        // A literal dotted key can collide with a nested path.
        if (match !== null) return null;
        match = { node: current.node, line: counter.linePos(current.offset).line };
      }
      if (isMap(current.node)) {
        const seen = current.node === parsed.contents ? keys : new Set<string>();
        for (const [index, pair] of current.node.items.entries()) {
          if (index % 128 === 0) yield;
          if (!isScalar(pair.key) || typeof pair.key.value !== "string") continue;
          if (seen.has(pair.key.value)) return null;
          seen.add(pair.key.value);
          pending.push({ node: pair.value, path: current.path ? `${current.path}.${pair.key.value}` : pair.key.value,
            offset: pair.key.range?.[0] ?? null });
        }
      } else if (isSeq(current.node)) {
        for (const [index, node] of current.node.items.entries()) {
          if (index % 128 === 0) yield;
          pending.push({ node, path: `${current.path}.${index}`, offset: isNode(node) ? node.range?.[0] ?? null : null });
        }
      }
    }
    yield;
  }
  return match;
}

export async function findFrontmatterProperty(source: string, property: string, scheduler: WorkScheduler): Promise<PropertyMatch | null> {
  const work = findProperty(source, property);
  let step = work.next();
  while (!step.done) {
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    step = work.next();
  }
  return step.value;
}

export function findFrontmatterPropertyLine(source: string, property: string): number | null {
  const work = findProperty(source, property);
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value?.line ?? null;
}
