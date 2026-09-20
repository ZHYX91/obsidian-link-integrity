import { describe, expect, it } from "vitest";
import { findFrontmatterPropertyLine } from "../../src/adapters/obsidian/frontmatter-navigation";

describe("frontmatter navigation", () => {
  it.each([
    ['---\nrelated:\n  - "[[A]]"\n  - "[[B]]"\n---', "related.1", 3],
    ['\uFEFF---\r\n"a:b": "[[A]]"\r\n...\r\nbody', "a:b", 1],
    ['---\n"a.b": "[[A]]"\n---', "a.b", 1],
    ['---\na: { b: "[[A]]" }\n---', "a.b", 1],
    ['---\na: "[[A]]"\na: "[[B]]"\n---', "a", null],
    ['---\n"a.b": "[[A]]"\na:\n  b: "[[B]]"\n---', "a.b", null],
    ['---\na: [invalid\n---', "a", null],
    ['---\na: "[[A]]"', "a", null],
    ['body\na: "[[A]]"', "a", null],
    ['---\na: "[[A]]"\n---', "missing", null],
  ] as const)("resolves only unambiguous YAML source ranges: %s / %s", (source, key, line) => {
    expect(findFrontmatterPropertyLine(source, key)).toBe(line);
  });
});
