import { describe, expect, it } from "vitest";

import { LinkIndex } from "../../../src/core/link-index";
import {
  createFileRecord,
  makeOccurrenceLookupKey,
  type FileRecord,
  type SourceSnapshot,
} from "../../../src/core/model";
import type { GraphContributionPolicy } from "../../../src/core/scopes";
import { AtomicLinkIndexStore } from "../../../src/features/index/atomic-store";
import { LinkIndexCoordinator } from "../../../src/features/index/coordinator";
import { FullRebuildController } from "../../../src/features/index/full-rebuild";
import { IncrementalIndexController } from "../../../src/features/index/incremental-controller";
import type { LinkIndexPort, SourceEvent } from "../../../src/features/index/ports";
import { occurrence, snapshot } from "../../core/test-helpers";

describe("full rebuild", () => {
  it("publishes staging atomically and retains last-known-good on failure", async () => {
    const lastKnownGood = new LinkIndex([createFileRecord("Known.md")]);
    const store = new AtomicLinkIndexStore(lastKnownGood);
    const port: LinkIndexPort = {
      listFiles: async () => [createFileRecord("Broken.md")],
      getFileRecord: async () => createFileRecord("Broken.md"),
      buildSourceSnapshot: async () => {
        throw new Error("fixture failure");
      },
    };
    const controller = new FullRebuildController(port, store);
    await expect(controller.rebuild()).rejects.toThrow("fixture failure");
    expect(store.current).toBe(lastKnownGood);
    expect(store.generation).toBe(0);
  });

  it("yields during large scans and throttles progress notifications", async () => {
    const files = Array.from({ length: 5 }, (_, index) =>
      createFileRecord(`Note-${index}.md`));
    const progress: string[] = [];
    let yields = 0;
    const store = new AtomicLinkIndexStore();
    const controller = new FullRebuildController({
      listFiles: async () => files,
      getFileRecord: async (path) => files.find((file) => file.path === path) ?? null,
      buildSourceSnapshot: async (path) => snapshot(path, []),
    }, store, {
      concurrency: 1,
      yieldEvery: 2,
      yieldControl: async () => {
        yields += 1;
      },
      progressThrottleMs: 100,
      now: () => 0,
      onProgress: (completed, total) => progress.push(`${completed}/${total}`),
    });
    await controller.rebuild();
    expect(yields).toBe(2);
    expect(progress).toEqual(["0/5", "5/5"]);
  });

  it("yields when scan work reaches the main-thread time budget", async () => {
    const files = Array.from({ length: 5 }, (_, index) =>
      createFileRecord(`Note-${index}.md`));
    let clock = 0;
    let yields = 0;
    const controller = new FullRebuildController({
      listFiles: async () => files,
      getFileRecord: async (path) => files.find((file) => file.path === path) ?? null,
      buildSourceSnapshot: async (path) => {
        clock += 5;
        return snapshot(path, []);
      },
    }, new AtomicLinkIndexStore(), {
      concurrency: 1,
      yieldEvery: 1_000,
      yieldIntervalMs: 8,
      yieldControl: async () => {
        yields += 1;
      },
      now: () => clock,
    });

    await controller.rebuild();

    expect(yields).toBe(2);
  });
});

