# Repository Guidelines

## Authority and scope

This repository contains the Link Integrity Obsidian plugin. Stable authority lives in the paired
product, UX, architecture, testing, and release contracts under `docs/`; Simplified Chinese is the
source language and each `.zh-CN.md` file has an English `.en.md` counterpart. Historical Link
Integrity plan and review files in the parent workspace are non-normative and must not be copied
as requirements.

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
- Settings, ignores, and UI preferences may persist. The derived graph does not persist in the
  initial release.

## Engineering conventions

Use strict TypeScript, ES modules, two-space indentation, double quotes, semicolons, and trailing
commas in multiline structures. Keep Obsidian APIs behind adapters. Use Vitest for tests and
Conventional Commit subjects for local commits.

Before handoff, run `npm run check` and the explicit scale benchmark required by the change.
Automated checks, packaged-candidate checks, real Obsidian host acceptance, emulator evidence,
and physical-device evidence are separate claims. Never operate on a production Vault.

The deterministic isolated-host fixture lives under `acceptance/`. It may be installed only into
a randomly named temporary Vault created by `obsidian-acceptance-kit`, from a clean committed
candidate. Never point it at an ordinary or production Vault, and never claim that the shared kit's
infrastructure report proves Link Integrity product behavior.

## Documentation lifecycle

Simplified Chinese is the source language for stable product, UX, architecture, and testing
documents. Pair stable `.zh-CN.md` documents with structurally matching `.en.md` translations.
The root README is English and translations live under `docs/i18n/`.

Durable rules belong only in the stable bilingual contracts. Short-lived implementation notes must
not become an alternative authority. Root README navigation links directly to every stable pair;
public README translations live under `docs/i18n/`.
