import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import esbuild from "esbuild";

import { measureBundleBudget } from "./bundle-budget.mjs";
import { createEsbuildOptions } from "./esbuild-options.mjs";
import {
  assertPackageLockContract,
  assertPackageVersionContract,
} from "./release-contract.mjs";
import { LOOSE_RELEASE_ASSET_NAMES } from "./release-assets.mjs";

const EXPECTED_ASSETS = LOOSE_RELEASE_ASSET_NAMES;

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function checkRelease(projectRoot = process.cwd()) {
  const fromRoot = (...segments) => path.join(projectRoot, ...segments);
  const [packageJson, manifest, packageLock, versions] = await Promise.all([
    readJson(fromRoot("package.json")),
    readJson(fromRoot("manifest.json")),
    readJson(fromRoot("package-lock.json")),
    readJson(fromRoot("versions.json")),
  ]);
  const version = assertPackageVersionContract(manifest, packageJson, versions);
  assertPackageLockContract(packageJson, packageLock);

  const entries = await readdir(fromRoot("dist"), { withFileTypes: true });
  const actualNames = entries.map(({ name }) => name).sort();
  if (!isDeepStrictEqual(actualNames, [...EXPECTED_ASSETS].sort())) {
    throw new Error(`dist must contain exactly ${EXPECTED_ASSETS.join(", ")}`);
  }
  await Promise.all(entries.map(async (entry) => {
    const fileStats = await lstat(fromRoot("dist", entry.name));
    if (!entry.isFile() || fileStats.isSymbolicLink() || fileStats.size === 0) {
      throw new Error(`Release asset must be a non-empty regular file: ${entry.name}`);
    }
  }));

  const [bundledMain, sourceManifest, bundledManifest, sourceStyles, bundledStyles, expectedBuild] =
    await Promise.all([
      readFile(fromRoot("dist", "main.js")),
      readFile(fromRoot("manifest.json")),
      readFile(fromRoot("dist", "manifest.json")),
      readFile(fromRoot("styles.css")),
      readFile(fromRoot("dist", "styles.css")),
      esbuild.build({
        ...createEsbuildOptions({ production: true, projectRoot }),
        logLevel: "silent",
        write: false,
      }),
    ]);
  if (
    expectedBuild.outputFiles.length !== 1 ||
    !isDeepStrictEqual(bundledMain, Buffer.from(expectedBuild.outputFiles[0].contents))
  ) {
    throw new Error("dist/main.js is stale; run npm run build:bundle");
  }
  if (!isDeepStrictEqual(bundledManifest, sourceManifest)) {
    throw new Error("dist/manifest.json is stale");
  }
  if (!isDeepStrictEqual(bundledStyles, sourceStyles)) {
    throw new Error("dist/styles.css is stale");
  }
  const bundle = measureBundleBudget(bundledMain.length);
  return { bundle, id: manifest.id, version };
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (import.meta.url === entryPoint) {
  const result = await checkRelease();
  process.stdout.write(
    `Release check passed for ${result.id} ${result.version}; ` +
    `bundle=${result.bundle.actualBytes} reference=${result.bundle.referenceBytes} ` +
    `budget=${result.bundle.maximumBytes}.\n`,
  );
}
