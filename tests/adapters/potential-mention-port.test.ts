import { describe, expect, it, vi } from "vitest";
import type { MetadataCache, Vault } from "obsidian";

import { ObsidianPotentialMentionPort } from "../../src/adapters/obsidian/potential-mention-port";
import { extractMarkdownMentionExclusions } from "../../src/adapters/obsidian/mention-body";
import { createFileRecord } from "../../src/core/model";
import { PotentialMentionMatcher } from "../../src/core/potential-mention-matcher";
import { WorkScheduler } from "../../src/scheduling/work-scheduler";

describe("potential mention host port", () => {
  it("collects titles and aliases only from the authoritative registry without reading bodies or enumerating Vault files", async () => {
    const file = { path: "Places/广州.md", extension: "md" };
    const vault = { getFileByPath: vi.fn((path) => path === file.path ? file : null), cachedRead: vi.fn(), getFiles: vi.fn() };
    const metadata = { getFileCache: vi.fn(() => ({ frontmatter: { aliases: ["白云山", "白 云", "\n", 5] } })) };
    const port = new ObsidianPotentialMentionPort(vault as unknown as Vault, metadata as unknown as MetadataCache);
    expect(await port.collectNames([createFileRecord(file.path), createFileRecord("Image.png")], new WorkScheduler())).toEqual([
      { text: "广州", targetPath: file.path, kind: "title" },
      { text: "白云山", targetPath: file.path, kind: "alias" },
      { text: "白 云", targetPath: file.path, kind: "alias" },
    ]);
    expect(vault.cachedRead).not.toHaveBeenCalled();
    expect(vault.getFiles).not.toHaveBeenCalled();
  });

  it("uses unsaved editor content before cached text and refuses missing/non-Markdown sources", async () => {
    const vault = { getFileByPath: vi.fn((path) => path === "Missing.md" ? null : ({ path, extension: path.split(".").at(-1) })),
      cachedRead: vi.fn(async () => "Disk") };
    const port = new ObsidianPotentialMentionPort(vault as unknown as Vault, {} as MetadataCache,
      (path) => path === "Open.md" ? "Unsaved" : null);
    expect(await port.readSource("Open.md")).toBe("Unsaved");
    expect(await port.readSource("Closed.md")).toBe("Disk");
    expect(await port.readSource("Missing.md")).toBeNull();
    expect(await port.readSource("Image.png")).toBeNull();
    expect(vault.cachedRead).toHaveBeenCalledTimes(1);
  });

  it("excludes all frontmatter, links, code and comments without shifting UTF-16 body offsets", async () => {
    const source = "---\r\naliases: [白云山]\r\nrelated: '[[白云山]]'\r\n---\r\n🌤️白云山\r\n" +
      "[[白云山|白云山]] ![[白云山]] [白云山](白云山) [白云山][place]\n[place]: 白云山\n" +
      "`白云山`\n\n    白云山\n\n```\n白云山\n```\n%%白云山%% <!--白云山--> <a title='白云山'>\n白云山";
    const excludedRanges = await extractMarkdownMentionExclusions(source);
    const matches = new PotentialMentionMatcher([{ text: "白云山", targetPath: "白云山.md", kind: "title" }]).match(source, { excludedRanges });
    expect(matches.map(({ from, to }) => [from, to])).toEqual([
      [source.indexOf("🌤️") + 3, source.indexOf("🌤️") + 6],
      [source.lastIndexOf("白云山"), source.length],
    ]);
    for (const match of matches) expect(source.slice(match.from, match.to)).toBe("白云山");
    const unclosed = "---\naliases: 白云山";
    expect(new PotentialMentionMatcher([{ text: "白云山", targetPath: "Target.md", kind: "alias" }])
      .match(unclosed, { excludedRanges: await extractMarkdownMentionExclusions(unclosed) })).toEqual([]);
  });
});
