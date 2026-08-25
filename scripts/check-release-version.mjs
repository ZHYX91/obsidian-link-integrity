import { readFile } from "node:fs/promises";

import { assertLocalTagPointsToHead } from "./local-tag-contract.mjs";
import {
  assertPackageLockContract,
  assertPackageVersionContract,
  assertReleaseTag,
} from "./release-contract.mjs";

const [manifest, packageJson, packageLock, versions] = await Promise.all([
  readFile("manifest.json", "utf8").then(JSON.parse),
  readFile("package.json", "utf8").then(JSON.parse),
  readFile("package-lock.json", "utf8").then(JSON.parse),
  readFile("versions.json", "utf8").then(JSON.parse),
]);
const version = assertPackageVersionContract(manifest, packageJson, versions);
const requested = process.argv[2] ?? version;
assertPackageLockContract(packageJson, packageLock);
assertReleaseTag(requested, version);
await assertLocalTagPointsToHead(requested);
process.stdout.write(`Release version contract passed for ${version}.\n`);
