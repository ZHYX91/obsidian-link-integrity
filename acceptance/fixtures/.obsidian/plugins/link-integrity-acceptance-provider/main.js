const { Plugin, Notice } = require("obsidian");
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
};
module.exports = class extends Plugin {
  onload() {
    for (const [id, name, action] of [
      ["create-body-hint-fixtures", "Create body-hint fixtures in this disposable acceptance Vault", () => this.createFixtures()],
      ["create-context-regression-fixtures", "Create escaped, percent and source-context regression fixtures", () => this.createContextRegressionFixtures()],
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
