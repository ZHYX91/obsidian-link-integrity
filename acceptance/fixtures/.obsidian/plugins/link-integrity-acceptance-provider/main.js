const { Plugin, Notice } = require("obsidian");

module.exports = class extends Plugin {
  onload() {
    this.addCommand({
      id: "create-potential-mention-fixtures",
      name: "Create potential mention fixtures in this disposable acceptance Vault",
      callback: () => this.createFixtures().catch((error) => new Notice(String(error))),
    });
  }

  async createFixtures() {
    const vault = this.app.vault;
    if (vault.getFileByPath("Standalone.md") === null || vault.getFileByPath("Broken-only.md") === null) {
      throw new Error("The product's disposable acceptance fixture is required.");
    }
    const prefix = "Mentions Acceptance";
    const files = {
      "Places/白云山.md": "# 白云山\n",
      "Travel/广州.md": "---\naliases:\n  - 白云山\n  - Cloud Mountain\n---\n# 广州\n",
      "山.md": "# 山\n",
      "Streets/山南路.md": "# 山南路\n",
      "AI.md": "# AI\n",
      "Source.md": "---\naliases: [白云山]\n---\n# Mention source\n\n白云山。白云山南路。🌤️ 白云山。ai AI MAIN。\n\nSecond paragraph: Cloud Mountain and 白云山。\n\n`白云山` [[Mentions Acceptance/Source|白云山]]\n%% 白云山 %% <!-- 白云山 -->\n$白云山$ https://example.test/白云山 #白云山\n\n| Place |\n| --- |\n| 白云山 |\n\ntext <span\n title=\"白云山\">end</span> 白云山\n\n- ```\n  白云山\n",
      "CRLF Source.md": "# CRLF source\r\n\r\n🌤️ 白云山南路\r\n\r\n白云山\r\n",
    };
    for (const path of Object.keys(files)) {
      if (vault.getAbstractFileByPath(`${prefix}/${path}`) !== null) throw new Error("Mention fixtures already exist; use a fresh disposable Vault.");
    }
    for (const folder of [prefix, `${prefix}/Places`, `${prefix}/Travel`, `${prefix}/Streets`]) {
      if (vault.getAbstractFileByPath(folder) === null) await vault.createFolder(folder);
    }
    for (const [path, source] of Object.entries(files)) await vault.create(`${prefix}/${path}`, source);
    new Notice("Potential mention fixtures created. Base fixture counts apply only before this explicit setup.");
    await this.app.workspace.getLeaf(false).openFile(vault.getFileByPath(`${prefix}/Source.md`));
  }
};
