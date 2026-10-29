import type { CachedMetadata, MetadataCache, Vault } from "obsidian";
import { describe, expect, it } from "vitest";
import { ObsidianLinkIndexPort } from "../../src/adapters/obsidian";
import { AtomicLinkIndexStore, FullRebuildController, IncrementalIndexController } from "../../src/features/index";
import { queryBrokenLinks, queryIsolatedFiles } from "../../src/features/queries";

describe("host suffix-resolution dependencies", () => {
  it("revalidates suffix links for create, delete, rename, ambiguity and source moves", async () => {
    const vault = suffixFixture({
      "Parent/Source.md": "[[Subdir/Target]]",
      "Archive/Subdir/Target.md": "",
    });
    const store = new AtomicLinkIndexStore();
    await new FullRebuildController(vault.port, store).rebuild();
    const incremental = new IncrementalIndexController(vault.port, store);
    incremental.start();
    const check = async (source: string, expected: string | null): Promise<void> => {
      await incremental.whenIdle();
      expect(store.current.getSourceSnapshot(source)?.occurrences[0]?.targetPath).toBe(expected);
      expect(queryBrokenLinks(store.current).map(({ sourcePath }) => sourcePath)).toEqual(expected === null ? [source] : []);
      if (expected !== null) {
        expect(store.current.getIncomingContributionCount(expected)).toBe(1);
        expect(queryIsolatedFiles(store.current).some(({ path }) => path === expected || path === source)).toBe(false);
      }
      const clean = (await new FullRebuildController(vault.port, new AtomicLinkIndexStore()).rebuild()).index;
      expect(store.current.toCanonicalState()).toEqual(clean.toCanonicalState());
    };
    try {
      await check("Parent/Source.md", "Archive/Subdir/Target.md");
      vault.content.set("Parent/Subdir/Target.md", "");
      incremental.enqueue({ type: "create", path: "Parent/Subdir/Target.md" });
      await check("Parent/Source.md", "Parent/Subdir/Target.md");
      vault.content.delete("Parent/Subdir/Target.md");
      incremental.enqueue({ type: "delete", path: "Parent/Subdir/Target.md" });
      await check("Parent/Source.md", "Archive/Subdir/Target.md");
      vault.content.delete("Archive/Subdir/Target.md");
      vault.content.set("Archive/Subdir/Renamed.md", "");
      incremental.enqueue({ type: "rename", oldPath: "Archive/Subdir/Target.md", path: "Archive/Subdir/Renamed.md" });
      await check("Parent/Source.md", null);
      vault.content.set("Parent/Subdir/Target.md", "");
      vault.content.set("Else/Subdir/Target.md", "");
      incremental.enqueue({ type: "create", path: "Parent/Subdir/Target.md" });
      incremental.enqueue({ type: "create", path: "Else/Subdir/Target.md" });
      await check("Parent/Source.md", "Parent/Subdir/Target.md");
      vault.content.delete("Parent/Source.md");
      vault.content.set("Else/Source.md", "[[Subdir/Target.md]]");
      incremental.enqueue({ type: "rename", oldPath: "Parent/Source.md", path: "Else/Source.md" });
      await check("Else/Source.md", "Else/Subdir/Target.md");
    } finally { incremental.stop(); }
  });

  it("rejects an in-flight source snapshot when a suffix competitor becomes available", async () => {
    const vault = suffixFixture({
      "Parent/Source.md": "[[Subdir/Target]]",
      "Archive/Subdir/Target.md": "",
      "Parent/Subdir/Target.md": "",
    });
    vault.unavailable.add("Parent/Subdir/Target.md");
    const store = new AtomicLinkIndexStore();
    await new FullRebuildController(vault.port, store).rebuild();
    const build = vault.port.buildSourceSnapshot.bind(vault.port);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const began = new Promise<void>((resolve) => { started = resolve; });
    let hold = true;
    vault.port.buildSourceSnapshot = async (path, scheduler) => {
      const result = await build(path, scheduler);
      if (path === "Parent/Source.md" && hold) { hold = false; started(); await gate; }
      return result;
    };
    const published: (string | null | undefined)[] = [];
    const incremental = new IncrementalIndexController(vault.port, store, {
      onChanges: () => published.push(store.current.getSourceSnapshot("Parent/Source.md")?.occurrences[0]?.targetPath),
    });
    incremental.start();
    try {
      incremental.enqueue({ type: "modify", path: "Parent/Source.md" });
      await began;
      vault.unavailable.delete("Parent/Subdir/Target.md");
      incremental.enqueue({ type: "modify", path: "Parent/Subdir/Target.md" });
      release();
      await incremental.whenIdle();
      expect(published).toEqual(["Parent/Subdir/Target.md"]);
      expect(store.current.getSourceSnapshot("Parent/Source.md")?.occurrences[0]?.targetPath).toBe("Parent/Subdir/Target.md");
      const clean = (await new FullRebuildController(vault.port, new AtomicLinkIndexStore()).rebuild()).index;
      expect(store.current.toCanonicalState()).toEqual(clean.toCanonicalState());
    } finally { release(); incremental.stop(); }
  });
});

function suffixFixture(initial: Readonly<Record<string, string>>) {
  const content = new Map(Object.entries(initial));
  const unavailable = new Set<string>();
  const file = (path: string) => ({ path, extension: "md", stat: { mtime: 1 } });
  const vault = {
    getFiles: () => [...content.keys()].map(file),
    getFileByPath: (path: string) => content.has(path) ? file(path) : null,
    cachedRead: (source: { path: string }) => Promise.resolve(content.get(source.path) ?? ""),
  } as unknown as Vault;
  const metadata = {
    getFileCache: (): CachedMetadata | null => null,
    // Independent host stand-in: no production lookup-key helper participates
    // in choosing a target. Context and ambiguity can change the best match.
    getFirstLinkpathDest: (link: string, source: string) => {
      const target = link.replace(/\.md$/iu, "");
      const folder = source.slice(0, source.lastIndexOf("/") + 1);
      const candidates = [...content.keys()].filter((path) => {
        const stem = path.replace(/\.md$/iu, "");
        return !unavailable.has(path) && (stem === target || stem.endsWith(`/${target}`));
      }).sort((left, right) => Number(right.startsWith(folder)) - Number(left.startsWith(folder)) || left.localeCompare(right));
      return candidates[0] === undefined ? null : file(candidates[0]);
    },
  } as unknown as MetadataCache;
  return { content, unavailable, port: new ObsidianLinkIndexPort(vault, metadata) };
}
