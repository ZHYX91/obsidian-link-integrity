import type { MetadataCache, Vault } from "obsidian";
import { Menu } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObsidianLinkIndexPort } from "../../src/adapters/obsidian";
import LinkIntegrityPlugin from "../../src/app/plugin";
import { SidebarQueryService } from "../../src/app/sidebar-query-service";
import { AtomicLinkIndexStore, FullRebuildController, IncrementalIndexController } from "../../src/features/index";
import { createOccurrenceIgnoreContext, IgnoreService, normalizeIgnoreRules, type IgnoreRule } from "../../src/shared/ignore-rules";
import { createDefaultSettings, normalizeSettings, type LinkIntegritySettings } from "../../src/shared/settings";
import type { BrokenLinkResult } from "../../src/ui/sidebar";

interface FakeFile { path: string; extension: string; stat: { mtime: number }; }

async function setup(entries: readonly (readonly [string, string])[], destinations: Readonly<Record<string, string>> = {}) {
  const content = new Map(entries);
  const files = new Map<string, FakeFile>();
  const put = (path: string, text = "") => {
    files.set(path, { path, extension: path.split(".").at(-1)!, stat: { mtime: 1 } });
    content.set(path, text);
  };
  for (const [path, text] of entries) put(path, text);
  const port = new ObsidianLinkIndexPort({
    getFiles: () => [...files.values()], getFileByPath: (path: string) => files.get(path) ?? null,
    cachedRead: async (file: FakeFile) => content.get(file.path) ?? "",
  } as unknown as Vault, {
    getFileCache: () => ({}),
    getFirstLinkpathDest: (link: string, source: string) => {
      if (destinations[link] !== undefined) return files.get(destinations[link]) ?? null;
      const segments = link.startsWith(".") ? source.split("/").slice(0, -1) : [];
      for (const segment of link.split("/")) {
        if (segment === "..") segments.pop();
        else if (segment !== "." && segment !== "") segments.push(segment);
      }
      const path = segments.join("/");
      return files.get(path) ?? files.get(`${path}.md`) ?? null;
    },
  } as unknown as MetadataCache);
  const store = new AtomicLinkIndexStore();
  await new FullRebuildController(port, store).rebuild();
  const incremental = new IncrementalIndexController(port, store);
  incremental.start();
  const plugin = new LinkIntegrityPlugin({} as never, {} as never);
  plugin.settings = createDefaultSettings();
  Object.assign(plugin, {
    coordinator: { get index() { return store.current; } },
    updateSettings: (settings: LinkIntegritySettings) => { plugin.settings = normalizeSettings(settings); },
  });
  const visible = () => new SidebarQueryService(() => store.current, () => plugin.settings)
    .getSnapshot("broken-links").brokenLinks;
  const menuFor = (result: BrokenLinkResult) => {
    const items: { title: string; disabled: boolean; click: () => void }[] = [];
    const spy = vi.spyOn(Menu.prototype, "addItem").mockImplementation(function (this: Menu, callback) {
      const record = { title: "", disabled: false, click: () => undefined as void };
      const item = {
        setTitle: (title: string) => { record.title = title; return item; },
        setDisabled: (disabled: boolean) => { record.disabled = disabled; return item; },
        onClick: (click: () => void) => { record.click = click; return item; },
      };
      callback(item as never); items.push(record); return this;
    });
    try {
      (plugin as unknown as { showBrokenLinkActions(result: BrokenLinkResult, anchor: HTMLElement): void })
        .showBrokenLinkActions(result, document.createElement("button"));
    } finally { spy.mockRestore(); }
    return items;
  };
  const ignoreTarget = async (source: string) => {
    const item = menuFor(visible().find((result) => result.sourcePath === source)!).find(({ title }) => title === "Ignore entire target file")!;
    expect(item.disabled).toBe(false);
    item.click();
    await vi.waitFor(() => expect(plugin.settings.ignoreRules).toHaveLength(1));
    return plugin.settings.ignoreRules[0]!;
  };
  return { plugin, store, port, put, visible, menuFor, ignoreTarget, incremental };
}

