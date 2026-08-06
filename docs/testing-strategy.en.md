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

Fixed-seed random event sequences repeatedly verify differential equality. Focused race tests cover revalidation of valid and broken references when a same-name file appears, prevention of an older asynchronous snapshot overwriting a newer revision, repeated-event coalescing, buffered replay of create/modify/delete/rename during the startup baseline, global metadata-resolved handling, and bounded concurrency.

## Rebuild and failure tests

Transactional tests verify that staging is invisible before completion and is published atomically only after success. On build failure, the store retains the same last-known-good object and generation.

Coordinator tests cover buffering and replay during rebuild, single-flight concurrent rebuilds, lifecycle recovery after pre-rebuild incremental failure, and prevention of an obsolete rebuild publishing after stop. Yield tests inject `yieldControl`, and progress tests use a controlled clock to verify throttling and final progress.

Failure tests should assert more than an exception: they must verify whether a trustworthy index remains, whether queued events can continue, and whether status honestly becomes failed or stale. Targeted synchronous-reducer fault injection makes a later source in one batch introduce a cross-source occurrence-ID collision and asserts that batch prevalidation fails before any file metadata or snapshot is published.

## UI, settings, and localization tests

Automated UI tests should cover the two business tabs, three settings tabs, absence of a fixed sidebar title/refresh/settings row, first-index build, contextual recovery rebuild, the permanent settings-page rebuild entry, search, sorting, list/tree or grouped views, temporary format filters, advanced expected-isolation display, low-confidence markers, and fixed 200-result pagination with reachable first and final pages.

Settings tests cover schema normalization, migration, future-schema write protection, serialized coalescing saves, retryable failures, and a single definition source shared by the 1.12 imperative and 1.13 declarative settings implementations. Keyboard tests cover tablist roles, roving tabindex, arrow keys, Home/End, focus retention, and RTL. DOM tests cannot replace real Obsidian style and focus acceptance.

The host-style geometry regression launches a real Chrome/Chromium process without adding a package dependency and loads the repository's actual `styles.css` together with a minimal Obsidian host-style contract. It measures multiline result line boxes and overflow, a long Russian badge, square host checkboxes with separate targets of at least 34px, native disclosure markers, overrides of host button backgrounds and shadows, a non-overflowing 220px sidebar fallback with container queries disabled, a 450px declarative custom-settings body, and logical RTL indentation. This is automated browser evidence in the regular test gate; the environment must provide Chrome/Chromium or set `LINK_INTEGRITY_CHROME_PATH` to an executable. It does not replace acceptance with real themes, system scaling, a real RTL interface, coarse-pointer devices, or a mobile host.

The i18n gate checks 11 complete independent catalogs, compile-time exact key coverage, interpolation, plurals, language autonyms, the Follow Obsidian label, structural parity of stable Chinese and English documents, and retired terminology. A stable catalog may not be completed by spreading the English object over missing translations.

## Performance and scale

Synthetic benchmarks record file count, occurrence count, source-kind distribution, environment, and elapsed time. A quick gate may use 10k files; 50k and, where necessary, 100k must be explicitly executed as separate scales and must not be reported if a script argument silently falls back to a smaller run.

Performance acceptance observes at least full construction, one-file modification, namespace create/delete/rename, duplicate Vault/Metadata Cache callback bursts, ignored startup `resolve(file)` storms, isolation queries, rule previews, and bounded sidebar DOM. Thresholds detect regressions and are not real-device promises; mobile devices require separate measurements.

The local synthetic 10k and explicit 50k modes have been run for the current implementation. On the exact runtime, the 2026-08-02 candidate built the 10k graph and isolated projection in 116.9 ms; explicit 50k mode took 606.0 ms and the complete guarded 50k benchmark test took 955 ms. A 100k claim remains unverified and must not be inferred from the 50k result.

The dedicated 2026-08-06 graph-ignore benchmark generates three occurrences per source and repeatedly replaces one complete source snapshot. At 10k/29,700 occurrences and 12 batches, the legacy full-scan comparator performed 356,400 rule evaluations and 12 complete-graph rebuilds in 659.6 ms; the local policy path performed 72 evaluations, zero complete-graph rebuilds, and took 0.4 ms. In explicit 50k/149,700-occurrence mode with six batches, the comparator took 898,200 evaluations, six complete-graph rebuilds, and 1,746.6 ms, while the local path took 36 evaluations, zero complete-graph rebuilds, and 0.3 ms. The guard asserts that evaluation count equals only the old and new occurrences per batch and that ordinary updates do not rebuild the complete graph, with broad elapsed limits of 500 ms/1,000 ms respectively; the same-process heap delta is printed but is not a threshold promise because it depends on garbage-collection timing.

## Package and host acceptance

A packaged candidate must come from a deterministic production build and verify that the runtime install assets are exactly `main.js`, `manifest.json`, and `styles.css`. Installation into an isolated Vault replaces those three assets while preserving `data.json`, then records file hashes and the plugin load result.

The real desktop host matrix should cover at least Obsidian 1.12.7 and the current 1.13.x, verifying Metadata Cache boundaries, official resolver results, live events, precise navigation, themes, a narrow sidebar, keyboard operation, and RTL. Mobile acceptance separately covers touch targets, background/resume, rotation, narrow screens, and responsiveness on a larger Vault.

