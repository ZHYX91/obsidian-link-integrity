---
source_language: zh-CN
translation_of: architecture.zh-CN.md
translation_status: synced
---

# Link Integrity — Architecture

This document describes the current module boundaries, index invariants, and consistency strategy of Link Integrity.

## Module boundaries

The code is layered by responsibility:

- `src/core/`: pure TypeScript file classification, link models, graph semantics, scopes, and expected-isolation rules, with no Obsidian imports;
- `src/features/index/`: full rebuilds, atomic publication, incremental event coordination, and lifecycle control;
- `src/features/queries/`: broken-link, isolated-file, no-incoming, and expected-isolation projections;
- `src/adapters/`: host boundaries for the Vault, Metadata Cache, link resolution, Canvas, Bases, and navigation;
- `src/ui/`: sidebar, settings, and accessible interaction;
- `src/app/`: plugin lifecycle, dependency composition, and status coordination;
- `src/shared/`: settings, i18n, the save queue, and shared rule services.

`LinkIndex` is the single source of truth for derived diagnostics. Views and settings previews read it through the query layer and must not scan the Vault independently.

## Core data model

Each `LinkOccurrence` stores a stable ID, source path, raw text, linkpath, subpath, kind, position, lookup key, target path, and separate file-level and subpath-level statuses. Separating those statuses lets “file exists but heading is missing” produce both a valid file edge and a broken-subpath diagnostic.

Each source file owns one complete `SourceSnapshot`. When a source changes, the index replaces the entire snapshot through the same reducer. Old occurrences, lookup references, and edge contributions are removed together, and the new contents are added together; fields are not patched individually.

Persisted occurrence-ignore rules use a versioned semantic identity: normalized source path, occurrence kind, a hash of the raw/link text, duplicate index, and duplicate-set cardinality. Mutable line/column and the global ordinal remain navigation and migration metadata, not part of semantic rule identity. Unrelated content or a different link inserted before an occurrence therefore does not invalidate its rule, and Vault file/folder rename events rewrite the saved source component. For indistinguishable duplicates, changing the duplicate-set cardinality deliberately makes an existing rule match zero occurrences until its settings preview is reviewed, instead of silently rebinding it to the wrong duplicate.

The index maintains:

- the current `FileRecord` registry;
- complete snapshots keyed by source;
- lookup-key reverse indexes for every occurrence, including currently valid links;
- a reverse index by resolved target path;
- forward and reverse valid edges counted by reference kind;
- self-link counts and file metadata.

Keeping every lookup reference matters because creating, deleting, or renaming a same-name file can retarget a link that was previously valid or broken.

## Resolver adapters

Obsidian semantics are resolved only in adapters. The current adapter uses the official `parseLinktext`, `MetadataCache.getFirstLinkpathDest`, and `resolveSubpath` APIs instead of reproducing Obsidian path, alias, heading, or block normalization in core.

The adapter builds a complete snapshot for every supported explicit source. Markdown and Frontmatter use the Metadata Cache with text extraction as a fallback where needed; Canvas reads explicit file nodes, background files, and internal links in text; Bases contributes explicit file references only. Results of dynamic Bases queries never enter the graph model. Invalid Canvas JSON fails closed: the batch does not replace file metadata or snapshots, and an existing last-known-good index remains visible as stale instead of turning the Canvas into a high-confidence isolated result.

The Markdown fallback preserves UTF-16 source offsets while masking fenced and indented code, inline code, Obsidian comments, and YAML comment ranges inside BOM-aware `---`/`...` frontmatter. It retains explicit links in frontmatter values and ordinary Markdown text. Canvas text nodes use the same fallback, so transient startup parsing and Canvas diagnostics share one false-positive boundary.

Core lookup-key normalization is used only for conservative revalidation after namespace changes. It neither replaces the official resolver nor decides the final target.

## Graph and query invariants

