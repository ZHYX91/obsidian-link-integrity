# Link Integrity release contract

## 1. Scope and principles

This document defines the blocking path from Link Integrity source code to a GitHub Release. The current repository work prepares and validates local code only; it does not authorize a push, tag, Release, or GitHub-settings change.

Release work has three permission domains:

1. CI validates source and the aggregate gate.
2. Prepare builds read-only and uploads one exact current-run candidate.
3. Publish neither checks out nor executes repository code; it validates the candidate, creates or confirms an immutable Release, and verifies provenance.

Automated gates, packaged-candidate verification, a real Obsidian host, and a real GitHub Actions run are four distinct forms of evidence. None substitutes for another.

## 2. Identity, version, and runtime

- The package/repository name is `obsidian-link-integrity`; the manifest ID is `link-integrity`.
- The version in `manifest.json`, `package.json`, the lockfile root, the current `versions.json` entry, and the Release tag must be identical.
- A tag is strict stable `x.y.z`: no `v`, leading zero, prerelease, or build metadata.
- `manifest.minAppVersion` equals the current-version mapping in `versions.json`.
- The first Release explicitly supports having no historical baseline.
- Node `24.18.0` and npm `11.16.0` are the shared local, CI, and release runtime contract; installation uses a frozen lockfile.

Every third-party GitHub Action is pinned to a full commit SHA, never a floating tag or branch.

## 3. One aggregate gate

The fail-closed aggregate gate covers, in order:

1. the Node/npm runtime contract;
2. lint and deterministic formatting checks;
3. 11-locale README navigation and stable paired English/Chinese documents;
4. strict TypeScript;
5. complete unit, differential, UI, and release-script tests;
6. the production bundle;
7. version, assets, deterministic ZIP, bundle budget, and workflow static contracts.

The blocking `main.js` budget has a measured local reference and records both the measurement and budget rationale in source. Prepare builds and archives independently from two clean directories and requires byte-identical `main.js` and ZIP outputs; two successful builds alone are not reproducibility evidence.

## 4. Public assets and deterministic ZIP

The public Release asset set is exactly:

- `main.js`
- `manifest.json`
- `styles.css`
- `link-integrity-<version>.zip`

The handoff artifact additionally and exclusively contains `SHA256SUMS`; that file is not a public Release asset.

The ZIP contains exactly one `link-integrity/` installation directory whose three entries have the fixed order `main.js`, `manifest.json`, `styles.css`. Entry time, Unix mode, compression parameters, and layout are fixed. Each inner file is byte-identical to its loose asset. `SHA256SUMS` records exactly the SHA-256 of the four public assets.

Candidate validation rejects symbolic links, directories, device files, extra or missing entries, duplicate ZIP names, unsafe paths, identity/version mismatches, and any hash mismatch.

## 5. Prepare and exact handoff

Preflight and prepare are read-only and never create or mutate a remote Release. The candidate artifact name binds both `github.run_id` and `github.run_attempt`, and overwrite is forbidden.

After upload, prepare reads the current-run artifact back from the GitHub API and passes publish:

- the exact artifact name;
- the GitHub artifact ID;
- the server-side artifact digest returned by GitHub;
- the current run ID and attempt.

Publish verifies repository and owner, run, attempt, ID, name, and server digest, then downloads by ID. Searching by “latest artifact with this name” or tolerating multiple candidates is forbidden.

## 6. Publish permissions and code isolation

The publish job grants only:

- `actions: read`
- `contents: write`
- `attestations: write`
- `id-token: write`

Publish cannot checkout, set up Node/npm, install dependencies, build, or execute any checked-out repository script or code. Remote API, identity, asset, ZIP, and provenance checks use only inline dependency-free logic executed from the runner temporary directory. The publish job also rejects self-hosted runners.

A new publication follows GitHub's [recommended immutable-release sequence](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) explicitly:

