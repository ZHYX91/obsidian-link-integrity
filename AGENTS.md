# Repository Guidelines

## Authority and scope

This repository contains the Link Integrity Obsidian plugin. Stable authority lives in the paired
product requirements, UX specification, architecture, testing, and release contracts under
`docs/`; Simplified Chinese is the source language and each `.zh-CN.md` file has an English `.en.md`
counterpart. Planning and review notes outside those stable contracts are non-normative and must
not be copied as requirements.

Link Integrity reports broken internal links and isolated Vault files. It is diagnostic and
non-destructive by default. Do not add deletion, bulk rewriting, network link checking, or
cross-repository runtime dependencies without an explicit product decision.

## Architecture

Source code lives under `src/`:

- `src/core/`: pure file, link, graph, classification, and ignore semantics; no Obsidian imports.
- `src/features/`: full rebuild, incremental indexing, projections, and application queries.
- `src/adapters/`: Obsidian Vault, Metadata Cache, resolver, navigation, Canvas, and Bases ports.
- `src/ui/`: sidebar views and native Obsidian settings UI.
- `src/app/`: plugin lifecycle and dependency composition.
- `src/shared/`: settings, i18n, and small cross-feature types.

`LinkIndex` is the single source of truth. Views must not scan the Vault directly. Full rebuild
and incremental updates must replace complete source snapshots through the same reducer, and
tests must prove incremental results equal a clean rebuild.

## Settings surface policy

Declarative settings are intentionally disabled because Obsidian 1.13 bypasses `display()` for
non-empty definitions, which removes Link Integrity's three-tab settings layout and degrades the
user experience. Preserve the imperative `PluginSettingTab.display()` surface and keep
`getSettingDefinitions()` empty. Dormant declarative builders and tests may remain, but must not be
activated accidentally. Do not flag the `display()` deprecation, empty definitions, the disabled
feature switch, or missing settings search, and do not propose a declarative migration unless the
user explicitly asks to revisit this decision. Stable documents that describe a declarative 1.13
surface as active are stale on this point and must not override this policy.

## Manual installation release policy

The versioned `link-integrity-<version>.zip` is an intentional required public release asset for
users who install without the Obsidian Community marketplace. Community ignores it during plugin
ingestion, so the automated-review `extra unsupported files` recommendation is expected and must
not be treated as a defect or a reason to remove the archive. The deterministic ZIP contains one
`link-integrity/` directory with `main.js`, `manifest.json`, and `styles.css`, byte-identical to the
three loose release assets. Release checks must preserve and verify all four public assets.

## Product invariants

- The two business tabs are Broken links and Isolated files.
- A file is isolated when it has no valid incoming or outgoing edge to another existing Vault
  file. Self-links and external URLs do not connect it.
- A file with only broken outgoing links remains isolated and is explicitly marked with its
  broken-link count; it is not a high-confidence cleanup candidate.
- No-incoming-links is an advanced filter, not the default isolated-file definition.
- Candidate scope, diagnostic visibility, and graph contribution are separate concerns.
- Hidden or unselected files still contribute valid edges unless an advanced rule explicitly
  excludes graph contribution.
- Settings, ignores, and UI preferences may persist. The derived graph does not persist.

## Engineering conventions

Use strict TypeScript, ES modules, two-space indentation, double quotes, semicolons, and trailing
commas in multiline structures. Keep Obsidian APIs behind adapters. Use Vitest for tests and
Conventional Commit subjects for local commits.

Before handoff, run `npm run check` and the explicit scale benchmark required by the change.
Automated checks, packaged-candidate checks, real Obsidian host acceptance, emulator evidence,
and physical-device evidence are separate claims.

## Deployment and host acceptance

Deploy to a production Vault only when the user explicitly names and authorizes the exact target.
Before copying, resolve the target plugin directory, record or back up the currently installed
runtime assets, and hash `data.json` when present. Replace only the verified production assets
declared by the release contract, preserve `data.json` unless the user explicitly authorizes a
reset, and verify the installed hashes after copying.

Acceptance fixtures, cleanup scripts, and destructive test operations may target only explicitly
identified temporary Vaults; never point them at an ordinary or production Vault. Source checks,
packaged-candidate checks, deployed-host behavior, emulator evidence, and physical-device evidence
remain separate claims.

The deterministic product fixture lives under `acceptance/fixtures/`. Use it only in an explicitly
identified disposable Vault with a clean packaged candidate. Never point it at an ordinary or
production Vault, and never treat fixture setup as proof of Link Integrity product behavior.

## Documentation lifecycle

Simplified Chinese is the source language for stable product requirements, UX specification,
architecture, testing, and release documents. Pair stable `.zh-CN.md` documents with structurally
matching `.en.md` translations and the canonical frontmatter enforced by `check:docs-i18n`.
The root README is English and translations live under `docs/i18n/`. Because the Obsidian plugin catalog renders only the English root README without rewriting repository-relative URLs, root navigation and repository-document links use canonical GitHub `blob/main` URLs and root images use canonical `raw.githubusercontent.com` URLs. Translated READMEs use repository-relative navigation, document, image, and license targets. Release, Issues, Security, and other external resources remain absolute HTTPS URLs in every language. `npm run check:readme-i18n` enforces this split offline, including exact language navigation, section order, target existence, and repository-boundary checks.

Durable rules belong only in the stable bilingual contracts. Short-lived implementation notes must
not become an alternative authority. Root README navigation links directly to every stable pair;
public README translations live under `docs/i18n/`.

`CHANGELOG.md` is the only public document that records release history. README and user help
describe the product as it works now: compatibility, installation, usage, settings, limitations,
privacy, and support. Do not add version banners, dated acceptance evidence, release-status
narratives, or superseded plans outside the changelog. Keep migration or deprecation guidance only
when users still need to act, and state the required action directly. Engineering documents describe
the current contract and repeatable process rather than past executions.