A reference contributes a valid edge only when it is internal, has file-level status `resolved`, targets a currently existing file, and connects two different files. A missing heading or block does not revoke the file-level edge. External URLs, self-links, and dynamic Bases results do not contribute connections.

Edges are counted by source, target, and occurrence kind, so removing one repeated reference does not erase other contributions between the same files. The isolated projection requires both incoming and outgoing neighbors from other files to be zero; the no-incoming projection requires only incoming neighbors to be zero.

Candidate, diagnostic, and contribution scopes apply separately to queries, visibility, and the graph. Ordinary filters do not touch the graph. The product layer injects a separate `GraphContributionPolicy` for advanced contribution exclusions: rule-setting changes reevaluate edges and self-links directly from the stored file registry and source snapshots without rereading or reparsing the Vault, while an ordinary source-snapshot replacement evaluates only the old and new occurrences for that source and updates edges locally. Explicit set-based exclusions remain represented by `GraphContributionScope`, and the product layer warns about the risk of advanced rules.

Exact expected-isolation paths and expected-isolation rules both run in the query layer. They classify only candidates that are already isolated and never write to the `LinkIndex` edge set, so they cannot create synthetic date-adjacency edges. Sidebar projections produce only results and classification counts; rule-match statistics are computed on demand by settings previews. Exact paths are normalized and deduplicated during settings load. File renames update exact paths, while folder renames rewrite descendant exact paths, folder rules, and periodic-note folders at path boundaries. Missing paths are not silently deleted.

## Transactional full rebuild

A full rebuild first obtains the current file registry from the adapter, then builds source snapshots with bounded concurrency in a separate staging `LinkIndex`. The controller yields on both a file-count ceiling and an approximately 8 ms main-thread time budget, with injectable yielding and throttled progress callbacks, so quickly completed files or a costly parsing batch do not monopolize the renderer indefinitely.

When a baseline is requested by startup scanning, the sidebar, or a manual rebuild, Vault create, modify, delete, and rename events are registered before the initial host-wide Metadata Cache resolution boundary and enter the bounded coalescing buffer. Events accumulated before a new full staging scan begins are absorbed by the baseline that is about to read current Vault state and are not replayed a second time. Only events that arrive after staging begins are replayed against staging so it catches up before atomic publication. Metadata Cache change/delete listeners are attached only after the initial resolution boundary (or a bounded fallback wait) and the full rebuild. A fallback timeout opens the baseline gate without falsely marking the cache resolved; the one-shot host-wide `resolved` listener remains attached, and a later signal synthesizes one all-source revalidation to correct fallback results. The runtime deliberately does not subscribe to per-file `resolve(file)`: content and namespace events already revalidate the changed source and its referers, while replaying the host's startup resolution tail would duplicate the full scan.

`AtomicLinkIndexStore` publishes the new index once, and only after staging completes successfully. A build failure does not mutate the current index; an existing index remains the last-known-good result while application status marks the result failed or potentially stale.

`LinkIndexCoordinator` buffers source events during a rebuild, replays them against staging, and catches up with current Vault state before publication. After a failure with an existing baseline, remaining events continue updating the stale last-known-good index. After a first-baseline failure, that incremental batch is discarded so local events cannot manufacture a partial index; the next rebuild reads the complete Vault again. Concurrent requests in one lifecycle share one rebuild promise. Every rebuild has an operation generation and cancellation signal; stop or restart prevents old workers from claiming new sources and prevents old catch/finally, progress, or publication paths from touching the new lifecycle. Host reads already in flight cannot be preempted, so cancellation leaves at most the reads already inside the bounded-concurrency window.

## Incremental updates

The incremental controller accepts create, modify, delete, rename, and synthetic metadata-resolved events at its host-independent port. The Obsidian runtime feeds it Vault events plus Metadata Cache change/delete events. Repeated runtime events enter a 100 ms trailing quiet window with a 500 ms maximum wait, are then coalesced before snapshot work begins, and use bounded snapshot concurrency.

Consistency protection includes:

