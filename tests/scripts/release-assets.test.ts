import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-ignore Plain JavaScript release tooling is exercised directly by Vitest.
import * as releaseAssetsSource from "../../scripts/release-assets.mjs";

interface ReleaseAssetsModule {
  buildReleaseArchive(options: {
    distDirectory: string;
    outputPath: string;
    version: string;
  }): Promise<{ outputPath: string; sha256: string; version: string }>;
  createDeterministicZip(
    entries: Array<{ content: Buffer | string; name: string }>,
  ): Buffer;
  handoffAssetNames(version: string): readonly string[];
  prepareReleaseHandoff(options: {
    distDirectory: string;
    outputDirectory: string;
    version: string;
  }): Promise<{ directory: string; publicAssetNames: readonly string[]; version: string }>;
  publicReleaseAssetNames(version: string): readonly string[];
  verifyReleaseHandoff(options: {
    directory: string;
    version: string;
  }): Promise<{ publicAssetNames: readonly string[]; version: string }>;
}

const releaseAssets = releaseAssetsSource as unknown as ReleaseAssetsModule;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })),
  );
});

describe("deterministic Release archive", () => {
  it("is order-independent and rejects duplicate or unsafe paths", () => {
    const entries = [
      { content: "styles", name: "link-integrity/styles.css" },
      { content: "main", name: "link-integrity/main.js" },
      { content: "manifest", name: "link-integrity/manifest.json" },
    ];
    const first = releaseAssets.createDeterministicZip(entries);
    const second = releaseAssets.createDeterministicZip([...entries].reverse());
    expect(first.equals(second)).toBe(true);
    expect(readStoredZipNames(first)).toEqual([
      "link-integrity/main.js",
      "link-integrity/manifest.json",
      "link-integrity/styles.css",
    ]);
    expect(() => releaseAssets.createDeterministicZip([
      { content: "a", name: "same" },
      { content: "b", name: "same" },
    ])).toThrow("unique");
    expect(() => releaseAssets.createDeterministicZip([
      { content: "a", name: "../outside" },
    ])).toThrow("Unsafe ZIP entry name");
  });

  it("builds byte-identical archives from the same exact dist", async () => {
    const root = await createWorkspace();
    const dist = await createDist(root);
    const firstPath = path.join(root, "first.zip");
    const secondPath = path.join(root, "second.zip");
    const first = await releaseAssets.buildReleaseArchive({
      distDirectory: dist,
      outputPath: firstPath,
      version: "0.1.0",
    });
    const second = await releaseAssets.buildReleaseArchive({
      distDirectory: dist,
      outputPath: secondPath,
      version: "0.1.0",
    });
    expect(first.sha256).toBe(second.sha256);
    expect((await readFile(firstPath)).equals(await readFile(secondPath))).toBe(true);
  });
});

describe("Release candidate handoff", () => {
  it("contains four public assets plus handoff-only checksums and binds ZIP bytes", async () => {
    const root = await createWorkspace();
    const dist = await createDist(root);
    const handoff = path.join(root, "handoff");
    const result = await releaseAssets.prepareReleaseHandoff({
      distDirectory: dist,
      outputDirectory: handoff,
      version: "0.1.0",
    });

    expect(result.publicAssetNames).toEqual([
      "link-integrity-0.1.0.zip",
      "main.js",
      "manifest.json",
      "styles.css",
    ]);
    expect((await readdir(handoff)).sort()).toEqual(
      releaseAssets.handoffAssetNames("0.1.0"),
    );
    expect(releaseAssets.publicReleaseAssetNames("0.1.0")).not.toContain(
      "SHA256SUMS",
    );
    await expect(releaseAssets.verifyReleaseHandoff({
      directory: handoff,
      version: "0.1.0",
    })).resolves.toMatchObject({ version: "0.1.0" });

    await writeFile(path.join(handoff, "main.js"), "tampered");
    await expect(releaseAssets.verifyReleaseHandoff({
      directory: handoff,
      version: "0.1.0",
    })).rejects.toThrow("checksum mismatch");
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "link-integrity-release-"));
  temporaryDirectories.push(root);
  return root;
}

async function createDist(root: string): Promise<string> {
  const dist = path.join(root, "dist");
  await mkdir(dist);
  await writeFile(path.join(dist, "main.js"), "module.exports = {};\n");
  await writeFile(
    path.join(dist, "manifest.json"),
    JSON.stringify({
      id: "link-integrity",
      isDesktopOnly: false,
      name: "Link Integrity",
      version: "0.1.0",
    }),
  );
  await writeFile(path.join(dist, "styles.css"), ".link-integrity {}\n");
  return dist;
}

function readStoredZipNames(zip: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    names.push(zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}
