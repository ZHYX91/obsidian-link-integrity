import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DOCUMENTS = Object.freeze([
  "product-requirements",
  "ux-spec",
  "architecture",
  "testing-strategy",
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


function structuralShape(body) {
  const lists = [];
  const fences = [];
  const tables = [];
  let activeFence = null;
  for (const line of body.split("\n")) {
    const fence = /^\s*(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence != null) {
      if (activeFence == null) {
        activeFence = fence[1];
        fences.push((fence[2] ?? "").trim());
      } else if (
        fence[1][0] === activeFence[0] &&
        fence[1].length >= activeFence.length &&
        (fence[2] ?? "").trim().length === 0
      ) {
        activeFence = null;
      }
      continue;
    }
    if (activeFence != null) continue;
    const list = /^(\s*)(?:[-*+]|\d+[.)])\s+/u.exec(line);
    if (list != null) {
      lists.push(String(list[1].length) + ":" + (/^\s*\d/u.test(line) ? "ordered" : "bullet"));
    }
    if (/^\s*\|.*\|\s*$/u.test(line)) {
      tables.push(line.split("|").length - 2);
    }
  }
  if (activeFence != null) throw new Error("Stable document has an unclosed fenced code block");
  return { fences, lists, tables };
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
    const sourceBody = source.replace(/^---[\s\S]*?---\n\n/u, "");
    const translationBody = translation.replace(/^---[\s\S]*?---\n\n/u, "");
    if (JSON.stringify(structuralShape(sourceBody)) !== JSON.stringify(structuralShape(translationBody))) {
      throw new Error(sourcePath + " and " + translationPath +
        " must have matching list, fence, and table structures");
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
