import { copyFile, lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

export const STATIC_ASSETS = Object.freeze(["manifest.json", "styles.css"]);

export async function syncStaticAssets({
  projectRoot = process.cwd(),
  outputDirectory = path.join(projectRoot, "dist"),
} = {}) {
  const sources = await Promise.all(STATIC_ASSETS.map(async (asset) => {
    const source = path.join(projectRoot, asset);
    const sourceStats = await lstat(source);
    if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
      throw new Error(`Static asset must be a regular file: ${asset}`);
    }
    return { asset, source };
  }));
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(sources.map(async ({ asset, source }) => {
    const destination = path.join(outputDirectory, asset);
    const temporary = `${destination}.link-integrity-${process.pid}.tmp`;
    try {
      await copyFile(source, temporary);
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }));
}
