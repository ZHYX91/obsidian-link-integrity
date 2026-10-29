import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const root = "Resolution Semantics Acceptance/Destinations";
const sourcePath = `${root}/Source.md`;
const kind = "link-integrity/native-resolution-observations-v1";
interface TestFile { path: string; stat: { ctime: number; mtime: number; size: number }; }
interface Point { line: number; col: number; offset: number; }
interface NativeTuple { link: string; original: string; position: { start: Point; end: Point }; }
interface Observation {
  kind: string; status: string; issues: string[]; error?: unknown;
  sourceBefore: { byteLength: number; sha256: string | null; hashBasis: string; text: string };
  targetsBefore: { expectedPath: string; byteLength: number; sha256: string | null }[];
  nativeBefore: { entries: unknown[]; omittedCount: number };
  native: { link: unknown; original: unknown; sourceSlice: string | null; rawMatches: boolean;
    probe: { targetPath: string | null; outsideFixedTargets: boolean } }[];
  coverage: { raw: string; nativeIndexes: number[] }[];
  stability: Record<string, boolean>;
}
interface Receipt { schemaVersion: number; kind: string; observations: Observation[]; }
interface Provider {
  app: unknown; onload(): void; createResolutionRegressionFixtures(): Promise<void>; recordNativeResolutionObservation(): Promise<void>;
}

async function fixture() {
  const files = new Map<string, TestFile>();
  const text = new Map<string, string>();
  const folders = new Set<string>();
  const commands: { id: string; callback: () => Promise<void> }[] = [];
  const mutations: string[] = [];
  const opened: string[] = [];
  const notices: string[] = [];
  let data: unknown = null;
  let cache: { links?: unknown[] } | null = null;
  let readHook: ((file: TestFile, ordinal: number) => void | Promise<void>) | undefined;
  let reads = 0;
  const create = (path: string, value: string) => {
    const file = { path, stat: { ctime: 1, mtime: 1, size: new TextEncoder().encode(value).length } };
    files.set(path, file); text.set(path, value); return file;
  };
  create("Standalone.md", "baseline"); create("Broken-only.md", "baseline");
  const saveData = vi.fn(async (value: unknown) => { data = structuredClone(value); });
  const loadData = vi.fn(async () => structuredClone(data));
  class MarkdownView {
    public constructor(public file: TestFile, public editor: { getValue: () => string }) {}
  }
  const leaves: { view: MarkdownView }[] = [];
  const module = { exports: null as unknown as new() => Provider };
  const parseLinktext = vi.fn((value: string) => {
    const marker = value.indexOf("#");
    return marker < 0 ? { path: value, subpath: "" } : { path: value.slice(0, marker), subpath: value.slice(marker) };
  });
  runInNewContext(await readFile("acceptance/fixtures/.obsidian/plugins/link-integrity-acceptance-provider/main.js", "utf8"), {
    module, TextEncoder, TextDecoder,
    require: () => ({ Plugin: class {
      public addCommand(command: typeof commands[number]) { commands.push(command); }
      public loadData = loadData;
      public saveData = saveData;
    }, Notice: class { public constructor(value: string) { notices.push(value); } }, MarkdownView, parseLinktext,
    apiVersion: "test-api", Platform: { isDesktopApp: false, isAndroidApp: true } }),
  }, { timeout: 1_000 });
  const readBinary = vi.fn(async (path: string) => {
    await readHook?.(files.get(path)!, ++reads);
    return new TextEncoder().encode(text.get(path) ?? "").buffer;
  });
  const resolve = vi.fn((path: string, source: string) => {
    expect(source).toBe(sourcePath);
    return files.get(`${root}/${path}`) ?? files.get(`${root}/${path}.md`) ?? null;
  });
  const forbidden = vi.fn(() => { throw new Error("Observer must not enumerate, listen, navigate or rebuild."); });
  const provider = new module.exports();
  provider.app = { vault: {
    getFileByPath: (path: string) => files.get(path) ?? null,
    getAbstractFileByPath: (path: string) => files.get(path) ?? (folders.has(path) ? { path } : null),
    createFolder: async (path: string) => { mutations.push(path); folders.add(path); },
    create: async (path: string, value: string) => { mutations.push(path); return create(path, value); },
    getFiles: forbidden, on: forbidden, adapter: { readBinary },
  }, metadataCache: { getFileCache: () => cache, getFirstLinkpathDest: resolve, on: forbidden },
  workspace: { getLeaf: () => ({ openFile: async (file: TestFile) => { opened.push(file.path); } }),
    getLeavesOfType: () => leaves, on: forbidden, trigger: forbidden }, plugins: new Proxy({}, { get: forbidden }) };
  provider.onload();
  expect(readBinary).not.toHaveBeenCalled(); expect(loadData).not.toHaveBeenCalled(); expect(saveData).not.toHaveBeenCalled();
  await provider.createResolutionRegressionFixtures();
  const source = text.get(sourcePath)!;
  const nativeLinks = ["A&amp;B.md", "foo\\!.md", "A&amp;B.md", "Escaped&B.md", "Wiki&amp;Name", "Percent%26Name.md", "https://example.com", "Missing&Value.md"];
  const tuples: NativeTuple[] = source.split("\n").slice(1, -1).map((original, index) => {
    const offset = source.indexOf(original);
    return { link: nativeLinks[index]!, original, position: {
      start: { line: index + 1, col: 0, offset }, end: { line: index + 1, col: original.length, offset: offset + original.length },
    } };
  });
  cache = { links: tuples };
  mutations.length = 0; opened.length = 0;
  return { provider, files, text, commands, mutations, opened, notices, readBinary, saveData, resolve, forbidden, tuples, leaves, MarkdownView,
    saved: () => data as Receipt, setData: (value: unknown) => { data = value; }, setCache: (value: typeof cache) => { cache = value; },
    setReadHook: (hook: typeof readHook) => { readHook = hook; } };
}

