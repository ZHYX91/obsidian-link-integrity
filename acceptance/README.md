# Link Integrity isolated-host fixture

This self-contained fixture is owned by Link Integrity and is intended only for an explicitly identified disposable Vault. It must never be copied into or run against an ordinary or production Vault.

## Expected initial results

With the packaged `link-integrity` candidate enabled and the startup scan complete:

- the Broken links tab reports the missing heading and missing block in `Connected/Source.md`, the missing file in `Broken-only.md`, the missing Canvas target, and the missing folded Bases target (five diagnostics total);
- `Broken-only.md` is isolated and marked as containing one broken link;
- `Standalone.md`, `Self-only.md`, and `Dynamic-only.base` are regular isolated files, for a default main count of four;
- `Periodic/2026-08-02.md` is classified as expected isolated by the local periodic-notes preset and excluded from the main isolated count;
- Markdown links and embeds, Frontmatter, Canvas file/background references, and the explicit Bases `link()` reference keep their source and target files connected;
- the standalone dynamic Bases folder filter does not create a file edge; enabling “Show expected isolated files” raises the isolated total from four to five.

Fixture setup is not product evidence. Candidate identity, host lifecycle, product observations, screenshots, and navigation checks must be recorded as separate claims by the environment performing the run.

The review regression also exercises CRLF/empty/adjacent Canvas fences, Bases dynamic arguments and display names, and YAML-decoded position fallback. The seeded `Bounded regex` rule matches no fixture filename; previewing it exercises the bounded matcher through the settings UI without changing the default isolation counts.

## Body diagnostic scenarios

The `body-link-hints` and `body-link-hints-fakelink` scenarios preserve the untouched five broken/four isolated baseline. Only in the identified disposable Vault, explicitly run the provider commands `create-body-hint-fixtures`, `repair-body-hint-fixtures` and `restore-body-hint-fixtures`. They create three notes under `Body Hints Acceptance/`, verify exact known fixture bytes before repair/restore, and refuse overwrites. After indexing the transitions are ten broken/five isolated, five/five, and ten/five. Setup is not product acceptance.

Broken body hints default Off. Legacy potential settings must not enable them, and retired potential commands/actions must be absent. Check three confirmed reasons, valid and protected negatives, read-only diagnostic navigation, native clicks, metadata refresh and Off/unload cleanup. Reading skips duplicate or third-party ambiguous destinations rather than guessing.

The FakeLink scenario uses an independent operator-supplied FakeLink environment; no third-party runtime is bundled. Include the bare Target#^missing-block mixed with a real same-destination link, both enable orders, hover preview, third-party conversion updates and disabling either plugin. Virtual text must never become a LinkIndex occurrence or graph edge. Record the exact candidate/host and honest incomplete checks or failures.

## Arabic and mixed-language paths

The `arabic-rtl-navigation` scenario uses `العربية/Target-中文-123.md` and its valid heading/block references from `Connected/Source.md`. These connected notes preserve the five broken/four isolated baseline. A temporary missing-heading reference is added and undone only in the disposable Vault; the expected broken count moves five → six → five without changing the isolated count. Record language persistence, plugin-only direction, diagnostic focus and actual navigation separately from fixture preparation.