afterEach(() => vi.restoreAllMocks());

describe("whole-file ignores through the sidebar, adapter and index", () => {
  it("separates identical relative text in different source folders and shares preview/visibility", async () => {
    const h = await setup([
      ["A/Source.md", "[missing](./Missing.md#Heading)"],
      ["B/Source.md", "[missing](./Missing.md#Heading)"],
      ["Other.md", "[[A/Missing#^block]]"],
    ]);
    try {
      const rule = await h.ignoreTarget("A/Source.md");
      expect(rule.matcher.value).toBe("A/Missing.md");
      expect(h.visible().map(({ sourcePath }) => sourcePath)).toEqual(["B/Source.md"]);
      expect((await h.plugin.previewIgnoreRule(rule)).matchCount).toBe(2);
    } finally { h.incremental.stop(); }
  });

  it("keeps one file identity for .md spelling, heading/block links and incremental file creation", async () => {
    const h = await setup([["Source.md", "[[Folder/Missing]]\n[[Folder/Missing#Heading]]\n[block](Folder/Missing.md#^block)\n![[Folder/Missing.md]]"]]);
    try {
      const rule = await h.ignoreTarget("Source.md");
      expect(rule.matcher.value).toBe("Folder/Missing.md");
      expect(h.visible()).toEqual([]);
      expect((await h.plugin.previewIgnoreRule(rule)).matchCount).toBe(4);
      h.put("Folder/Missing.md");
      h.incremental.enqueue({ type: "create", path: "Folder/Missing.md" });
      await h.incremental.whenIdle();
      expect(h.visible()).toEqual([]);
      expect((await h.plugin.previewIgnoreRule(rule)).matchCount).toBe(2);
      expect(h.store.current.getIncomingContributionCount("Folder/Missing.md")).toBe(4);
      const clean = (await new FullRebuildController(h.port, new AtomicLinkIndexStore()).rebuild()).index;
      expect(h.store.current.toCanonicalState()).toEqual(clean.toCanonicalState());
      h.plugin.settings = { ...h.plugin.settings, brokenLinks: { ...h.plugin.settings.brokenLinks, showIgnored: true } };
      expect(h.visible().map(({ reason }) => reason)).toEqual(["missing-heading", "missing-block"]);
    } finally { h.incremental.stop(); }
  });

  it("leaves ambiguous missing short names available for occurrence ignores", async () => {
    const h = await setup([["A/Source.md", "[[Missing]]"]]);
    try {
      const items = h.menuFor(h.visible()[0]!);
      expect(items.find(({ title }) => title === "Ignore entire target file")?.disabled).toBe(true);
      expect(items.some(({ title }) => title.includes("full Vault path"))).toBe(true);
      expect(items.find(({ title }) => title === "Ignore this reference")?.disabled).toBe(false);
      expect(h.plugin.settings.ignoreRules).toEqual([]);
    } finally { h.incremental.stop(); }
  });

  it("uses the current host-selected target even when link text names a different suffix", async () => {
    const h = await setup([["Source.md", "[[Folder/Target#Heading]]"], ["Other/Folder/Target.md", ""]],
      { "Folder/Target": "Other/Folder/Target.md" });
    try {
      const occurrence = h.store.current.getSourceSnapshot("Source.md")!.occurrences[0]!;
      const rule = await h.ignoreTarget("Source.md");
      expect(rule.matcher.value).toBe("Other/Folder/Target.md");
      const ignore = new IgnoreService([rule]);
      expect(ignore.shouldHideBrokenResult(createOccurrenceIgnoreContext(occurrence))).toBe(true);
      expect(ignore.shouldHideBrokenResult(createOccurrenceIgnoreContext({ ...occurrence, targetPath: "Folder/Target.md" }))).toBe(false);
      expect(ignore.shouldHideBrokenResult(createOccurrenceIgnoreContext({ ...occurrence, targetPath: "Other/Folder/Target.MD" }))).toBe(false);
    } finally { h.incremental.stop(); }
  });

  it.each([
    ["../Missing", "A/Missing.md"], ["../../Missing.md", "Missing.md"],
    ["/Missing", "Missing.md"], ["Folder/Missing.MD", "Folder/Missing.MD"],
    ["Folder/image.png", "Folder/image.png"],
  ])("identifies explicit missing %s as %s", async (linkpath, target) => {
    const h = await setup([["A/B/Source.md", `[[${linkpath}#Heading]]`]]);
    try {
      const rule = await h.ignoreTarget("A/B/Source.md");
      expect(rule.matcher.value).toBe(target);
      expect(h.visible()).toEqual([]);
    } finally { h.incremental.stop(); }
  });

  it.each(["../../../Outside", "./Folder/", "./Folder/..", "Folder/Encoded%20Name", "Folder/Topic.v1"])(
    "does not guess a whole-file identity for %s", async (linkpath) => {
      const h = await setup([["A/B/Source.md", `[[${linkpath}]]`]]);
      try {
        const menu = h.menuFor(h.visible()[0]!);
        expect(menu.find(({ title }) => title === "Ignore entire target file")?.disabled).toBe(true);
      } finally { h.incremental.stop(); }
    },
  );

  it("preserves exact Canvas file/background identities, literal hashes and extensionless paths", async () => {
    const h = await setup([["Board.canvas", JSON.stringify({ nodes: [
      { id: "file", type: "file", file: "Assets/Figure#1.png", subpath: "#Heading" },
      { id: "background", type: "group", background: "Assets/Figure#1.png" },
      { id: "other", type: "file", file: "Assets/Figure#2.png" },
      { id: "extensionless", type: "file", file: "Assets/README" },
    ] })]]);
    try {
      const rule = await h.ignoreTarget("Board.canvas");
      expect(rule.matcher.value).toBe("Assets/Figure#1.png");
      expect((await h.plugin.previewIgnoreRule(rule)).matchCount).toBe(2);
      expect(h.visible().map(({ targetText }) => targetText)).toEqual(["Assets/Figure#2.png", "Assets/README"]);
      const readme = h.store.current.getSourceSnapshot("Board.canvas")!.occurrences.find(({ linkpath }) => linkpath === "Assets/README")!;
      expect(createOccurrenceIgnoreContext(readme).targetPath).toBe("Assets/README");
    } finally { h.incremental.stop(); }
  });
});

