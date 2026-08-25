# Contributing to Link Integrity

Thank you for helping improve Link Integrity. The plugin is a local, diagnostic, and
non-destructive Obsidian tool. Changes should preserve that boundary unless an explicit product
decision updates the canonical requirements.

## Before opening a change

- Use GitHub Issues for reproducible bugs and focused proposals. Do not post private Vault paths,
  note contents, plugin settings, or diagnostic samples that have not been sanitized.
- Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not a public
  issue.
- Keep a change focused. Refactors should have a concrete correctness, maintainability, or measured
  performance benefit.

## Development setup

The repository requires Node.js `24.19.0` and npm `11.17.0`, as declared by `.node-version`,
`package.json`, and the lockfile.

```sh
npm ci
npm run check
```

Use strict TypeScript, ES modules, two-space indentation, double quotes, semicolons, and trailing
commas in multiline structures. Keep Obsidian APIs behind adapters, keep core graph semantics free
of Obsidian imports, and use Conventional Commit subjects.

## Product and documentation authority

Stable requirements live in these synchronized pairs:

- `docs/product-requirements.{zh-CN,en}.md`
- `docs/ux-spec.{zh-CN,en}.md`
- `docs/architecture.{zh-CN,en}.md`
- `docs/testing-strategy.{zh-CN,en}.md`
- `docs/release.{zh-CN,en}.md`

Simplified Chinese is the source language. Update the `.zh-CN.md` source first, update its English
translation in the same change, preserve matching heading structure, and keep the canonical
frontmatter synchronized. Do not recreate retired document names or introduce a second stable
authority. Update [CHANGELOG.md](CHANGELOG.md) when a user-visible or operationally significant
change warrants an Unreleased entry.

## Tests and evidence

- Add the smallest regression test that fails before a bug fix and passes afterward.
- Prove full and incremental indexing remain equivalent when changing graph or lifecycle behavior.
- Run `npm run check` before handoff.
- Run `npm run bench:index` and `npm run bench:index:large` for parsing, indexing, query, or other
  scale-sensitive changes. `npm run release:check` runs the complete release gate.
- Treat source checks, packaged candidates, real Obsidian host acceptance, emulators, physical
  devices, GitHub publication, and community-directory approval as separate evidence.

Never aim fixtures or destructive operations at an ordinary or production Vault. A real Vault
deployment requires explicit authorization for that exact target and must preserve `data.json`
unless a reset is separately authorized.

## Pull requests

A pull request should explain the problem, the chosen boundary, tests run, remaining host or device
gaps, and any documentation or changelog impact. Do not include generated coverage, local runtime
evidence, credentials, private data, or dependencies on files outside this repository.
