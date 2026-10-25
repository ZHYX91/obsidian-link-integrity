import { watch } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

import esbuild from "esbuild";

import { createEsbuildOptions } from "./scripts/esbuild-options.mjs";
import { createStaticAssetSync, syncStaticAssets } from "./scripts/static-assets.mjs";

const production = process.argv.includes("production");
const projectRoot = process.cwd();
const outputDirectory = path.join(projectRoot, "dist");
const context = await esbuild.context(createEsbuildOptions({ production, projectRoot }));

if (production) {
  await rm(outputDirectory, { recursive: true, force: true });
  await context.rebuild();
  await syncStaticAssets({ projectRoot, outputDirectory });
  await context.dispose();
} else {
  await syncStaticAssets({ projectRoot, outputDirectory });
  await context.watch();
  const assetSync = createStaticAssetSync({ projectRoot, outputDirectory });
  const watcher = watch(projectRoot, (_event, filename) => {
    assetSync.schedule(filename);
  });
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    watcher.close();
    let exitCode = 0;
    try {
      await assetSync.close();
    } catch (error) {
      console.error("Failed to flush static assets during shutdown", error);
      exitCode = 1;
    }
    try {
      await context.dispose();
    } catch (error) {
      console.error("Failed to dispose the esbuild context", error);
      exitCode = 1;
    }
    process.exit(exitCode);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  process.stdout.write("Watching TypeScript and static assets for changes...\n");
}
