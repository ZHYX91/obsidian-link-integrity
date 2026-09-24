import { WorkScheduler } from "../../src/scheduling/work-scheduler";
import { describe, expect, it } from "vitest";

import {
  extractBasesExplicitReferences,
  extractMarkdownExplicitReferences,
  extractMarkdownExplicitReferencesAsync,
  isExternalReference,
} from "../../src/adapters/obsidian/explicit-link-parser";

describe("extractMarkdownExplicitReferences", () => {
  it("extracts wiki links, embeds, aliases, and Markdown destinations in source order", () => {
    const source = "[[Note#Part|label]] ![[image.png]] [other](Folder/Other.md#Block)";

    expect(extractMarkdownExplicitReferences(source)).toEqual([
      expect.objectContaining({ linktext: "Note#Part", embedded: false, startOffset: 0 }),
      expect.objectContaining({ linktext: "image.png", embedded: true, startOffset: 20 }),
      expect.objectContaining({
        linktext: "Folder/Other.md#Block",
        embedded: false,
        startOffset: 35,
      }),
    ]);
  });

  it("ignores escaped Markdown label openers", () => {
    const source = String.raw`\[label](Missing.md) [kept](Present.md)`;

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "Present.md",
    ]);
  });

  it("supports arbitrarily nested balanced parentheses in Markdown destinations", () => {
    const source = "[nested](A(B(C(D))).md)";

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "A(B(C(D))).md",
    ]);
  });

  it("keeps unmatched bracket-heavy input bounded and produces no false links", () => {
    const source = "[x".repeat(25_000);

    expect(extractMarkdownExplicitReferences(source)).toEqual([]);
  });

  it.each(["[x](", "[x](<", '[x](a "'])("handles repeated unsuccessful destinations: %s", (unit) => {
    expect(extractMarkdownExplicitReferences(unit.repeat(16_000))).toEqual([]);
    expect(extractMarkdownExplicitReferences(`${unit.repeat(100)}\n[kept](Present.md)`)
      .map(({ linktext }) => linktext)).toEqual(["Present.md"]);
  });

  it("yields while parsing a large source and preserves synchronous results", async () => {
    const source = "[link](A(B(C)).md) [[Other]]\n".repeat(1000);
    let yields = 0;
    const scheduler = new WorkScheduler({ yieldEvery: 1, yieldControl: async () => { yields += 1; } });
    expect(await extractMarkdownExplicitReferencesAsync(source, scheduler))
      .toEqual(extractMarkdownExplicitReferences(source));
    expect(yields).toBeGreaterThan(10);
  });

  it("ignores fenced code, inline code, and Obsidian comments", () => {
    const source = [
      "`[[inline]]` [[kept]]",
      "%% [[comment]] %%",
      "```md",
      "[[fenced]]",
      "```",
      "[[after fence]]",
    ].join("\n");

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "kept",
      "after fence",
    ]);
  });

  it("handles CRLF, empty, adjacent, and longer fenced code blocks", () => {
    const source = [
      "````md",
      "[[hidden-long]]",
      "````",
      "```",
      "```",
      "~~~",
      "[[hidden-tilde]]",
      "~~~",
      "[[kept]]",
    ].join("\r\n");

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "kept",
    ]);
  });

  it("keeps adjacent fenced blocks isolated from following content", () => {
    const source = [
      "```",
      "[[hidden-one]]",
      "```",
      "```",
      "[[hidden-two]]",
      "```",
      "[[shown]]",
    ].join("\n");

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "shown",
    ]);
  });

  it("masks an unclosed fence through end of source without shifting UTF-16 offsets", () => {
    const source = ["😀 [[shown]]", "```", "[[hidden]]"].join("\n");
    const references = extractMarkdownExplicitReferences(source);

    expect(references).toEqual([
      expect.objectContaining({
        linktext: "shown",
        startOffset: source.indexOf("[[shown]]"),
      }),
    ]);
  });
  it("ignores indented code blocks without hiding paragraph continuations", () => {
    const source = [
      "    [[top-level code]]",
      "",
      "\t[[tab code]]",
      "",
      "paragraph",
      "    [[paragraph continuation]]",
      "[[kept]]",
    ].join("\n");

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "paragraph continuation",
      "kept",
    ]);
  });

  it("ignores YAML comments while retaining frontmatter values and later headings", () => {
    const source = [
      "\uFEFF---",
      "related: '[[Frontmatter value]]' # [[YAML comment]]",
      "...",
      "# [[Markdown heading]]",
    ].join("\r\n");

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "Frontmatter value",
      "Markdown heading",
    ]);
  });

  it("keeps UTF-16 offsets aligned when astral characters precede fenced code", () => {
    const source = [
      "😀",
      "```md",
      "[[hidden]]",
      "```",
      "[[shown]]",
    ].join("\n");

    expect(extractMarkdownExplicitReferences(source)).toEqual([
      expect.objectContaining({
        linktext: "shown",
        raw: "[[shown]]",
        startOffset: source.indexOf("[[shown]]"),
      }),
    ]);
  });

  it("supports angle-bracket destinations and one nested parenthesis", () => {
    const source = "[spaces](<Folder/My Note.md>) [nested](A_(B).md)";

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "Folder/My Note.md",
      "A_(B).md",
    ]);
  });

  it("pairs equal-length backtick spans and leaves unmatched runs literal", () => {
    const source = [
      "`[[one]]` ``[[two]]`` [[kept]]",
      "`[[unclosed]] [[next line]]",
    ].join("\n");

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "kept",
      "unclosed",
      "next line",
    ]);
  });

  it("ignores code spans delimited by three or more backticks", () => {
    const source = "before ```[[hidden]]``` after [[kept]]";

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "kept",
    ]);
  });

  it("ignores links inside multiline code spans", () => {
    const source = [
      "before `[[hidden first]]",
      "[[hidden second]]` after [[kept]]",
    ].join("\n");

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "kept",
    ]);
  });

  it("treats Obsidian comment tokens inside code spans as literal text", () => {
    const source = [
      "`%%` [[kept]]",
      "%% actual [[hidden]] %%",
    ].join("\n");

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "kept",
    ]);
  });

  it("treats backtick runs inside Obsidian comments as literal text", () => {
    const source = [
      "%% ` %%",
      "[[kept]] `",
    ].join("\n");

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "kept",
    ]);
  });

  it("does not pair multiline code spans across fenced blocks", () => {
    const source = [
      "before `",
      "```md",
      "[[hidden fenced]]",
      "```",
      "[[kept after fence]] `",
    ].join("\n");

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "kept after fence",
    ]);
  });
});