describe("incremental indexing", () => {
  it("coalesces repeated events for one source", async () => {
    const vault = new VirtualVault({ "A.md": [] });
    const store = new AtomicLinkIndexStore(await buildOracle(vault));
    const controller = new IncrementalIndexController(vault, store);
    vault.buildCount = 0;
    controller.start();
    controller.enqueue({ type: "modify", path: "A.md" });
    controller.enqueue({ type: "modify", path: "A.md" });
    controller.enqueue({ type: "metadata-resolved", path: "A.md" });
    await controller.whenIdle();
    expect(vault.buildCount).toBe(1);
  });

  it("bounds concurrent snapshot builds for global metadata refreshes", async () => {
    const vault = new VirtualVault(Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`Note-${index}.md`, []]),
    ));
    const store = new AtomicLinkIndexStore(await buildOracle(vault));
    const baseBuild = vault.buildSourceSnapshot;
    let activeBuilds = 0;
    let maximumActiveBuilds = 0;
    vault.buildSourceSnapshot = async (path) => {
      activeBuilds += 1;
      maximumActiveBuilds = Math.max(maximumActiveBuilds, activeBuilds);
      await Promise.resolve();
      const result = await baseBuild(path);
      activeBuilds -= 1;
      return result;
    };
    const controller = new IncrementalIndexController(vault, store, { concurrency: 2 });
    controller.start();
    controller.enqueue({ type: "metadata-resolved", path: null });
    await controller.whenIdle();
    expect(maximumActiveBuilds).toBe(2);
  });

  it("does not let an old async snapshot overwrite a newer revision", async () => {
    const gate = deferred<void>();
    const started = deferred<void>();
    const vault = new VirtualVault({ "A.md": ["Old"], "Old.md": [], "New.md": [] });
    const store = new AtomicLinkIndexStore(await buildOracle(vault));
    const baseBuild = vault.buildSourceSnapshot;
    let held = false;
    vault.buildSourceSnapshot = async (path) => {
      const built = await baseBuild(path);
      if (path === "A.md" && !held) {
        held = true;
        started.resolve();
        await gate.promise;
      }
      return built;
    };
    const controller = new IncrementalIndexController(vault, store);
    controller.start();
    controller.enqueue({ type: "modify", path: "A.md" });
    await started.promise;
    vault.setLinks("A.md", ["New"]);
    controller.enqueue({ type: "modify", path: "A.md" });
    gate.resolve();
    await controller.whenIdle();
    expect(store.current.getOutgoingEdges("A.md")[0]?.targetPath).toBe("New.md");
  });

  it("revalidates every lookup ref when a same-name file appears", async () => {
    const vault = new VirtualVault({ "Source.md": ["Note"] });
    const store = new AtomicLinkIndexStore(await buildOracle(vault));
    const controller = new IncrementalIndexController(vault, store);
    controller.start();
    expect(store.current.getSourceSnapshot("Source.md")?.occurrences[0]?.fileStatus).toBe("missing");

    vault.create("Folder/Note.md", []);
    controller.enqueue({ type: "create", path: "Folder/Note.md" });
    await controller.whenIdle();
    expect(store.current.getSourceSnapshot("Source.md")?.occurrences[0]).toMatchObject({
      fileStatus: "resolved",
      targetPath: "Folder/Note.md",
    });
  });

  it("refreshes file metadata on modify and keeps it equal to a clean rebuild", async () => {
    const vault = new VirtualVault({ "A.md": [], "Untouched.md": [] });
    const store = new AtomicLinkIndexStore(await buildOracle(vault));
    const before = store.current.getFile("A.md")?.modifiedAt;
    const untouchedBefore = store.current.getFile("Untouched.md");
    const controller = new IncrementalIndexController(vault, store);
    vault.listFilesCallCount = 0;
    vault.getFileRecordCallCount = 0;
    controller.start();

    vault.setLinks("A.md", []);
    controller.enqueue({ type: "modify", path: "A.md" });
    await controller.whenIdle();

    expect(store.current.getFile("A.md")?.modifiedAt).toBeGreaterThan(before ?? 0);
    expect(store.current.getFile("Untouched.md")).toBe(untouchedBefore);
    expect(vault.listFilesCallCount).toBe(0);
    expect(vault.getFileRecordCallCount).toBe(1);
    expect(store.current.toCanonicalState()).toEqual((await buildOracle(vault)).toCanonicalState());
  });

  it("does not partially publish a namespace refresh when a source build fails", async () => {
    const vault = new VirtualVault({ "Known.md": [] });
    const lastKnownGood = await buildOracle(vault);
    const store = new AtomicLinkIndexStore(lastKnownGood);
    const baseBuild = vault.buildSourceSnapshot;
    vault.buildSourceSnapshot = async (path) => {
      if (path === "Broken.canvas") throw new Error("parse failed");
      return baseBuild(path);
    };
    const controller = new IncrementalIndexController(vault, store);
    controller.start();

    vault.create("Broken.canvas", []);
    controller.enqueue({ type: "create", path: "Broken.canvas" });

    await expect(controller.whenIdle()).rejects.toThrow("parse failed");
    expect(store.current).toBe(lastKnownGood);
    expect(store.current.files.map(({ path }) => path)).toEqual(["Known.md"]);
  });

  it("does not commit single-file metadata when its snapshot build fails", async () => {
    const vault = new VirtualVault({ "Known.md": [] });
    const lastKnownGood = await buildOracle(vault);
    const original = lastKnownGood.getFile("Known.md");
    const store = new AtomicLinkIndexStore(lastKnownGood);
    vault.setLinks("Known.md", []);
    vault.buildSourceSnapshot = async () => {
      throw new Error("parse failed");
    };
    const controller = new IncrementalIndexController(vault, store);
    vault.listFilesCallCount = 0;
    controller.start();

    controller.enqueue({ type: "modify", path: "Known.md" });

    await expect(controller.whenIdle()).rejects.toThrow("parse failed");
    expect(store.current.getFile("Known.md")).toBe(original);
    expect(vault.listFilesCallCount).toBe(0);
  });

  it("prevalidates a reducer batch before publishing any source", async () => {
    const vault = new VirtualVault({
      "A.md": ["Target"],
      "B.md": ["Target"],
      "Target.md": [],
    });
    const lastKnownGood = await buildOracle(vault);
    const before = lastKnownGood.toCanonicalState();
    const store = new AtomicLinkIndexStore(lastKnownGood);
    const baseBuild = vault.buildSourceSnapshot;
    vault.setLinks("A.md", ["Target"]);
    vault.setLinks("B.md", ["Target"]);
    vault.buildSourceSnapshot = async (path) => {
      if (path === "A.md" || path === "B.md") {
        return snapshot(path, [
          occurrence("cross-source-collision", path, { targetPath: "Target.md" }),
        ]);
      }
      return baseBuild(path);
    };
    const controller = new IncrementalIndexController(vault, store);
    controller.start();
    controller.enqueue({ type: "modify", path: "A.md" });
    controller.enqueue({ type: "modify", path: "B.md" });

    await expect(controller.whenIdle()).rejects.toThrow(
      "Occurrence ID is already used by A.md: cross-source-collision",
    );
    expect(store.current).toBe(lastKnownGood);
    expect(store.current.toCanonicalState()).toEqual(before);
  });

  it("matches a clean full rebuild after deterministic random event sequences", async () => {
    const vault = new VirtualVault({
      "A.md": ["B"],
      "B.md": [],
      "C.md": ["Missing"],
    });
    const store = new AtomicLinkIndexStore(await buildOracle(vault));
    const controller = new IncrementalIndexController(vault, store);
    controller.start();
    const random = mulberry32(0x51a7ed);

    for (let step = 0; step < 60; step += 1) {
      const event = mutateRandomly(vault, random, step);
      controller.enqueue(event);
      await controller.whenIdle();
      const oracle = await buildOracle(vault);
      expect(store.current.toCanonicalState()).toEqual(oracle.toCanonicalState());
    }
  });
});

