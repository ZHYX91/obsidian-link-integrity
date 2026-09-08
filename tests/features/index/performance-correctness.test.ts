import { describe, expect, it, vi } from "vitest";
import { createFileRecord, LinkIndex, type FileRecord, type SourceSnapshot } from "../../../src/core";
import { AtomicLinkIndexStore } from "../../../src/features/index/atomic-store";
import { FullRebuildController } from "../../../src/features/index/full-rebuild";
import { IncrementalIndexController } from "../../../src/features/index/incremental-controller";
import type { LinkIndexPort } from "../../../src/features/index/ports";
import { occurrence, snapshot } from "../../core/test-helpers";

function fixture(fingerprint: string | null | undefined = "headings-v1") {
  const files = new Map<string, FileRecord>(["Hub.md", "A.md", "B.md"].map((path) => [path,
    createFileRecord(path, { modifiedAt: 1,
      ...(fingerprint === undefined ? {} : { targetFingerprint: fingerprint }),
    })]));
  const snapshots = new Map<string, SourceSnapshot>([
    ["Hub.md", snapshot("Hub.md", [])],
    ["A.md", snapshot("A.md", [occurrence("a", "A.md", { targetPath: "Hub.md", lookupKey: "hub" })])],
    ["B.md", snapshot("B.md", [occurrence("b", "B.md", { targetPath: "Hub.md", lookupKey: "hub" })])],
  ]);
  const index = new LinkIndex([...files.values()]);
  for (const [path, value] of snapshots) index.replaceSourceSnapshot(path, value);
  const port: LinkIndexPort = {
    listFiles: vi.fn(async () => [...files.values()]),
    getFileRecord: vi.fn(async (path) => files.get(path) ?? null),
    buildSourceSnapshot: vi.fn(async (path) => snapshots.get(path) ?? null),
  };
  const store = new AtomicLinkIndexStore(index);
  return { files, snapshots, index, port, store };
}

