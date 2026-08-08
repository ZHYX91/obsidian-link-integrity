# Link Integrity Product Semantics

This document defines the current product behavior of Link Integrity. It describes diagnostic semantics that users can rely on, not a progress checklist or a future roadmap.

## Product position

Link Integrity is a fully local, read-only Obsidian Vault diagnostic plugin. It provides two business views: Broken links and Isolated files. The plugin helps users find relationships that need review, but it does not delete files, bulk-rewrite links, check external URLs, or present a diagnostic result as permission to clean up automatically.

## Valid Vault connections

A valid connection is an explicit internal reference whose source points to another currently existing Vault file and whose file-level target resolves successfully.

- A self-link does not connect two files, so it does not contribute valid in-degree or out-degree.
- An external URL is not a Vault connection.
- When the target file exists but a heading or block is missing, the file-level connection remains valid while a heading or block diagnostic is reported.
- Repeated references between the same pair of files remain separate diagnostic occurrences; the graph also preserves edge contribution counts by reference kind.

The currently supported explicit connection sources are:

- internal links and embeds in Markdown bodies;
- internal links recognized by Obsidian in Frontmatter;
- explicit Canvas file nodes, background files, and resolvable internal links in text nodes;
- explicit file references in Bases files.

Results produced by dynamic Bases queries are not explicit references and do not create graph edges by default. Date adjacency between periodic notes does not create synthetic edges either.

## Broken links

Broken-link results are reported per occurrence instead of only per target. Confirmed reasons currently include a missing target file, an invalid internal link, a missing heading, and a missing block. A link waiting for host metadata is not a confirmed error, and an unsupported subpath is not presented as a confirmed error.

Opening a result should open its source and, where the source type permits, navigate to a line, property, or Canvas node. When exact navigation is unavailable, the interface must honestly fall back to opening the source file or node.

Ordinary result-hiding rules change diagnostic visibility only. They do not change valid file connections or erase the risk signal attached to an isolated result.

## Isolated files

A file is isolated by default only when both conditions are true in the valid graph:

- it has no valid incoming connection from another existing Vault file;
- it has no valid outgoing connection to another existing Vault file.

A file with only broken outgoing references still meets this definition because those references do not connect to existing files. Such a result must carry a low-confidence state such as “Isolated · N broken links” and must not be treated as a high-confidence cleanup candidate.

“No incoming links” is a separate advanced query. It can include files that still have valid outgoing connections, so it cannot replace the default isolation definition and must not be interpreted automatically as meaning that a file is useless.

## Expected isolation

Some files may be isolated by workflow design, including periodic notes, templates, or exports. Expected-isolation rules classify only files that already meet the isolation definition:

- they are excluded from the main isolated list, main count, and high-confidence cleanup candidates by default;
- users may reveal them through an advanced option and inspect the matching rules;
- they do not create date-adjacency or other inferred connections;
- they do not affect broken-link diagnostics or remove real graph contributions.

A rule may combine file type, folder, and naming conditions. Different conditions use AND; multiple date-format, glob, or regular-expression naming patterns within one rule use OR. Rules have names and can report a match count with a bounded sample. The built-in periodic-note presets run independently of Chrono Notes or any other plugin, cover daily, weekly, monthly, quarterly, and yearly formats, and allow path and naming formats to be configured.

A user may also choose “Mark as expected isolated” from one isolated-file row. This action stores only a normalized exact Vault path, creates no ignore rule, changes no file, and offers immediate undo. A folder menu in the isolated folder tree offers direct-folder or recursive scope; that action creates a folder rule without extra file-type or naming conditions and also offers immediate undo. Rename events update stored exact-file paths. Deleted or temporarily missing paths remain visibly marked as missing in settings until the user removes them. Exact paths and rule matches share the same expected-isolated classification but are managed separately in settings.

## Scopes and file types

Link Integrity keeps three scopes strictly separate:

- candidate scope: which files may appear in Isolated files results;
- diagnostic scope: which broken-link results are visible in the interface;
- contribution scope: which valid references participate in graph calculations.

Unselected candidate types and ordinary hide rules continue to contribute valid connections. Only the separate advanced “exclude graph contribution” rule changes the graph, and the interface must warn that it can create false isolated results.

Isolated candidates use a central file-type registry: Obsidian files (Markdown, Bases, and Canvas), images, audio, video, fixed-layout files (PDF), and other attachments. Images, media, and attachments are subdivided into format families, with common extension aliases grouped together. Matching is case-insensitive. An unknown attachment extension enters candidate scope only when that extension is explicitly configured as custom; selecting the custom family with an empty extension list does not silently include every unknown file. Settings store the default candidate scope; sidebar filters are temporary query conditions.

## Data and safety boundaries

All scanning, indexing, and rule matching runs locally. The initial version persists settings, ignore rules, and interface preferences only; it does not persist the derived link graph. A current authoritative index is rebuilt from the Vault after restart.

The plugin is diagnostic and non-destructive. Automatic deletion, bulk repair, network checks of external URLs, and inference of explicit connections from dynamic query results are not current behaviors.

## Current delivery status

The core semantics, query projections, full and incremental index controllers, and automated tests are implemented in the repository. The first version remains in local implementation and acceptance and has not been released. A production-Vault smoke has verified the observed desktop workflow in Obsidian 1.13.4; Obsidian 1.12.7, Android emulator, physical-device, and broader live-event acceptance remain separate evidence boundaries. Type checking, unit tests, synthetic benchmarks, and one desktop smoke cannot substitute for those missing claims.
