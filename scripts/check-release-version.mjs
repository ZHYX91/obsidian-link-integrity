import { readFile } from "node:fs/promises";

import {
  assertPackageLockContract,
  assertPackageVersionContract,
  assertReleaseTag,
} from "./release-contract.mjs";

const requested = process.argv[2];
if (requested === undefined) {
  throw new Error("Usage: node scripts/check-release-version.mjs <x.y.z>");
}

const [manifest, packageJson, packageLock, versions] = await Promise.all([
  readFile("manifest.json", "utf8").then(JSON.parse),
  readFile("package.json", "utf8").then(JSON.parse),
  readFile("package-lock.json", "utf8").then(JSON.parse),
  readFile("versions.json", "utf8").then(JSON.parse),
]);
const version = assertPackageVersionContract(manifest, packageJson, versions);
assertPackageLockContract(packageJson, packageLock);
assertReleaseTag(requested, version);
process.stdout.write(`Release version contract passed for ${version}.\n`);
