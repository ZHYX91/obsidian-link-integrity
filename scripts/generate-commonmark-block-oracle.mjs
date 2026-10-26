import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const sourceUrl = "https://cdn.jsdelivr.net/npm/commonmark@0.31.2/dist/commonmark.js";
const sourceSha256 = "4d124568b8d4490df72fea8aa0f9a144c5b581b0de0eb63d3a996104b2797edc";
const output = new URL("../tests/fixtures/commonmark-block-oracle.json", import.meta.url);
assert.ok(["--write", "--check"].includes(process.argv[2]) && process.argv.length === 3,
  "Usage: node scripts/generate-commonmark-block-oracle.mjs --write|--check");
const response = await fetch(sourceUrl);
assert.equal(response.status, 200, "Official CommonMark distribution unavailable");
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(createHash("sha256").update(bytes).digest("hex"), sourceSha256,
  "CommonMark distribution differs from the reviewed pinned bytes");
const module = { exports: {} };
vm.runInNewContext(bytes.toString("utf8"), { module, exports: module.exports });
const parser = new module.exports.Parser();
const renderer = new module.exports.HtmlRenderer();
const pair = "[[Target]] [[Missing]]";
const prefixes = [
  "paragraph", "paragraph\n2. item", "paragraph\n1. item", "paragraph\n01. item",
  "paragraph\n-", "paragraph\n+", "paragraph\n1.", "paragraph\n==", "==",
  "-", "-   ", "- item", "1. item", "10. item", "> paragraph", "> -", "- -", "- >",
  "> [id]: /url", "[id]: /url", "[id]:", "[id]:\n    /url", '[id]: /url "title"',
  '[id]: /url "title" prose', '[id]: /url\n  "title"', '[id]: /url "a\nb"',
  '[id]: /url "a\n==\nb"', "[a\n==\nb]: /url", "[id]: <my url>", "[id]: foo(bar)",
  "[id]: foo(bar", "[id]: <>", "- item\n2. item", "> item\n2. item", "-\n      code",
];
const blankLines = [0, 1, 2];
const quotePrefixes = ["", "> "];
const indents = [0, 2, 3, 4, 5, 6, 8, 10];
const expected = (source) => {
  const root = parser.parse(source);
  const walker = root.walker();
  let event;
  let text = "";
  while ((event = walker.next()) !== null) {
    if (event.entering && event.node.type === "text") text += event.node.literal;
  }
  // Wiki syntax is literal text to CommonMark. Only actual text nodes count;
  // code blocks/spans, HTML and stripped definitions do not create this pair.
  return { count: text.includes(pair) ? 2 : 0, html: renderer.render(root) };
};
const expectedByPrefix = prefixes.map((prefix) => {
  let row = "";
  for (const blank of blankLines) for (const quote of quotePrefixes) for (const indent of indents) {
    const source = "😀\n\n" + prefix + "\n" + "\n".repeat(blank) + quote + " ".repeat(indent) + pair;
    row += String(expected(source).count);
  }
  return row;
});
const examples = [
  ["paragraph-non-1-marker", "paragraph\n2. item\n\n    "],
  ["paragraph-setext", "paragraph\n-\n\n    "],
  ["empty-item-second-blank", "-   \n\n    "],
  ["standalone-underline", "==\n    "],
  ["definition-continuation", "[id]: /url\n    "],
  ["definition-non-1-marker", "[id]: /url\n2. item\n\n    "],
  ["definition-blank-code", "[id]: /url\n\n    "],
  ["definition-blank-list", "[id]: /url\n\n2. item\n\n    "],
  ["definition-empty-marker", "[id]: /url\n-\n    "],
  ["definition-empty-marker-blank", "[id]: /url\n-\n\n    "],
  ["definition-no-heading-body", "[id]: /url\n==\n    "],
  ["definition-heading-body", "[id]: /url\nbody\n==\n    "],
  ["definition-second-underline", "[id]: /url\n==\n==\n    "],
  ["consecutive-definitions", "[a]: /a\n[b]: /b\n    "],
  ["consecutive-definitions-underline", "[a]: /a\n[b]: /b\n==\n    "],
  ["consecutive-definitions-heading", "[a]: /a\n[b]: /b\nbody\n==\n    "],
  ["definition-title", '[id]: /url "title"\n    '],
  ["definition-extra-prose", '[id]: /url "title" prose\n    '],
  ["definition-multiline-destination", "[id]:\n    /url\n    "],
  ["definition-next-line-title", '[id]: /url\n    "title"\n    '],
  ["definition-multiline-title", "[id]: /url 'multi\n    line'\n    "],
  ["definition-title-setext", "[id]: /url 'multi\n==\nline'\n==\n    "],
  ["definition-label-setext", "[multi\n==\nline]: /url\n==\n    "],
  ["definition-in-paragraph", "paragraph\n[id]: /url\n    "],
  ["quoted-definition", "> [id]: /url\n>     "],
  ["lazy-quoted-definition", "> [id]:\n/url\n>     "],
  ["list-definition", "- [id]: /url\n      "],
  ["list-definition-code", "- [id]: /url\n\n      "],
  ["list-definition-prose", "- [id]: /url\n\n    "],
  ["definition-missing-destination", "[id]:\n    "],
  ["definition-angle-title", "[id]: <my url> (title)\n    "],
  ["definition-balanced-destination", "[id]: foo(bar)\n    "],
  ["definition-unbalanced-destination", "[id]: foo(bar\n    "],
  ["definition-unclosed-angle", "[id]: <url\\>\n    "],
  ["definition-non-ascii-space", "[id]: url\u00a0part\n    "],
  ["definition-unclosed-title", '[id]: /url "unclosed\n    '],
  ["paragraph-leading-zero-list", "paragraph\n01. item\n\n    "],
  ["paragraph-empty-bullet", "paragraph\n+\n\n    "],
  ["paragraph-empty-ordered", "paragraph\n1.\n\n    "],
  ["empty-item-first-content", "-   \n    "],
  ["populated-item-blank-lines", "- item\n\n\n    "],
  ["empty-item-code-then-prose", "-\n      code\n\n    "],
  ["quoted-non-1-marker", "> paragraph\n> 2. item\n>\n>     "],
  ["nested-non-1-marker", "- paragraph\n  2. item\n\n      "],
  ["quoted-empty-list", "> -\n>\n>     "],
  ["quote-ending-empty-list", "> -\n\n>     "],
  ["list-containing-empty-quote", "- >\n\n    "],
  ["ordered-sibling", "1. first\n2. second\n\n    "],
].map(([id, prefix]) => {
  const markdown = prefix + pair;
  return { id, markdown, ...expected(markdown) };
});
const oracle = {
  schemaVersion: 1,
  oracle: {
    implementation: "Official CommonMark.js", version: "0.31.2", sourceUrl, sourceSha256,
    specification: "https://spec.commonmark.org/0.31.2/",
    algorithm: "https://github.com/commonmark/commonmark.js/blob/0.31.2/lib/blocks.js",
  },
  matrix: { preamble: "😀\n\n", pair, prefixes, blankLines, quotePrefixes, indents, expectedByPrefix },
  examples,
};
const encoded = JSON.stringify(oracle, null, 2) + "\n";
if (process.argv[2] === "--write") await writeFile(output, encoded);
else assert.equal(await readFile(output, "utf8"), encoded, "CommonMark block oracle is stale");
process.stdout.write(JSON.stringify({
  status: process.argv[2] === "--write" ? "written" : "verified",
  sourceSha256, matrixCases: prefixes.length * blankLines.length * quotePrefixes.length * indents.length,
  examples: examples.length,
}) + "\n");
