# Link Integrity Testing Strategy

The Link Integrity testing strategy prioritizes diagnostic correctness and index consistency while keeping automated gates, packaged candidates, real hosts, emulators, and physical-device evidence strictly separate.

## Evidence levels

Different evidence answers different questions and cannot substitute for another level:

1. static and automated tests prove types, pure semantics, controllers, and deterministic contracts;
2. packaged-candidate checks prove the actual install assets and version contract;
3. an isolated real Obsidian Vault proves host APIs, navigation, and interface behavior;
4. an Android emulator proves layout and host behavior in one simulated mobile environment;
5. a physical device proves real touch, performance, filesystem, and lifecycle behavior.

A green build is not real-host acceptance, and an emulator is not physical-device evidence. A production Vault is not used for destructive or first-time acceptance experiments.

## Core semantic tests

Pure fixtures should cover:

- resolved, missing, invalid, and pending file states;
- successful, missing, pending, and unsupported heading or block states;
- retention of a file-level edge when the file exists but its subpath is missing;
- Markdown, embed, Frontmatter, Canvas, and Bases explicit source kinds;
- self-links, external URLs, and repeated occurrences;
- absence of explicit edges from dynamic Bases results;
- separation of candidate, diagnostic, and contribution scopes.

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

## Full and incremental equivalence

A clean rebuild is the correctness oracle for the incremental implementation. Tests maintain a mutable virtual Vault and, after every create, modify, delete, or rename:

1. let the incremental controller process the event and reach idle;
2. rebuild a clean index from the current virtual Vault;
3. compare normalized files, snapshots, occurrence statuses, edge counts, and self-links.

Fixed-seed random event sequences repeatedly verify differential equality. Focused race tests cover revalidation of valid and broken references when a same-name file appears, prevention of an older asynchronous snapshot overwriting a newer revision, repeated-event coalescing, global metadata-resolved handling, and bounded concurrency.

## Rebuild and failure tests

Transactional tests verify that staging is invisible before completion and is published atomically only after success. On build failure, the store retains the same last-known-good object and generation.

Coordinator tests cover buffering and replay during rebuild, single-flight concurrent rebuilds, lifecycle recovery after pre-rebuild incremental failure, and prevention of an obsolete rebuild publishing after stop. Yield tests inject `yieldControl`, and progress tests use a controlled clock to verify throttling and final progress.

Failure tests should assert more than an exception: they must verify whether a trustworthy index remains, whether queued events can continue, and whether status honestly becomes failed or stale.

## UI, settings, and localization tests

Automated UI tests should cover the two business tabs, three settings tabs, search, sorting, list/tree or grouped views, temporary format filters, advanced expected-isolation display, and low-confidence markers.

Settings tests cover schema normalization, migration, future-schema write protection, serialized coalescing saves, retryable failures, and a single definition source shared by the 1.12 imperative and 1.13 declarative settings implementations. Keyboard tests cover tablist roles, roving tabindex, arrow keys, Home/End, focus retention, and RTL. DOM tests cannot replace real Obsidian style and focus acceptance.

The i18n gate checks complete catalogs, English fallback, interpolation, plurals, language autonyms, structural parity of stable Chinese and English documents, and retired terminology.

## Performance and scale

Synthetic benchmarks record file count, occurrence count, source-kind distribution, environment, and elapsed time. A quick gate may use 10k files; 50k and, where necessary, 100k must be explicitly executed as separate scales and must not be reported if a script argument silently falls back to a smaller run.

Performance acceptance observes at least full construction, one-file modification, namespace create/delete/rename, global metadata-resolved work, isolation queries, and rule previews. Thresholds detect regressions and are not real-device promises; mobile devices require separate measurements.

The local synthetic 10k and explicit 50k modes have been run for the current implementation. The final pre-host 50k run built the graph and projected isolated files in 704.1 ms (1.063 s for the complete guarded benchmark test) on the recorded local runtime. A 100k claim remains unverified and must not be inferred from the 50k result.

## Package and host acceptance

A packaged candidate must come from a deterministic production build and verify that the runtime install assets are exactly `main.js`, `manifest.json`, and `styles.css`. Installation into an isolated Vault replaces those three assets while preserving `data.json`, then records file hashes and the plugin load result.

The real desktop host matrix should cover at least Obsidian 1.12.7 and the current 1.13.x, verifying Metadata Cache boundaries, official resolver results, live events, precise navigation, themes, a narrow sidebar, keyboard operation, and RTL. Mobile acceptance separately covers touch targets, background/resume, rotation, narrow screens, and responsiveness on a larger Vault.

The 2026-08-02 isolated-host attempt bound candidate commit `88fdb45` and its three install-asset hashes through `obsidian-acceptance-kit`, launched the installed Obsidian 1.12.7 binary with a fresh `--user-data-dir`, and opened the exact randomly named temporary Vault. Obsidian then presented its “trust this Vault author and enable plugins” security prompt before loading Link Integrity. Automation did not accept or bypass that prompt; the host lifecycle was recorded with a failed outcome and archived under run `b2d214ad-3c07-4f9b-b946-5940e8697c1b`.

This is real evidence for the 1.12.7 executable, isolated profile, exact temporary Vault, and installed candidate bytes, but it is not plugin host acceptance. Plugin loading, sidebar counts, navigation, settings behavior, live events, 1.13.x, Android emulator, and physical-device behavior remain not verified.

## Completion criteria

A candidate may make a claim only when evidence exists separately for that fact: automated gates pass, the candidate asset contract passes, the target Obsidian version passes in an isolated Vault, the emulator passes, or a physical device passes. Missing evidence at one level does not invalidate lower-level evidence, but lower-level evidence must never be promoted into a higher-level acceptance claim.

When a failure is found, record the smallest reproduction, the affected semantic invariant, the last-known-good state, and the regression test added after repair. Any production Vault deployment requires separate authorization after isolated acceptance is complete.
