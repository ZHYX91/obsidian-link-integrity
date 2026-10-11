import { describe, expect, it } from "vitest";
import { mentionDisplayFragments, mentionParagraphRange } from "../../src/core/mention-display";
import { PotentialMentionMatcher } from "../../src/core/potential-mention-matcher";

describe("mention display projections", () => {
  it("keeps complete source ranges reachable in two-track overlap fragments", () => {
    const matches = new PotentialMentionMatcher([
      { text: "白云山", targetPath: "A.md", kind: "alias" },
      { text: "山", targetPath: "B.md", kind: "alias" },
      { text: "山南路", targetPath: "C.md", kind: "alias" },
    ]).match("白云山南路");
    expect(mentionDisplayFragments(matches, { from: 1, to: 4 }).map(({ from, to, tracks, matches: ranges }) =>
      [from, to, tracks, ranges.map((match) => match.text)])).toEqual([
      [1, 2, 1, ["白云山"]], [2, 3, 2, ["白云山", "山", "山南路"]], [3, 4, 1, ["山南路"]],
    ]);
    expect(mentionDisplayFragments(matches, { from: 1, to: 4 }, 1)).toEqual([
      { from: 1, to: 2, tracks: 1, matches: [matches[0]] },
    ]);
    expect(mentionDisplayFragments(matches, { from: 1, to: 4 }, 0)).toEqual([]);
  });

  it("uses the actual paragraph at EOF, CRLF and trailing empty lines", () => {
    expect(mentionParagraphRange("first\n\nlast", 11)).toEqual({ from: 7, to: 11 });
    expect(mentionParagraphRange("first\r\n\r\nlast\r\n", 15)).toEqual({ from: 15, to: 15 });
    expect(mentionParagraphRange("# Header\nparagraph\n\n- item\nnext", 26)).toEqual({ from: 20, to: 31 });
    expect(mentionParagraphRange("", 0)).toEqual({ from: 0, to: 0 });
  });
});
