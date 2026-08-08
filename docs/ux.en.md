# Link Integrity UX contract

## 1. Interaction goals

Link Integrity is a read-only diagnostic tool. The interface helps a user understand a problem and navigate to its source or target; it does not offer bulk deletion, automatic rewriting, or imply that a file is safe to remove. Counts and labels preserve these distinctions:

- A broken link is an occurrence-level diagnostic; repeated references remain individually navigable.
- An isolated file is a file-level projection of the valid explicit-link graph.
- Expected isolated is a separate user-rule state, not an invented graph connection.
- “Isolated · N broken links” is low confidence and must not appear as a high-confidence cleanup candidate.
- Candidate scope, diagnostic visibility, and graph contribution are independent concepts.

Desktop and mobile use the same product semantics. A narrow layout may rearrange controls, but it must not hide critical state or change the meaning of a count.

## 2. Sidebar information architecture

The sidebar starts with the two business tabs. It does not repeat the plugin title or keep a permanent refresh/settings action row. Plugin settings are entered through Obsidian's plugin settings page. The tabs are:

1. **Broken links**, with the number of currently visible occurrences.
2. **Isolated files**, with the main projection count, excluding expected isolated files by default.

The ready state consumes no permanent status row. Progress appears only while scanning; stale or failed state appears contextually in the current panel with a Retry rebuild action. With no baseline, opening the sidebar starts the first complete build automatically while retaining a discoverable Build index action. A full-rebuild failure must never replace the last-known-good result with an empty list.

Result DOM is bounded to 200 occurrences or files per page. Previous/next controls preserve access to the complete filtered and sorted projection; badges remain full-result counts, the range label identifies the current page, and changing search, sort, grouping, view, mode, expected-isolation visibility, or file-type filters returns to the first page.

Toolbar hierarchy follows interaction frequency: search receives the primary available width, list/tree or grouped/list is the primary view switch, and sorting is a compact select with a visible Sort label. A narrow sidebar may wrap controls and increase touch height, but it does not stretch sorting into a full-row button with the same weight as the view switch. Options state the ordering explicitly, such as by path, file name, or modified time.

### 2.1 Broken links tab

Results are grouped by target by default, with source grouping and an occurrence list as alternatives. Each item shows at least its source, original reference, failure kind, and the best available location hint.

- Missing files, headings, and blocks have distinct labels.
- When a file exists but its subpath is missing, the target file can still be opened while retaining the subpath diagnostic.
- Markdown body references navigate to a line when possible. Frontmatter, Canvas, and Bases honestly fall back to opening the source file or node when the host API cannot provide a stable exact position.
- A row menu can create an ignore rule for the occurrence, target, or source. It shows the scope and match preview before saving, then offers one immediate undo action.

Search, grouping, sorting, and “show ignored” affect only the current projection, never the graph.

### 2.2 Isolated files tab

Users can switch between a list and folder tree and sort by name, path, or modification time. Results distinguish:

- Regular isolated: no valid incoming or outgoing connection to another existing Vault file.
- Low-confidence isolated: still isolated, but containing one or more broken outgoing links.
- Expected isolated: matched by an enabled expected-isolation rule and excluded from the main count and high-confidence projection by default.

“Show expected isolated files” is an advanced viewing option. When enabled, expected items retain a separate badge and cannot be mixed indistinguishably with regular results. Expected-isolation rules never hide their broken links.

“Files with no incoming links” is an advanced projection only and explicitly differs from the default isolation definition.

## 3. File-type filtering

Settings persist the default candidate types; sidebar selection is only a temporary query filter. The first- and second-level hierarchy is:

- Obsidian files: Markdown, Bases, and Canvas.
- Images: JPEG, PNG, TIFF, GIF, WebP, AVIF, BMP, SVG, HEIF/HEIC, and related families.
- Audio: FLAC, M4A/AAC, MP3, OGG, WAV, WebM, 3GP, and related families.
- Video: MKV, MOV, MP4/M4V, OGV, WebM, and related families.
- Fixed-layout files: PDF.
- Other attachments: preset families and custom extensions.

Extension matching is case-insensitive, and aliases are combined into one format family. A first-level category supports select all, clear, restore defaults, and an indeterminate state; the second level is available only when fine control is needed. A format such as WebM that participates in more than one media category retains every category identity so a secondary filter cannot lose it.

