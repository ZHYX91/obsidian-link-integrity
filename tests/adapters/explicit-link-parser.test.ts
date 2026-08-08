import { describe, expect, it } from "vitest";

import {
  extractBasesExplicitReferences,
  extractMarkdownExplicitReferences,
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

  it("pairs one- and two-backtick spans independently without crossing lines", () => {
    const source = [
      "`[[one]]` ``[[two]]`` [[kept]]",
      "`[[unclosed]]",
      "[[next line]]",
    ].join("\n");

    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "kept",
      "unclosed",
      "next line",
    ]);
  });
});

describe("extractBasesExplicitReferences", () => {
  it("keeps explicit link literals without treating dynamic membership as an edge", () => {
    const source = [
      "filters:",
      "  and:",
      "    - 'file.folder == [[Projects]]'",
      "properties:",
      "  related: 'link(\"Reference.md\")'",
      "  dynamic: 'file.hasTag(\"active\")'",
      "# [[Commented.md]]",
    ].join("\n");

    expect(extractBasesExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "Projects",
      "Reference.md",
    ]);
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
