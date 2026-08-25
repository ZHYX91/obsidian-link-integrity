import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error The documentation checker is an executable JavaScript module.
import { checkDocsI18n } from "../../scripts/check-docs-i18n.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryDirectories: string[] = [];
let fixtureRoot = "";

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "link-integrity-docs-"));
  temporaryDirectories.push(fixtureRoot);
  await cp(path.join(projectRoot, "docs"), path.join(fixtureRoot, "docs"), { recursive: true });
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("stable documentation contract", () => {
  it("accepts the five canonical synchronized document pairs", async () => {
    await expect(checkDocsI18n(fixtureRoot)).resolves.toBe(10);
  });

  it("rejects translation metadata that does not name its source", async () => {
    await replaceInDocument(
      "docs/product-requirements.en.md",
      "translation_of: product-requirements.zh-CN.md",
      "translation_of: product.zh-CN.md",
    );

    await expect(checkDocsI18n(fixtureRoot)).rejects.toThrow(
      /product-requirements\.en\.md frontmatter must be exactly/u,
    );
  });

  it("rejects structural drift between a source and its translation", async () => {
    await replaceInDocument(
      "docs/ux-spec.en.md",
      "## 7. Accessibility and mobile",
      "### 7. Accessibility and mobile",
    );

    await expect(checkDocsI18n(fixtureRoot)).rejects.toThrow(/matching heading structures/u);
  });

  it("rejects a retired document name as a second authority", async () => {
    await cp(
      path.join(fixtureRoot, "docs/product-requirements.en.md"),
      path.join(fixtureRoot, "docs/product.en.md"),
    );

    await expect(checkDocsI18n(fixtureRoot)).rejects.toThrow(/retired authority/u);
  });
});

async function replaceInDocument(filePath: string, search: string, replacement: string) {
  const absolutePath = path.join(fixtureRoot, filePath);
  const source = await readFile(absolutePath, "utf8");
  expect(source).toContain(search);
  await writeFile(absolutePath, source.replace(search, replacement));
}
