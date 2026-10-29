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

The focused `inline-metadata-boundaries` scenario uses four explicit commands:
`prepare-inline-quoted`, `prepare-inline-parenthesized`, `prepare-inline-label-wiki` and
`prepare-inline-invalid-outer`. Their palette names begin with
**Prepare inline-metadata** under **Link Integrity acceptance provider**. They create
`Inline Metadata Acceptance/Source.md`, `Target.md` and `Ghost.md` only when the folder
is absent. Source bytes are LF with a final LF (81, 82, 62 and 46 bytes respectively).
Later commands require the three known files, exact fixed Target/Ghost bytes and one
of the nine Source states. A missing file, unexpected child, unknown edit or existing
`Missing.md` refuses the transition before writing; Missing is never created.

Quoted link/image metadata and parenthesized titles yield five broken/five isolated
files. Label Wiki yields six/four, with exactly one Missing on Source L1 and both
targets connected; invalid outer syntax yields six/five, with Ghost connected and
Target isolated. Observe both tabs incrementally and after each Rebuild, then actually
open the diagnostic source. Commands prepare input and open Source without evaluating
product output. Actual native caches are observed; forced cold/partial cache and legacy
ordinal conditions remain automated regression claims.

The companion `inline-proof-boundaries` scenario adds `prepare-inline-atx-boundary`,
`prepare-inline-nested-image`, `prepare-inline-reference-inner`,
`prepare-inline-quote-continuation` and `prepare-inline-hint-metadata`. They reuse the
same guarded three notes. Their expected broken/isolated totals are respectively
6/7, 5/4, 6/5 with a ready accurate native reference cache, 5/5 and 7/7. Verify the
ATX Missing location on L2, both connections in the nested image, the native inner
reference and literal quote title, then the two actual Missing hint locations after
explicitly enabling body diagnostics. Preserve native anchor/rendering restrictions;
source-only setup or matching counts do not prove hints or navigation. Commands do
not change settings, force metadata state, create Missing or evaluate product output.

The focused `container-block-boundaries` scenario uses five explicit provider commands:
`prepare-block-quote-code`, `prepare-block-list-prose`,
`prepare-block-definition-continuation`, `prepare-block-definition-non1-code` and
`prepare-block-definition-title`. They create `Block Context Acceptance/C5 Source.md`
and `C5 Target.md` only when the folder is absent. Later transitions require both known
files and exact expected target/source bytes; unknown edits are never overwritten.
The quote, non-1-marker code and definition-title inputs produce no C5 edge or diagnostic
(five broken/six isolated overall). List prose and definition continuation produce one
resolved C5 edge and one missing-target diagnostic (six broken/four isolated overall).
Observe both tabs and rebuild through the real host; preparation is not a verdict.

The focused `escaped-percent-and-source-context` scenario uses the explicit
`create-context-regression-fixtures` provider command in a disposable Vault. It creates
`Context Regression Acceptance/` only when absent: escaped delimiters and protected code,
literal and encoded percent targets, and identical relative-link sources in two folders.
Observe sidebar diagnostics, editing/reading hints, source switches, rename, Off and rebuild
through the real host. Fixture creation does not issue a verdict.

The `body-link-hints` and `body-link-hints-fakelink` scenarios preserve the untouched five broken/four isolated baseline. Only in the identified disposable Vault, explicitly run the provider commands `create-body-hint-fixtures`, `repair-body-hint-fixtures` and `restore-body-hint-fixtures`. They create three notes under `Body Hints Acceptance/`, verify exact known fixture bytes before repair/restore, and refuse overwrites. After indexing the transitions are ten broken/five isolated, five/five, and ten/five. Setup is not product acceptance.

Broken body hints default Off. Legacy potential settings must not enable them, and retired potential commands/actions must be absent. Check three confirmed reasons, valid and protected negatives, read-only diagnostic navigation, native clicks, metadata refresh and Off/unload cleanup. Reading skips duplicate or third-party ambiguous destinations rather than guessing.

The FakeLink scenario uses an independent operator-supplied FakeLink environment; no third-party runtime is bundled. Include the bare Target#^missing-block mixed with a real same-destination link, both enable orders, hover preview, third-party conversion updates and disabling either plugin. Virtual text must never become a LinkIndex occurrence or graph edge. Record the exact candidate/host and honest incomplete checks or failures.

## Resolution semantics and asynchronous tab focus

In a fresh disposable fixture Vault, run `create-resolution-regression-fixtures` once. It creates only `Resolution Semantics Acceptance/`, refuses an existing root, and leaves the original baseline unchanged. `Destinations/Source.md` and `Destinations/Board.canvas` carry the same eight references: six local targets, one encoded external scheme, and `Missing&Value.md`. Compare actual native navigation with target identities and diagnostics; `A&B.md`, `A&amp;B.md`, and `Escaped&amp;B.md` are deliberately distinct. Wiki and percent spellings must retain host interpretation. Observe incremental results and Rebuild separately; the provider does not manufacture empty or partial native caches.

`Parent/Source.md` starts with `[[Subdir/Suffix Target]]` and no matching target. In this temporary subtree, create `Parent/Subdir/Suffix Target.md`, add an `Archive/Subdir/Suffix Target.md` competitor, then delete or rename candidates and move the source between these contexts. Record the actual host resolver choice at every transition rather than assuming a best-match algorithm. Compare Broken links, incoming edges and isolation with Rebuild; retain filenames and source bytes in the receipt. Do not change the fixed destination inputs during these namespace checks.

With a physical keyboard on desktop or emulator hardware-key input, focus a business tab and press one direction key or Home/End while queries are asynchronous. The selected tab, focused button and visible panel must agree after settling. Repeat rapid End/Home and move focus to search or another window, hide the view, or close it before completion: late results must not reclaim focus. The provider prepares inputs only; it does not verify host behavior or auxiliary technology.

## Arabic and mixed-language paths

The `arabic-rtl-navigation` scenario uses `العربية/Target-中文-123.md` and its valid heading/block references from `Connected/Source.md`. These connected notes preserve the five broken/four isolated baseline. A temporary missing-heading reference is added and undone only in the disposable Vault; the expected broken count moves five → six → five without changing the isolated count. Record language persistence, plugin-only direction, diagnostic focus and actual navigation separately from fixture preparation.
