import type { MentionRange, PotentialMentionMatch } from "./potential-mention-model";

export interface MentionDisplayFragment extends MentionRange {
  readonly tracks: 1 | 2;
  readonly matches: readonly PotentialMentionMatch[];
}

/** Visual density is capped; each fragment retains every complete source range. */
export function mentionDisplayFragments(matches: readonly PotentialMentionMatch[], viewport: MentionRange): MentionDisplayFragment[] {
  const events = new Map<number, { starts: PotentialMentionMatch[]; ends: PotentialMentionMatch[] }>();
  const event = (offset: number) => {
    let value = events.get(offset);
    if (value === undefined) {
      value = { starts: [], ends: [] };
      events.set(offset, value);
    }
    return value;
  };
  for (const match of matches) {
    if (match.to <= viewport.from || match.from >= viewport.to) continue;
    event(Math.max(match.from, viewport.from)).starts.push(match);
    event(Math.min(match.to, viewport.to)).ends.push(match);
  }
  const active = new Set<PotentialMentionMatch>();
  const offsets = [...events.keys()].sort((left, right) => left - right);
  const fragments: MentionDisplayFragment[] = [];
  for (let index = 0; index < offsets.length; index += 1) {
    const from = offsets[index];
    const to = offsets[index + 1];
    if (from === undefined || to === undefined) continue;
    const changes = events.get(from);
    for (const match of changes?.ends ?? []) active.delete(match);
    for (const match of changes?.starts ?? []) active.add(match);
    if (active.size > 0 && to > from) fragments.push({ from, to, tracks: active.size > 1 ? 2 : 1, matches: [...active] });
  }
  return fragments;
}

export function mentionParagraphRange(source: string, offset: number): MentionRange {
  const lines = [...source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)].filter((line) => line[0].length > 0);
  const found = lines.findIndex((line) => line.index + line[0].length > offset);
  if (offset >= source.length && /[\r\n]$/u.test(source)) return { from: source.length, to: source.length };
  const current = found < 0 ? Math.max(0, lines.length - 1) : found;
  const content = (index: number): string => (lines[index]?.[0] ?? "").replace(/^(?:[ \t]{0,3}>[ \t]?)+/u, "").trim();
  const startsBlock = (index: number): boolean => /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\[![^\]]+\])/u.test(content(index));
  let first = current;
  let last = current;
  if (!/^#{1,6}\s/u.test(content(current)) && content(current).length > 0) {
    while (first > 0 && content(first - 1).length > 0 && !startsBlock(first)) first -= 1;
    while (last + 1 < lines.length && content(last + 1).length > 0 && !startsBlock(last + 1)) last += 1;
  }
  return { from: lines[first]?.index ?? 0, to: (lines[last]?.index ?? 0) + (lines[last]?.[0].length ?? source.length) };
}