describe("index coordinator", () => {
  it("publishes bounded rebuild and incremental diagnostics", async () => {
    let now = 1_000;
    const vault = new VirtualVault({
      "A.md": ["B"],
      "B.md": [],
    });
    const coordinator = new LinkIndexCoordinator(vault, new LinkIndex(), {
      now: () => now,
    }, {
      now: () => now,
    });
    const snapshots: unknown[] = [];
    coordinator.subscribeDiagnostics((snapshot) => snapshots.push(snapshot));
    coordinator.start();

    const rebuilding = coordinator.rebuild();
    now = 1_025;
    await rebuilding;
    expect(coordinator.diagnostics).toMatchObject({
      fileCount: 2,
      sourceCount: 2,
      occurrenceCount: 1,
      pendingEventCount: 0,
      lastFullRebuild: {
        completedAt: 1_025,
        durationMs: 25,
        fileCount: 2,
        sourceCount: 2,
        occurrenceCount: 1,
      },
      lastIncrementalUpdate: null,
    });

    vault.setLinks("A.md", []);
    now = 2_000;
    coordinator.enqueue({ type: "modify", path: "A.md" });
    expect(coordinator.diagnostics.pendingEventCount).toBe(1);
    now = 2_007;
    await coordinator.whenIdle();
    expect(coordinator.diagnostics).toMatchObject({
      fileCount: 2,
      sourceCount: 2,
      occurrenceCount: 0,
      pendingEventCount: 0,
      lastIncrementalUpdate: {
        completedAt: 2_007,
        durationMs: 0,
        eventCount: 1,
        affectedSourceCount: 1,
      },
    });
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    coordinator.stop();
  });

  it("keeps indexing when diagnostics observers throw", async () => {
    const vault = new VirtualVault({
      "A.md": ["B"],
      "B.md": [],
    });
    const coordinator = new LinkIndexCoordinator(vault);
    coordinator.subscribeDiagnostics(() => {
      throw new Error("observer failed");
    });
    coordinator.start();

    await expect(coordinator.rebuild()).resolves.toBeDefined();
    vault.setLinks("A.md", []);
    coordinator.enqueue({ type: "modify", path: "A.md" });
    await expect(coordinator.whenIdle()).resolves.toBeUndefined();

    expect(coordinator.index.getOutgoingNeighborCount("A.md")).toBe(0);
    expect(coordinator.diagnostics.occurrenceCount).toBe(0);
    coordinator.stop();
  });

  it("keeps graph contribution policy across rebuild and incremental updates", async () => {
    const vault = new VirtualVault({
      "Source.md": ["Target"],
      "Target.md": [],
      "Other.md": [],
    });
    let evaluationCount = 0;
    const policy: GraphContributionPolicy = {
      allows: ({ occurrence: item }) => {
        evaluationCount += 1;
        return item.targetPath !== "Target.md";
      },
    };
    const coordinator = new LinkIndexCoordinator(vault);
    coordinator.setGraphContributionPolicy(policy);
    coordinator.start();

    await coordinator.rebuild();
    expect(coordinator.index.getOutgoingNeighborCount("Source.md")).toBe(0);
    expect(coordinator.index.toCanonicalState()).toEqual(
      (await buildOracle(vault, policy)).toCanonicalState(),
    );

    evaluationCount = 0;
    vault.setLinks("Source.md", ["Other"]);
    coordinator.enqueue({ type: "modify", path: "Source.md" });
    await coordinator.whenIdle();

    expect(evaluationCount).toBe(2);
    expect(coordinator.index.getOutgoingEdges("Source.md")[0]?.targetPath).toBe("Other.md");
    expect(coordinator.index.toCanonicalState()).toEqual(
      (await buildOracle(vault, policy)).toCanonicalState(),
    );
  });

  it("recovers its lifecycle when draining pre-rebuild incremental work fails", async () => {
    const vault = new VirtualVault({ "A.md": [] });
    const baseBuild = vault.buildSourceSnapshot;
    let failNext = true;
    vault.buildSourceSnapshot = async (path) => {
      if (failNext) {
        failNext = false;
        throw new Error("incremental failed");
      }
      return baseBuild(path);
    };
    const coordinator = new LinkIndexCoordinator(vault, await buildOracle({
      listFiles: vault.listFiles,
      getFileRecord: vault.getFileRecord,
      buildSourceSnapshot: baseBuild,
    }));
    coordinator.start();
    coordinator.enqueue({ type: "modify", path: "A.md" });
    await expect(coordinator.rebuild()).rejects.toThrow("incremental failed");
    expect(coordinator.state).toBe("failed");

    coordinator.enqueue({ type: "modify", path: "A.md" });
    await coordinator.whenIdle();
    expect(coordinator.index.getSourceSnapshot("A.md")).not.toBeNull();
  });

  it("does not publish an obsolete rebuild after lifecycle stop", async () => {
    const vault = new VirtualVault({ "A.md": [] });
    const gate = deferred<void>();
    const started = deferred<void>();
    const baseBuild = vault.buildSourceSnapshot;
    vault.buildSourceSnapshot = async (path) => {
      started.resolve();
      await gate.promise;
      return baseBuild(path);
    };
    const initial = new LinkIndex([createFileRecord("Known.md")]);
    const coordinator = new LinkIndexCoordinator(vault, initial);
    coordinator.start();
    const rebuilding = coordinator.rebuild();
    await started.promise;
    coordinator.stop();
    gate.resolve();
    await expect(rebuilding).rejects.toThrow("lifecycle change");
    expect(coordinator.index).toBe(initial);
    expect(coordinator.store.generation).toBe(0);
    expect(coordinator.state).toBe("idle");
  });

  it("replays events buffered during rebuild and makes concurrent rebuild calls single-flight", async () => {
    const vault = new VirtualVault({ "A.md": ["Old"], "Old.md": [] });
    const gate = deferred<void>();
    const started = deferred<void>();
    const baseBuild = vault.buildSourceSnapshot;
    let held = false;
    vault.buildSourceSnapshot = async (path) => {
      if (!held) {
        held = true;
        started.resolve();
        await gate.promise;
      }
      return baseBuild(path);
    };
    const coordinator = new LinkIndexCoordinator(vault);
    coordinator.start();
    const first = coordinator.rebuild();
    const second = coordinator.rebuild();
    await started.promise;
    vault.create("New.md", []);
    vault.setLinks("A.md", ["New"]);
    coordinator.enqueue({ type: "create", path: "New.md" });
    coordinator.enqueue({ type: "modify", path: "A.md" });
    gate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.generation).toBe(secondResult.generation);
    expect(coordinator.index.toCanonicalState()).toEqual((await buildOracle(vault)).toCanonicalState());
  });

  it("retains last-known-good after rebuild failure and drains buffered events into it", async () => {
    const vault = new VirtualVault({ "A.md": ["Old"], "Old.md": [] });
    const coordinator = new LinkIndexCoordinator(vault);
    coordinator.start();
    await coordinator.rebuild();
    const publishedGeneration = coordinator.store.generation;
    const lastKnownGood = coordinator.index;

    const gate = deferred<void>();
    const started = deferred<void>();
    const baseBuild = vault.buildSourceSnapshot;
    let failed = false;
    vault.buildSourceSnapshot = async (path) => {
      if (!failed) {
        failed = true;
        started.resolve();
        await gate.promise;
        throw new Error("rebuild failed");
      }
      return baseBuild(path);
    };
    const rebuilding = coordinator.rebuild();
    await started.promise;
    vault.create("New.md", []);
    vault.setLinks("A.md", ["New"]);
    coordinator.enqueue({ type: "create", path: "New.md" });
    coordinator.enqueue({ type: "modify", path: "A.md" });
    gate.resolve();
    await expect(rebuilding).rejects.toThrow("rebuild failed");
    await coordinator.whenIdle();

    expect(coordinator.index).toBe(lastKnownGood);
    expect(coordinator.store.generation).toBe(publishedGeneration);
    expect(coordinator.state).toBe("stale");
    expect(coordinator.index.toCanonicalState()).toEqual((await buildOracle(vault)).toCanonicalState());
  });

  it("does not create a partial index from buffered events when the first baseline fails", async () => {
    const vault = new VirtualVault({ "A.md": [] });
    const coordinator = new LinkIndexCoordinator(vault);
    coordinator.start();
    const gate = deferred<void>();
    const started = deferred<void>();
    const baseBuild = vault.buildSourceSnapshot;
    let failFirst = true;
    vault.buildSourceSnapshot = async (path) => {
      if (failFirst) {
        failFirst = false;
        started.resolve();
        await gate.promise;
        throw new Error("first baseline failed");
      }
      return baseBuild(path);
    };

    const rebuilding = coordinator.rebuild();
    await started.promise;
    vault.create("B.md", []);
    coordinator.enqueue({ type: "create", path: "B.md" });
    gate.resolve();
    await expect(rebuilding).rejects.toThrow("first baseline failed");
    await coordinator.whenIdle();

    expect(coordinator.state).toBe("failed");
    expect(coordinator.store.generation).toBe(0);
    expect(coordinator.index.files).toEqual([]);

    await coordinator.rebuild();
    expect(coordinator.index.toCanonicalState()).toEqual((await buildOracle(vault)).toCanonicalState());
  });
});