describe("extractBasesExplicitReferences", () => {
  it("keeps explicit formula literals without treating dynamic membership as an edge", () => {
    const source = [
      "filters:",
      "  and:",
      "    - 'file.folder == [[Projects]]'",
      "formulas:",
      "  related: 'link(\"Reference.md\")'",
      "  spaced: 'link(\"Spaced.md\" )'",
      "  dynamic: 'file.hasTag(\"active\")'",
      "views:",
      "  - type: table",
      "    name: \"link('View-name.md')\"",
      "    filters:",
      "      - \"file.name.contains(\\\"link('String-only.md')\\\")\"",
      "properties:",
      "  status:",
      "    displayName: \"[[Display-only.md]]\"",
      "# [[Commented.md]]",
    ].join("\n");

    expect(extractBasesExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "Projects",
      "Reference.md",
      "Spaced.md",
    ]);
  });

  it("rejects malformed Bases YAML instead of inventing a partial graph", () => {
    expect(() => extractBasesExplicitReferences("filters: [unterminated")).toThrow(
      "Cannot parse Bases source.",
    );
  });
});

describe("isExternalReference", () => {
  it.each(["https://example.com", "mailto:user@example.com", "//example.com", "obsidian://open"])(
    "recognizes %s as external",
    (value) => expect(isExternalReference(value)).toBe(true),
  );

  it.each(["Note", "Folder/Note.md", "#Heading", "image.png"])(
    "keeps %s in the Vault namespace",
    (value) => expect(isExternalReference(value)).toBe(false),
  );
});