describe("explicit native resolution observer", () => {
  it("records actual native tuples and public API probes without decoding, navigation or indexed writes", async () => {
    const f = await fixture();
    const before = new Map(f.text);
    await f.commands.find(({ id }) => id === "record-native-resolution-observation")!.callback();
    const observation = f.saved().observations[0]!;
    expect(observation.status).toBe("complete"); expect(observation.issues).toEqual([]);
    expect(observation.sourceBefore).toMatchObject({ byteLength: 205, hashBasis: "exact-known-fixture-bytes",
      sha256: createHash("sha256").update(f.text.get(sourcePath)!).digest("hex") });
    expect(observation.targetsBefore).toHaveLength(6);
    for (const target of observation.targetsBefore) expect(target).toMatchObject({ byteLength: 27,
      sha256: createHash("sha256").update(f.text.get(target.expectedPath)!).digest("hex") });
    expect(observation.nativeBefore.entries).toEqual(f.tuples);
    expect(observation.native[0]).toMatchObject({ link: "A&amp;B.md", sourceSlice: "[amp](A&amp;B.md)", rawMatches: true,
      probe: { targetPath: `${root}/A&amp;B.md` } });
    expect(observation.native[3]).toMatchObject({ link: "Escaped&B.md", sourceSlice: "[escaped](Escaped\\&amp;B.md)",
      probe: { targetPath: null } });
    expect(observation.native[7]).toMatchObject({ sourceSlice: "[missing](Missing&amp;Value.md)", sourceRange: { start: 171, end: 202 } });
    expect(observation.stability).toEqual({ sourceIdentity: true, targetIdentities: true, sourceBytesAndStat: true,
      targetBytesAndStats: true, cacheIdentity: true, cacheFields: true, editors: true, resolverResults: true });
    expect(f.resolve).toHaveBeenCalledWith("Escaped&B.md", sourcePath);
    expect(f.resolve).toHaveBeenCalledWith("Escaped&amp;B.md", sourcePath);
    expect(f.text).toEqual(before); expect(f.mutations).toEqual([]); expect(f.opened).toEqual([]); expect(f.forbidden).not.toHaveBeenCalled();
    expect(f.readBinary.mock.calls.every(([path]) => path === sourcePath || /^Resolution Semantics Acceptance\/Destinations\/[^/]+\.md$/u.test(path))).toBe(true);
    expect(f.notices.at(-1)).toContain("no product verdict");
    await f.provider.recordNativeResolutionObservation();
    expect(f.saved().observations).toHaveLength(2); expect(f.saved().observations[0]).toEqual(observation);
  });

  it.each(["missing-cache", "missing-link", "missing-position", "stale-position", "missing-tuple", "duplicate", "excess"])("preserves %s native facts as incomplete", async (mode) => {
    const f = await fixture();
    if (mode === "missing-cache") f.setCache(null);
    if (mode === "missing-link") f.setCache({ links: [{ original: f.tuples[0]!.original, position: f.tuples[0]!.position }, ...f.tuples.slice(1)] });
    if (mode === "missing-position") f.setCache({ links: [{ link: f.tuples[0]!.link, original: f.tuples[0]!.original }, ...f.tuples.slice(1)] });
    if (mode === "stale-position") f.tuples[3]!.position.start.col = 999;
    if (mode === "missing-tuple") f.setCache({ links: f.tuples.slice(0, 7) });
    if (mode === "duplicate") f.setCache({ links: [f.tuples[0], f.tuples[0], ...f.tuples.slice(2)] });
    if (mode === "excess") f.setCache({ links: [...f.tuples, f.tuples[3]] });
    await f.provider.recordNativeResolutionObservation();
    const observation = f.saved().observations[0]!;
    expect(observation.status).toBe("incomplete"); expect(observation.issues.length).toBeGreaterThan(0);
    if (mode !== "missing-cache") expect(observation.nativeBefore.entries.length).toBeGreaterThan(0);
    if (mode === "stale-position") expect(observation.native[3]).toMatchObject({ link: "Escaped&B.md", rawMatches: false });
    if (mode === "missing-link") expect(observation.nativeBefore.entries[0]).toMatchObject({ link: { type: "undefined" } });
    if (mode === "missing-tuple") expect(observation.coverage[7]?.nativeIndexes).toEqual([]);
    if (mode === "excess") expect(observation.nativeBefore.omittedCount).toBe(1);
    expect(f.mutations).toEqual([]); expect(f.opened).toEqual([]);
  });

  it.each(["dirty-editor", "stale-editor-file", "changed-source", "changed-target", "cache-in-place", "late-cache-change", "source-replaced", "source-renamed-outside", "target-renamed-outside", "editor-replaced", "resolver-outside", "read-failure"])("retains %s evidence without a complete capture", async (mode) => {
    const f = await fixture();
    if (mode === "dirty-editor") f.leaves.push({ view: new f.MarkdownView(f.files.get(sourcePath)!, { getValue: () => "unsaved text" }) });
    if (mode === "stale-editor-file") f.leaves.push({ view: new f.MarkdownView({ ...f.files.get(sourcePath)! }, { getValue: () => f.text.get(sourcePath)! }) });
    if (mode === "changed-source") f.text.set(sourcePath, f.text.get(sourcePath)!.replace("amp", "AMP"));
    if (mode === "changed-target") f.text.set(`${root}/A&B.md`, "changed target");
    if (mode === "resolver-outside") f.resolve.mockImplementation(() => ({ path: "Elsewhere.md", stat: { ctime: 1, mtime: 1, size: 0 } }));
    if (mode === "late-cache-change") {
      const resolve = f.resolve.getMockImplementation()!;
      let calls = 0;
      f.resolve.mockImplementation((path, source) => {
        if (++calls === 15) f.tuples[3]!.link = "Changed native.md";
        return resolve(path, source);
      });
    }
    const editor = { getValue: () => f.text.get(sourcePath)! };
    if (mode === "editor-replaced") f.leaves.push({ view: new f.MarkdownView(f.files.get(sourcePath)!, editor) });
    f.setReadHook((file, ordinal) => {
      if (ordinal !== 2) return;
      if (mode === "cache-in-place") f.tuples[3]!.link = "Changed native.md";
      if (mode === "source-replaced") f.files.set(sourcePath, { ...f.files.get(sourcePath)!, stat: { ...f.files.get(sourcePath)!.stat } });
      if (mode === "source-renamed-outside" || mode === "target-renamed-outside") {
        const originalPath = mode === "source-renamed-outside" ? sourcePath : `${root}/A&B.md`;
        const original = f.files.get(originalPath)!;
        f.files.delete(originalPath); original.path = "Outside.md"; f.files.set(original.path, original);
      }
      if (mode === "editor-replaced") f.leaves[0]!.view.editor = { getValue: editor.getValue };
      if (mode === "read-failure") throw new Error("read diagnosis");
      if (!mode.endsWith("renamed-outside")) expect(file.path.startsWith(root)).toBe(true);
    });
    await f.provider.recordNativeResolutionObservation();
    const observation = f.saved().observations[0]!;
    expect(observation.status).toBe("incomplete"); expect(observation.issues.length).toBeGreaterThan(0);
    expect(observation.nativeBefore.entries[3]).toMatchObject({ link: "Escaped&B.md", original: "[escaped](Escaped\\&amp;B.md)" });
    if (mode === "cache-in-place" || mode === "late-cache-change") expect(observation.stability.cacheFields).toBe(false);
    if (mode === "source-replaced") expect(observation.stability.sourceIdentity).toBe(false);
    if (mode === "source-renamed-outside") expect(observation.stability.sourceIdentity).toBe(false);
    if (mode === "target-renamed-outside") expect(observation.stability.targetIdentities).toBe(false);
    if (mode === "editor-replaced") expect(observation.stability.editors).toBe(false);
    if (mode === "stale-editor-file") expect(observation.issues).toContain("source-editor-has-a-different-same-path-file-identity");
    if (mode === "resolver-outside") expect(observation.native[0]?.probe).toMatchObject({ outsideFixedTargets: true, targetPath: "Elsewhere.md" });
    if (mode === "read-failure") expect(observation.error).toBe("Error: read diagnosis");
    expect(f.mutations).toEqual([]); expect(f.opened).toEqual([]);
    expect(f.readBinary.mock.calls.some(([path]) => path === "Outside.md")).toBe(false);
  });

  it.each(["future", "unknown", "extra-key", "full", "bytes"])("refuses %s provider data without overwriting it", async (mode) => {
    const f = await fixture();
    const previous = mode === "future" ? { schemaVersion: 2, kind, observations: [] } : mode === "unknown" ? { foreign: true }
      : mode === "extra-key" ? { schemaVersion: 1, kind, observations: [], future: true }
      : { schemaVersion: 1, kind, observations: Array.from({ length: mode === "full" ? 4 : 1 }, () => ({ kind: "native-resolution-observation-v1",
        issues: mode === "bytes" ? ["a".repeat(96001)] : [] })) };
    f.setData(previous);
    await expect(f.provider.recordNativeResolutionObservation()).rejects.toThrow();
    expect(f.saved()).toEqual(previous); expect(f.saveData).not.toHaveBeenCalled(); expect(f.readBinary).not.toHaveBeenCalled();
  });

  it("rejects concurrent capture while preserving the first request", async () => {
    const f = await fixture();
    let release: () => void = () => {};
    const paused = new Promise<void>((resolve) => { release = resolve; });
    f.setReadHook(async (_file, ordinal) => { if (ordinal === 1) await paused; });
    const first = f.provider.recordNativeResolutionObservation();
    await vi.waitFor(() => expect(f.readBinary).toHaveBeenCalledOnce());
    await expect(f.provider.recordNativeResolutionObservation()).rejects.toThrow("already running");
    release(); await first;
    expect(f.saved().observations).toHaveLength(1); expect(f.saveData).toHaveBeenCalledOnce();
  });
});
