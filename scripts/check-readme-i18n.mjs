import { access, readFile } from "node:fs/promises";
import path from "node:path";

const TRANSLATED_LOCALES = Object.freeze([
  "zh-CN",
  "zh-TW",
  "de",
  "fr",
  "ru",
  "pt-BR",
  "ja",
  "ko",
  "es",
  "vi",
]);
const ALL_READMES = Object.freeze([
  ["en", "README.md"],
  ...TRANSLATED_LOCALES.map((locale) => [locale, `docs/i18n/README.${locale}.md`]),
]);
const LANGUAGE_LINKS = Object.freeze([
  ["English", "README.md"],
  ["简体中文", "docs/i18n/README.zh-CN.md"],
  ["繁體中文", "docs/i18n/README.zh-TW.md"],
  ["Deutsch", "docs/i18n/README.de.md"],
  ["Français", "docs/i18n/README.fr.md"],
  ["Русский", "docs/i18n/README.ru.md"],
  ["Português (Brasil)", "docs/i18n/README.pt-BR.md"],
  ["日本語", "docs/i18n/README.ja.md"],
  ["한국어", "docs/i18n/README.ko.md"],
  ["Español", "docs/i18n/README.es.md"],
  ["Tiếng Việt", "docs/i18n/README.vi.md"],
]);

function assertReadmeContract(locale, source, filePath) {
  if (!source.startsWith("# Link Integrity\n")) {
    throw new Error(`${filePath} must start with the canonical product title`);
  }
  for (const token of ["link-integrity", "Broken links", "Isolated files", "data.json"]) {
    if (!source.includes(token)) {
      throw new Error(`${filePath} is missing required product token: ${token}`);
    }
  }
  if (/Orphan files|孤儿文件/iu.test(source)) {
    throw new Error(`${filePath} contains retired orphan-file terminology`);
  }
  for (const [label, target] of LANGUAGE_LINKS) {
    if (!source.includes(`[${label}](`) || !source.includes(target)) {
      throw new Error(`${filePath} must link to ${label} (${target})`);
    }
  }
  const headings = [...source.matchAll(/^##\s+(.+)$/gmu)].map((match) => match[1]);
  if (headings.length < 4) {
    throw new Error(`${filePath} must contain at least four H2 sections`);
  }
  if (locale === "en") {
    for (const heading of ["What it finds", "Install", "Privacy and data", "Status"]) {
      if (!headings.includes(heading)) {
        throw new Error(`${filePath} is missing required English section: ${heading}`);
      }
    }
  }
}

export async function checkReadmeI18n(projectRoot = process.cwd()) {
  await Promise.all(ALL_READMES.map(async ([locale, relativePath]) => {
    const filePath = path.join(projectRoot, relativePath);
    await access(filePath);
    const source = await readFile(filePath, "utf8");
    assertReadmeContract(locale, source.replaceAll("\r\n", "\n"), relativePath);
  }));
  return ALL_READMES.length;
}

const count = await checkReadmeI18n();
process.stdout.write(`README i18n contract passed for ${count} languages.\n`);
