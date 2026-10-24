import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTranslator, SUPPORTED_LOCALES } from "../../src/shared/i18n";

// @ts-expect-error The README checker is an executable JavaScript module.
import { checkReadmeI18n } from "../../scripts/check-readme-i18n.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryDirectories: string[] = [];
let fixtureRoot = "";

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "link-integrity-readme-"));
  temporaryDirectories.push(fixtureRoot);
  await Promise.all([
    cp(path.join(projectRoot, "README.md"), path.join(fixtureRoot, "README.md")),
    cp(path.join(projectRoot, "manifest.json"), path.join(fixtureRoot, "manifest.json")),
    cp(path.join(projectRoot, "LICENSE"), path.join(fixtureRoot, "LICENSE")),
    cp(path.join(projectRoot, "CHANGELOG.md"), path.join(fixtureRoot, "CHANGELOG.md")),
    cp(path.join(projectRoot, "CONTRIBUTING.md"), path.join(fixtureRoot, "CONTRIBUTING.md")),
    cp(path.join(projectRoot, "SECURITY.md"), path.join(fixtureRoot, "SECURITY.md")),
    cp(path.join(projectRoot, "docs"), path.join(fixtureRoot, "docs"), { recursive: true }),
  ]);
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("README marketplace link contract", () => {
  it("accepts the synchronized READMEs using the sidebar names in each reader's language", async () => {
    expect(checkReadmeI18n(fixtureRoot)).toEqual([]);
    for (const locale of SUPPORTED_LOCALES) {
      const relativePath = locale === "en" ? "README.md" : `docs/i18n/README.${locale}.md`;
      const source = await readFile(path.join(fixtureRoot, relativePath), "utf8");
      const { t } = createTranslator(locale, "en");
      expect(source, relativePath).toContain(t("sidebar.tab.broken"));
      expect(source, relativePath).toContain(t("sidebar.tab.isolated"));
    }
  });

  it("rejects replacing the Chinese interface names with English-only labels", async () => {
    const relativePath = "docs/i18n/README.zh-CN.md";
    const absolutePath = path.join(fixtureRoot, relativePath);
    const source = await readFile(absolutePath, "utf8");
    await writeFile(absolutePath, source.replaceAll("无效链接", "Broken links").replaceAll("孤立文件", "Isolated files"));
    expect(checkReadmeI18n(fixtureRoot)).toContain(`${relativePath} is missing required product term: 无效链接`);
    expect(checkReadmeI18n(fixtureRoot)).toContain(`${relativePath} is missing required product term: 孤立文件`);
  });

  it("rejects a repository-relative target in the English marketplace README", async () => {
    await replaceInReadme(
      "README.md",
      "[English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/README.md)",
      "[English](README.md)",
    );

    expect(checkReadmeI18n(fixtureRoot)).toContain(
      "README.md must use a canonical absolute GitHub target for repository content: README.md",
    );
  });

  it("rejects an absolute repository target in a translated README", async () => {
    await replaceInReadme(
      "docs/i18n/README.zh-CN.md",
      "[English](../../README.md)",
      "[English](https://github.com/ZHYX91/obsidian-link-integrity/blob/main/README.md)",
    );

    expect(checkReadmeI18n(fixtureRoot)).toContain(
      "docs/i18n/README.zh-CN.md must use a relative target for repository content: https://github.com/ZHYX91/obsidian-link-integrity/blob/main/README.md",
    );
  });

  it("rejects a missing translated image target", async () => {
    await replaceInReadme(
      "docs/i18n/README.zh-CN.md",
      "../assets/link-integrity-overview-en.png",
      "../assets/missing-overview.png",
    );

    expect(checkReadmeI18n(fixtureRoot)).toContain(
      "docs/i18n/README.zh-CN.md contains a missing relative target: ../assets/missing-overview.png",
    );
  });
  it("rejects omission of the advanced rule's connection-count warning", async () => {
    const guide = "docs/i18n/README.zh-TW.md";
    await replaceInReadme(guide, "從連結分析排除符合條件的連結（進階）", "一般結果顯示規則");
    expect(checkReadmeI18n(fixtureRoot)).toContain(
      `${guide} lacks the warning that advanced rules can change connection counts`,
    );
  });

  it("keeps examples separating missing incoming links from real isolation", async () => {
    const guide = "docs/i18n/README.de.md";
    await replaceInReadme(guide, "[[Missing]]", "ein nicht vorhandener Link");
    expect(checkReadmeI18n(fixtureRoot)).toContain(
      `${guide} must distinguish no incoming links from isolation with actual examples`,
    );
  });

  it("requires an explicit statement of the mobile host-test boundary", async () => {
    const guide = "docs/i18n/README.fr.md";
    await replaceInReadme(guide, "Android physiques et iOS", "Android physiques et autres appareils");
    expect(checkReadmeI18n(fixtureRoot)).toContain(
      `${guide} must distinguish mobile support from formal acceptance scope`,
    );
  });

  it("rejects internal implementation jargon in public README copy", async () => {
    await replaceInReadme(
      "README.md",
      "keeps it up to date as the Vault changes",
      "keeps the projection up to date as the Vault changes",
    );

    expect(checkReadmeI18n(fixtureRoot)).toContain(
      "README.md contains internal public-facing jargon: projection",
    );
  });

  it("rejects implementation-only FakeLink text in any translated guide", async () => {
    const guide = "docs/i18n/README.ar.md";
    const absolutePath = path.join(fixtureRoot, guide);
    const source = await readFile(absolutePath, "utf8");
    await writeFile(absolutePath, source + "\nFakeLink\n");
    expect(checkReadmeI18n(fixtureRoot)).toContain(
      "docs/i18n/README.ar.md exposes an implementation-only FakeLink term",
    );
  });

  it("rejects literal archive calques in Spanish and Brazilian Portuguese", async () => {
    await replaceInReadme(
      "docs/i18n/README.es.md",
      "archivos archivados",
      "archivos de archivo",
    );
    await replaceInReadme(
      "docs/i18n/README.pt-BR.md",
      "notas arquivadas",
      "arquivos de arquivo",
    );

    expect(checkReadmeI18n(fixtureRoot)).toEqual(expect.arrayContaining([
      "docs/i18n/README.es.md contains internal public-facing jargon: archivos de archivo",
      "docs/i18n/README.pt-BR.md contains internal public-facing jargon: arquivos de arquivo",
    ]));
  });

});

async function replaceInReadme(filePath: string, search: string, replacement: string) {
  const absolutePath = path.join(fixtureRoot, filePath);
  const source = await readFile(absolutePath, "utf8");
  expect(source).toContain(search);
  await writeFile(absolutePath, source.replace(search, replacement));
}
