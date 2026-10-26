---
source_language: zh-CN
translation_of: testing-strategy.zh-CN.md
translation_status: synced
---

# Link Integrity — Testing strategy

The Link Integrity testing strategy prioritizes diagnostic correctness and index consistency while keeping automated gates, packaged candidates, real hosts, and emulator evidence strictly separate.

## Evidence levels

Different evidence answers different questions and cannot substitute for another level:

1. static and automated tests prove types, pure semantics, controllers, and deterministic contracts;
2. packaged-candidate checks prove the actual install assets and version contract;
3. an isolated real Obsidian Vault proves host APIs, navigation, and interface behavior;
4. an Android emulator proves layout and host behavior in the supported mobile acceptance environment.

A green build is not real-host acceptance. A production Vault is not used for destructive or first-time acceptance experiments.

Select representative acceptance on the exact candidate by change impact. Desktop interaction, settings or lifecycle changes require relevant real-host scenarios; mobile interaction or shared runtime behavior affecting mobile requires relevant Android emulator scenarios. Documentation-only or host-independent logic changes may omit hosts with a recorded reason. Confirmed serious product defects affecting a release block that release. Missing host/tool evidence stays unverified and is assessed by risk; it does not automatically block publication or add a separate approval step. Claim acceptance only for observed passing scope. The full host matrix is not required for every release, and CI does not automatically enforce host coverage. Record actual desktop and emulator coverage separately. Android physical devices and iOS are outside the shared acceptance scope.

## Core semantic tests

Pure fixtures should cover:

- resolved, missing, invalid, and pending file states;
- successful, missing, pending, and unsupported heading or block states;
- retention of a file-level edge when the file exists but its subpath is missing;
- Markdown, embed, Frontmatter, Canvas, and Bases explicit source kinds;
- fallback-parser exclusion of fenced and indented code, HTML comments, raw HTML code, and frontmatter YAML comments, while retaining links in frontmatter values and paragraph continuations; regressions cover LF/CRLF/CR, empty and adjacent blocks, both fence characters, variable lengths, nested quote/list containers, unclosed blocks and container termination, and UTF-16 offsets after astral prefixes; HTML literals inside code, fences inside HTML, quoted attributes, and tag-like Markdown destinations must not affect adjacent prose;
- self-links, external URLs, and repeated occurrences;
- absence of explicit edges from dynamic Bases results; semantic tests allow static explicit references only from `filters`, `formulas`, custom `summaries`, and view `filters`, with view names, `properties` display strings, ordinary formula string literals, and dynamic first link arguments as negative cases; escaped/folded YAML must never fabricate link coordinates or collapse repeated occurrences;
- separation of candidate, diagnostic, and contribution scopes.

Occurrence-identity regressions prove that unrelated text and unrelated links inserted before a saved occurrence preserve its ignore match, while file and folder rename events migrate the persisted source identity. Inserting an indistinguishable duplicate must change duplicate-set cardinality and make the old rule match zero results, which the rule preview exposes, rather than matching a different occurrence. Workflow-contract syntax validation concatenates the extracted shell blocks into one `bash -n` process so the Windows gate does not pay one Git Bash startup per block.

File-type registry tests cover the classification hierarchy, extension aliases, casing, overlapping media classifications such as WebM, PDF under fixed-layout files, and custom extensions.

## Isolation and rule tests

Isolation-result tests must prove that the default definition requires both valid incoming and outgoing neighbor counts to be zero. A file with only broken outgoing links remains isolated and shows the number of broken references and a cautionary state; self-links and external URLs do not change isolation.

The no-incoming query is tested separately so a file with valid outgoing links cannot enter the default isolated result. Candidate-type filtering must not remove real connections contributed by unselected files.

Expected-isolation tests cover:

- exclusion from main results and the main count by default, with `expected-isolated` classification when advanced display is enabled;
- no graph edge creation by expected classification;
- AND between file-type, folder, and naming conditions, with OR between multiple naming patterns;
- exact/recursive folders, date formats, globs, safe-subset regular expressions, match counts, and samples; regex tests reject overlong patterns, excessive repetition/state counts, invalid flags, backreferences, and lookaround; differential tests compare the supported subset with native Unicode regex semantics on short inputs, and adversarial benchmarks cover nested/ambiguous groups and adjacent repetitions without native backtracking;
- daily, weekly, monthly, quarterly, and yearly periodic-note presets with configurable paths and formats;
- prevention of an invalid rule from silently matching every file; invalid persisted naming conditions, including explicit non-array `namingPatterns` or legacy `patterns`, remain available for diagnosis and disable their whole rule instead of being removed during normalization or saving and broadening the match; omitted conditions and empty arrays remain valid rules without a naming restriction.
- exact-file path normalization, deduplication, main-count exclusion, rename following, and visible removal of missing paths in settings.

