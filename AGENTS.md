# Link Integrity maintenance rules

Read the [documentation index](docs/README.md) and the relevant product contracts before changing behavior. Keep the repository independently buildable and preserve unrelated local changes.

## Product boundaries

- Keep `src/core` host-independent. `LinkIndex` owns parsed files, links, graph and query projections; views must not scan the Vault.
- The plugin is diagnostic and non-destructive. Do not add deletion, bulk rewriting or network link checking without an explicit product decision.
- Isolation means no valid incoming or outgoing edge to another Vault file. Self-links and external URLs do not connect files; broken links do not imply safe deletion.
- Hidden or unselected files still contribute graph edges unless an explicit rule excludes them. Persist settings, not the derived graph.
- Full and incremental indexing must agree; run scale checks for parsing, indexing and query changes.
- Keep the plugin-rendered top-tab settings surface. Declarative definitions must remain empty or absent unless an explicit product decision changes the layout.

## Changes and verification

- Follow the existing TypeScript style and dependency boundaries. Prefer focused changes over new generic abstractions.
- Run checks appropriate to the change. Documentation moves require `check:docs-i18n`, `check:readme-i18n` and affected checker tests; follow [CONTRIBUTING.md](CONTRIBUTING.md) for source and release gates.
- Use isolated disposable Vaults for fixtures. Production deployment requires authorization for the exact target; preserve plugin `data.json` unless reset is explicitly authorized.
- Source tests, packaged artifacts, real-host behavior and publication are distinct facts. Record only observed acceptance and keep missing coverage explicit.
- Preserve the release contract's three loose plugin assets and versioned manual-install ZIP. Verify candidate identity and do not overwrite immutable release assets.
- Keep credentials, private Vault contents, local paths, generated dependencies and runtime evidence out of commits. Use Conventional Commit subjects when a commit is authorized.

## Documentation

- Standard entry points belong at the root; detailed product guidance belongs in `docs/`, indexed by `docs/README.md`. Ordinary names use lowercase words separated by hyphens.
- Stable English documents use `name.md`; Chinese sources use `name.zh-CN.md`. Update both together or explicitly mark an incomplete translation outdated. README translations use `docs/i18n/README.<locale>.md`.
- Root README repository links use canonical GitHub URLs for the Obsidian catalog. Translated READMEs use relative links; retain the checked language-navigation order.
- Maintain one authoritative text for each rule. Keep architecture decisions and repeatable development, test and release instructions with the product; local plans and execution evidence belong to the maintainer workspace.
- Describe current behavior and useful compatibility guidance. Release history belongs in `CHANGELOG.md`; candidate state, progress and historical acceptance do not belong in this file.
