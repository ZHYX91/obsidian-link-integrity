import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultProjectRoot = path.resolve(path.dirname(scriptPath), "..");

export function checkRepositoryHygiene(projectRoot = defaultProjectRoot) {
  const errors = [];
  const manifest = JSON.parse(readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
  const changelog = readFileSync(path.join(projectRoot, "CHANGELOG.md"), "utf8");
  const versions = [...changelog.matchAll(/^## \[([0-9]+\.[0-9]+\.[0-9]+)\]/gmu)]
    .map((match) => match[1] ?? "");
  if (!versions.includes(manifest.version)) {
    errors.push(`CHANGELOG.md is missing the current manifest version: ${manifest.version}`);
  }
  const expectedUnreleased =
    `[Unreleased]: https://github.com/ZHYX91/obsidian-link-integrity/compare/${manifest.version}...HEAD`;
  if (!changelog.includes(expectedUnreleased)) {
    errors.push(`CHANGELOG.md must compare Unreleased from ${manifest.version}`);
  }
  for (const version of versions) {
    if (!new RegExp(`^\\[${escapeRegExp(version)}\\]: `, "mu").test(changelog)) {
      errors.push(`CHANGELOG.md is missing a link definition for ${version}`);
    }
  }

  const issueRoot = path.join(projectRoot, ".github", "ISSUE_TEMPLATE");
  const configPath = path.join(issueRoot, "config.yml");
  const config = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  if (!/^blank_issues_enabled:\s*false$/mu.test(config)) {
    errors.push(".github/ISSUE_TEMPLATE/config.yml must disable blank issues");
  }
  for (const [file, name] of [["bug.yml", "Bug report"], ["feature.yml", "Feature request"]]) {
    const formPath = path.join(issueRoot, file);
    if (!existsSync(formPath)) {
      errors.push(`Missing structured issue form: .github/ISSUE_TEMPLATE/${file}`);
      continue;
    }
    const source = readFileSync(formPath, "utf8");
    if (!source.includes(`name: ${name}`)) {
      errors.push(`.github/ISSUE_TEMPLATE/${file} must identify itself as ${name}`);
    }
    if (!/private Vault paths/iu.test(source) || !/note contents/iu.test(source)) {
      errors.push(`.github/ISSUE_TEMPLATE/${file} must warn against sharing private Vault data`);
    }
  }
  return errors;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const errors = checkRepositoryHygiene();
  if (errors.length > 0) {
    console.error("Repository hygiene contract failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Repository hygiene contract passed.");
  }
}