class VirtualVault implements LinkIndexPort {
  private readonly linksByPath = new Map<string, readonly string[]>();
  private readonly modifiedAtByPath = new Map<string, number>();
  private clock = 0;
  public buildCount = 0;
  public listFilesCallCount = 0;
  public getFileRecordCallCount = 0;

  public constructor(initial: Readonly<Record<string, readonly string[]>>) {
    for (const [path, links] of Object.entries(initial)) this.create(path, links);
  }

  public listFiles = async (): Promise<readonly FileRecord[]> => {
    this.listFilesCallCount += 1;
    return this.currentFileRecords();
  };

  public getFileRecord = async (path: string): Promise<FileRecord | null> => {
    this.getFileRecordCallCount += 1;
    return this.linksByPath.has(path) ? this.fileRecord(path) : null;
  };

  public buildSourceSnapshot = async (sourcePath: string): Promise<SourceSnapshot | null> => {
    this.buildCount += 1;
    const links = this.linksByPath.get(sourcePath);
    if (links === undefined) return null;
    const files = this.currentFileRecords();
    const occurrences = links.map((linkpath, index) => {
      const lookupKey = makeOccurrenceLookupKey(linkpath, sourcePath);
      const targets = files.filter(({ lookupKeys }) => lookupKeys.includes(lookupKey));
      const targetPath = targets[0]?.path ?? null;
      return occurrence(`${sourcePath}:${index}`, sourcePath, {
        linkpath,
        lookupKey,
        targetPath,
        fileStatus: targetPath === null ? "missing" : "resolved",
      });
    });
    return snapshot(sourcePath, occurrences);
  };

