import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import esbuild from "esbuild";

import { measureBundleBudget } from "./bundle-budget.mjs";
import { createEsbuildOptions } from "./esbuild-options.mjs";

export async function checkProductionBundle(projectRoot = process.cwd()) {
  const fromRoot = (...segments) => path.join(projectRoot, ...segments);
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

  return measureBundleBudget(bundledMain.length);
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (import.meta.url === entryPoint) {
  const bundle = await checkProductionBundle();
  process.stdout.write(
    `Production bundle check passed; bundle=${bundle.actualBytes} ` +
    `reference=${bundle.referenceBytes} budget=${bundle.maximumBytes}.\n`,
  );
}
