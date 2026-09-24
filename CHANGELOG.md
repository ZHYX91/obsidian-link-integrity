# Changelog

This changelog records notable repository changes to Link Integrity. Version entries are based on
the repository manifest, annotated Git tags, and commit history. A tag identifies a source
revision; it does not by itself prove that a GitHub Release was published, that the plugin was
accepted into the Obsidian community directory, or that any Vault was updated.

## [Unreleased]

## [0.2.8] - 2026-09-24

### Fixed

- Keep long rule editors scrollable in short windows so preview results and Save remain reachable.
- Parse empty, adjacent, and CRLF fenced code without losing real links or indexing code as links.
- Restrict Bases references to formula fields and complete static link arguments; omit unavailable decoded YAML coordinates instead of reporting incorrect positions.
- Preserve naming conditions across rule preview, save, and reload, and disable invalid persisted rules without broadening their scope.
- Match regex and glob rules without native backtracking, with bounded compiled state counts.
- Stop accumulating events indefinitely when the first index baseline fails.
- Expose available non-Markdown source locations and label advanced rule controls for accessibility.
- Update the development dependency on js-yaml to the patched version and audit dependencies in CI.

### Improved

- Remove inactive declarative settings bridges while preserving the imperative tabbed settings surface.

## [0.2.7] - 2026-09-20

### Fixed

- Bound unsuccessful Markdown destination scans, respect escaped openers, and support nested destinations.
- Keep ignore previews consistent with actual filtering when links move or contain heading and block targets.
- Locate YAML properties using syntax ranges and show Canvas node identifiers alongside text-node line numbers.
- Preserve logical sidebar focus across result replacement and use native disclosure semantics.
- Keep graph-policy updates atomic across rebuilds, incremental changes, and lifecycle transitions.

### Improved

- Schedule broad ignore previews and fallback link extraction, cancelling superseded previews and restarting counts when the index changes.
- Present filenames before paths and location details; create settings ignore rules disabled and label whole-file target ignores explicitly.

## [0.2.6] - 2026-09-13

### Fixed

- Preserve source-file expansion in the broken-link folder view across searches and index rebuilds.

### Improved

- Reuse isolation counts while searching instead of rescanning hidden results.
- Yield during incremental result merging and discard superseded calculations before publishing results.

## [0.2.5] - 2026-09-09

### Improved

- Schedule incremental indexing and sidebar calculations in browser task slices, publishing complete index updates atomically while sharing unchanged data.
- Keep ordinary body edits local when target metadata is unchanged, and update diagnostics and isolation from changed sources and graph endpoints.
- Reuse unchanged result rows and view models, separate progress updates from result rendering, and defer presentation work for hidden tabs.

### Fixed

- Keep expected-isolation controls readable in narrow sidebars and hide saved-state and retry controls when they are not needed.
- Mark inactive result counts as pending after index changes until their projection is refreshed.

## [0.2.4] - 2026-09-06

### Fixed

- Distinguish no search matches, filtered-out results, and no findings in the current check scope.
- Add a Clear search action that restores search focus while preserving filters and folder expansion.
- Avoid claiming that every link resolves or every file is connected when a check is incomplete or results are hidden.

## [0.2.3] - 2026-09-06

### Fixed

- Keep sidebar search focused while typing and refreshing the index, including selection replacement and IME composition.
- Retain collapsed isolated folders, broken-link groups, and expanded file-type filters during sidebar updates.

### Changed

- Update development dependencies and use attested tag-triggered releases with optional host acceptance.

## [0.2.2] - 2026-08-31

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

[Unreleased]: https://github.com/ZHYX91/obsidian-link-integrity/compare/0.2.4...HEAD
[0.2.4]: https://github.com/ZHYX91/obsidian-link-integrity/compare/0.2.3...0.2.4
[0.2.3]: https://github.com/ZHYX91/obsidian-link-integrity/compare/0.2.2...0.2.3
[0.2.2]: https://github.com/ZHYX91/obsidian-link-integrity/compare/0.2.1...0.2.2
[0.2.1]: https://github.com/ZHYX91/obsidian-link-integrity/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/ZHYX91/obsidian-link-integrity/compare/0.1.1...0.2.0
[0.1.1]: https://github.com/ZHYX91/obsidian-link-integrity/tree/0.1.1
[0.1.0]: https://github.com/ZHYX91/obsidian-link-integrity/tree/0.1.0
