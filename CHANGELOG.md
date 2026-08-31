# Changelog

This changelog records notable repository changes to Link Integrity. Version entries are based on
the repository manifest, annotated Git tags, and commit history. A tag identifies a source
revision; it does not by itself prove that a GitHub Release was published, that the plugin was
accepted into the Obsidian community directory, or that any Vault was updated.

## [Unreleased]

### Changed

- Emphasized the active Broken links or Isolated files sidebar tab with a semibold label while
  preserving its accent underline.

## [0.2.1] - 2026-08-28

### Changed

- Refreshed public documentation and Community Directory screenshots to match the current plugin,
  installation path, and release boundaries without embedding stale candidate evidence.
- Clarified that Link Integrity keeps its three-tab imperative settings surface and that mobile
  release acceptance requires current Android emulator evidence while treating physical-device
  evidence as a separate optional claim.
- Strengthened local release-version validation so an existing version tag must point to the exact
  candidate revision, and reduced routine dependency-update noise.

## [0.2.0] - 2026-08-25

### Added

- Added cancellable full-rebuild and staging-replay workers so obsolete lifecycle generations stop
  claiming Vault sources and cannot publish stale results after a restart.
- Added versioned occurrence identities with legacy matching and source-path migration for persisted
  occurrence-ignore rules.

### Changed

- Recompute graph edges directly from stored source snapshots when graph-contribution rules change,
  without rereading or reparsing Vault files.
- Restored tabbed settings navigation and made the active section visually distinct across supported
  Obsidian layouts.
- Renamed the canonical product and UX contracts to `product-requirements.*.md` and
  `ux-spec.*.md`, and aligned the repository's runtime, documentation, and release governance.

### Fixed

- Accept valid JSON Canvas documents that omit the optional `nodes` array while continuing to
  reject a present non-array value.
- Apply CommonMark-style equal-length and multiline backtick code-span masking without allowing
  code spans or Obsidian comments to consume one another's delimiters or cross fenced code blocks.
- Keep the one-shot Metadata Cache readiness listener after the bounded startup fallback and run
  one all-source correction when the host-wide `resolved` signal arrives later.
- Keep occurrence-ignore rules stable across line shifts and source-file renames while accepting
  legacy persisted identities.
- Exclude fallback link-like text from non-content regions so diagnostics do not report false
  broken-link occurrences.

## [0.1.1] - 2026-08-09

### Added

- Added bounded, read-only index diagnostics for aggregate file, source, occurrence, pending-event,
  full-rebuild, and incremental-batch status.
- Added localized index-detail UI and automated coverage for diagnostics lifecycle and privacy
  boundaries.

## [0.1.0] - 2026-08-09

### Added

- Established the first tagged Link Integrity baseline for local broken-link and isolated-file
  diagnostics across supported Obsidian file sources.
- Added incremental index maintenance, expected-isolation and ignore rules, desktop/mobile-aware
  sidebar and settings UI, multilingual documentation, automated release checks, and scale
  benchmarks.

[Unreleased]: https://github.com/ZHYX91/obsidian-link-integrity/compare/0.2.1...HEAD
[0.2.1]: https://github.com/ZHYX91/obsidian-link-integrity/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/ZHYX91/obsidian-link-integrity/compare/0.1.1...0.2.0
[0.1.1]: https://github.com/ZHYX91/obsidian-link-integrity/tree/0.1.1
[0.1.0]: https://github.com/ZHYX91/obsidian-link-integrity/tree/0.1.0