describe("scheduled incremental publication", () => {
  it("rejects duplicate registry paths before publishing either a baseline or a namespace update", async () => {
    const f = fixture();
    const port = { ...f.port, listFiles: async () => [...f.files.values(), f.files.get("A.md")!] };
    const full = new FullRebuildController(port, f.store);
    await expect(full.rebuild()).rejects.toThrow("Duplicate file path: A.md");
    const incremental = new IncrementalIndexController(port, f.store);
    incremental.start();
    incremental.enqueue({ type: "create", path: "A.md" });
    await expect(incremental.whenIdle()).rejects.toThrow("Duplicate file path: A.md");
    expect(f.store.current).toBe(f.index);
  });
  it("does not fan out a body edit or enumerate the file registry", async () => {
    const f = fixture();
    const allFiles = vi.spyOn(f.index, "files", "get");
    f.files.set("Hub.md", createFileRecord("Hub.md", { modifiedAt: 2, targetFingerprint: "headings-v1" }));
    const controller = new IncrementalIndexController(f.port, f.store);
    controller.start();
    controller.enqueue({ type: "modify", path: "Hub.md" });
    await controller.whenIdle();
    expect(f.port.buildSourceSnapshot).toHaveBeenCalledTimes(1);
    expect(f.port.listFiles).not.toHaveBeenCalled();
    expect(allFiles).not.toHaveBeenCalled();
    expect(f.store.current.changes.sourcePaths.size).toBe(0);
    expect([...f.store.current.changes.filePaths]).toEqual(["Hub.md"]);
    expect(f.index.getFile("Hub.md")?.modifiedAt).toBe(1);
    expect(f.store.current.getFile("Hub.md")?.modifiedAt).toBe(2);
  });

  it.each(["headings-v2", null])("revalidates incoming references for changed or unknown metadata: %s", async (fingerprint) => {
    const f = fixture();
    f.files.set("Hub.md", createFileRecord("Hub.md", { modifiedAt: 2, targetFingerprint: fingerprint }));
    const controller = new IncrementalIndexController(f.port, f.store);
    controller.start();
    controller.enqueue({ type: "modify", path: "Hub.md" });
    await controller.whenIdle();
    expect(f.port.buildSourceSnapshot).toHaveBeenCalledTimes(3);
  });

  it("keeps every visible container unchanged while reducing a dense source in slices", async () => {
    const f = fixture();
    const before = f.index.toCanonicalState();
    f.snapshots.set("A.md", snapshot("A.md", Array.from({ length: 250 }, (_, i) =>
      occurrence(`new-${i}`, "A.md", { targetPath: "B.md", lookupKey: "b" }))));
    let yields = 0;
    const controller = new IncrementalIndexController(f.port, f.store, {
      yieldEvery: 10,
      now: () => 0,
      yieldControl: async () => {
        yields += 1;
        expect(f.store.current).toBe(f.index);
        expect(f.index.toCanonicalState()).toEqual(before);
      },
    });
    controller.start();
    controller.enqueue({ type: "modify", path: "A.md" });
    await controller.whenIdle();
    expect(yields).toBeGreaterThan(20);
    expect(f.store.current.getOutgoingNeighborCount("A.md")).toBe(1);
    expect(f.store.current.getIncomingContributionCount("B.md")).toBe(250);
    expect(f.index.toCanonicalState()).toEqual(before);
    expect(f.store.current.changes.graphPaths).toEqual(new Set(["A.md", "Hub.md", "B.md"]));
  });

  it("discards all staged work on a late reducer failure", async () => {
    const f = fixture();
    const before = f.index.toCanonicalState();
    f.snapshots.set("A.md", snapshot("A.md", [occurrence("same-id", "A.md")]));
    f.snapshots.set("B.md", snapshot("B.md", [occurrence("same-id", "B.md")]));
    const controller = new IncrementalIndexController(f.port, f.store, { yieldEvery: 1 });
    controller.start();
    controller.enqueue({ type: "modify", path: "A.md" });
    controller.enqueue({ type: "modify", path: "B.md" });
    await expect(controller.whenIdle()).rejects.toThrow("Occurrence ID is already used");
    expect(f.store.current).toBe(f.index);
    expect(f.index.toCanonicalState()).toEqual(before);
  });

  it("retries after a yield admits newer source positions, without publishing the old positions", async () => {
    const f = fixture();
    const moved = { ...occurrence("a", "A.md", { targetPath: "B.md", lookupKey: "b" }), position: {
      line: 17, column: 2, endLine: 17, endColumn: 8, property: null, canvasNodeId: null,
    } };
    let changed = false;
    const published: number[] = [];
    const controller = new IncrementalIndexController(f.port, f.store, {
      yieldEvery: 1,
      onChanges: () => published.push(f.store.current.getSourceSnapshot("A.md")?.occurrences[0]?.position?.line ?? -1),
      yieldControl: async () => {
        if (changed) return;
        changed = true;
        f.snapshots.set("A.md", snapshot("A.md", [moved]));
        controller.enqueue({ type: "modify", path: "A.md" });
      },
    });
    controller.start();
    controller.enqueue({ type: "modify", path: "A.md" });
    await controller.whenIdle();
    expect(published).toEqual([17]);
    expect(f.store.current.getSourceSnapshot("A.md")?.occurrences[0]).toEqual(moved);
  });

  it("does not publish after stop during a slice", async () => {
    const f = fixture();
    const controller = new IncrementalIndexController(f.port, f.store, {
      yieldEvery: 1, yieldControl: async (): Promise<void> => { controller.stop(); },
    });
    controller.start();
    controller.enqueue({ type: "modify", path: "A.md" });
    await controller.whenIdle();
    expect(f.store.current).toBe(f.index);
  });

  it("does not restart a batch when an unrelated edit arrives during its slice", async () => {
    const f = fixture();
    let enqueued = false;
    const controller = new IncrementalIndexController(f.port, f.store, {
      yieldEvery: 1,
      yieldControl: async () => {
        if (enqueued) return;
        enqueued = true;
        controller.enqueue({ type: "modify", path: "B.md" });
      },
    });
    controller.start();
    controller.enqueue({ type: "modify", path: "A.md" });
    await controller.whenIdle();
    expect(f.port.buildSourceSnapshot).toHaveBeenCalledTimes(2);
  });

  it("validates concurrent full-build sources with a single staging reducer", async () => {
    const f = fixture();
    f.snapshots.set("A.md", snapshot("A.md", [occurrence("same-id", "A.md")]));
    f.snapshots.set("B.md", snapshot("B.md", [occurrence("same-id", "B.md")]));
    const controller = new FullRebuildController(f.port, f.store, { yieldEvery: 1, concurrency: 4 });
    await expect(controller.rebuild()).rejects.toThrow("Occurrence ID is already used");
    expect(f.store.current).toBe(f.index);
  });
});

describe("forked graph ownership", () => {
  it("isolates mutations in either branch, including lookup sets, edge counts and policies", () => {
    const f = fixture();
    const first = f.index.fork();
    first.replaceSourceSnapshot("A.md", snapshot("A.md", [occurrence("a-new", "A.md", { targetPath: "B.md" })]));
    f.index.replaceSourceSnapshot("B.md", null);
    expect(first.getSourcePathsByTargetPath("Hub.md")).toEqual(new Set(["B.md"]));
    expect(f.index.getSourcePathsByTargetPath("Hub.md")).toEqual(new Set(["A.md"]));
    expect(first.getIncomingContributionCount("Hub.md")).toBe(1);
    expect(f.index.getIncomingContributionCount("Hub.md")).toBe(1);
    first.setGraphContributionPolicy({ allows: () => false });
    expect(first.getIncomingNeighborCount("Hub.md")).toBe(0);
    expect(f.index.getIncomingNeighborCount("Hub.md")).toBe(1);
    const second = first.fork();
    second.replaceFileRecord("New.md", createFileRecord("New.md"));
    expect(first.hasFile("New.md")).toBe(false);
  });
});