  public create(path: string, links: readonly string[]): void {
    this.linksByPath.set(path, [...links]);
    this.modifiedAtByPath.set(path, ++this.clock);
  }

  public setLinks(path: string, links: readonly string[]): void {
    if (!this.linksByPath.has(path)) throw new Error(`Missing virtual file: ${path}`);
    this.linksByPath.set(path, [...links]);
    this.modifiedAtByPath.set(path, ++this.clock);
  }

  public delete(path: string): void {
    this.linksByPath.delete(path);
    this.modifiedAtByPath.delete(path);
  }

  public rename(oldPath: string, path: string): void {
    const links = this.linksByPath.get(oldPath);
    if (links === undefined) throw new Error(`Missing virtual file: ${oldPath}`);
    const modifiedAt = this.modifiedAtByPath.get(oldPath) ?? ++this.clock;
    this.linksByPath.delete(oldPath);
    this.modifiedAtByPath.delete(oldPath);
    this.linksByPath.set(path, links);
    this.modifiedAtByPath.set(path, modifiedAt);
  }

  public paths(): readonly string[] {
    return Array.from(this.linksByPath.keys());
  }

  private currentFileRecords(): readonly FileRecord[] {
    return Array.from(this.linksByPath.keys()).sort().map((path) => this.fileRecord(path));
  }

