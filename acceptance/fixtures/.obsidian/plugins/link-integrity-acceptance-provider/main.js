const { Plugin, Notice, MarkdownView, parseLinktext, apiVersion, Platform } = require("obsidian");
const RESOLUTION_ROOT = "Resolution Semantics Acceptance";
const RESOLUTION_DIRECTORY = `${RESOLUTION_ROOT}/Destinations`;
const RESOLUTION_SOURCE = `${RESOLUTION_DIRECTORY}/Source.md`;
const RESOLUTION_TEXT = "😀\n[amp](A&amp;B.md)\n[bang](foo\\!.md)\n[once](A&amp;amp;B.md)\n[escaped](Escaped\\&amp;B.md)\n[[Wiki&amp;Name]]\n[percent](Percent%26Name.md)\n[remote](https&#58;//example.com)\n[missing](Missing&amp;Value.md)\n";
const RESOLUTION_TARGETS = ["A&B.md", "foo!.md", "A&amp;B.md", "Escaped&amp;B.md", "Wiki&amp;Name.md", "Percent%26Name.md"];
const RESOLUTION_TARGET_TEXT = "# Fixed destination target\n";
const RESOLUTION_SOURCE_SHA256 = "7df50189ba86fcc75e7914150ce6d3bfa45f8b0e085db36c4b9e57f3e6e28cff";
const RESOLUTION_TARGET_SHA256 = "b6e88fd2998b87e61fa432df51b285da5bf1deedab70fbd272b9ca4c8c54463e";
const OBSERVATION_KIND = "link-integrity/native-resolution-observations-v1";
const OBSERVATION_LIMIT = 4;
const OBSERVATION_BYTE_LIMIT = 96000;

