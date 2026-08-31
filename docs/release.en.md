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

An ordinary tag push does not trigger publication. Commit, push, tag, workflow dispatch, GitHub
Release, and production-Vault deployment are separately authorized; Community Plugins inclusion is
not implied by a GitHub Release.

## Version and source

`manifest.json`, `package.json`, `package-lock.json`, and `versions.json` bind one canonical version
and exact commit/tree. A clean worktree must pass `npm run release:check`, including the quick/large
index guardrails and tag-identity gate.

## Candidate Bundle v3

The vendored release-core `2.0.0` and thin adapter create the sole Candidate Bundle v3 containing
`main.js`, `manifest.json`, `styles.css`, `link-integrity-x.y.z.zip`, `SHA256SUMS`, and
`candidate-bundle.json`. It binds the toolchain, core/config/workflow, product payload, scenario
contract, and fixture hashes; no parallel receipt, envelope, or manual restore directory exists.

## Product acceptance

The same Bundle requires desktop and Android-emulator acceptance covering broken-link and
isolated-file classification, expected periodic isolation, Markdown/embed/frontmatter/Canvas/Bases
edges, navigation, and equivalence between incremental updates and a full rebuild. Android physical
devices and iOS are out of scope.

## Standalone workflow

The generated, checked-in standalone workflow accepts only explicit `workflow_dispatch`. Its
read-only verify job performs one independent install and one complete `release:check` at the exact
commit, rebuilds the Bundle, and source-verifies it. The publish job downloads the fixed artifact
and performs transport verification without restoring or trusting `dist`.

## Publication and verification

The acceptance closure does not authorize publication; separate authorization binds the same
Bundle and closure. Before the first mutation, the workflow deeply validates the records, tag, and
read-only preflight. The public Release contains exactly the three loose assets and versioned ZIP;
`SHA256SUMS` and `candidate-bundle.json` remain in the private Bundle. Post-verification reads back
hosted bytes and provenance.

## Failure, rollback, and deployment

An existing same-tag Release is a zero-write no-op only when exact; any difference fails without
overwrite and fixes use a new version. Production-Vault deployment requires separate authorization
and preserves `data.json`. GitHub Release, Community Plugins review, and deployment results are
reported separately.