The 2026-08-02 isolated-host attempt bound candidate commit `88fdb45` and its three install-asset hashes through `obsidian-acceptance-kit`, launched the installed Obsidian 1.12.7 binary with a fresh `--user-data-dir`, and opened the exact randomly named temporary Vault. Obsidian then presented its “trust this Vault author and enable plugins” security prompt before loading Link Integrity. Automation did not accept or bypass that prompt; the host lifecycle was recorded with a failed outcome and archived under run `b2d214ad-3c07-4f9b-b946-5940e8697c1b`.

The same date's formal-host smoke deployed runtime commit `296c163` to `D:\OneDrive\Note\.obsidian\plugins\link-integrity` and loaded it in installed Obsidian 1.13.4. Installed SHA-256 values were `350cad31686b2e1dd5676b0097a29666503398c2d11ad6d20fa2a69847dae3e6` for `main.js`, `f047eede08e3828b59380ea87dc68d39b67416a931f5cb82fd1215f7bfa894e9` for `manifest.json`, and `c0ff9ddd2a7087a7d71a5dbfcaaca218317c99afee48d490900482f2e205be94` for `styles.css`. The scan completed with 2 broken-link occurrences and 11,831 isolated files; the sidebar and the General, Broken links, and Isolated files settings sections were visible. After a 45-second post-ready settling period, three consecutive 12-second samples recorded renderer CPU deltas of 0.016 s, 0 s, and 0.016 s, with the renderer working set stable around 1.08 GiB and changing by -0.6 MiB over the final 24 seconds. The remaining roughly 6.8-7.1 CPU seconds per 12-second sample belonged to the Electron browser process and matched the same Vault with Link Integrity disabled.

The same date's follow-up layout repair deployed runtime commit `e03aeba` to the same formal plugin directory and was rechecked in the Chinese desktop host after fully exiting and restarting Obsidian 1.13.4. Final SHA-256 values were `522ed022b702b6c9c3132bed6d7cbf6705d29b8176f2769d720f9384ee1e40ee` for `main.js`, `f047eede08e3828b59380ea87dc68d39b67416a931f5cb82fd1215f7bfa894e9` for `manifest.json`, and `9c72248109fdeb6c6faaef60e7d6a38a7cdad0092f4ba7fbe5a7ba62c7e32149` for `styles.css`. The plugin's `data.json` SHA-256 remained `97550d63bd894c6cc8a75316aba058cacc819ea362e479c267b2cd24ca1d35b3` before and after deployment and host interaction. The real host again reported 2 broken-link occurrences and 11,831 isolated files; with the window maximized, both header actions, both business tabs, broken-link result rows, and more-action buttons were fully visible without text overlap. The isolated-file list, file-type disclosure markers, square checkboxes, 31/31 selection count, and nested image formats and extensions such as JPEG/PNG/TIFF also rendered correctly. The right-half clipping seen in the ordinary narrow window came from the Obsidian workspace retaining a sidebar wider than the application window, not from overflow inside the plugin content.

The streamlined-maintenance acceptance then deployed runtime commit `c9129ca` to the same formal directory and reopened the installed Chinese Obsidian 1.13.4 host. Installed SHA-256 values were `cce0d2d87c35498957fa33df01731e0e34896787bc53468d2ceaf119947c6dec` for `main.js`, `f047eede08e3828b59380ea87dc68d39b67416a931f5cb82fd1215f7bfa894e9` for `manifest.json`, and `502db9a1aeac954a6c635ee2d803930802bf100cd88f463ba6076d15f1662bf6` for `styles.css`. The sidebar built its index without a manual refresh and reported 0 broken-link occurrences and 11,831 isolated files. Its two business tabs were the first controls, with no persistent title, refresh, or settings row; both empty and populated list layouts rendered without overlap. General settings showed Follow Obsidian, described automatic incremental maintenance, and provided a working Rebuild index action that returned to the updated state. The pre-deployment `data.json` SHA-256 `24ba01b2d4b32435179def6f26e73cb96bcd75ef0d66b8c6420c2ae27842c342` was restored byte-for-byte after the temporary acceptance navigation, so no acceptance-only interface state remained in the user's settings.

This is real desktop production-Vault smoke evidence for plugin load, a complete initial scan, result counts, settings rendering, and startup steady state on Obsidian 1.13.4. It did not edit note content or exercise result navigation or live create/modify/delete/rename semantics. The 1.12.7 plugin-load boundary, Android emulator, physical-device behavior, and those live interaction paths remain separately unverified.

## Completion criteria

A candidate may make a claim only when evidence exists separately for that fact: automated gates pass, the candidate asset contract passes, the target Obsidian version passes in an isolated Vault, the emulator passes, or a physical device passes. Missing evidence at one level does not invalidate lower-level evidence, but lower-level evidence must never be promoted into a higher-level acceptance claim.

When a failure is found, record the smallest reproduction, the affected semantic invariant, the last-known-good state, and the regression test added after repair. Any production Vault deployment requires separate authorization after isolated acceptance is complete.
