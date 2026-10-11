import { normalizeVaultPath } from "./model";
import { sortSteps } from "../scheduling/sort-steps";
import type {
  MentionMatchOptions,
  MentionName,
  MentionNameKind,
  MentionRange,
  PotentialMentionMatch,
  PotentialMentionTarget,
} from "./potential-mention-model";

interface MatcherNode {
  readonly next: Map<string, number>;
  failure: number;
  output: number;
  terminal: string | null;
}

/** Exact multi-pattern matching. Failure links retain contained and crossing matches. */
export class PotentialMentionMatcher {
  private readonly nodes: MatcherNode[] = [createNode()];
  private readonly targetsByName = new Map<string, readonly PotentialMentionTarget[]>();

  public constructor(names: Iterable<MentionName>) {
    const steps = this.initializeSteps(names);
    while (!steps.next().done) { /* Pure synchronous callers share the scheduled construction path. */ }
  }

  public static *createSteps(names: Iterable<MentionName>): Generator<void, PotentialMentionMatcher> {
    const matcher = new PotentialMentionMatcher([]);
    yield* matcher.initializeSteps(names);
    return matcher;
  }

  private *initializeSteps(names: Iterable<MentionName>): Generator<void> {
    const groups = new Map<string, Map<string, Set<MentionNameKind>>>();
    for (const name of names) {
      if (name.text.length === 0) continue;
      const path = normalizeVaultPath(name.targetPath);
      const text = normalizeMentionText(name.text);
      let targets = groups.get(text);
      if (targets === undefined) {
        targets = new Map();
        groups.set(text, targets);
      }
      let kinds = targets.get(path);
      if (kinds === undefined) {
        kinds = new Set();
        targets.set(path, kinds);
      }
      kinds.add(name.kind);
      yield;
    }
    for (const [text, targets] of groups) {
      const options: PotentialMentionTarget[] = [];
      for (const [path, kinds] of targets) {
        options.push({ path, nameKinds: (["title", "alias"] as const).filter((kind) => kinds.has(kind)) });
        yield;
      }
      this.targetsByName.set(text, yield* sortSteps(options, (left, right) =>
        left.path.localeCompare(right.path, "en")));
      let state = 0;
      for (let index = 0; index < text.length; index += 1) {
        const character = text.charAt(index);
        let next = this.node(state).next.get(character);
        if (next === undefined) {
          next = this.nodes.length;
          this.nodes.push(createNode());
          this.node(state).next.set(character, next);
        }
        state = next;
        if (index % 128 === 0) yield;
      }
      this.node(state).terminal = text;
    }
    yield* this.buildFailureSteps();
  }

  public match(source: string, options: MentionMatchOptions = {}): readonly PotentialMentionMatch[] {
    const steps = this.matchSteps(source, options);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  }

  /** Consumers can yield between checkpoints without exposing partial results. */
  public *matchSteps(
    source: string,
    options: MentionMatchOptions = {},
  ): Generator<void, readonly PotentialMentionMatch[]> {
    const sourcePath = options.sourcePath === undefined ? null : normalizeVaultPath(options.sourcePath);
    const excluded = mergedRanges(options.excludedRanges ?? [], source.length);
    const matches: PotentialMentionMatch[] = [];
    const boundaries = new Set<number>([source.length]);
    let segments = 0;
    for (const segment of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(source)) {
      boundaries.add(segment.index);
      if (++segments % 1024 === 0) yield;
    }
    const filteredTargets = new Map<string, readonly PotentialMentionTarget[]>();
    let rangeIndex = 0;
    let state = 0;
    let work = 0;
    for (let index = 0; index < source.length; index += 1) {
      const range = excluded[rangeIndex];
      if (range !== undefined && index >= range.from) {
        index = range.to - 1;
        rangeIndex += 1;
        state = 0;
        yield;
        continue;
      }
      const character = normalizeMentionText(source.charAt(index));
      while (state !== 0 && !this.node(state).next.has(character)) {
        state = this.node(state).failure;
      }
      state = this.node(state).next.get(character) ?? 0;
      let output = state;
      while (output !== 0) {
        const node = this.node(output);
        if (node.terminal !== null) {
          const text = node.terminal;
          const from = index + 1 - text.length;
          const to = index + 1;
          let targets = filteredTargets.get(text);
          if (targets === undefined) {
            const allTargets = this.targetsByName.get(text) ?? [];
            targets = sourcePath === null ? allTargets : allTargets.filter(({ path }) => path !== sourcePath);
            filteredTargets.set(text, targets);
          }
          if (targets.length > 0 && boundaries.has(from) && boundaries.has(to) &&
            mentionWordEdges(source, from, to)) {
            matches.push({ from, to, text: source.slice(from, to), targets });
          }
          work += 1;
          if (work % 128 === 0) yield;
        }
        output = node.output;
      }
      work += 1;
      if (work % 1024 === 0) yield;
    }
    return yield* sortSteps(matches, (left, right) => left.from - right.from || left.to - right.to);
  }

  private node(index: number): MatcherNode {
    const node = this.nodes[index];
    if (node === undefined) throw new Error("Invalid mention matcher state.");
    return node;
  }

  private *buildFailureSteps(): Generator<void> {
    const queue = Array.from(this.node(0).next.values());
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const state = queue[cursor];
      if (state === undefined) continue;
      const node = this.node(state);
      for (const [character, child] of node.next) {
        let failure = node.failure;
        while (failure !== 0 && !this.node(failure).next.has(character)) {
          failure = this.node(failure).failure;
        }
        const fallback = this.node(failure).next.get(character) ?? 0;
        const childNode = this.node(child);
        childNode.failure = fallback;
        childNode.output = this.node(fallback).terminal === null
          ? this.node(fallback).output : fallback;
        queue.push(child);
        yield;
      }
    }
  }
}

export function normalizeMentionText(text: string): string {
  return text.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

function mentionWordEdges(source: string, from: number, to: number): boolean {
  const text = source.slice(from, to);
  const characters = Array.from(text);
  const first = characters[0] ?? "";
  const last = characters.at(-1) ?? "";
  const latinOrNumber = /[\p{Script=Latin}\p{N}]/u;
  const word = /[\p{L}\p{N}\p{M}_]/u;
  const before = Array.from(source.slice(Math.max(0, from - 2), from)).at(-1) ?? "";
  const after = String.fromCodePoint(source.codePointAt(to) ?? 32);
  return !(latinOrNumber.test(first) && word.test(before)) && !(latinOrNumber.test(last) && word.test(after));
}

function createNode(): MatcherNode {
  return { next: new Map(), failure: 0, output: 0, terminal: null };
}

function mergedRanges(ranges: readonly MentionRange[], sourceLength: number): MentionRange[] {
  const sorted = ranges.map(({ from, to }) => {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > sourceLength) {
      throw new Error("Mention exclusion range is outside the source.");
    }
    return { from, to };
  }).filter(({ from, to }) => from < to).sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: MentionRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous !== undefined && range.from <= previous.to) {
      merged[merged.length - 1] = { from: previous.from, to: Math.max(previous.to, range.to) };
    } else merged.push(range);
  }
  return merged;
}
