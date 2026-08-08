import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assertReleaseVersion } from "./release-contract.mjs";

export const PLUGIN_ID = "link-integrity";
export const LOOSE_RELEASE_ASSET_NAMES = Object.freeze([
  "main.js",
  "manifest.json",
  "styles.css",
]);
export const RELEASE_CHECKSUM_ASSET = "SHA256SUMS";

const ZIP_DOS_DATE = 0x0021;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_UNIX_FILE_MODE = 0o100644;
const ZIP_VERSION = 20;
const ZIP_VERSION_MADE_BY_UNIX = (3 << 8) | ZIP_VERSION;
const CRC32_TABLE = createCrc32Table();

export function releaseArchiveName(version) {
  assertReleaseVersion(version);
  return `${PLUGIN_ID}-${version}.zip`;
}

export function publicReleaseAssetNames(version) {
  return Object.freeze([
    ...LOOSE_RELEASE_ASSET_NAMES,
    releaseArchiveName(version),
  ].sort());
}

export function handoffAssetNames(version) {
  return Object.freeze([
    ...publicReleaseAssetNames(version),
    RELEASE_CHECKSUM_ASSET,
  ].sort());
}

export async function buildReleaseArchive({
  distDirectory = "dist",
  outputPath,
  version,
} = {}) {
  const distRoot = path.resolve(distDirectory);
  const assets = await readDistributionAssets(distRoot, version);
  const archive = createReleaseArchive(assets);
  const resolvedOutputPath = path.resolve(
    outputPath ?? path.join(path.dirname(distRoot), "release", releaseArchiveName(assets.version)),
  );
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, archive, { mode: 0o644 });
  return {
    outputPath: resolvedOutputPath,
    sha256: hashSha256(archive),
    version: assets.version,
  };
}

export async function prepareReleaseHandoff({
  distDirectory = "dist",
  outputDirectory,
  version,
} = {}) {
  if (typeof outputDirectory !== "string" || outputDirectory.length === 0) {
    throw new Error("A new handoff output directory is required");
  }
  const distRoot = path.resolve(distDirectory);
  const outputRoot = path.resolve(outputDirectory);
  if (outputRoot === distRoot) {
    throw new Error("Release handoff directory must be separate from dist");
  }
  await assertPathDoesNotExist(outputRoot, "Release handoff directory");

  const assets = await readDistributionAssets(distRoot, version);
  const archiveName = releaseArchiveName(assets.version);
  const publicAssets = new Map(assets.files);
  publicAssets.set(archiveName, createReleaseArchive(assets));
  const expectedPublicNames = publicReleaseAssetNames(assets.version);

  await mkdir(outputRoot, { recursive: false });
  try {
    for (const name of expectedPublicNames) {
      await writeFile(path.join(outputRoot, name), publicAssets.get(name), { mode: 0o644 });
    }
    const checksums = expectedPublicNames
      .map((name) => `${hashSha256(publicAssets.get(name))}  ${name}`)
      .join("\n");
    await writeFile(
      path.join(outputRoot, RELEASE_CHECKSUM_ASSET),
      `${checksums}\n`,
      { encoding: "utf8", mode: 0o644 },
    );
    await verifyReleaseHandoff({ directory: outputRoot, version: assets.version });
  } catch (error) {
    await rm(outputRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    directory: outputRoot,
    publicAssetNames: expectedPublicNames,
    version: assets.version,
  };
}

export async function verifyReleaseHandoff({ directory, version }) {
  assertReleaseVersion(version);
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("Release handoff directory is required");
  }
  const root = path.resolve(directory);
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`Release handoff root must be a regular directory: ${root}`);
  }
  const entries = await readdir(root, { withFileTypes: true });
  assertExactNames(
    entries.map(({ name }) => name).sort(),
    handoffAssetNames(version),
    "Release handoff asset inventory",
  );
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Release handoff asset must be a regular file: ${entry.name}`);
    }
  }

  const expectedPublicNames = publicReleaseAssetNames(version);
  const checksumSource = await readRegularFile(
    path.join(root, RELEASE_CHECKSUM_ASSET),
    "Release handoff checksums",
  );
  const expectedHashes = parseChecksums(checksumSource.toString("utf8"), expectedPublicNames);
  const publicFiles = new Map();
  for (const name of expectedPublicNames) {
    const content = await readRegularFile(path.join(root, name), `Release handoff asset ${name}`);
    publicFiles.set(name, content);
    if (hashSha256(content) !== expectedHashes.get(name)) {
      throw new Error(`Release handoff checksum mismatch: ${name}`);
    }
  }
  const manifest = parseJson(
    await readFile(path.join(root, "manifest.json")),
    "Release handoff manifest",
  );
  assertManifestIdentity(manifest, version);
  const expectedArchive = createDeterministicZip(
    LOOSE_RELEASE_ASSET_NAMES.map((name) => ({
      content: publicFiles.get(name),
      name: `${PLUGIN_ID}/${name}`,
    })),
  );
  const archiveName = releaseArchiveName(version);
  if (!expectedArchive.equals(publicFiles.get(archiveName))) {
    throw new Error("Release archive is not the byte-exact deterministic wrapper of the loose assets");
  }
  return { publicAssetNames: expectedPublicNames, version };
}

export function createDeterministicZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("ZIP must contain at least one entry");
  }
  if (entries.length > 0xffff) {
    throw new Error("ZIP entry count exceeds the deterministic ZIP32 contract");
  }
  const ordered = entries
    .map(({ name, content }) => ({
      content: Buffer.from(content),
      name: normalizeArchiveName(name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  if (new Set(ordered.map(({ name }) => name)).size !== ordered.length) {
    throw new Error("ZIP entry names must be unique");
  }

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of ordered) {
    const fileName = Buffer.from(entry.name, "utf8");
    const content = entry.content;
    assertZip32Size(fileName.length, `Archive path ${entry.name}`);
    assertZip32Size(content.length, `Archive asset ${entry.name}`);
    const checksum = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(ZIP_VERSION, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(ZIP_DOS_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, fileName, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(ZIP_VERSION_MADE_BY_UNIX, 4);
    centralHeader.writeUInt16LE(ZIP_VERSION, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(ZIP_DOS_DATE, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((ZIP_UNIX_FILE_MODE << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, fileName);

    localOffset += localHeader.length + fileName.length + content.length;
    assertZip32Size(localOffset, "Archive local data");
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(ordered.length, 8);
  end.writeUInt16LE(ordered.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function hashSha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function readDistributionAssets(distRoot, requestedVersion) {
  const entries = await readdir(distRoot, { withFileTypes: true });
  assertExactNames(
    entries.map(({ name }) => name).sort(),
    [...LOOSE_RELEASE_ASSET_NAMES].sort(),
    "dist asset inventory",
  );
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`dist asset must be a regular file: ${entry.name}`);
    }
  }
  const files = new Map();
  for (const name of LOOSE_RELEASE_ASSET_NAMES) {
    files.set(name, await readRegularFile(path.join(distRoot, name), `Release asset ${name}`));
  }
  const manifest = parseJson(files.get("manifest.json"), "Release manifest");
  const version = requestedVersion ?? manifest?.version;
  assertReleaseVersion(version);
  assertManifestIdentity(manifest, version);
  return { files, version };
}

function createReleaseArchive(assets) {
  return createDeterministicZip(
    LOOSE_RELEASE_ASSET_NAMES.map((name) => ({
      content: assets.files.get(name),
      name: `${PLUGIN_ID}/${name}`,
    })),
  );
}

function assertManifestIdentity(manifest, version) {
  if (manifest?.id !== PLUGIN_ID || manifest?.version !== version) {
    throw new Error("Release manifest identity and version must match the candidate");
  }
}

function parseChecksums(source, expectedNames) {
  if (!source.endsWith("\n")) {
    throw new Error("SHA256SUMS must end with a newline");
  }
  const result = new Map();
  for (const line of source.slice(0, -1).split("\n")) {
    const match = /^([0-9a-f]{64}) {2}([^/\\]+)$/u.exec(line);
    if (!match || result.has(match[2])) {
      throw new Error(`Invalid SHA256SUMS entry: ${line}`);
    }
    result.set(match[2], match[1]);
  }
  assertExactNames([...result.keys()].sort(), expectedNames, "SHA256SUMS inventory");
  return result;
}

function assertExactNames(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(
      `${label} mismatch: expected=${[...expected].sort().join(",")} actual=${actual.join(",")}`,
    );
  }
}

async function readRegularFile(filePath, label) {
  let stats;
  try {
    stats = await lstat(filePath);
  } catch (error) {
    throw new Error(`${label} is missing: ${filePath}`, { cause: error });
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size === 0) {
    throw new Error(`${label} must be a non-empty regular file: ${filePath}`);
  }
  return readFile(filePath);
}

async function assertPathDoesNotExist(filePath, label) {
  try {
    await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} must not already exist: ${filePath}`);
}

