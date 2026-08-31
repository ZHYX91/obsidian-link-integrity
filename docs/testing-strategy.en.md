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

Every mobile candidate's shared release closure requires desktop and current Android-emulator product evidence. Android physical devices and iOS are outside the shared acceptance scope.

## Core semantic tests

Pure fixtures should cover:

- resolved, missing, invalid, and pending file states;
- successful, missing, pending, and unsupported heading or block states;
- retention of a file-level edge when the file exists but its subpath is missing;
- Markdown, embed, Frontmatter, Canvas, and Bases explicit source kinds;
- fallback-parser exclusion of fenced and indented code plus frontmatter YAML comments, while retaining links in frontmatter values and paragraph continuations;
- self-links, external URLs, and repeated occurrences;
- absence of explicit edges from dynamic Bases results;
- separation of candidate, diagnostic, and contribution scopes.

Occurrence-identity regressions prove that unrelated text and unrelated links inserted before a saved occurrence preserve its ignore match, while file and folder rename events migrate the persisted source identity. Inserting an indistinguishable duplicate must change duplicate-set cardinality and make the old rule match zero results, which the rule preview exposes, rather than matching a different occurrence. Workflow-contract syntax validation concatenates the extracted shell blocks into one `bash -n` process so the Windows gate does not pay one Git Bash startup per block.

File-type registry tests cover the classification hierarchy, extension aliases, casing, overlapping media classifications such as WebM, PDF under fixed-layout files, and custom extensions.

## Isolation and rule tests

Isolation projections must prove that the default definition requires both valid incoming and outgoing neighbor counts to be zero. A file with only broken outgoing links remains isolated and carries a broken-occurrence count and low confidence; self-links and external URLs do not change isolation.

The no-incoming query is tested separately so a file with valid outgoing links cannot enter the default isolated result. Candidate-type filtering must not remove real connections contributed by unselected files.

Expected-isolation tests cover:

- exclusion from main results and the main count by default, with `expected-isolated` classification when advanced display is enabled;
- no graph edge creation by expected classification;
- AND between file-type, folder, and naming conditions, with OR between multiple naming patterns;
- exact/recursive folders, date formats, globs, regular expressions, match counts, and samples;
- daily, weekly, monthly, quarterly, and yearly periodic-note presets with configurable paths and formats;
- prevention of an invalid rule from silently matching every file.
- exact-file path normalization, deduplication, main-count exclusion, rename following, and visible removal of missing paths in settings.

## Full and incremental equivalence

A clean rebuild is the correctness oracle for the incremental implementation. Tests maintain a mutable virtual Vault and, after every create, modify, delete, or rename:

1. let the incremental controller process the event and reach idle;
2. rebuild a clean index from the current virtual Vault;
3. compare normalized files, snapshots, occurrence statuses, edge counts, and self-links.

Fixed-seed random event sequences repeatedly verify differential equality. Focused race tests cover revalidation of valid and broken references when a same-name file appears, prevention of an older asynchronous snapshot overwriting a newer revision, repeated-event coalescing, absorption of pre-scan event storms by the new baseline without duplicate snapshot work, buffered replay of create/modify/delete/rename after a scan has begun, one late host-wide `resolved` correction after a Metadata Cache timeout, and bounded concurrency. Graph-contribution rule tests use the same normalized state as a stable differential fingerprint to prove that regraph equals a clean materialization under the new policy without increasing adapter-read or source-parse counts.

## Rebuild and failure tests

Transactional tests verify that staging is invisible before completion and is published atomically only after success. On build failure, the store retains the same last-known-good object and generation.

Coordinator tests cover buffering and replay during rebuild, single-flight concurrent rebuilds within one lifecycle, lifecycle recovery after pre-rebuild incremental failure, prevention of an obsolete rebuild from publishing or claiming more sources after stop, and prevention of an old operation finalizer from cleaning up a new controller after stop→start. Yield tests inject `yieldControl` and a controlled clock to verify both file-count and main-thread-time budgets; progress tests verify throttling and final progress.

Failure tests should assert more than an exception: they must verify whether a trustworthy index remains, whether queued events can continue, and whether status honestly becomes failed or stale. Targeted synchronous-reducer fault injection makes a later source in one batch introduce a cross-source occurrence-ID collision and asserts that batch prevalidation fails before any file metadata or snapshot is published.

## UI, settings, and localization tests

Automated UI tests should cover the two business tabs, three settings tabs, absence of a fixed sidebar title/refresh/settings row, first-index build, contextual recovery rebuild, the permanent settings-page rebuild entry and its collapsed-by-default index details, search, equal-width view segments, immediate grouped-main switching, the native target/source-file/source-folder grouping select, contextual native sorting shown or hidden by view, fixed list/tree ordering contracts, source-tree counts and lazy DOM for collapsed branches, temporary format filters, advanced expected-isolation display, individual expected-isolation actions, exact/recursive expected-folder rules with Undo, low-confidence markers, and fixed 100-result pagination with reachable first and final pages. Index-detail tests also prove that counts come from an O(1) diagnostics snapshot, subscriptions detach when settings close, failures expose aggregate error text only, and expanding details causes neither Vault reads nor a complete-graph export.

The canonical `npm run check` gate must enforce coverage thresholds. The release gate must execute both the quick and 50,000-file scale benchmarks. Large-source parsing benchmarks cover explicit-link position mapping and inline-code masking so neither path may regress quadratically with link or backtick count.

Settings tests cover schema normalization, migration, future-schema write protection, serialized coalescing saves, retryable failures, and the imperative top-tab implementation used on every supported Obsidian version. They prove that declarative definitions remain empty so Obsidian cannot bypass the tab layout. Keyboard tests cover tablist roles, roving tabindex, arrow keys, Home/End, focus retention, and RTL. DOM tests cannot replace real Obsidian style and focus acceptance.

The host-style geometry regression launches a real Chrome/Chromium process without adding a package dependency and loads the repository's actual `styles.css` together with a minimal Obsidian host-style contract. It measures multiline result line boxes and overflow, a long Russian badge, square host checkboxes with separate targets of at least 34px, native disclosure markers, overrides of host button backgrounds and shadows, a non-overflowing 220px sidebar fallback with container queries disabled, a 450px custom-settings body, and logical RTL indentation. This is automated browser evidence in the regular test gate; the environment must provide Chrome/Chromium or set `LINK_INTEGRITY_CHROME_PATH` to an executable. It does not replace acceptance with real themes, system scaling, a real RTL interface, coarse-pointer devices, or a mobile host.

The i18n gate checks 11 complete independent catalogs, compile-time exact key coverage, interpolation, plurals, language autonyms, the Follow Obsidian label, structural parity of stable Chinese and English documents, and retired terminology. A stable catalog may not be completed by spreading the English object over missing translations.

## Performance and scale

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

When a failure is found, record the smallest reproduction, the affected semantic invariant, the last-known-good state, and the regression test added after repair. Any production Vault deployment requires separate authorization after isolated acceptance is complete.
