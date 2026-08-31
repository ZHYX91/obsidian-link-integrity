---
source_language: zh-CN
translation_of: release.zh-CN.md
translation_status: synced
---

# Link Integrity — Release procedure

## 1. Scope

This document defines the blocking path from a tagged Link Integrity source revision to a GitHub Release. Repository checks, packaged-candidate validation, real Obsidian acceptance, GitHub publication, and Obsidian community-directory approval remain separate evidence boundaries.

The release workflow separates authority. A read-only verification job reproduces one exact
digest-bound handoff. Only a manual `publish` dispatch with a passing acceptance closure and a
separate, exact single-candidate authorization can start the write-capable job. Tag creation and
push are separate actions and do not trigger publication. The workflow does not preflight
repository-governance settings. Tag rulesets remain optional protection, but a successful
publication requires the created Release to report `immutable: true` during final readback.

## 2. Identity, version, and source

- The package name is `obsidian-link-integrity`; the manifest ID is `link-integrity`.
- `manifest.json`, `package.json`, the lockfile root, `versions.json`, and the Release tag use the same version.
- The tag is strict stable `x.y.z`, without a `v` prefix, leading zero, prerelease, or build metadata.
- The tag points exactly to a commit in the default branch history.
- Node `24.19.0` and npm `11.17.0` are used with the frozen lockfile.
- Third-party GitHub Actions are pinned to full commit SHAs.

## 3. Blocking gate

`npm run check` runs runtime, lint, formatting, documentation, TypeScript, coverage, production
bundle, and common vendored-core validation of metadata and exact asset inventory.
`npm run release:check` adds the 10,000/50,000-file performance gates and tag-aware validation.
A missing local same-version tag is allowed while preparing a candidate; an existing tag must
resolve exactly to `HEAD`, so a tag from another commit cannot be reused.

## 4. Release assets

The public Release contains exactly:

- `main.js`
- `manifest.json`
- `styles.css`
- `link-integrity-<version>.zip`

The workflow handoff additionally contains `candidate.json` and `SHA256SUMS`; neither is a
public Release asset. The deterministic ZIP contains a single `link-integrity/` installation
directory and the same three loose assets byte for byte.

Candidate validation rejects missing or extra files, symbolic links, unsafe ZIP paths, identity or version mismatches, and checksum mismatches.

## 5. Handoff and publication

The manual workflow defaults to `verify`. Its read-only job checks the exact candidate commit,
numeric tag, default-branch ancestry, pinned toolchain, complete gate, and reproduced
`candidate.json` digest, then uploads one artifact named by the stable workspace release-run ID.
It records the exact artifact ID and server digest.

The `publish` job checks out only the same candidate commit without persisted credentials and
does not install dependencies or rebuild. It downloads the artifact by ID, decodes the exact
portable closure and authorization bytes, verifies their independent digests and bindings, and
runs the vendored core publication boundary. Before any remote write, a read-only GitHub preflight
permits staging, attestation, and creation only when the Release is missing. An exact existing
Release whose bytes and provenance pass every check is a zero-write safe rerun; any conflict fails
before those writes, and `publish-github` repeats the check. A separate post-verification job
redownloads the same artifact and checks the hosted immutable state.

An existing same-tag Release is accepted as a successful safe-rerun no-op only when it is stable,
immutable, contains exactly the four public assets, matches the current candidate byte for byte,
and every provenance record binds the current tag and commit. Any difference fails. The workflow
never overwrites, edits, or appends to an existing Release; changed publication content requires a
higher version.

## 6. Provenance and final verification

GitHub attestations cover all four public assets. After publication, the workflow reads the Release back with bounded retries, requires a non-draft, non-prerelease, immutable state and the exact four-asset inventory, downloads every asset, compares it byte for byte with the verified candidate, and verifies its repository, workflow signer, source ref, source commit, and non-self-hosted runner provenance.

## 7. Marketplace boundary

Creating a GitHub Release does not publish the plugin in Obsidian's community directory. The maintainer must separately submit the repository through the Obsidian community-plugin submission site. The directory reads `manifest.json` from the default branch, while installation consumes the matching GitHub Release assets.

## 8. Evidence record

Each release retains the aggregate-gate logs, exact runtime, bundle budget result, candidate artifact ID and digest, four public asset checksums, attestations, final Release readback, and tag identity. A green workflow proves the release transaction; it does not replace desktop/Android-emulator or broader production-Vault acceptance. Android physical devices and iOS are out of scope.
