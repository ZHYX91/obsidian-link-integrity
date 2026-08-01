import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-ignore Plain JavaScript release tooling is exercised directly by Vitest.
import * as staticAssetsSource from "../../scripts/static-assets.mjs";

interface StaticAssetsModule {
  STATIC_ASSETS: readonly string[];
  syncStaticAssets(options: {
    outputDirectory: string;
    projectRoot: string;
  }): Promise<void>;
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
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "link-integrity-static-"));
  temporaryDirectories.push(root);
  return root;
}