  private fileRecord(path: string): FileRecord {
    return createFileRecord(path, { modifiedAt: this.modifiedAtByPath.get(path) ?? 0 });
  }
}

async function buildOracle(
  vault: LinkIndexPort,
  contributionPolicy?: GraphContributionPolicy,
): Promise<LinkIndex> {
  const store = new AtomicLinkIndexStore(new LinkIndex([], contributionPolicy === undefined
    ? {}
    : { contributionPolicy }));
  await new FullRebuildController(vault, store, { concurrency: 3 }).rebuild();
  return store.current;
}

function mutateRandomly(
  vault: VirtualVault,
  random: () => number,
  step: number,
): SourceEvent {
  const paths = vault.paths();
  const operation = Math.floor(random() * 4);
  if (operation === 0 || paths.length === 0) {
    const path = `Generated-${step}.md`;
    vault.create(path, randomLinks(vault.paths(), random));
    return { type: "create", path };
  }
  const selected = paths[Math.floor(random() * paths.length)]!;
  if (operation === 1) {
    vault.setLinks(selected, randomLinks(paths, random));
    return { type: "modify", path: selected };
  }
  if (operation === 2 && paths.length > 1) {
    vault.delete(selected);
    return { type: "delete", path: selected };
  }
  const path = `Renamed-${step}.md`;
  vault.rename(selected, path);
  return { type: "rename", oldPath: selected, path };
}

function randomLinks(paths: readonly string[], random: () => number): readonly string[] {
  const count = Math.floor(random() * 4);
  return Array.from({ length: count }, (_, index) => {
    if (paths.length === 0 || random() < 0.3) return `Missing-${index}`;
    const target = paths[Math.floor(random() * paths.length)]!;
    return target.replace(/\.md$/u, "");
  });
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
