import { describe, expect, it } from "vitest";

import { PotentialMentionMatcher } from "../../src/core/potential-mention-matcher";
import type { MentionName } from "../../src/core/potential-mention-model";
import { LinkIndex } from "../../src/core/link-index";
import { createFileRecord } from "../../src/core/model";

const names: readonly MentionName[] = [
  { text: "白云山", targetPath: "Places/白云山.md", kind: "title" },
  { text: "白云山", targetPath: "Travel/广州.md", kind: "alias" },
  { text: "山", targetPath: "山.md", kind: "title" },
  { text: "山南路", targetPath: "Streets/山南路.md", kind: "title" },
];

describe("potential mention matching", () => {
  it("retains same-range targets, contained names, and crossing names", () => {
    const source = "白云山南路";
    const matches = new PotentialMentionMatcher(names).match(source);
    expect(matches).toEqual([
      {
        from: 0, to: 3, text: "白云山", targets: [
          { path: "Places/白云山.md", nameKinds: ["title"] },
          { path: "Travel/广州.md", nameKinds: ["alias"] },
        ],
      },
      { from: 2, to: 3, text: "山", targets: [{ path: "山.md", nameKinds: ["title"] }] },
      { from: 2, to: 5, text: "山南路", targets: [{ path: "Streets/山南路.md", nameKinds: ["title"] }] },
    ]);
    for (const match of matches) expect(source.slice(match.from, match.to)).toBe(match.text);
  });

  it("retains exact UTF-16 offsets after astral characters and CRLF", () => {
    const source = "🌤️\r\n白云山 🌤️白云山";
    const matches = new PotentialMentionMatcher(names).match(source);
    expect(matches.map(({ from, to, text }) => [from, to, text])).toEqual([
      [5, 8, "白云山"], [7, 8, "山"], [12, 15, "白云山"], [14, 15, "山"],
    ]);
  });

  it("retains complete crossing ranges when clipping output to separated visible windows", () => {
    const matcher = new PotentialMentionMatcher(names);
    const source = "白云山南路\n白云山南路\n白云山南路";
    const complete = matcher.match(source);
    expect(matcher.match(source, { ranges: [{ from: 1, to: 3 }, { from: 14, to: 15 }] })).toEqual(
      complete.filter(({ from, to }) => to > 1 && from < 3 || to > 14 && from < 15),
    );
    expect(matcher.match(source, { ranges: [] })).toEqual([]);
  });

  it("deduplicates title/alias rows without dropping their provenance", () => {
    const matcher = new PotentialMentionMatcher([
      ...names,
      { text: "白云山", targetPath: "Places\\白云山.md", kind: "alias" },
      { text: "白云山", targetPath: "Places/白云山.md", kind: "title" },
      { text: "", targetPath: "Empty.md", kind: "title" },
    ]);
    expect(matcher.match("白云山")[0]?.targets).toEqual([
      { path: "Places/白云山.md", nameKinds: ["title", "alias"] },
      { path: "Travel/广州.md", nameKinds: ["alias"] },
    ]);
    expect(matcher.match("", { sourcePath: "山.md" })).toEqual([]);
    expect(matcher.match("白云山", { sourcePath: "Travel/广州.md" })[0]?.targets).toEqual([
      { path: "Places/白云山.md", nameKinds: ["title", "alias"] },
    ]);
  });

  it("blocks excluded syntax and never bridges an excluded range", () => {
    const source = "白云山 白云山南路 白云山";
    const matcher = new PotentialMentionMatcher(names);
    expect(matcher.match(source, { excludedRanges: [
      { from: 5, to: 7 }, { from: 4, to: 6 }, { from: 0, to: 3 }, { from: 3, to: 3 },
    ] }).map(({ from, to, text }) => [from, to, text])).toEqual([
      [10, 13, "白云山"], [12, 13, "山"],
    ]);
    expect(() => matcher.match(source, { excludedRanges: [{ from: -1, to: 2 }] })).toThrow();
    expect(() => matcher.match(source, { excludedRanges: [{ from: 1, to: 100 }] })).toThrow();
    expect(() => matcher.match(source, { excludedRanges: [{ from: 3, to: 1 }] })).toThrow();
    expect(() => matcher.match(source, { excludedRanges: [{ from: 1.5, to: 2 }] })).toThrow();
  });

  it("handles failure transitions, repeated occurrences, and exact punctuation", () => {
    const matcher = new PotentialMentionMatcher([
      { text: "aba", targetPath: "aba.md", kind: "title" },
      { text: "ba", targetPath: "ba.md", kind: "title" },
      { text: "a+b", targetPath: "special.md", kind: "alias" },
    ]);
    expect(matcher.match("ababa a+b ABA").map(({ from, text }) => [from, text])).toEqual([
      [6, "a+b"], [10, "ABA"],
    ]);
    expect(new PotentialMentionMatcher([]).match("text")).toEqual([]);
  });

  it("can be consumed in slices and never creates valid graph connections", () => {
    const matcher = new PotentialMentionMatcher(names);
    const source = `${"unrelated ".repeat(1_000)}白云山`;
    const steps = matcher.matchSteps(source);
    let checkpoints = 0;
    let step = steps.next();
    while (!step.done) {
      checkpoints += 1;
      step = steps.next();
    }
    expect(checkpoints).toBeGreaterThan(5);
    expect(step.value).toEqual(matcher.match(source));
    const index = new LinkIndex(names.map(({ targetPath }) => createFileRecord(targetPath)));
    expect(index.occurrences).toEqual([]);
    expect(index.toCanonicalState().edges).toEqual([]);
  });

  it("slices dictionary construction and keeps large ambiguous target sets shared", () => {
    const dictionary = Array.from({ length: 1_000 }, (_, index) => ({
      text: "白云山", targetPath: `Places/Target-${index}.md`, kind: "alias" as const,
    }));
    const construction = PotentialMentionMatcher.createSteps(dictionary);
    let checkpoints = 0;
    let step = construction.next();
    while (!step.done) {
      checkpoints += 1;
      step = construction.next();
    }
    expect(checkpoints).toBeGreaterThan(2_000);
    const matches = step.value.match("白云山 白云山");
    expect(matches[0]?.targets).toHaveLength(1_000);
    expect(matches[1]?.targets).toBe(matches[0]?.targets);
    const filtered = step.value.match("白云山 白云山", { sourcePath: "Places/Target-0.md" });
    expect(filtered[0]?.targets).toHaveLength(999);
    expect(filtered[1]?.targets).toBe(filtered[0]?.targets);
    expect(matches).toEqual(new PotentialMentionMatcher(dictionary).match("白云山 白云山"));
  });

  it("equals an independent exhaustive matcher across deterministic overlapping dictionaries", () => {
    let seed = 1701;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const text = (length: number): string => Array.from({ length }, () =>
      "白路山云".charAt(Math.floor(random() * 4))).join("");
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const phrases = new Set(Array.from({ length: 20 }, () => text(1 + Math.floor(random() * 6))));
      const dictionary = Array.from(phrases, (phrase, index) => ({
        text: phrase, targetPath: `Target-${index}.md`, kind: "title" as const,
      }));
      const source = text(80);
      const expected: Array<{ from: number; to: number; text: string }> = [];
      for (let from = 0; from < source.length; from += 1) {
        for (const phrase of phrases) {
          if (source.startsWith(phrase, from)) expected.push({ from, to: from + phrase.length, text: phrase });
        }
      }
      expected.sort((left, right) => left.from - right.from || left.to - right.to);
      expect(new PotentialMentionMatcher(dictionary).match(source).map(({ from, to, text: phrase }) => ({
        from, to, text: phrase,
      }))).toEqual(expected);
    }
  });

  it("uses Unicode word edges for Latin names and never splits a grapheme", () => {
    const matcher = new PotentialMentionMatcher([
      { text: "AI", targetPath: "AI.md", kind: "title" },
      { text: "a", targetPath: "a.md", kind: "title" },
      { text: "山", targetPath: "山.md", kind: "title" },
      { text: "👩", targetPath: "Woman.md", kind: "alias" },
    ]);
    expect(matcher.match("MAIN ai AI中 _AI AI2 á 山́ 👩‍💻 山" ).map(({ text }) => text)).toEqual(["ai", "山"]);
  });
});
