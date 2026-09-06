---
source_language: zh-CN
translation_of: release.zh-CN.md
translation_status: synced
---

# Link Integrity — Release procedure

This document defines the repeatable Link Integrity release process. Source, the Candidate Bundle,
real Obsidian acceptance, GitHub publication, and Community Plugins state are separate evidence
boundaries.

## Boundaries

An authorized stable version tag push triggers publication. Manual dispatch on the same tag supports verify-only or publish mode through the same workflow. Host acceptance is optional; publishing does not deploy to a Vault.

## Version and source

`manifest.json`, `package.json`, `package-lock.json`, and `versions.json` bind one canonical version
and exact commit/tree. A clean worktree must pass `npm run release:check`, including the quick/large
index guardrails and tag-identity gate.

## Candidate Bundle v3

The vendored release-core `3.0.0` and thin adapter create the sole Candidate Bundle v3 containing
`main.js`, `manifest.json`, `styles.css`, `link-integrity-x.y.z.zip`, `SHA256SUMS`, and
`candidate-bundle.json`. It binds the toolchain, core/config/workflow, product payload, scenario
contract, and fixture hashes; no parallel receipt, envelope, or manual restore directory exists.

## Optional product acceptance

Use the same Bundle for desktop and Android-emulator acceptance covering broken-link and
isolated-file classification, expected periodic isolation, Markdown/embed/frontmatter/Canvas/Bases
edges, navigation, and equivalence between incremental updates and a full rebuild. Android physical
devices and iOS are out of scope.

## Standalone workflow

Tag push and manual dispatch use the same build, publish, and post-verification jobs. The read-only build job produces and verifies the Bundle. Publication downloads that fixed artifact without rebuilding and verifies the event, tag, commit, and Bundle digest before writing. Manual verify mode performs no publication.

## Publication and verification

Actions generates SLSA build provenance for the four public assets. The publisher verifies their source, tag and workflow, creates a draft, downloads and checks all draft assets, then publishes the immutable Release. A separate job checks the hosted release. Only the three loose files and versioned ZIP are public assets; Bundle metadata stays in the CI artifact. GitHub publication and Community Directory review are separate outcomes.

## Failure, rollback, and deployment

An existing same-tag Release is a zero-write no-op only when exact; any difference fails without
overwrite and fixes use a new version. Production-Vault deployment requires separate authorization
and preserves `data.json`. GitHub Release, Community Plugins review, and deployment results are
reported separately.