After filtering, the count is shown as “visible / configured-scope total” so temporary hiding is not mistaken for a graph recalculation.

## 4. Settings interface

Settings contain three tabs: General, Broken links, and Isolated files. The imperative Obsidian 1.12 UI and the declarative/searchable 1.13+ UI share one set of definitions, value sources, and side effects; they cannot become separate products.

### 4.1 General

- Language: Follow Obsidian or one of 11 bundled languages.
- Default sidebar tab and optional scan on startup. Startup scanning is off by default; before the sidebar is first opened, indexing and listeners remain dormant.
- Link-index status and a manual rebuild action for recovery or complete verification, not routine refresh.

A language change updates plugin UI immediately. Follow Obsidian retains the stable internal value `auto`, while user-visible wording states the host relationship. Settings search, keyboard navigation, and status text use the selected locale. All 11 bundled catalogs cover every stable message key at compile time without being completed by an English spread, and an internal key is never exposed.

### 4.2 Broken links

- Default grouping and sorting.
- Visible diagnostic kinds.
- Broken-link ignore rules and match previews.
- A diagnostic option to show ignored results.

### 4.3 Isolated files

- Default candidate categories and format families.
- Default list/tree view and sorting.
- Isolated-candidate ignore rules.
- Expected-isolation rules and the periodic-notes preset.
- Advanced expected-isolated and no-incoming projections.
- Advanced graph-contribution exclusions, with a pre-save warning that they can create false isolated results.

## 5. Rule editing and previews

Ignore and expected-isolation rules are previewed before saving. A preview contains a match count and bounded samples and is tied to the current draft and index revision; an older asynchronous result must not overwrite a newer edit.

Saved expected-isolation rules default to compact summary cards with enablement, name, scope summary, and an edit entry instead of exposing the complete rule engine inline. The add entry first offers periodic-notes, folder, naming-pattern, and advanced-custom intents; periodic notes moves to the dedicated preset, while the others open a modal draft editor. The editor automatically debounces previews for the draft and commits settings only on Save; Cancel, Escape, or dismissing the backdrop discards the draft. Rule deletion lives inside the editor and is not presented as a peer primary action beside preview controls.

An expected-isolation rule has a name, enabled state, and combined conditions:

- file type or format family;
- exact or recursive folder scope;
- date-format, glob, or advanced regular-expression patterns against a basename or full path.

Different condition groups are combined with AND, while naming patterns inside a group are combined with OR. The periodic-notes preset provides configurable daily, weekly, monthly, quarterly, and yearly patterns: `YYYY-MM-DD`, `GGGG-[W]WW`, `YYYY-MM`, `YYYY-[Q]Q`, and `YYYY`. It creates Link Integrity rules only and never reads Chrono Notes data or code.

An ignore rule states its actual scope: hide broken diagnostics, exclude isolated candidates, ignore a target, ignore an occurrence, or exclude graph contribution. Disabling or deleting a rule recalculates projections from the same authoritative index.

## 6. Saving, errors, and recovery

Settings use a serialized, coalescing save queue. The ordinary saved state does not consume a permanent row; status appears only while a save is scheduled, active, or failed:

- Rapid edits may coalesce, but a write that already started is not silently cancelled.
- A failed save retains pending in-memory settings and exposes Retry.
- A future-schema `data.json` is write-protected so an older plugin cannot overwrite a newer format.
- Undo applies only to the rule just created and never implies that Vault content changed.

Scan errors and settings-save errors are separate states and are presented independently. Error text offers a next step instead of exposing only an internal stack.

## 7. Accessibility and mobile

- Tabs use `tablist`, `tab`, and `tabpanel` semantics with roving tabindex.
- Arrow keys, Home, and End work, and focus remains sensible after switching.
- Tabs may scroll horizontally on narrow screens; RTL keeps ordering and icon meaning correct.
- Coarse-pointer targets are at least 44 CSS pixels.
- State never relies on color alone; badges and text communicate together.
- Result menus, checkboxes, and disclosure controls have readable labels.

A real desktop host, Android emulator, and physical device are distinct acceptance boundaries. Automated DOM tests cannot substitute for any real-host conclusion.