1. Authenticated paginated Release readback, which includes drafts for a token with push access, must first prove that no Release occupies the candidate version. An existing draft or any inconsistent Release fails closed; an existing exact immutable Release can only take the same-tag no-op path.
2. The workflow creates an empty draft through the REST API with a hidden marker bound to the current run ID, run attempt, and source commit, then captures the numeric Release ID directly from the validated `201` response. If that write response is ambiguous, it does not replay the non-idempotent write; bounded paginated readback may only recover the one exact empty draft carrying that marker.
3. The workflow uploads exactly the four public assets through the captured Release ID without clobbering, then reads the same Release ID back while it is still a draft and verifies the exact asset set, server digests, and every remote byte.
4. Only that captured, current-run draft ID is transitioned to published. Final readback must observe the exact immutable contract.

Create, upload, and publish are one guarded transaction entered only after the earlier absence decision. The workflow never adopts, completes, uploads to, publishes, or otherwise repairs a Release that existed before this transaction.

## 7. Release history and notes baseline

Both dispatch and tag triggers verify:

- repository and default-branch identity;
- that the tag points exactly to the candidate source commit;
- that the source commit belongs to default-branch history;
- that the candidate version is greater than every genuinely published stable Release.

The notes baseline is the highest lower stable Release, whose tag commit must be an ancestor of the candidate. With no lower stable Release, the workflow uses an explicit first-release path and does not guess a baseline.

Drafts, prereleases, non-stable tags, and entries without a verifiable tag do not become a stable baseline, but an anomaly is never silently treated as something that may be overwritten.

## 8. Strict same-tag no-op

If the same tag already exists, only a strict no-op is accepted:

- the Release is immutable, neither draft nor prerelease;
- the tag still points exactly to the candidate source commit;
- the public asset set is exact;
- every remote asset is byte-identical to the candidate;
- every asset passes all provenance checks in section 9.

Any mismatch fails closed and requires a higher version. Automation never edits, overwrites, deletes, recreates, or “repairs” an existing Release.

## 9. Provenance and final readback

Both a same-tag no-op and the final readback after a new publication verify attestations for each of the four public assets:

- exact repository;
- exact release-workflow signer;
- exact source ref;
- exact source commit digest;
- a runner environment that is not self-hosted.

For a new Release, candidate provenance and the GitHub-hosted runner boundary are verified before any Release mutation. The final readback rechecks the tag, Release state, exact asset set, remote bytes, and attestations after publication becomes immutable. Publication completes only when all agree.

## 10. Concurrency, retries, and failure boundary

Release uses repository-level concurrency with `cancel-in-progress: false`. Retries are bounded and use backoff:

- transport failures, 404, and 5xx may retry;
- an unready 200 during immutable or asset propagation may retry;
- deterministic ordinary 4xx fail immediately.

Automatic recovery never deletes or rewrites a Release and never rolls a tag back. If creation, upload, or publication fails, any empty or partially populated draft is deliberately preserved for human diagnosis. A rerun treats that draft as pre-existing and refuses to resume, complete, delete, or repair it. If an inconsistent Release already exists, the only automation-safe next path is publishing a higher version.

## 11. Manual prerelease checklist

Before a real publication, a maintainer verifies and records in the GitHub UI:

- Immutable Releases is enabled;
- a numeric-version tag ruleset covers strict `x.y.z`;
- the ruleset forbids tag update and deletion;
- the ruleset has no bypass actor;
- the default branch and repository owner match workflow expectations;
- required GitHub provenance/attestation features are available.

Local scripts can validate workflow and candidate contracts but cannot prove these external settings. Initial project automation must not create or change them.

## 12. Evidence record

Each candidate retains aggregate-gate logs, exact runtime, two clean-build hashes, two ZIP hashes, the bundle reference/budget result, SHA-256 for all four assets, and candidate manifest identity. A real publication additionally retains current-run artifact metadata, Release readback, every provenance result, and the final tag readback.

A green local run proves only the in-repository contract. Until a real GitHub Actions run completes, artifact API propagation, least-privilege permissions, immutable timing, and provenance signer behavior remain unverified.