## Full and incremental equivalence

A clean rebuild is the correctness reference for the incremental implementation. Tests maintain a mutable virtual Vault and, after every create, modify, delete, or rename:

1. let the incremental controller process the event and reach idle;
2. rebuild a clean index from the current virtual Vault;
3. compare normalized files, snapshots, occurrence statuses, edge counts, and self-links.

Protected-range regressions for Markdown fallback, accurately positioned Metadata Cache entries, and Canvas text must use the real adapter and full/incremental controllers. Move valid and missing targets from prose into comments/code and back, then verify that occurrences, broken links, valid edges, and isolation update together and match a clean rebuild. Container-indentation cases distinguish code inside `>     [[Target]]` from a second list paragraph in `- item\n\n    [[Target]]`, covering varying list-marker widths, tabs, nesting, paragraphs and lazy continuations, container termination, comment/HTML/fence literals inside code, and original UTF-16 coordinates after CRLF and non-BMP characters.

Fixed-seed random event sequences repeatedly verify differential equality. Focused race tests cover revalidation of valid and broken references when a same-name file appears, prevention of an older asynchronous snapshot overwriting a newer revision, repeated-event coalescing, absorption of pre-scan event storms by the new complete initial index without duplicate snapshot work, buffered replay of create/modify/delete/rename after a scan has begun, one late host-wide `resolved` correction after a Metadata Cache timeout, and bounded concurrency. Graph-contribution rule tests use the same normalized state as a stable differential fingerprint to prove that regraph equals a clean materialization under the new policy without increasing adapter-read or source-parse counts.

Block-context regressions follow CommonMark 0.31.2 list-interruption rules and examples 97, 207, 213, 216, 280 and 285. They cover non-1 ordered markers and empty list markers after paragraphs, setext with and without a preceding paragraph, the second blank line of an empty item, and valid, invalid and multiline reference definitions. Each case separately asserts occurrences, missing targets, valid-edge contributions and isolated files; equality between incremental and clean rebuilds alone does not prove correct semantics.

## Rebuild and failure tests

Transactional tests verify that staging is invisible before completion and is published atomically only after success. On build failure, the store retains the same most-recent trustworthy object and generation.

Coordinator tests cover buffering and replay during rebuild, single-flight concurrent rebuilds within one lifecycle, lifecycle recovery after pre-rebuild incremental failure, prevention of an obsolete rebuild from publishing or claiming more sources after stop, and prevention of an old operation finalizer from cleaning up a new controller after stop→start. Yield tests inject `yieldControl` and a controlled clock to verify both file-count and main-thread-time budgets; progress tests verify throttling and final progress.

Failure tests should assert more than an exception: they must verify whether a trustworthy index remains, whether queued events can continue, and whether status honestly becomes failed or stale. After the first complete build fails with no trustworthy index, a large event burst must also prove that the plugin layer does not retain history linearly; the next full rebuild still reads complete current Vault state. Targeted synchronous-reducer fault injection makes a later source in one batch introduce a cross-source occurrence-ID collision and asserts that batch prevalidation fails before any file metadata or snapshot is published.

## UI, settings, and localization tests

Group automated UI tests by the operation they verify:

- Navigation and recovery: two business tabs, three settings tabs, no permanent sidebar title/refresh/settings row, first-index build, contextual Retry, and the rebuild entry in settings.
- Queries and layout: search, equal-width view segments, immediate grouped-main switching, native target/source-file/source-folder selection, contextual sorting, list/tree ordering, source-tree counts, and lazy DOM for collapsed branches.
- Scope and classification: temporary format filters, advanced expected-isolation display, individual and exact/recursive folder marking, Undo, and low-confidence states.
- Pagination: fixed 100-result pages with reachable first and final pages; badges retain complete-result counts.
- Index details: collapsed by default, O(1) diagnostic counts, subscriptions released when settings close, and aggregate errors only; expanding details causes no Vault reads or full-graph export.

Ignore-rule regressions cover edits and Cancel without commits, Save enabled only by a current preview, cancellation on input/index publication/settings closure, late results unable to restore old counts, rejection of concurrent saved-rule changes, empty values, disabled drafts, cancelled new rules, and future-schema write protection. DOM checks verify accessible names for scope, matcher, and value; preview tests distinguish repeated references, distinct file connections, and self-links.

The canonical `npm run check` gate must enforce coverage thresholds. The release gate must execute both the quick and 50,000-file scale benchmarks. Large-source parsing benchmarks cover explicit-link position mapping and inline-code masking so neither path may regress quadratically with link or backtick count.

