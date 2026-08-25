import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DOCUMENTS = Object.freeze([
  "product-requirements",
  "ux-spec",
  "architecture",
  "testing-strategy",
  "release",
]);
const LEGACY_DOCUMENTS = Object.freeze([
  "docs/product.en.md",
  "docs/product.zh-CN.md",
  "docs/ux.en.md",
  "docs/ux.zh-CN.md",
]);

function parseDocument(source, relativePath, expectedFrontmatter) {
  const normalized = source.replaceAll("\r\n", "\n");
  const frontmatter = /^---\n([\s\S]*?)\n---\n\n([\s\S]+)$/u.exec(normalized);
  if (frontmatter === null) {
    throw new Error(`${relativePath} must start with canonical YAML frontmatter`);
  }
  const actualFrontmatter = frontmatter[1]?.split("\n") ?? [];
  if (JSON.stringify(actualFrontmatter) !== JSON.stringify(expectedFrontmatter)) {
    throw new Error(
      `${relativePath} frontmatter must be exactly:\n${expectedFrontmatter.join("\n")}`,
    );
  }
  const body = frontmatter[2] ?? "";
  const headings = [...body.matchAll(/^(#{1,6})\s+.+$/gmu)].map((match) =>
    (match[1] ?? "").length
  );
  if (!body.startsWith("# ") || !body.includes("\n## ") || headings[0] !== 1) {
    throw new Error(`${relativePath} must contain one H1 followed by at least one H2`);
  }
  if (headings.filter((level) => level === 1).length !== 1) {
    throw new Error(`${relativePath} must contain exactly one H1`);
  }
  if (/Orphan files|孤儿文件/iu.test(body)) {
    throw new Error(`${relativePath} contains retired orphan-file terminology`);
  }
  if (!body.includes("Link Integrity")) {
    throw new Error(`${relativePath} must identify Link Integrity`);
  }
  return headings;
}

export async function checkDocsI18n(projectRoot = process.cwd()) {
  for (const relativePath of LEGACY_DOCUMENTS) {
    if (existsSync(path.join(projectRoot, relativePath))) {
      throw new Error(`${relativePath} is a retired authority; use the canonical document name`);
    }
  }

  for (const document of DOCUMENTS) {
    const sourcePath = `docs/${document}.zh-CN.md`;
    const translationPath = `docs/${document}.en.md`;
    const [source, translation] = await Promise.all([
      readFile(path.join(projectRoot, sourcePath), "utf8"),
      readFile(path.join(projectRoot, translationPath), "utf8"),
    ]);
    const sourceHeadings = parseDocument(source, sourcePath, [
      "source_language: zh-CN",
      "translation_status: source",
    ]);
    const translationHeadings = parseDocument(translation, translationPath, [
      "source_language: zh-CN",
      `translation_of: ${document}.zh-CN.md`,
      "translation_status: synced",
    ]);
    if (JSON.stringify(sourceHeadings) !== JSON.stringify(translationHeadings)) {
      throw new Error(`${sourcePath} and ${translationPath} must have matching heading structures`);
    }
  }
  return DOCUMENTS.length * 2;
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (import.meta.url === entryPoint) {
  const count = await checkDocsI18n();
  process.stdout.write(`Stable documentation contract passed for ${count} files.\n`);
}
