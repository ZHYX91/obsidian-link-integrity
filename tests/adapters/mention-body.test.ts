import { describe, expect, it } from "vitest";
import { extractMarkdownMentionExclusions } from "../../src/adapters/obsidian/mention-body";
import { PotentialMentionMatcher } from "../../src/core/potential-mention-matcher";

describe("body syntax protection", () => {
  it("protects syntax independently of the explicit-link parser", async () => {
    const source = "---\r\naliases: 山\r\n---\r\n山\n\n    山\n\n> ```\n> 山\n> ```\n%% 山 %%\n<!-- 山 -->\n<div>\n山\n</div>\n\n$山$ $$山$$ \\[山\\] #山 https://example.test/山 [山][r]\n[r]: 山\n山";
    const matches = new PotentialMentionMatcher([{ text: "山", targetPath: "Target.md", kind: "alias" }])
      .match(source, { excludedRanges: await extractMarkdownMentionExclusions(source) });
    expect(matches.map((match) => match.from)).toEqual([source.indexOf("山\n\n"), source.length - 1]);
  });

  it("treats escaped opening backticks as text and backslashes inside code as ordinary characters", async () => {
    const matcher = new PotentialMentionMatcher([{ text: "山", targetPath: "Target.md", kind: "alias" }]);
    const escaped = "\\` 山 ` 山";
    expect(matcher.match(escaped, { excludedRanges: await extractMarkdownMentionExclusions(escaped) }).map((match) => match.from)).toEqual([3, 7]);
    const code = "` 山 \\` 山";
    expect(matcher.match(code, { excludedRanges: await extractMarkdownMentionExclusions(code) }).map((match) => match.from)).toEqual([7]);
  });

  it("protects multiline HTML attributes, list fences and incomplete link syntax", async () => {
    const matcher = new PotentialMentionMatcher([{ text: "白云山", targetPath: "Target.md", kind: "alias" }]);
    for (const source of ['text <span\n title="白云山">end</span>', "- ```\n  白云山\n", "[[白云山", "[label](白云山", "[白云山"]) {
      expect(matcher.match(source, { excludedRanges: await extractMarkdownMentionExclusions(source) })).toEqual([]);
    }
    const source = 'text <span title="<foo">end</span> 白云山';
    expect(matcher.match(source, { excludedRanges: await extractMarkdownMentionExclusions(source) }).map((match) => match.from)).toEqual([35]);
  });
  it("protects even-backslash math openers and escaped closing delimiters", async () => {
    const matcher = new PotentialMentionMatcher([{ text: "山", targetPath: "Target.md", kind: "alias" }]);
    for (const source of ["\\\\$山$", "$x\\$山$", "$$山$$"]) {
      expect(matcher.match(source, { excludedRanges: await extractMarkdownMentionExclusions(source) })).toEqual([]);
    }
    const source = "\\$山";
    expect(matcher.match(source, { excludedRanges: await extractMarkdownMentionExclusions(source) })).toHaveLength(1);
  });

});
