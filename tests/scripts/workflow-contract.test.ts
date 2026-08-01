import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const release = readFileSync(".github/workflows/release.yml", "utf8");
const publish = release.split("\n  publish:\n", 2)[1] ?? "";

describe("workflow supply-chain contract", () => {
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
        expect(
          result.status,
          `${fileName} run block ${index + 1}: ${result.stderr}`,
        ).toBe(0);
      });
    }
  }, 15_000);

  it("pins every action to a full commit and pins the runner, Node.js, and npm", () => {
    const workflows = `${ci}\n${release}`;
    const actionReferences = [
      ...workflows.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/gu),
    ].map((match) => match[1] ?? "");
    expect(actionReferences.length).toBeGreaterThan(0);
    expect(actionReferences.every((reference) => /^[0-9a-f]{40}$/u.test(reference))).toBe(
      true,
    );
    expect(workflows).toContain("runs-on: ubuntu-24.04");
    expect(workflows).toContain("node-version: 24.18.0");
    expect(workflows).toContain("npm@11.16.0");
  });

  it("keeps verification read-only and publication free of checkout and project execution", () => {
    const verify = release.split("\n  publish:\n", 1)[0];
    expect(verify).toContain("permissions:\n      contents: read");
    expect(publish).toContain("actions: read");
    expect(publish).toContain("attestations: write");
    expect(publish).toContain("contents: write");
    expect(publish).toContain("id-token: write");
    expect(publish).not.toContain("actions/checkout");
    expect(publish).not.toContain("actions/setup-node");
    expect(publish).not.toMatch(/npm (?:ci|install|run)/u);
    expect(publish).not.toMatch(/node\s+scripts\//u);
    expect(publish).not.toMatch(/(?:bash|sh)\s+scripts\//u);
    expect(publish).not.toContain("$GITHUB_WORKSPACE");
    expect(publish).toContain('source "$RUNNER_TEMP/release-inline.sh"');
    expect(publish).toContain('[[ "$RUNNER_ENVIRONMENT" == "github-hosted" ]]');
  });

  it("binds the handoff to run id, attempt, exact artifact id, owner, and GitHub digest", () => {
    expect(release).toContain('name="link-integrity-release-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"');
    expect(release).toContain("overwrite: false");
    expect(release).toContain("artifact-id");
    expect(release).toContain("artifact-digest");
    expect(publish).toContain("/actions/artifacts/$EXPECTED_ARTIFACT_ID");
    expect(publish).toContain("/actions/runs/$GITHUB_RUN_ID/artifacts");
    expect(publish).toContain(".run_attempt == $attempt");
    expect(publish).toContain(".repository.owner.login == $owner");
    expect(publish).toContain(".digest == $digest");
    expect(publish).toContain('sha256:$(sha256sum "$transport_zip"');
  });

  it("publishes exactly four assets while keeping SHA256SUMS inside the handoff", () => {
    expect(release).toContain("SHA256SUMS is handoff-only");
    expect(release).toContain('[[ "$(wc -l < "$candidate_dir/SHA256SUMS")" -eq 4 ]]');
    expect(release).toContain("unzip -Z1");
    expect(release).toContain('cmp --silent "$candidate_dir/$name" "$RUNNER_TEMP/archive-$name"');

    const attestationBlock = publish.match(
      /subject-path:\s*\|([\s\S]*?)\n\s+- name: Verify exact candidate provenance/u,
    )?.[1] ?? "";
    expect(attestationBlock).toContain("main.js");
    expect(attestationBlock).toContain("manifest.json");
    expect(attestationBlock).toContain("styles.css");
    expect(attestationBlock).toContain("link-integrity-");
    expect(attestationBlock).not.toContain("SHA256SUMS");

    const transactionBlock = publish.match(
      /- name: Create verified draft[\s\S]*?(?=\n\s+- name: Final immutable)/u,
    )?.[0] ?? "";
    expect(transactionBlock).toContain("draft: true, prerelease: false");
    expect(transactionBlock).toContain('for name in "${public_assets[@]}"; do');
    expect(transactionBlock).toContain(
      'upload_asset_to_draft "$created_draft_id" "$name" "$candidate_dir/$name"',
    );
    expect(transactionBlock).not.toContain("SHA256SUMS");
  });

  it("binds draft creation, exact upload, and publication to a new release id", () => {
    const transactionBlock = publish.match(
      /- name: Create verified draft[\s\S]*?(?=\n\s+- name: Final immutable)/u,
    )?.[0] ?? "";
    expect(transactionBlock).toContain("if: steps.release_state.outputs.decision == 'create'");
    expect(transactionBlock).toContain(
      'create_empty_draft "$create_request" "$created_draft_id_file"',
    );
    expect(transactionBlock).toContain(
      'IFS= read -r created_draft_id < "$created_draft_id_file"',
    );
    expect(transactionBlock).toContain(
      'upload_asset_to_draft "$created_draft_id"',
    );
    expect(transactionBlock).toContain('verify_uploaded_draft "$created_draft_id"');
    expect(transactionBlock).toContain(
      '"/repos/$GITHUB_REPOSITORY/releases/$created_draft_id" --field draft=false',
    );
    expect(transactionBlock.indexOf("create_empty_draft")).toBeLessThan(
      transactionBlock.indexOf("upload_asset_to_draft"),
    );
    expect(transactionBlock.indexOf("upload_asset_to_draft")).toBeLessThan(
      transactionBlock.indexOf("verify_uploaded_draft"),
    );
    expect(transactionBlock.indexOf("verify_uploaded_draft")).toBeLessThan(
      transactionBlock.indexOf("--field draft=false"),
    );
    expect(publish).toContain(
      'status="$(curl --silent --show-error --location --request POST',
    );
    expect(publish).toContain(
      '"$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/releases"',
    );
    expect(publish).toContain("jq --raw-output '.id'");
    expect(publish).toContain("collect_releases");
    expect(publish).toContain("?per_page=100&page=$page");
    expect(publish).not.toContain("gh release create");
    expect(publish).not.toContain("gh release upload");
    expect(publish.match(/--field draft=false/gu)).toHaveLength(1);
  });

  it("never tries to discover a draft through the published-only tag endpoint", () => {
    const capture = publish.match(
      /capture_empty_draft_id\(\) \{[\s\S]*?\n\s+\}/u,
    )?.[0] ?? "";
    expect(capture).toContain("collect_releases");
    expect(capture).not.toContain("/releases/tags/");
    expect(publish).toContain("empty_draft_payload_ready");
    expect(publish).toContain('status" == "201"');
    expect(publish).toContain(
      "link-integrity-release-candidate:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:${GITHUB_SHA}",
    );
    expect(publish).toContain('startswith($marker + "\\n\\n")');
  });

  it("enforces history, no-overwrite, bounded retries, provenance, and final tag identity", () => {
    expect(release).toContain("github-release-contract.mjs");
    expect(release).toContain("previous_tag_name");
    expect(release).toContain("immutable_releases_confirmed");
    expect(release).toContain("protected_numeric_tags_confirmed");
    expect(release).toContain("for attempt in 1 2 3 4 5");
    expect(release).toContain("for attempt in 1 2 3 4 5 6 7 8 9 10");
    expect(release).not.toContain("--clobber");
    expect(release).not.toContain("gh release edit");
    expect(release).not.toContain("gh release delete");
    expect(publish).toContain("--deny-self-hosted-runners");
    expect(publish).toContain("Verify exact candidate provenance before Release mutation");
    expect(publish).toContain(
      'verify_remote_release before true "$release_state_file"',
    );
    expect(publish).not.toContain("verify_remote_release before true ||");
    expect(publish).not.toContain('created_draft_id="$(create_empty_draft');
    expect(publish.match(/verify_tag_identity/gu)?.length).toBeGreaterThanOrEqual(5);
    expect(publish).toContain("verify_remote_release final false");
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