- lifecycle epoch: results from an old lifecycle cannot publish after stop or restart;
- operation generation and cancellation signal: an old rebuild cannot clean up a new controller, claim more sources, or publish completion diagnostics;
- path revision: every affected source has a monotonic revision, so an older asynchronous snapshot cannot overwrite a newer revision;
- bounded quiet-window coalescing: duplicate Vault and Metadata Cache callbacks for one path trigger one build without allowing a continuous stream to postpone updates indefinitely;
- lookup and target reverse indexes: namespace or target-metadata changes revalidate the direct source, sources currently resolved to the target, and sources that may retarget through a lookup key.

Create, delete, and rename events refresh the file registry and compare old and new lookup keys. Deleting a source removes its complete snapshot through the same replacement reducer. Vault modify and Metadata Cache changed callbacks revalidate the source and its referers after the bounded quiet window. The host-wide `resolved` completion signal normally serves only as the initial readiness boundary. Only when the initial wait timed out and allowed a fallback baseline does the first later `resolved` become one all-source correction; subsequent ordinary signals remain ignored. Snapshot and contribution-scope replacements perform semantic no-op checks; ordinary snapshot replacement updates through the active contribution policy locally, and only a policy or explicit contribution-scope change reevaluates the complete graph. Full-rebuild staging inherits the coordinator's current policy and synchronizes any rule change again immediately before publication.

Broken-link and isolated-file result arrays are independent lazy projections cached until index, settings, or graph semantics change. Only the active tab computes its projection and builds sorted groups or trees; an inactive tab displays its last-known badge, or an unknown marker before its first query. The Broken links source-folder tree is built from source paths on the current fixed page, while counts come from the complete visible projection; only expanded branches create descendant result DOM, and expanded paths persist as an interface preference. Progress/status updates reuse both caches, and the advanced no-incoming projection is skipped while disabled. Rendering uses a fixed 100-result page so one view can never materialize the entire Vault as DOM.

## Persistence and recovery

The plugin does not persist `LinkIndex`, edges, or diagnostic projections. `data.json` stores only settings, rules, and interface preferences after schema validation, migration, and normalization. This prevents a stale namespace from a previous run from becoming an authoritative result.

The coordinator separately maintains a small read-only runtime-diagnostics snapshot. File, source, and occurrence counts come directly from index-container sizes; a completed full rebuild or successful incremental batch records only aggregate counts, completion time, duration, and pending-event count at its completion boundary. Settings subscribe to that snapshot without traversing the Vault, exporting canonical state, or persisting diagnostics. Staging replay never masquerades as an incremental update to the published index.

Scan on startup is disabled by default. While it remains disabled and the sidebar has not been opened, the coordinator, Vault listeners, and Metadata Cache listeners remain dormant. Restoring or first opening the sidebar, enabling startup scanning after layout readiness, or manually rebuilding starts the runtime and a complete baseline; local events are never used to manufacture a partial baseline. After the baseline succeeds, incremental updates keep the index synchronized for the session, so routine changes require no manual refresh. If future performance evidence justifies a cross-restart cache, it must remain a verifiable cache and cannot bypass resolution against the current Vault.

## Current implementation boundaries

Automated tests cover core graph invariants, snapshot replacement, normalized differential equality between regraph and a clean materialization, synchronous reducer-batch prevalidation, same-name target revalidation, random-event differential equality, late Metadata Cache correction, last-known-good retention, event replay, worker cancellation, operation-generation isolation, and query semantics. A dedicated 10k/50k benchmark also constrains ordinary single-source updates to evaluating only that source's old and new occurrences. Actual resolution accuracy ultimately depends on the live Obsidian APIs and real file caches.

There is currently no derived-graph persistence, external-URL network checking, automatic deletion, or bulk repair. Architecture tests do not establish the required Obsidian 1.12.7/current 1.13.x host matrix, live-event paths, Android emulator behavior, or physical-device behavior; those boundaries require separate acceptance.
