# Link Integrity isolated-host fixture

This self-contained fixture is owned by Link Integrity and is intended only for an explicitly identified disposable Vault. It must never be copied into or run against an ordinary or production Vault.

## Expected initial results

With the packaged `link-integrity` candidate enabled and the startup scan complete:

- the Broken links tab reports the missing heading and missing block in `Connected/Source.md`, the missing file in `Broken-only.md`, and the missing Canvas target (four diagnostics total);
- `Broken-only.md` is isolated and marked as containing one broken link;
- `Standalone.md`, `Self-only.md`, and `Dynamic-only.base` are regular isolated files, for a default main count of four;
- `Periodic/2026-08-02.md` is classified as expected isolated by the local periodic-notes preset and excluded from the main isolated count;
- Markdown links and embeds, Frontmatter, Canvas file/background references, and the explicit Bases `link()` reference keep their source and target files connected;
- the standalone dynamic Bases folder filter does not create a file edge; enabling “Show expected isolated files” raises the isolated total from four to five.

Fixture setup is not product evidence. Candidate identity, host lifecycle, product observations, screenshots, and navigation checks must be recorded as separate claims by the environment performing the run.
