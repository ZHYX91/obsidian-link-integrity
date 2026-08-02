# Link Integrity Architecture

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

Core lookup-key normalization is used only for conservative revalidation after namespace changes. It neither replaces the official resolver nor decides the final target.

## Graph and query invariants

A reference contributes a valid edge only when it is internal, has file-level status `resolved`, targets a currently existing file, and connects two different files. A missing heading or block does not revoke the file-level edge. External URLs, self-links, and dynamic Bases results do not contribute connections.

Edges are counted by source, target, and occurrence kind, so removing one repeated reference does not erase other contributions between the same files. The isolated projection requires both incoming and outgoing neighbors from other files to be zero; the no-incoming projection requires only incoming neighbors to be zero.

Candidate, diagnostic, and contribution scopes apply separately to queries, visibility, and the graph. Ordinary filters do not touch the graph. Advanced contribution exclusions rebuild graph state through a separate `GraphContributionScope`, while the product layer is responsible for warning about the risk.

Expected-isolation rules run in the query layer. They classify only candidates that are already isolated and never write to the `LinkIndex` edge set, so they cannot create synthetic date-adjacency edges.

## Transactional full rebuild

A full rebuild first obtains the current file registry from the adapter, then builds source snapshots with bounded concurrency in a separate staging `LinkIndex`. The controller supports injectable task yielding and throttled progress callbacks so a large number of quickly completed operations does not monopolize one task indefinitely.

For the startup baseline, Vault create, modify, delete, and rename events are registered immediately and enter the bounded coalescing buffer. Once full staging starts, the coordinator replays those events against staging and catches up to current Vault state before atomic publication. Metadata Cache change/delete listeners are attached only after one initial host-wide resolution boundary (or a bounded fallback wait) and the full rebuild. The runtime deliberately does not subscribe to per-file `resolve(file)`: content and namespace events already revalidate the changed source and its referers, while replaying the host's startup resolution tail would duplicate the full scan.

`AtomicLinkIndexStore` publishes the new index once, and only after staging completes successfully. A build failure does not mutate the current index; an existing index remains the last-known-good result while application status marks the result failed or potentially stale.

`LinkIndexCoordinator` buffers source events during a rebuild, replays them against staging, and catches up with current Vault state before publication. After a failure with an existing baseline, remaining events continue updating the stale last-known-good index. After a first-baseline failure, that incremental batch is discarded so local events cannot manufacture a partial index; the next rebuild reads the complete Vault again. Concurrent rebuild requests share one rebuild promise. When the plugin lifecycle changes, an obsolete rebuild is prevented from publishing so work from before unload cannot overwrite current state.

## Incremental updates

The incremental controller accepts create, modify, delete, rename, and synthetic metadata-resolved events at its host-independent port. The Obsidian runtime feeds it Vault events plus Metadata Cache change/delete events. Repeated runtime events enter a 100 ms trailing quiet window with a 500 ms maximum wait, are then coalesced before snapshot work begins, and use bounded snapshot concurrency.

Consistency protection includes:

- lifecycle epoch: results from an old lifecycle cannot publish after stop or restart;
- path revision: every affected source has a monotonic revision, so an older asynchronous snapshot cannot overwrite a newer revision;
- bounded quiet-window coalescing: duplicate Vault and Metadata Cache callbacks for one path trigger one build without allowing a continuous stream to postpone updates indefinitely;
- lookup and target reverse indexes: namespace or target-metadata changes revalidate the direct source, sources currently resolved to the target, and sources that may retarget through a lookup key.

Create, delete, and rename events refresh the file registry and compare old and new lookup keys. Deleting a source removes its complete snapshot through the same replacement reducer. Vault modify and Metadata Cache changed callbacks revalidate the source and its referers after the bounded quiet window. The host-wide `resolved` completion signal is used only as an initial readiness boundary and is never translated into an all-source invalidation because Obsidian fires it again after ordinary modifications. Snapshot and contribution-scope replacements perform semantic no-op checks before mutating graph state.

Sidebar result arrays are cached until index, settings, or graph semantics change. Progress/status updates reuse those arrays, the advanced no-incoming projection is skipped while disabled, and only the active tab builds sorted groups or trees. Rendering uses a fixed 200-result page so one view can never materialize the entire Vault as DOM.

## Persistence and recovery

The initial version does not persist `LinkIndex`, edges, or diagnostic projections. `data.json` stores only settings, rules, and interface preferences after schema validation, migration, and normalization. This prevents a stale namespace from a previous run from becoming an authoritative result.

The scan-on-startup setting determines whether a full rebuild begins proactively after the workspace is ready. When it is disabled, the coordinator still captures Vault events immediately but never uses local events to create a partial baseline. Restoring or first opening the sidebar starts a complete rebuild automatically, while General settings and the unscanned empty state provide discoverable Build/Rebuild index actions. After the baseline succeeds, incremental updates keep the index synchronized for the session, so routine changes require no manual refresh. If future performance evidence justifies a cross-restart cache, it must remain a verifiable cache and cannot bypass resolution against the current Vault.

## Current implementation boundaries

Automated tests cover core graph invariants, snapshot replacement, same-name target revalidation, random-event differential equality, last-known-good retention, event replay, lifecycle cancellation, and query semantics. Actual resolution accuracy ultimately depends on the live Obsidian APIs and real file caches.

There is currently no derived-graph persistence, external-URL network checking, automatic deletion, or bulk repair. A formal-Vault smoke records the observed Obsidian 1.13.4 startup, sidebar, and settings behavior, but architecture tests and that smoke do not establish the full Obsidian 1.12.7/current 1.13.x matrix, live-event paths, Android emulator behavior, or physical-device behavior; those boundaries require separate acceptance.