function parseJson(source, label) {
  try {
    return JSON.parse(Buffer.from(source).toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function normalizeArchiveName(value) {
  const name = String(value).replaceAll("\\", "/");
  if (
    name.length === 0 ||
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe ZIP entry name: ${String(value)}`);
  }
  return name;
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(content) {
  let checksum = 0xffffffff;
  for (const byte of content) {
    checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function assertZip32Size(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} exceeds the deterministic ZIP32 contract`);
  }
}

function parseCliArguments(arguments_) {
  const command = arguments_[0];
  const values = new Map();
  for (let index = 1; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name == null || !name.startsWith("--") || value == null || values.has(name)) {
      throw new Error("Release asset options must use unique --name value pairs");
    }
    values.set(name, value);
  }
  return { command, values };
}

function assertAllowedOptions(values, allowed) {
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new Error(`Unknown Release asset option: ${name}`);
  }
}

async function main() {
  const { command, values } = parseCliArguments(process.argv.slice(2));
  if (command === "archive") {
    assertAllowedOptions(values, new Set(["--dist-dir", "--output", "--version"]));
    const result = await buildReleaseArchive({
      distDirectory: values.get("--dist-dir"),
      outputPath: values.get("--output"),
      version: values.get("--version"),
    });
    process.stdout.write(`Deterministic Release archive created: ${result.outputPath}\n`);
    process.stdout.write(`SHA-256: ${result.sha256}\n`);
    return;
  }
  if (command === "handoff") {
    assertAllowedOptions(values, new Set(["--dist-dir", "--output-dir", "--version"]));
    const result = await prepareReleaseHandoff({
      distDirectory: values.get("--dist-dir"),
      outputDirectory: values.get("--output-dir"),
      version: values.get("--version"),
    });
    process.stdout.write(
      `Verified Release handoff created: ${result.directory} (${handoffAssetNames(result.version).join(", ")})\n`,
    );
    return;
  }
  if (command === "verify-handoff") {
    assertAllowedOptions(values, new Set(["--dir", "--version"]));
    const result = await verifyReleaseHandoff({
      directory: values.get("--dir"),
      version: values.get("--version"),
    });
    process.stdout.write(`Release handoff verified for ${result.version}.\n`);
    return;
  }
  throw new Error(
    "Usage: release-assets.mjs <archive|handoff|verify-handoff> [--name value]",
  );
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (import.meta.url === entryPoint) await main();