Settings tests cover schema normalization, migration, future-schema write protection, serialized coalescing saves, retryable failures, and the imperative top-tab implementation used on every supported Obsidian version. Rule-editor tests also cover accessible names for kind, match target, pattern, and flags controls, association with validation feedback, and invalid drafts disabling Save before preview; navigation tests cover node or line/column context when a non-Markdown source cannot be positioned precisely. They prove that declarative definitions remain empty so Obsidian cannot bypass the tab layout. Keyboard tests cover tablist roles, roving tabindex, arrow keys, Home/End, focus retention, and RTL. DOM tests cannot replace real Obsidian style and focus acceptance.

The host-style geometry regression launches a real Chrome/Chromium process without adding a package dependency and loads the repository's actual `styles.css` together with a minimal Obsidian host-style contract. It measures multiline result line boxes and overflow, a long Russian badge, square host checkboxes with separate targets of at least 34px, native disclosure markers, overrides of host button backgrounds and shadows, a non-overflowing 220px sidebar fallback with container queries disabled, a 450px custom-settings body, and logical RTL indentation. This is automated browser evidence in the regular test gate; the environment must provide Chrome/Chromium or set `LINK_INTEGRITY_CHROME_PATH` to an executable. It does not replace acceptance with real themes, system scaling, a real RTL interface, coarse-pointer devices, or a mobile host.

Navigation CSS checks inspect selectors, individual declarations, and their priorities through CSSOM. Splitting a rule or reordering independent declarations must not break them. Browser geometry and focus tests remain the evidence for layout under the host-style contract; the declaration checks do not replace them.

The i18n gate checks 12 complete independent catalogs, compile-time exact key coverage, interpolation, plurals, language autonyms, the Follow Obsidian label, structural parity of stable Chinese and English documents, and retired terminology. README checks use the reader's actual sidebar labels and retain offline target validation for canonical root links and relative translated links. Help-link tests cover localized guide targets and availability without settings writes. A stable catalog may not be completed by spreading the English object over missing translations.

## Performance and scale

Incremental performance regression must cover ordinary body edits of a heavily referenced note. In 10k and 50k file graphs, edit the central note 12 times with a ready, unchanged target fingerprint and assert exactly 12 source builds and no Vault-registry enumeration. Update both sidebar projections while preserving the old index and unchanged result-array identities. Synthetic batch ceilings are 750 ms and 1,500 ms respectively; they do not represent real-host input latency.

Scheduling and copy-on-write tests inspect the published index at each yield and prove that old files, snapshots, reverse indexes, and edge counts remain unchanged until complete-batch publication. Cover mutation in both branches, later-source validation failure, new events or stop during a yield, source-position updates, changed heading/block/footnote fingerprints and unknown metadata, and the single reducer used with concurrent full-build reads. Query tests compare scheduled and synchronous projections and incremental and clean projections, including accumulated inactive-tab changes, deletion, ignores, and the no-incoming option. UI tests cover retained nodes and focus on progress updates, correct click payloads for reused rows, hidden-view recovery, obsolete requests, and close lifecycle.

Real-host responsiveness separately requires Performance recordings of plugin long tasks, input latency, and peak memory, comparing a disabled plugin, a ready index with its result tab closed, and an open result tab. CPU throttling is supplemental and does not replace the specified low-spec machine. Synthetic tests cannot establish that an individual host API or JSON parse fits the scheduling budget.

Synthetic benchmarks record file count, occurrence count, source-kind distribution, environment, and elapsed time. A quick gate may use 10k files; 50k and, where necessary, 100k must be explicitly executed as separate scales and must not be reported if a script argument silently falls back to a smaller run.

Performance acceptance observes at least full construction, one-file modification, namespace create/delete/rename, duplicate Vault/Metadata Cache callback bursts, dormant startup with scanning disabled, ignored startup `resolve(file)` storms, the one-shot host-wide `resolved` correction after a timeout, zero-parse regraph for graph-only rule changes, independent active-tab queries, rule previews, and bounded sidebar DOM. Thresholds detect regressions and are not real-device promises; mobile devices require separate measurements.

The benchmark contract runs a 10k-file quick scale and an explicit 50k-file scale. A 100k result may be reported only when that scale is explicitly executed. The graph-contribution benchmark generates three occurrences per source and repeatedly replaces one complete source snapshot; it asserts that rule evaluation is bounded by the old and new occurrences for each batch and that ordinary updates never rebuild the complete graph. Its 10k and 50k elapsed ceilings are 500 ms and 1,000 ms. Heap deltas are diagnostic only because garbage-collection timing makes them unsuitable as a stable threshold.

