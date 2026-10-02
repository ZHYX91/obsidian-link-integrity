import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error The repository checker is an executable JavaScript module.
import { checkRepositoryHygiene } from "../../scripts/check-repository-hygiene.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryDirectories: string[] = [];
let fixtureRoot = "";

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "link-integrity-hygiene-"));
  temporaryDirectories.push(fixtureRoot);
  await Promise.all([
    cp(path.join(projectRoot, "manifest.json"), path.join(fixtureRoot, "manifest.json")),
    cp(path.join(projectRoot, "CHANGELOG.md"), path.join(fixtureRoot, "CHANGELOG.md")),
    cp(path.join(projectRoot, ".github"), path.join(fixtureRoot, ".github"), { recursive: true }),
  ]);
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })));
});

describe("repository hygiene contract", () => {
  it("accepts the repository release links and issue routing", () => {
    expect(checkRepositoryHygiene(fixtureRoot)).toEqual([]);
  });

  it("rejects a stale Unreleased comparison", async () => {
    const file = path.join(fixtureRoot, "CHANGELOG.md");
    const source = await readFile(file, "utf8");
    await writeFile(file, source.replace("compare/0.2.8...HEAD", "compare/0.2.4...HEAD"));
    expect(checkRepositoryHygiene(fixtureRoot)).toContain(
      "CHANGELOG.md must compare Unreleased from 0.2.8",
    );
  });

  it("rejects missing structured issue forms and enabled blank issues", async () => {
    const config = path.join(fixtureRoot, ".github", "ISSUE_TEMPLATE", "config.yml");
    const source = await readFile(config, "utf8");
    await writeFile(config, source.replace("blank_issues_enabled: false", "blank_issues_enabled: true"));
    await rm(path.join(fixtureRoot, ".github", "ISSUE_TEMPLATE", "bug.yml"));
    const errors = checkRepositoryHygiene(fixtureRoot);
    expect(errors).toContain(".github/ISSUE_TEMPLATE/config.yml must disable blank issues");
    expect(errors).toContain("Missing structured issue form: .github/ISSUE_TEMPLATE/bug.yml");
  });
});
