# Link Integrity release contract

## 1. Scope

This document defines the blocking path from a tagged Link Integrity source revision to a GitHub Release. Repository checks, packaged-candidate validation, real Obsidian acceptance, GitHub publication, and Obsidian community-directory approval remain separate evidence boundaries.

The release workflow follows the same structure as the sibling Obsidian plugins: a read-only verification job produces one exact handoff, and a write-capable publication job consumes only that handoff. Repository governance settings such as Immutable Releases or tag rulesets are optional protections and are not release preconditions.

## 2. Identity, version, and source

- The package name is `obsidian-link-integrity`; the manifest ID is `link-integrity`.
- `manifest.json`, `package.json`, the lockfile root, `versions.json`, and the Release tag use the same version.
- The tag is strict stable `x.y.z`, without a `v` prefix, leading zero, prerelease, or build metadata.
- The tag points exactly to a commit in the default branch history.
- Node `24.18.0` and npm `11.16.0` are used with the frozen lockfile.
- Third-party GitHub Actions are pinned to full commit SHAs.

## 3. Blocking gate

Before publication, `npm run release:check` runs the runtime, lint, formatting, documentation, TypeScript, test, coverage, production-bundle, release-contract, and 10,000/50,000-file performance gates.

## 4. Release assets

The public Release contains exactly:

- `main.js`
- `manifest.json`
- `styles.css`
- `link-integrity-<version>.zip`

The workflow handoff additionally contains `SHA256SUMS`; it is not a public Release asset. The deterministic ZIP contains a single `link-integrity/` installation directory and the same three loose assets byte for byte.

Candidate validation rejects missing or extra files, symbolic links, unsafe ZIP paths, identity or version mismatches, and checksum mismatches.

## 5. Handoff and publication

The verification job uploads one artifact named with the current run ID and attempt. It records the exact artifact ID and server digest. The publication job does not checkout the repository, install dependencies, build, or execute repository scripts. It downloads the artifact by ID, verifies its identity, digest, inventory, checksums, and manifest version, then creates a Release for the existing tag with generated notes.

The workflow refuses to overwrite an existing same-tag Release. A changed publication requires a higher version.

## 6. Provenance and final verification

GitHub attestations cover all four public assets. After publication, the workflow reads the Release back, requires a non-draft, non-prerelease state and the exact four-asset inventory, downloads every asset, compares it byte for byte with the verified candidate, and verifies its repository, workflow signer, source ref, source commit, and non-self-hosted runner provenance.

## 7. Marketplace boundary

Creating a GitHub Release does not publish the plugin in Obsidian's community directory. The maintainer must separately submit the repository through the Obsidian community-plugin submission site. The directory reads `manifest.json` from the default branch, while installation consumes the matching GitHub Release assets.

## 8. Evidence record

Each release retains the aggregate-gate logs, exact runtime, bundle budget result, candidate artifact ID and digest, four public asset checksums, attestations, final Release readback, and tag identity. A green workflow proves the release transaction; it does not replace physical-device or broader production-Vault acceptance.
