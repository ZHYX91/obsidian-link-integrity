import { describe, expect, it } from "vitest";
import { extractMarkdownExplicitReferences, isExternalReference } from "../../src/adapters/obsidian/explicit-link-parser";

describe("Markdown destination semantics", () => {
  it("accepts the complete CommonMark ASCII punctuation escape set", () => {
    const punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
    for (const character of punctuation) {
      expect(extractMarkdownExplicitReferences(`[label](<A\\${character}B.md>)`)[0]?.linktext)
        .toBe(`A${character}B.md`);
    }
  });

  it.each([
    ["A&amp;B.md", "A&B.md"],
    ["A&#38;B.md", "A&B.md"],
    ["A&#x26;B.md", "A&B.md"],
    ["A&NotEqualTilde;B.md", "A≂̸B.md"],
    ["Folder/foo\\!.md", "Folder/foo!.md"],
    ["foo\\:bar", "foo:bar"],
    ["A\\&amp;B.md", "A&amp;B.md"],
    ["A&amp;amp;B.md", "A&amp;B.md"],
    ["A&bsol;!B.md", "A\\!B.md"],
    ["A\\\\&amp;B.md", "A\\&B.md"],
    ["A\\q.md", "A\\q.md"],
    ["A%26B.md", "A%26B.md"],
    ["A%2526B.md", "A%2526B.md"],
    ["A&notAnEntity;B.md", "A&notAnEntity;B.md"],
    ["A&ampB.md", "A&ampB.md"],
    ["A&#00000065;B.md", "A&#00000065;B.md"],
    ["A&#x0000041;B.md", "A&#x0000041;B.md"],
    ["A&#0;B.md", "A�B.md"],
    ["A&#128;B.md", "A\u0080B.md"],
    ["A&#x80;B.md", "A\u0080B.md"],
    ["A&#xD800;B.md", "A�B.md"],
    ["A&#x110000;B.md", "A�B.md"],
    ["https&#58;//example.com", "https://example.com"],
    ["https\\://example.com", "https://example.com"],
  ])("decodes %s once, preserving original UTF-16 ranges", (destination, expected) => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const raw = `![label](<${destination}>)`;
      const prefix = `😀${newline}prefix `;
      const result = extractMarkdownExplicitReferences(prefix + raw);
      expect(result).toEqual([{
        raw, linktext: expected, embedded: true,
        startOffset: prefix.length, endOffset: prefix.length + raw.length,
      }]);
      expect(isExternalReference(result[0]!.linktext)).toBe(expected.startsWith("https:") || expected === "foo:bar");
    }
  });

  it("does not apply Markdown decoding to WikiLink targets", () => {
    const source = "[[A&amp;B]] [[Folder/foo\\!.md]] [[A%26B]]";
    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext))
      .toEqual(["A&amp;B", "Folder/foo\\!.md", "A%26B"]);
  });
});
