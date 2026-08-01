import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

const INCLUDED_EXTENSIONS = new Set([
  ".css",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".ts",
  ".yaml",
  ".yml",
]);
const INCLUDED_NAMES = new Set([".gitignore", ".node-version", "LICENSE"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "release",
]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export async function checkFormatting(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const files = await collectTextFiles(root);
  const failures = [];
  for (const filePath of files) {
    const relativePath = path.relative(root, filePath).replaceAll("\\", "/");
    let source;
    try {
      source = UTF8_DECODER.decode(await readFile(filePath));
    } catch {
      failures.push(`${relativePath}: not valid UTF-8`);
      continue;
    }
    if (source.startsWith("\uFEFF")) failures.push(`${relativePath}: UTF-8 BOM is forbidden`);
    if (source.includes("\r")) failures.push(`${relativePath}: line endings must be LF`);
    if (!source.endsWith("\n")) failures.push(`${relativePath}: final newline is required`);
    if (/[ \t]+$/mu.test(source)) failures.push(`${relativePath}: trailing whitespace is forbidden`);
    if (path.extname(filePath) === ".json") {
      try {
        JSON.parse(source);
        const lines = source.split("\n").slice(0, -1);
        if (
          lines.length < 2 ||
          lines.some((line) => line.includes("\t") || (/^ */u.exec(line)?.[0].length ?? 0) % 2 !== 0) ||
          lines.some((line) => /"\s*:\S/u.test(line))
        ) {
          failures.push(`${relativePath}: JSON must use readable 2-space indentation`);
        }
      } catch {
        failures.push(`${relativePath}: invalid JSON`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Format check failed:\n- ${failures.join("\n- ")}`);
  }
  return files.length;
}

async function collectTextFiles(root) {
  const result = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Format input must not be a symbolic link: ${entryPath}`);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(entryPath);
      } else if (
        entry.isFile() &&
        (INCLUDED_NAMES.has(entry.name) || INCLUDED_EXTENSIONS.has(path.extname(entry.name)))
      ) {
        result.push(entryPath);
      }
    }
  }
  await visit(root);
  return result.sort((left, right) => left.localeCompare(right, "en"));
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (import.meta.url === entryPoint) {
  const count = await checkFormatting();
  process.stdout.write(`Format check passed for ${count} text files.\n`);
}