function boundedField(value) {
  if (typeof value === "string") return value.length <= 512 ? value : { prefix: value.slice(0, 512), utf16Length: value.length, truncated: true };
  return value === null || typeof value === "number" || typeof value === "boolean" ? value : { type: typeof value };
}
function nativeCacheSnapshot(cache) {
  const links = cache?.links;
  const point = (value) => Object.fromEntries(["line", "col", "offset"].map((key) => [key, boundedField(value?.[key])]));
  return { present: cache !== null, linksType: Array.isArray(links) ? "array" : typeof links,
    count: Array.isArray(links) ? links.length : null, omittedCount: Array.isArray(links) ? Math.max(0, links.length - 8) : 0,
    entries: Array.isArray(links) ? links.slice(0, 8).map((entry) => ({ link: boundedField(entry?.link), original: boundedField(entry?.original),
      position: { start: point(entry?.position?.start), end: point(entry?.position?.end) } })) : [] };
}
function sourceOffset(point, text) {
  if (!Number.isInteger(point.line) || !Number.isInteger(point.col) || point.line < 0 || point.col < 0) return null;
  const lines = text.split("\n");
  if (point.line >= lines.length || point.col > lines[point.line].length) return null;
  return lines.slice(0, point.line).reduce((sum, line) => sum + line.length + 1, 0) + point.col;
}
function statSnapshot(file) {
  return file === null ? null : { ctime: file.stat.ctime, mtime: file.stat.mtime, size: file.stat.size };
}
function sameValue(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function jsonByteLength(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
const PREFIX = "Body Hints Acceptance";
const TARGET = "---\naliases: [BodyHintTarget]\n---\n# Existing heading\n\nKnown block ^known-block\n";
const REPAIRED_TARGET = TARGET + "\n# Missing heading\n\nRepaired block ^missing-block\n";
const MISSING = "# Created missing file\n";
const SOURCE = "# Body link hints\n\n[[Body Hints Acceptance/Missing|Missing file]]\n\n[[Body Hints Acceptance/Target#Missing heading|Missing heading]]\n\n[[Body Hints Acceptance/Target#^missing-block|Missing block]]\n\n[[Body Hints Acceptance/Target#Existing heading|Same label]] and [[Body Hints Acceptance/Missing|Same label]].\n\nBody Hints Acceptance/Target#^missing-block and [[Body Hints Acceptance/Target#^missing-block|Same label]].\n\n[[Body Hints Acceptance/Target#^known-block|Valid block]]\n\n[Native reference][existing]\n\n[existing]: <Body Hints Acceptance/Target#Existing heading>\n\n![[Body Hints Acceptance/Target]]\n\n`[[Protected ghost]]`\n%% [[Protected ghost]] %%\n";
const VIRTUAL = "# Virtual text only\n\nBodyHintTarget\n\nBody Hints Acceptance/Target#^missing-block\n";
const BLOCK_PREFIX = "Block Context Acceptance";
const BLOCK_PAIR = "[[C5 Target]] [[C5 Missing]]";
const BLOCK_CASES = {
  "quote-code": `>     ${BLOCK_PAIR}\n`,
  "list-prose": `- item\n\n    ${BLOCK_PAIR}\n`,
  "definition-continuation": `[id]: /url\n    ${BLOCK_PAIR}\n`,
  "definition-non1-code": `[id]: /url\n2. item\n\n    ${BLOCK_PAIR}\n`,
  "definition-title": `[id]: /url "${BLOCK_PAIR}"\n`,
};
const INLINE_PREFIX = "Inline Metadata Acceptance";
const INLINE_CASES = {
  "quoted": "[label](Target \"[[Ghost]] [[Missing]]\")\n![label](Target '[[Ghost]] [[Missing]]')\n",
  "parenthesized": "[label](Target (title))\n![label](Target (title \\(nested\\) [[Ghost]] [[Missing]]))\n",
  "label-wiki": "[label [[Ghost]] [[Missing]]](Target \"[[Ghost]] [[Missing]]\")\n",
  "invalid-outer": "[label](Target \"[[Ghost]] [[Missing]]\" extra)\n",
  "atx-boundary": "# [label](Target \"title\n[[Missing]]\")\n",
  "nested-image": "![outer [inner](Target)](Ghost \"[[Missing]]\")\n",
  "reference-inner": "[outer [r]](Ghost \"[[Missing]]\")\n\n[r]: Target\n",
  "quote-continuation": "> [label](Target\n> \"[[Ghost]] [[Missing]]\")\n",
  "hint-metadata": "[label](Missing \"<!--\") [[Missing]]\n",
};
module.exports = class extends Plugin {
  onload() {
    for (const [id, name, action] of [
      ["create-body-hint-fixtures", "Create body-hint fixtures in this disposable acceptance Vault", () => this.createFixtures()],
      ["create-context-regression-fixtures", "Create escaped, percent and source-context regression fixtures", () => this.createContextRegressionFixtures()],
      ["create-resolution-regression-fixtures", "Create suffix and Markdown destination regression fixtures", () => this.createResolutionRegressionFixtures()],
      ["record-native-resolution-observation", "Record native resolution facts (provider receipt only)", () => this.recordNativeResolutionObservation()],
      ["repair-body-hint-fixtures", "Repair body-hint fixtures in this disposable acceptance Vault", () => this.repair()],
      ["restore-body-hint-fixtures", "Restore broken body-hint fixtures in this disposable acceptance Vault", () => this.restore()],
    ]) this.addCommand({ id, name, callback: () => action().catch((error) => new Notice(String(error))) });
    for (const [group, label, cases, prepare] of [
      ["block", "block-context", BLOCK_CASES, (mode) => this.prepareBlockContextFixtures(mode)],
      ["inline", "inline-metadata", INLINE_CASES, (mode) => this.prepareInlineMetadataFixtures(mode)],
    ]) for (const mode of Object.keys(cases)) this.addCommand({
      id: `prepare-${group}-${mode}`, name: `Prepare ${label} ${mode} in this disposable acceptance Vault`,
      callback: () => prepare(mode).catch((error) => new Notice(String(error))),
    });
  }
  guard() {
    if (this.app.vault.getFileByPath("Standalone.md") === null || this.app.vault.getFileByPath("Broken-only.md") === null) {
      throw new Error("The product's disposable acceptance fixture is required.");
    }
  }
  async readResolutionFile(file, expectedPath, text, sha256) {
    if (file === null) return { exists: false, expectedPath };
    const expected = new TextEncoder().encode(text);
    const facts = { exists: true, expectedPath, path: file.path, stat: statSnapshot(file), matchesKnownBytes: false, sha256: null };
    if (file.path !== expectedPath || this.app.vault.getFileByPath(expectedPath) !== file) {
      return { ...facts, readSkipped: "file-path-or-identity-changed" };
    }
    if (!Number.isInteger(file.stat.size) || file.stat.size < 0 || file.stat.size > expected.length) {
      return { ...facts, readSkipped: "outside-known-byte-limit" };
    }
    // Use the fixed public adapter path, never a mutable TFile's later path.
    const bytes = new Uint8Array(await this.app.vault.adapter.readBinary(expectedPath));
    if (file.path !== expectedPath || this.app.vault.getFileByPath(expectedPath) !== file) {
      return { ...facts, pathAfterRead: file.path, readDiscarded: "file-path-or-identity-changed" };
    }
    facts.byteLength = bytes.length;
    facts.bytesHex = Array.from(bytes.slice(0, expected.length), (byte) => byte.toString(16).padStart(2, "0")).join("");
    facts.omittedBytes = Math.max(0, bytes.length - expected.length);
    facts.matchesKnownBytes = bytes.length === expected.length && bytes.every((byte, index) => byte === expected[index]);
    // This is an exact known-byte proof, not a claim that the host computed a hash.
    facts.hashBasis = "exact-known-fixture-bytes";
    if (facts.matchesKnownBytes) facts.sha256 = sha256;
    if (bytes.length <= expected.length) {
      try { facts.text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch (error) { facts.decodeError = boundedField(String(error)); }
    }
    return facts;
  }
  resolutionProbe(link) {
    try {
      const parsed = parseLinktext(link);
      const resolverInput = parsed.path.trim();
      const target = this.app.metadataCache.getFirstLinkpathDest(resolverInput, RESOLUTION_SOURCE);
      return { input: link, parsed, resolverInput, targetPath: target?.path ?? null,
        outsideFixedTargets: target !== null && !RESOLUTION_TARGETS.some((name) => target.path === `${RESOLUTION_DIRECTORY}/${name}`) };
    } catch (error) { return { input: link, error: boundedField(String(error)) }; }
  }
  resolutionEditors(source, savedText) {
    const bindings = this.app.workspace.getLeavesOfType("markdown").flatMap((leaf) => {
      if (!(leaf.view instanceof MarkdownView) || leaf.view.file?.path !== RESOLUTION_SOURCE) return [];
      return [{ leaf, view: leaf.view, editor: leaf.view.editor, file: leaf.view.file }];
    });
    return { bindings, facts: bindings.map(({ editor, file }) => {
      const value = editor.getValue();
      return { fileIdentity: file === source, matchesSavedText: value === savedText, text: boundedField(value) };
    }) };
  }
  async recordNativeResolutionObservation() {
    if (this.nativeObservationRunning) throw new Error("A native observation is already running.");
    this.nativeObservationRunning = true;
    try {
      this.guard();
      const previous = await this.loadData();
      if (previous !== null && previous !== undefined && (previous.schemaVersion !== 1 || previous.kind !== OBSERVATION_KIND ||
        Object.keys(previous).some((key) => !["schemaVersion", "kind", "observations"].includes(key)) ||
        !Array.isArray(previous.observations) || previous.observations.some((item) => item?.kind !== "native-resolution-observation-v1"))) {
        throw new Error("Unknown provider data schema; observations were not overwritten.");
      }
      const observations = previous?.observations ?? [];
      if (observations.length >= OBSERVATION_LIMIT || jsonByteLength(previous ?? {}) > OBSERVATION_BYTE_LIMIT) {
        throw new Error("Provider observation capacity reached; preserve the receipt and use a fresh disposable Vault.");
      }
      const observation = { kind: "native-resolution-observation-v1", observedAt: new Date().toISOString(),
        apiVersion, platform: { isDesktopApp: Platform.isDesktopApp, isAndroidApp: Platform.isAndroidApp },
        sourcePath: RESOLUTION_SOURCE, status: "incomplete", issues: [] };
      try {
        const vault = this.app.vault;
        const source = vault.getFileByPath(RESOLUTION_SOURCE);
        const targets = RESOLUTION_TARGETS.map((name) => vault.getFileByPath(`${RESOLUTION_DIRECTORY}/${name}`));
        const cache = source === null ? null : this.app.metadataCache.getFileCache(source);
        observation.nativeBefore = nativeCacheSnapshot(cache);
        const editorsBefore = this.resolutionEditors(source, RESOLUTION_TEXT);
        observation.editorsBefore = editorsBefore.facts;
        observation.sourceBefore = await this.readResolutionFile(source, RESOLUTION_SOURCE, RESOLUTION_TEXT, RESOLUTION_SOURCE_SHA256);
        const sourceText = observation.sourceBefore.text ?? "";
        const tokens = RESOLUTION_TEXT.split("\n").slice(1, -1);
        observation.native = observation.nativeBefore.entries.map((entry) => {
          const start = sourceOffset(entry.position.start, sourceText);
          const end = sourceOffset(entry.position.end, sourceText);
          const slice = start !== null && end !== null && end > start ? sourceText.slice(start, end) : null;
          const offsetsAgree = start !== null && end !== null && entry.position.start.offset === start && entry.position.end.offset === end;
          return { ...entry, sourceRange: { start, end }, sourceSlice: slice, rawMatches: slice !== null && slice === entry.original,
            offsetsAgree, probe: typeof entry.link === "string" ? this.resolutionProbe(entry.link) : null };
        });
        observation.coverage = tokens.map((raw) => ({ raw, nativeIndexes: observation.native.flatMap((entry, index) =>
          entry.original === raw && entry.rawMatches && entry.offsetsAgree ? [index] : []) }));
        observation.fixedTargetProbes = RESOLUTION_TARGETS.map((name) => this.resolutionProbe(name));
        observation.targetsBefore = await Promise.all(targets.map((file, index) => this.readResolutionFile(file, `${RESOLUTION_DIRECTORY}/${RESOLUTION_TARGETS[index]}`, RESOLUTION_TARGET_TEXT, RESOLUTION_TARGET_SHA256)));
        observation.sourceAfter = await this.readResolutionFile(source, RESOLUTION_SOURCE, RESOLUTION_TEXT, RESOLUTION_SOURCE_SHA256);
        observation.targetsAfter = await Promise.all(targets.map((file, index) => this.readResolutionFile(file, `${RESOLUTION_DIRECTORY}/${RESOLUTION_TARGETS[index]}`, RESOLUTION_TARGET_TEXT, RESOLUTION_TARGET_SHA256)));
        const editorsAfter = this.resolutionEditors(source, observation.sourceAfter.text ?? "");
        observation.editorsAfter = editorsAfter.facts;
        observation.probesAfter = observation.native.map((entry) => typeof entry.link === "string" ? this.resolutionProbe(entry.link) : null);
        observation.fixedTargetProbesAfter = RESOLUTION_TARGETS.map((name) => this.resolutionProbe(name));
        const cacheAfter = source === null ? null : this.app.metadataCache.getFileCache(source);
        observation.nativeAfter = nativeCacheSnapshot(cacheAfter);
        observation.stability = {
          sourceIdentity: source !== null && source.path === RESOLUTION_SOURCE && vault.getFileByPath(RESOLUTION_SOURCE) === source,
          targetIdentities: targets.every((file, index) => file !== null && file.path === `${RESOLUTION_DIRECTORY}/${RESOLUTION_TARGETS[index]}` && vault.getFileByPath(file.path) === file),
          sourceBytesAndStat: sameValue(observation.sourceBefore, observation.sourceAfter) && sameValue(statSnapshot(source), observation.sourceAfter.stat),
          targetBytesAndStats: sameValue(observation.targetsBefore, observation.targetsAfter) && targets.every((file, index) => sameValue(statSnapshot(file), observation.targetsAfter[index].stat)),
          cacheIdentity: cache === cacheAfter, cacheFields: sameValue(observation.nativeBefore, observation.nativeAfter),
          editors: sameValue(observation.editorsBefore, observation.editorsAfter) && editorsBefore.bindings.length === editorsAfter.bindings.length &&
            editorsBefore.bindings.every((binding, index) => ["leaf", "view", "editor", "file"].every((key) => binding[key] === editorsAfter.bindings[index][key])),
          resolverResults: sameValue(observation.native.map((entry) => entry.probe), observation.probesAfter) && sameValue(observation.fixedTargetProbes, observation.fixedTargetProbesAfter),
        };
        if (!observation.sourceBefore.matchesKnownBytes || !observation.sourceAfter.matchesKnownBytes) observation.issues.push("source-bytes-not-the-known-205-byte-fixture");
        if ([...observation.targetsBefore, ...observation.targetsAfter].some((file) => !file.matchesKnownBytes)) observation.issues.push("fixed-target-missing-or-not-the-known-27-byte-fixture");
        if ([...observation.editorsBefore, ...observation.editorsAfter].some((editor) => !editor.matchesSavedText)) observation.issues.push("source-editor-differs-from-saved-bytes");
        if ([...observation.editorsBefore, ...observation.editorsAfter].some((editor) => !editor.fileIdentity)) observation.issues.push("source-editor-has-a-different-same-path-file-identity");
        if (!observation.nativeBefore.present || observation.nativeBefore.linksType !== "array") observation.issues.push("native-link-tuples-unavailable");
        if (observation.nativeBefore.omittedCount > 0) observation.issues.push("native-link-tuple-limit-exceeded-facts-explicitly-bounded");
        if (observation.native.some((entry) => !entry.rawMatches || !entry.offsetsAgree || typeof entry.link !== "string" || !tokens.includes(entry.original))) observation.issues.push("invalid-or-stale-native-tuple");
        if (observation.coverage.some((item) => item.nativeIndexes.length !== 1)) observation.issues.push("native-token-coverage-missing-or-duplicate-reason-not-inferred");
        if ([...observation.native.map((entry) => entry.probe), ...observation.fixedTargetProbes].some((probe) => probe?.error || probe?.outsideFixedTargets)) observation.issues.push("resolver-error-or-target-outside-fixed-observation-scope");
        if (Object.values(observation.stability).some((stable) => !stable)) observation.issues.push("source-cache-editor-or-resolution-changed-during-observation");
        if (observation.issues.length === 0) observation.status = "complete";
      } catch (error) {
        observation.issues.push("capture-failed");
        observation.error = boundedField(String(error));
      }
      const data = { schemaVersion: 1, kind: OBSERVATION_KIND, observations: [...observations, observation] };
      if (jsonByteLength(data) > OBSERVATION_BYTE_LIMIT) throw new Error("Provider observation byte capacity reached; existing data was preserved.");
      await this.saveData(data);
      new Notice(`Native facts saved (${observation.status}); no product verdict is assigned.`);
    } finally { this.nativeObservationRunning = false; }
  }
  async assertFile(name, text) {
    const file = this.app.vault.getFileByPath(`${PREFIX}/${name}`);
    if (file === null || await this.app.vault.cachedRead(file) !== text) throw new Error(`Unexpected fixture bytes: ${name}`);
    return file;
  }
  async createFixtures() {
    this.guard(); const vault = this.app.vault;
    if (vault.getAbstractFileByPath(PREFIX) !== null) throw new Error("Body fixtures already exist; use a fresh disposable Vault.");
    await vault.createFolder(PREFIX);
    for (const [name, text] of [["Target.md", TARGET], ["Source.md", SOURCE], ["Virtual-only.md", VIRTUAL]]) await vault.create(`${PREFIX}/${name}`, text);
    new Notice("Body fixtures created. Expect ten broken and five isolated files after indexing.");
    await this.app.workspace.getLeaf(false).openFile(vault.getFileByPath(`${PREFIX}/Source.md`));
  }
  async verifyCommon() { this.guard(); await this.assertFile("Source.md", SOURCE); await this.assertFile("Virtual-only.md", VIRTUAL); }
  async prepareBlockContextFixtures(mode) {
    return this.prepareKnownSource(mode, { prefix: BLOCK_PREFIX, label: "block-context", cases: BLOCK_CASES,
      sourceName: "C5 Source.md", fixed: { "C5 Target.md": "# Block context target\n" }, absent: ["C5 Missing.md"] });
  }
  async prepareInlineMetadataFixtures(mode) {
    return this.prepareKnownSource(mode, { prefix: INLINE_PREFIX, label: "inline-metadata", cases: INLINE_CASES,
      sourceName: "Source.md", fixed: { "Target.md": "# Inline metadata target\n", "Ghost.md": "# Inline metadata ghost\n" },
      absent: ["Missing.md"] });
  }
  async prepareKnownSource(mode, { prefix, label, cases, sourceName, fixed, absent }) {
    this.guard();
    if (!Object.hasOwn(cases, mode)) throw new Error(`Unknown ${label} fixture mode.`);
    const vault = this.app.vault;
    const sourcePath = `${prefix}/${sourceName}`;
    const paths = [sourcePath, ...Object.keys(fixed).map((name) => `${prefix}/${name}`)];
    const folder = vault.getAbstractFileByPath(prefix);
    const unexpected = () => { throw new Error(`Unexpected ${label} fixture bytes; use a fresh disposable Vault.`); };
    if (absent.some((name) => vault.getAbstractFileByPath(`${prefix}/${name}`) !== null)) unexpected();
    if (folder === null) {
      if (paths.some((path) => vault.getAbstractFileByPath(path) !== null)) unexpected();
      await vault.createFolder(prefix);
      for (const [name, text] of Object.entries(fixed)) await vault.create(`${prefix}/${name}`, text);
      await vault.create(sourcePath, cases[mode]);
    } else {
      const source = vault.getFileByPath(sourcePath);
      if (!Array.isArray(folder.children) || folder.children.length !== paths.length ||
        folder.children.some((child) => !paths.includes(child.path)) || source === null) unexpected();
      const targets = Object.keys(fixed).map((name) => vault.getFileByPath(`${prefix}/${name}`));
      if (targets.some((file) => file === null)) unexpected();
      const [currentSource, ...targetTexts] = await Promise.all([source, ...targets].map((file) => vault.cachedRead(file)));
      if (!Object.values(cases).includes(currentSource) ||
        Object.values(fixed).some((text, index) => targetTexts[index] !== text)) unexpected();
      await vault.modify(source, cases[mode]);
    }
    new Notice(`${label} ${mode} input prepared; observe diagnostics and isolation separately.`);
    await this.app.workspace.getLeaf(false).openFile(vault.getFileByPath(sourcePath));
  }
  async createContextRegressionFixtures() {
    this.guard();
    const vault = this.app.vault;
    const root = "Context Regression Acceptance";
    if (vault.getAbstractFileByPath(root) !== null) throw new Error("Context fixtures already exist; use a fresh disposable Vault.");
    for (const folder of [root, `${root}/A`, `${root}/B`]) await vault.createFolder(folder);
    const backtick = "`";
    const escaped = `\\${backtick} [Escaped missing](Escaped%20Missing.md) \\${backtick}\n\n${backtick}[[Protected code]]${backtick}\n\n\\${backtick.repeat(3)} [[Protected shorter code]] ${backtick.repeat(2)} [[Visible missing]]\n`;
    const percent = "[[100% Missing|Percent missing]]\n\n[[Missing%ZZ|Literal percent missing]]\n\n[Encoded missing](Encoded%25%20Missing.md)\n\n[[Context Regression Acceptance/Target%#100%|Percent heading]]\n\n[[Context Regression Acceptance/Target%|Percent valid]]\n";
    const sameText = "[Sibling](./Sibling.md)\n";
    for (const [name, text] of [
      ["Escaped.md", escaped],
      ["Percent.md", percent],
      ["Target%.md", "# Existing heading\n"],
      ["A/Source.md", sameText],
      ["B/Source.md", sameText],
      ["A/Sibling.md", "# Existing sibling\n"],
    ]) await vault.create(`${root}/${name}`, text);
    new Notice("Context fixtures created. Observe native links and Link Integrity results separately.");
    await this.app.workspace.getLeaf(false).openFile(vault.getFileByPath(`${root}/Escaped.md`));
  }
  async createResolutionRegressionFixtures() {
    this.guard();
    const vault = this.app.vault;
    const root = RESOLUTION_ROOT;
    if (vault.getAbstractFileByPath(root) !== null) throw new Error("Resolution fixtures already exist; use a fresh disposable Vault.");
    const folders = [root, `${root}/Parent`, `${root}/Parent/Subdir`, `${root}/Archive`, `${root}/Archive/Subdir`, `${root}/Destinations`];
    const text = RESOLUTION_TEXT;
    for (const folder of folders) await vault.createFolder(folder);
    for (const name of RESOLUTION_TARGETS) {
      await vault.create(`${root}/Destinations/${name}`, RESOLUTION_TARGET_TEXT);
    }
    await vault.create(`${root}/Destinations/Source.md`, text);
    await vault.create(`${root}/Destinations/Board.canvas`, JSON.stringify({ nodes: [{ id: "destinations", type: "text", text }] }, null, 2) + "\n");
    await vault.create(`${root}/Parent/Source.md`, "[[Subdir/Suffix Target]]\n");
    new Notice("Resolution inputs prepared. Observe native targets, diagnostics, incremental events and rebuild results separately.");
    await this.app.workspace.getLeaf(false).openFile(vault.getFileByPath(`${root}/Destinations/Source.md`));
  }
  async repair() {
    await this.verifyCommon(); const vault = this.app.vault; const target = await this.assertFile("Target.md", TARGET);
    if (vault.getAbstractFileByPath(`${PREFIX}/Missing.md`) !== null) throw new Error("Missing fixture already exists.");
    await vault.create(`${PREFIX}/Missing.md`, MISSING); await vault.modify(target, REPAIRED_TARGET);
    new Notice("Body fixtures repaired. Expect five broken and five isolated files after indexing.");
  }
  async restore() {
    await this.verifyCommon(); const target = await this.assertFile("Target.md", REPAIRED_TARGET); const missing = await this.assertFile("Missing.md", MISSING);
    await this.app.vault.modify(target, TARGET); await this.app.vault.delete(missing);
    new Notice("Broken body fixtures restored. Expect ten broken and five isolated files after indexing.");
  }
};
