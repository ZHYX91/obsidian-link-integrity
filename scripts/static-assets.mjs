import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

export const STATIC_ASSETS = Object.freeze(["manifest.json", "styles.css"]);
const synchronizations = new Map();

export async function syncStaticAssets({
  projectRoot = process.cwd(),
  outputDirectory = path.join(projectRoot, "dist"),
  copy = copyFile,
} = {}) {
  const outputKey = path.resolve(outputDirectory);
  const previous = synchronizations.get(outputKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => syncOnce({
    projectRoot,
    outputDirectory,
    copy,
  }));
  synchronizations.set(outputKey, next);
  try {
    await next;
  } finally {
    if (synchronizations.get(outputKey) === next) synchronizations.delete(outputKey);
  }
}

async function syncOnce({ projectRoot, outputDirectory, copy }) {
  const sources = await Promise.all(STATIC_ASSETS.map(async (asset) => {
    const source = path.join(projectRoot, asset);
    const sourceStats = await lstat(source);
    if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
      throw new Error(`Static asset must be a regular file: ${asset}`);
    }
    return { asset, source };
  }));
  await mkdir(outputDirectory, { recursive: true });
  const results = await Promise.allSettled(sources.map(async ({ asset, source }) => {
    const destination = path.join(outputDirectory, asset);
    const temporary = `${destination}.link-integrity-${process.pid}-${randomUUID()}.tmp`;
    try {
      await copy(source, temporary);
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }));
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}

export function createStaticAssetSync({
  onError = (error) => console.error("Failed to synchronize static assets", error),
  retryDelays = [25, 75, 150],
  ...options
} = {}) {
  const errors = [];
  let pending = false;
  let closed = false;
  let running;

  async function drain() {
    while (pending) {
      pending = false;
      try {
        for (let attempt = 0; ; attempt += 1) {
          try {
            await syncStaticAssets(options);
            break;
          } catch (error) {
            if (error?.code !== "ENOENT" || attempt >= retryDelays.length) throw error;
            await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
          }
        }
      } catch (error) {
        errors.push(error);
        try {
          onError(error);
        } catch (reportError) {
          errors.push(reportError);
        }
      }
    }
  }

  function schedule(filename) {
    if (closed || (filename != null && !STATIC_ASSETS.includes(filename.toString()))) return;
    pending = true;
    if (!running) start();
  }

  function start() {
    running = drain().finally(() => {
      running = undefined;
      if (pending) start();
    });
  }

  async function flush() {
    while (running) await running;
    if (errors.length > 0) {
      throw new AggregateError(errors.splice(0), "Failed to synchronize static assets");
    }
  }

  async function close() {
    closed = true;
    await flush();
  }

  return { close, flush, schedule };
}
