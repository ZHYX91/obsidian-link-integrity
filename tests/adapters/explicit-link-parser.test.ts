import { WorkScheduler } from "../../src/scheduling/work-scheduler";
import { describe, expect, it } from "vitest";

import {
  extractBasesExplicitReferences,
  extractMarkdownExplicitReferences,
  extractMarkdownExplicitReferencesAsync,
  isExternalReference,
} from "../../src/adapters/obsidian/explicit-link-parser";

describe("extractMarkdownExplicitReferences", () => {
  it.each(["\n", "\r\n", "\r"])("excludes HTML comments and raw code while retaining text offsets with %j", (newline) => {
    const source = [
      "😀 <!-- [[Ghost]] [ghost](Missing.md) --> [[Shown]]",
      "<pre class=\"x > y\">[[Hidden pre]]</pre> [[After pre]]",
      "<SCRIPT>[[Hidden script]]</SCRIPT>",
      "<style>[[Hidden style]]</style>",
      "<textarea>[[Hidden textarea]]</textarea>",
      "<span>[[Inline prose]]</span>",
      "`<!--` [[Literal comment token]] `<pre>` [[Literal tag]]",
      "<!-- unclosed [[Hidden end]]",
    ].join(newline);
    expect(extractMarkdownExplicitReferences(source)).toEqual(
      ["Shown", "After pre", "Inline prose", "Literal comment token", "Literal tag"].map((linktext) =>
        expect.objectContaining({ linktext, startOffset: source.indexOf(`[[${linktext}]]`) })),
    );
  });

  it.each([
    "> ~~~md\n> [[Ghost]]\n> ~~~\n[[Shown]]",
    "- ~~~md\n  [[Ghost]]\n  ~~~\n[[Shown]]",
    "> 1. ~~~~md\n>    [[Ghost]]\n>    ~~~~\n> [[Shown]]",
    "- > ```md\n  > [[Ghost]]\n  > ```\n  [[Shown]]",
    "> ~~~md\n> [[Ghost]]\n[[Shown]]",
    "- ~~~md\n  [[Ghost]]\n\n[[Shown]]",
    "> ~~~md\n> - ~~~\n> [[Ghost]]\n> ~~~\n[[Shown]]",
  ])("recognizes nested fences and their container boundary: %s", (source) => {
    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual(["Shown"]);
  });

  it("keeps invalid backtick fences and escaped HTML openers as content", () => {
    const source = "```bad`info [[Shown]]\n\\<!-- [[Escaped comment]]\n\\<pre>[[Escaped tag]]";
    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "Shown", "Escaped comment", "Escaped tag",
    ]);
  });

  it("masks raw HTML with multiline quoted attributes or no closing tag", () => {
    const source = '<pre data-value=" >\n[[Hidden attribute]]">\n[[Hidden body]]\n</pre> [[Shown]]\n<pre>[[Hidden end]]';
    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual(["Shown"]);
  });

  it.each(["<pre>", "<!--", "<script>"])("keeps HTML-like frontmatter values separate from body syntax: %s", (literal) => {
    const source = `---\nnote: "${literal}"\nlink: "[[Property]]"\n---\n[[Shown]]`;
    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual(["Property", "Shown"]);
  });

  it.each([
    "<!--\n```md\n[[Hidden]]\n-->\n[[Shown]]",
    "<pre>\n```md\n[[Hidden]]\n</pre>\n[[Shown]]",
    "%%\n```md\n[[Hidden]]\n%%\n[[Shown]]",
    "> <pre>\n> [[Hidden]]\n\n[[Shown]]",
    "> <!--\n> [[Hidden]]\n\n[[Shown]]",
    "> ~~~\n> [[Hidden]]\n\n> [[Shown]]",
    "before `<!--\n[[Hidden]]` after [[Shown]]",
    "    <!--\n\n[[Shown]]",
    "    <pre>\n\n[[Shown]]",
    "before `\n<!-- [[Ghost]] -->\n~~~\ncode\n~~~\nafter ` [[Shown]]",
    "before `\n<pre>[[Ghost]]</pre>\n~~~\ncode\n~~~\nafter ` [[Shown]]",
    '<span data-value="<pre>">[[Shown]]</span>',
    '<span data-value="\n<pre>\n">[[Shown]]</span>',
    '<span data-value="\n<!--\n">[[Shown]]</span>',
    '<broken\n<!-- [[Ghost]] -->\n[[Shown]]',
    '<broken\n<span data-value="<!--">[[Shown]]</span>',
    '<span data-value="\n<!-- [[Ghost]] -->\n[[Shown]]',
    '<pre\n>\n[[Ghost]]\n</pre>\n[[Shown]]',
    'before <!--> [[Shown]]',
    'before <!---> [[Shown]]',
    '<broken a=\'\n<span data-value="\n<!--\n">[[Shown]]</span>',
  ])("keeps nested opaque syntax within its original block: %s", (source) => {
    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual(["Shown"]);
  });

  it("retains an angle-bracket destination whose filename resembles a raw tag", () => {
    expect(extractMarkdownExplicitReferences("[label](<pre>) [[Shown]]").map(({ linktext }) => linktext))
      .toEqual(["pre", "Shown"]);
  });

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

  it("does not hide explicit links between escaped backticks, while real code stays masked", () => {
    const source = [
      "\\` [broken](Missing.md) \\`",
      "\\` [[Missing wiki]] \\`",
      "\\\\\\` [also broken](Second.md) \\\\\\`",
      "\\\\` [hidden](InCode.md) ` [visible](Visible.md)",
    ].join("\n");
    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual([
      "Missing.md", "Missing wiki", "Second.md", "Visible.md",
    ]);
  });

  it("can start a shorter code delimiter after an escaped first backtick", () => {
    const source = "\\``` [[masked]] `` [[shown]]";
    expect(extractMarkdownExplicitReferences(source).map(({ linktext }) => linktext)).toEqual(["shown"]);
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

  it.each(["\n", "\r\n", "\r"])("measures indented code inside its containers without shifting offsets with %j", (newline) => {
    const cases = [
      ">     [[Ghost]]",
      "> >     [[Ghost]]",
      "- item\n\n      [[Ghost]]",
      "10. item\n\n        [[Ghost]]",
      "1000. item\n\n          [[Ghost]]",
      "-   \n\n      [[Ghost]]",
      "10.   \n\n        [[Ghost]]",
      "- > item\n  >\n  >     [[Ghost]]",
      "> - item\n>\n>       [[Ghost]]",
      "-\titem\n\n\t\t[[Ghost]]",
      ">\t\t[[Ghost]]",
      "-     [[Ghost]]",
      "- first\n-     [[Ghost]]",
      "paragraph\n>     [[Ghost]]",
      "# heading\n    [[Ghost]]",
      "- - -\n    [[Ghost]]",
      "> * * *\n>     [[Ghost]]",
      "<pre>\n</pre>\n    [[Ghost]]",
      "> <pre>\n> </pre>\n>     [[Ghost]]",
      "<!--\n-->\n    [[Ghost]]",
      ">     - ```\n>     [[Ghost]]\n[[Shown]]",
      ">     <!--\n\n[[Shown]]",
      ">     <pre>\n\n[[Shown]]",
      "- item\n\n      <!--\n\n  [[Shown]]",
      ">    [[Shown]]",
      "- item\n\n    [[Shown]]",
      "-   \n\n    [[Ghost]]",
      "10. item\n\n      [[Shown]]",
      "- first\n  - second\n\n      [[Shown]]",
      "> - item\n>\n>     [[Shown]]",
      "-\titem\n\n\t  [[Shown]]",
      "> paragraph\n>     [[Shown]]",
      "- item\n      [[Shown]]",
      "- item\nlazy continuation\n\n    [[Shown]]",
      "> item\nlazy continuation\n>     [[Shown]]",
      ">     [[Ghost]]\n>\n>    [[Shown]]",
      "-     [[Ghost]]\n\n    😀 [[Shown]]",
      "paragraph <!-- inline -->\n    [[Shown]]",
      "paragraph <!--\n-->\n    [[Shown]]",
    ];
    for (const example of cases) {
      const source = `😀${newline}${newline}${example.replaceAll("\n", newline)}`;
      const shown = source.indexOf("[[Shown]]");
      expect(extractMarkdownExplicitReferences(source), example).toEqual(shown < 0 ? [] : [
        expect.objectContaining({ linktext: "Shown", startOffset: shown }),
      ]);
    }
  });

  it.each(["\n", "\r\n", "\r"])("uses block context before accepting list markers, setext and definitions with %j", (newline) => {
    // CommonMark 0.31.2: list interruption exceptions, examples 97, 207, 213,
    // 216, 280 and 285. An empty item's marker line is its first blank line.
    const cases: readonly [string, boolean][] = [
      ["paragraph\n2. item\n\n    [[Target]] [[Missing]]", false],
      ["paragraph\n-\n\n    [[Target]] [[Missing]]", false],
      ["-   \n\n    [[Target]] [[Missing]]", false],
      ["==\n    [[Target]] [[Missing]]", true],
      ["[id]: /url\n    [[Target]] [[Missing]]", false],
      ["paragraph\n1. item\n\n    [[Target]] [[Missing]]", true],
      ["paragraph\n01. item\n\n    [[Target]] [[Missing]]", true],
      ["paragraph\n+\n\n    [[Target]] [[Missing]]", false],
      ["paragraph\n1.\n\n    [[Target]] [[Missing]]", false],
      ["-   \n    [[Target]] [[Missing]]", true],
      ["- item\n\n\n    [[Target]] [[Missing]]", true],
      ["-\n      code\n\n    [[Target]] [[Missing]]", true],
      ["paragraph\n==\n    [[Target]] [[Missing]]", false],
      ["[id]: /url\n==\n    [[Target]] [[Missing]]", true],
      ["paragraph\n[id]: /url\n    [[Target]] [[Missing]]", true],
      ["[id]: /url \"title\"\n    [[Target]] [[Missing]]", false],
      ["[id]: /url \"title\" prose\n    [[Target]] [[Missing]]", true],
      ["> paragraph\n> 2. item\n>\n>     [[Target]] [[Missing]]", false],
      ["- paragraph\n  2. item\n\n      [[Target]] [[Missing]]", false],
      ["> -\n>\n>     [[Target]] [[Missing]]", false],
      ["> -\n\n>     [[Target]] [[Missing]]", false],
      ["- >\n\n    [[Target]] [[Missing]]", true],
      ["1. first\n2. second\n\n    [[Target]] [[Missing]]", true],
      ["[id]:\n    /url\n    [[Target]] [[Missing]]", false],
      ["[id]: /url\n    \"title\"\n    [[Target]] [[Missing]]", false],
      ["[id]: /url 'multi\n    line'\n    [[Target]] [[Missing]]", false],
      ["> [id]:\n/url\n>     [[Target]] [[Missing]]", false],
      ["[id]:\n    [[Target]] [[Missing]]", true],
      ["[id]: <my url> (title)\n    [[Target]] [[Missing]]", false],
      ["[id]: foo(bar)\n    [[Target]] [[Missing]]", false],
      ["[id]: foo(bar\n    [[Target]] [[Missing]]", true],
      ["[id]: <url\\>\n    [[Target]] [[Missing]]", true],
      ["[id]: url\u00a0part\n    [[Target]] [[Missing]]", false],
      ["[id]: /url \"unclosed\n    [[Target]] [[Missing]]", true],
    ];
    for (const [example, visible] of cases) {
      const source = `😀${newline}${newline}${example.replaceAll("\n", newline)}`;
      expect(extractMarkdownExplicitReferences(source), example).toEqual(visible ? ["Target", "Missing"].map((linktext) =>
        expect.objectContaining({ linktext, startOffset: source.indexOf(`[[${linktext}]]`) })) : []);
    }
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
      "Invalid Bases source.",
    );
  });

  it("requires the entire first link argument to be a literal, independent of the display argument", () => {
    const formulas = [
      'link("Projects/" + file.name)', 'link("Real.md".replace("R", "S"))',
      'link("Real.md" [0])', 'link("Real.md" || file.name)', 'file.link("Method.md")',
      'link(file.name)', 'link("Real.md", file.name)', 'link(\n"Other.md"\n)',
    ];
    const source = `formulas:\n${formulas.map((value, index) =>
      `  f${index}: ${JSON.stringify(value)}`).join("\n")}`;
    expect(extractBasesExplicitReferences(source).map(({ linktext }) => linktext))
      .toEqual(["Real.md", "Other.md"]);
  });

  it("keeps exact plain offsets but does not invent positions after YAML decoding", () => {
    const exact = 'formulas:\n  target: \'link("Real.md")\'\n';
    expect(extractBasesExplicitReferences(exact)[0]).toMatchObject({
      startOffset: exact.indexOf("link("),
    });
    for (const source of [
      'formulas:\n  target: >-\n    if(true,\n      link("Real.md"),\n      null)\n',
      `formulas:\n  target: ${JSON.stringify('link("Real.md")')}\n`,
      'formulas:\n  target: \'link(\'\'Real.md\'\')\'\n',
    ]) {
      expect(extractBasesExplicitReferences(source)).toEqual([
        expect.objectContaining({ linktext: "Real.md", exactPosition: false }),
      ]);
    }
  });

  it("preserves repeated references even when exact decoded positions are unavailable", () => {
    const source = `formulas:\n  target: ${JSON.stringify('if(true, link("A"), link("A"))')}\n`;
    expect(extractBasesExplicitReferences(source).map(({ linktext }) => linktext)).toEqual(["A", "A"]);
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