describe("persisted target-rule admission", () => {
  it.each(["./Missing.md", "../Missing.md", "Missing", "Missing.md", "Folder/Missing#Heading", "Folder/Missing", "Folder/Topic.v1"])("retains but pauses an old ambiguous %s rule without guessing", (value) => {
    const old: IgnoreRule = { id: "old", enabled: true, scope: "ignore-target", matcher: { kind: "target-path", value }, createdAt: 7, note: "Keep my note" };
    const normalized = normalizeIgnoreRules([old]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({ id: "old", enabled: false, matcher: { value }, note: old.note });
    const service = new IgnoreService(normalized);
    expect(service.shouldHideBrokenResult({ targetPath: value })).toBe(false);
    expect(service.preview(normalized[0]!, [{ targetPath: value }]).matchCount).toBe(0);
  });

  it.each([["Folder/Missing.md", "Folder/Missing.md"], ["/Missing.md", "Missing.md"], ["Folder/Image.png", "Folder/Image.png"]])(
    "recovers an old explicit %s path once as %s", (value, path) => {
      const old: IgnoreRule = { id: "old", enabled: true, scope: "ignore-target", matcher: { kind: "target-path", value }, createdAt: 7, note: "Keep my note" };
      const normalized = normalizeIgnoreRules([old]);
      expect(normalized[0]).toMatchObject({ enabled: true, matcher: { value: path, pathKind: "vault" }, note: old.note });
      expect(normalizeIgnoreRules(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
      expect(new IgnoreService(normalized).shouldHideBrokenResult({ targetPath: path })).toBe(true);
    },
  );
});
