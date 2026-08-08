import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const release = readFileSync(".github/workflows/release.yml", "utf8");
const publish = release.split("\n  publish:\n", 2)[1] ?? "";

describe("workflow supply-chain contract", () => {
  it("publishes only from a numeric version tag after the canonical release gate", () => {
    expect(release).toContain('- "[0-9]*.[0-9]*.[0-9]*"');
    expect(release).not.toContain("workflow_dispatch:");
    expect(release).toContain('node scripts/check-release-version.mjs "$GITHUB_REF_NAME"');
    expect(release).toContain("run: npm run release:check");
    expect(release).toContain(
      'git merge-base --is-ancestor "$GITHUB_SHA" "origin/${{ github.event.repository.default_branch }}"',
    );
  });

  it("keeps every multiline shell block syntactically valid", () => {
    for (const [fileName, source] of [["ci.yml", ci], ["release.yml", release]] as const) {
      const blocks = extractRunBlocks(source);
      expect(blocks.length).toBeGreaterThan(0);
      blocks.forEach((block, index) => {
        const result = spawnSync("bash", ["-n"], {
          encoding: "utf8",
          input: block,
          windowsHide: true,
        });
        expect(result.status, `${fileName} run block ${index + 1}: ${result.stderr}`).toBe(0);
      });
    }
  }, 15_000);

  it("pins actions, runner, Node.js, and npm", () => {
    const workflows = `${ci}\n${release}`;
    const actionReferences = [...workflows.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/gu)].map(
      (match) => match[1] ?? "",
    );
    expect(actionReferences.length).toBeGreaterThan(0);
    expect(actionReferences.every((reference) => /^[0-9a-f]{40}$/u.test(reference))).toBe(true);
    expect(workflows).toContain("runs-on: ubuntu-24.04");
    expect(workflows).toContain("node-version: 24.18.0");
    expect(workflows).toContain("npm@11.16.0");
  });

  it("hands publish one exact current-run artifact", () => {
    expect(release).toContain(
      "name: link-integrity-release-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(release).toContain("overwrite: false");
    expect(release).toContain("artifact-id");
    expect(release).toContain("artifact-digest");
    expect(publish).toContain("/actions/artifacts/$EXPECTED_ARTIFACT_ID");
    expect(publish).toContain(".workflow_run.id == $run_id");
    expect(publish).toContain(".workflow_run.head_sha == $sha");
    expect(publish).toContain('.digest == $digest');
    expect(publish).toContain('$(sha256sum "$transport_zip"');
  });

  it("publishes exactly the four Obsidian assets and keeps checksums private", () => {
    expect(publish).toContain(
      "expected_names=\"$(printf '%s\\n' SHA256SUMS \"link-integrity-$GITHUB_REF_NAME.zip\" main.js manifest.json styles.css",
    );
    expect(publish).toContain("(cd \"$RUNNER_TEMP/release\" && sha256sum --check SHA256SUMS)");

    const attestationBlock = publish.match(
      /subject-path:\s*\|([\s\S]*?)\n\s+- name: Publish GitHub Release/u,
    )?.[1] ?? "";
    expect(attestationBlock).toContain("main.js");
    expect(attestationBlock).toContain("manifest.json");
    expect(attestationBlock).toContain("styles.css");
    expect(attestationBlock).toContain("link-integrity-");
    expect(attestationBlock).not.toContain("SHA256SUMS");
  });

  it("keeps publication isolated from checked-out project code", () => {
    expect(publish).toContain("actions: read");
    expect(publish).toContain("attestations: write");
    expect(publish).toContain("contents: write");
    expect(publish).toContain("id-token: write");
    expect(publish).not.toContain("actions/checkout");
    expect(publish).not.toContain("actions/setup-node");
    expect(publish).not.toMatch(/npm (?:ci|install|run)/u);
    expect(publish).not.toMatch(/node\s+scripts\//u);
    expect(publish).not.toContain("$GITHUB_WORKSPACE");
  });

  it("uses the shared direct-release flow without repository-governance preconditions", () => {
    expect(publish).toContain('gh release create "$GITHUB_REF_NAME"');
    expect(publish).toContain("--generate-notes");
    expect(publish).toContain("--verify-tag");
    expect(publish).not.toContain("--clobber");
    expect(release).not.toContain("immutable_releases_confirmed");
    expect(release).not.toContain("protected_numeric_tags_confirmed");
    expect(release).not.toContain("github-release-contract.mjs");
    expect(release).not.toContain("verify-release-source.mjs");
  });

  it("verifies published bytes and provenance", () => {
    expect(publish).toContain("gh release download");
    expect(publish).toContain('cmp --silent "$RUNNER_TEMP/release/$name"');
    expect(publish).toContain("gh attestation verify");
    expect(publish).toContain("--deny-self-hosted-runners");
    expect(publish).toContain("--source-digest \"$GITHUB_SHA\"");
    expect(publish).toContain(
      'select(.draft == false and .prerelease == false)',
    );
  });
});

function extractRunBlocks(source: string): string[] {
  const lines = source.split(/\r?\n/u);
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*\|\s*$/u.exec(lines[index] ?? "");
    if (!match) continue;
    const contentIndent = (match[1]?.length ?? 0) + 2;
    const block: string[] = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.length === 0) {
        block.push("");
        continue;
      }
      const indentation = /^\s*/u.exec(line)?.[0].length ?? 0;
      if (indentation < contentIndent) {
        index -= 1;
        break;
      }
      block.push(line.slice(contentIndent));
    }
    blocks.push(`${block.join("\n")}\n`);
  }
  return blocks;
}
