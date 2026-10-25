import { copyFile, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-ignore Plain JavaScript release tooling is exercised directly by Vitest.
import * as staticAssetsSource from "../../scripts/static-assets.mjs";

interface StaticAssetsModule {
  STATIC_ASSETS: readonly string[];
  syncStaticAssets(options: {
    outputDirectory: string;
    projectRoot: string;
  }): Promise<void>;
  createStaticAssetSync(options: {
    outputDirectory: string;
    projectRoot: string;
    copy?: (source: string, destination: string) => Promise<void>;
    onError?: (error: unknown) => void;
    retryDelays?: number[];
  }): {
    close(): Promise<void>;
    flush(): Promise<void>;
    schedule(filename: string | Buffer | null): void;
  };
}

const staticAssets = staticAssetsSource as unknown as StaticAssetsModule;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })),
  );
});

describe("static asset synchronization", () => {
  it("owns exactly manifest.json and styles.css and refreshes them byte-for-byte", async () => {
    const root = await createWorkspace();
    const outputDirectory = path.join(root, "dist");
    await writeFile(path.join(root, "manifest.json"), "{\"version\":\"0.1.0\"}\n");
    await writeFile(path.join(root, "styles.css"), ".first {}\n");

    await staticAssets.syncStaticAssets({ outputDirectory, projectRoot: root });
    expect(staticAssets.STATIC_ASSETS).toEqual(["manifest.json", "styles.css"]);
    expect(await readFile(path.join(outputDirectory, "manifest.json"), "utf8")).toBe(
      "{\"version\":\"0.1.0\"}\n",
    );
    expect(await readFile(path.join(outputDirectory, "styles.css"), "utf8")).toBe(
      ".first {}\n",
    );

    await writeFile(path.join(root, "styles.css"), ".second {}\n");
    await staticAssets.syncStaticAssets({ outputDirectory, projectRoot: root });
    expect(await readFile(path.join(outputDirectory, "styles.css"), "utf8")).toBe(
      ".second {}\n",
    );
  });

  it("fails closed when a source asset is absent", async () => {
    const root = await createWorkspace();
    await writeFile(path.join(root, "manifest.json"), "{}\n");
    await expect(staticAssets.syncStaticAssets({
      outputDirectory: path.join(root, "dist"),
      projectRoot: root,
    })).rejects.toThrow();
  });

  it("does not share temporary files between simultaneous synchronizations", async () => {
    const root = await createWorkspace();
    const outputDirectory = path.join(root, "dist");
    await writeFile(path.join(root, "manifest.json"), "{}\n");
    await writeFile(path.join(root, "styles.css"), ".parallel {}\n");

    await Promise.all(Array.from({ length: 8 }, () =>
      staticAssets.syncStaticAssets({ outputDirectory, projectRoot: root })));

    expect(await readFile(path.join(outputDirectory, "styles.css"), "utf8")).toBe(
      ".parallel {}\n",
    );
    expect((await readdir(outputDirectory)).sort()).toEqual(["manifest.json", "styles.css"]);
  });

  it("coalesces saves in order and waits for the final accepted contents on close", async () => {
    const root = await createWorkspace();
    const outputDirectory = path.join(root, "dist");
    await writeFile(path.join(root, "manifest.json"), "{\"version\":\"1\"}\n");
    await writeFile(path.join(root, "styles.css"), ".first {}\n");
    const started = deferred();
    const release = deferred();
    const copies = new Map<string, number>();
    let activeCssCopies = 0;
    let maximumCssCopies = 0;
    const sync = staticAssets.createStaticAssetSync({
      outputDirectory,
      projectRoot: root,
      copy: async (source, destination) => {
        const asset = path.basename(source);
        const count = (copies.get(asset) ?? 0) + 1;
        copies.set(asset, count);
        const content = await readFile(source);
        if (asset === "styles.css") {
          maximumCssCopies = Math.max(maximumCssCopies, ++activeCssCopies);
          if (count === 1) {
            started.resolve();
            await release.promise;
          }
        }
        await writeFile(destination, content);
        if (asset === "styles.css") activeCssCopies -= 1;
      },
    });

    sync.schedule("styles.css");
    await started.promise;
    await writeFile(path.join(root, "manifest.json"), "{\"version\":\"2\"}\n");
    await writeFile(path.join(root, "styles.css.next"), ".last {}\n");
    await rename(path.join(root, "styles.css.next"), path.join(root, "styles.css"));
    sync.schedule("manifest.json");
    sync.schedule(Buffer.from("styles.css"));
    sync.schedule(null);
    sync.schedule("unrelated.txt");
    let closed = false;
    const closing = sync.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release.resolve();
    await closing;

    expect(maximumCssCopies).toBe(1);
    expect([...copies.values()]).toEqual([2, 2]);
    expect(await readFile(path.join(outputDirectory, "manifest.json"), "utf8")).toBe(
      "{\"version\":\"2\"}\n",
    );
    expect(await readFile(path.join(outputDirectory, "styles.css"), "utf8")).toBe(".last {}\n");
    await writeFile(path.join(root, "styles.css"), ".after-close {}\n");
    sync.schedule("styles.css");
    await sync.flush();
    expect(await readFile(path.join(outputDirectory, "styles.css"), "utf8")).toBe(".last {}\n");
    expect((await readdir(outputDirectory)).sort()).toEqual(["manifest.json", "styles.css"]);
  });

  it("retries a temporarily missing asset during an editor save", async () => {
    const root = await createWorkspace();
    const outputDirectory = path.join(root, "dist");
    await writeFile(path.join(root, "manifest.json"), "{}\n");
    await writeFile(path.join(root, "styles.css"), ".before {}\n");
    const onError = vi.fn();
    let firstCssCopy = true;
    const sync = staticAssets.createStaticAssetSync({
      outputDirectory,
      projectRoot: root,
      retryDelays: [0],
      onError,
      copy: async (source, destination) => {
        if (path.basename(source) === "styles.css" && firstCssCopy) {
          firstCssCopy = false;
          await rename(source, `${source}.old`);
          try {
            await copyFile(source, destination);
          } finally {
            await writeFile(source, ".saved {}\n");
          }
          return;
        }
        await copyFile(source, destination);
      },
    });

    sync.schedule("styles.css");
    await sync.close();
    expect(onError).not.toHaveBeenCalled();
    expect(await readFile(path.join(outputDirectory, "styles.css"), "utf8")).toBe(".saved {}\n");
    expect((await readdir(outputDirectory)).sort()).toEqual(["manifest.json", "styles.css"]);
  });

  it("reports a completed watch failure and continues syncing later saves", async () => {
    const root = await createWorkspace();
    const outputDirectory = path.join(root, "dist");
    await writeFile(path.join(root, "manifest.json"), "{}\n");
    const reported = deferred();
    const onError = vi.fn(() => reported.resolve());
    const sync = staticAssets.createStaticAssetSync({
      outputDirectory,
      projectRoot: root,
      retryDelays: [],
      onError,
    });
    sync.schedule(null);
    await reported.promise;
    await expect(sync.flush()).rejects.toThrow("Failed to synchronize static assets");
    expect(onError).toHaveBeenCalledOnce();

    await writeFile(path.join(root, "styles.css"), ".recovered {}\n");
    sync.schedule("styles.css");
    await expect(sync.close()).resolves.toBeUndefined();
    expect(await readFile(path.join(outputDirectory, "styles.css"), "utf8")).toBe(
      ".recovered {}\n",
    );
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "link-integrity-static-"));
  temporaryDirectories.push(root);
  return root;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}