The active-tab benchmark proves that refreshing Broken links does not compute the inactive isolated-file projection. The isolated-projection ceilings are 2,000 ms at 10k and 8,000 ms at 50k; the Broken links ceilings are 500 ms and 1,000 ms. Synthetic thresholds detect regressions but do not replace real-Vault startup, interaction-jank, or longest-main-thread-task measurement.

## Package and host acceptance

A packaged candidate must come from a deterministic production build and verify that the runtime install assets are exactly `main.js`, `manifest.json`, and `styles.css`. Installation into an isolated Vault replaces those three assets while preserving `data.json`, then records file hashes and the plugin load result.

The real desktop host matrix should cover at least Obsidian 1.12.7 and the current 1.13.x, verifying Metadata Cache boundaries, official resolver results, live events, precise navigation, themes, a narrow sidebar, keyboard operation, and RTL. Mobile acceptance separately covers touch targets, background/resume, rotation, narrow screens, and responsiveness on a larger Vault.

Stable repository documentation records the repeatable matrix and evidence boundaries, not
machine-specific paths, run IDs, screenshots, hashes, or dated execution logs. Release decisions
must use a separately retained record for the exact candidate and host without promoting a smoke
check into navigation, live-event, or emulator evidence.

## Completion criteria

A candidate may make a claim only when evidence exists separately for that fact: automated gates pass, the candidate asset contract passes, the target Obsidian version passes in an isolated Vault, or the emulator passes. Android physical devices and iOS are not acceptance levels for this project. Missing evidence at one supported level does not invalidate lower-level evidence, but lower-level evidence must never be promoted into a higher-level acceptance claim.

When a failure is found, record the smallest reproduction, the affected semantic invariant, the most recent trustworthy state, and the regression test added after repair. Any production Vault deployment requires separate authorization after isolated acceptance is complete.

## Body diagnostic regression and coexistence acceptance

Cached and fallback paths must agree for exactly positioned Obsidian comments, code and YAML-comment references, covering LF/CRLF/CR, embeds, native reference-style links, formatted labels and independent property references. The real adapter's 10k/50k-source benchmark checks one body read per source, protected references excluded from the graph, and 12 single-source edits causing only 12 reads without registry enumeration. A real Chromium style regression loads native unresolved and hover selectors, proving that owned hints retain warning-colored waves while unmarked native and virtual links keep host styling; it still does not replace real-host acceptance.

Automated regression covers default Off, missing/legacy mention fields, three settings tabs, absence of retired commands/actions, shared diagnostic toggles/ignores, the three confirmed missing reasons and pending/invalid/unsupported negatives, full-text and cache/snapshot identity, equal-length prefixes becoming code/comments, CRLF/CR coordinates and protected syntax. Confirmed diagnostics never change graph/isolation results, and missing headings/blocks preserve existing file edges.

Reading tests cover same labels at different targets, repeated native destinations, bare #^block mixed with real references, extra third-party anchors, conservative fallback for embeds/reference-style links/transformed text, native href/click preservation, hover/focus/Escape, the touch diagnostic entry, Off, asynchronous close, DOM mutation and surviving children at unload. Editor tests cover immediate clearing on edits, IME, viewport limits and cancellation.

Explicit 10k/50k benchmarks retain index/query/incremental/regraph scale and additionally exercise dense real references in one source, shared proof/projection, multiple reading sections and repeated-destination counts, including concurrent deduplication above two million UTF-16 units without completed retention. Separately terminable workers check long letters/digits/punctuation, repeated brackets, missing delimiters and two-million-character bodies; a five-second watchdog only bounds failed-test resource use and does not guarantee host latency. Short-input legacy oracles verify unchanged URL/email and incomplete-syntax protection. Regression also covers changed-to-resolve recovery and same-cache rename-to-resolved recovery without graph scans, missing-file keys with fragments and .md, toggle-controlled observers/interaction listeners, in-place anchor attributes, and tooltip owner viewport, flipping, scrolling and focus restoration. Record actual counts, text units and diagnostic memory; machine timing is not a host guarantee. Old potential dictionaries or reverse-lookup measurements do not prove current behavior.

body-link-hints and body-link-hints-fakelink use explicit self-contained provider prepare/repair/restore commands. Observe the original five broken/four isolated counts first, then 10/5→5/5→10/5. An independent FakeLink environment checks both enable orders, native navigation, hover preview, third-party conversion updates and disabling either plugin; virtual text must never enter the graph or be mislabeled. Fixture setup is not product acceptance; desktop/Android emulator evidence is recorded separately from source tests.
