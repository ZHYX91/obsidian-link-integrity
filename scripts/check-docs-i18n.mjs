import { readFile } from "node:fs/promises";
import path from "node:path";

const DOCUMENTS = Object.freeze([
  "product",
  "ux",
  "architecture",
  "testing-strategy",
  "release",
]);

function assertDocument(source, relativePath) {
  const normalized = source.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("# ") || !normalized.includes("\n## ")) {
    throw new Error(`${relativePath} must contain one H1 and at least one H2`);
  }
  if (/Orphan files|孤儿文件/iu.test(normalized)) {
    throw new Error(`${relativePath} contains retired orphan-file terminology`);
  }
  if (!normalized.includes("Link Integrity")) {
    throw new Error(`${relativePath} must identify Link Integrity`);
  }
}

export async function checkDocsI18n(projectRoot = process.cwd()) {
  for (const document of DOCUMENTS) {
    for (const locale of ["en", "zh-CN"]) {
      const relativePath = `docs/${document}.${locale}.md`;
      const source = await readFile(path.join(projectRoot, relativePath), "utf8");
      assertDocument(source, relativePath);
    }
  }
  return DOCUMENTS.length * 2;
}

const count = await checkDocsI18n();
process.stdout.write(`Stable documentation contract passed for ${count} files.\n`);
