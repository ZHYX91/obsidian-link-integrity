import { watch } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

import esbuild from "esbuild";

import { createEsbuildOptions } from "./scripts/esbuild-options.mjs";
import { STATIC_ASSETS, syncStaticAssets } from "./scripts/static-assets.mjs";

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
  const watcher = watch(projectRoot, (_event, filename) => {
    if (filename != null && STATIC_ASSETS.includes(filename.toString())) {
      void syncStaticAssets({ projectRoot, outputDirectory });
    }
  });
  const shutdown = async () => {
    watcher.close();
    await context.dispose();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  process.stdout.write("Watching TypeScript and static assets for changes...\n");
}
