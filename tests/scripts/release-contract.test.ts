import { describe, expect, it } from "vitest";
// @ts-ignore Plain JavaScript release tooling is exercised directly by Vitest.
import * as releaseContractSource from "../../scripts/release-contract.mjs";

interface ReleaseContractModule {
  assertPackageLockContract(packageJson: unknown, packageLock: unknown): void;
  assertPackageVersionContract(manifest: unknown, packageJson: unknown, versions: unknown): string;
  assertReleaseTag(tag: string, version: string): void;
  assertReleaseVersion(value: unknown): string;
}

const releaseContract = releaseContractSource as unknown as ReleaseContractModule;

const manifest = {
  id: "link-integrity",
  isDesktopOnly: false,
  minAppVersion: "1.12.7",
  name: "Link Integrity",
  version: "0.1.0",
};
const packageJson = {
  engines: { node: "24.19.0" },
  name: "obsidian-link-integrity",
  version: "0.1.0",
};
const packageLock = {
  name: "obsidian-link-integrity",
  packages: {
    "": {
      engines: { node: "24.19.0" },
      name: "obsidian-link-integrity",
      version: "0.1.0",
    },
  },
  version: "0.1.0",
};

describe("release contract", () => {
  it("binds package, lockfile, manifest, versions, identity, and mobile support", () => {
    expect(releaseContract.assertPackageVersionContract(
      manifest,
      packageJson,
      { "0.1.0": "1.12.7" },
    )).toBe("0.1.0");
    expect(() => releaseContract.assertPackageLockContract(packageJson, packageLock)).not.toThrow();
    expect(() => releaseContract.assertPackageVersionContract(
      { ...manifest, isDesktopOnly: true },
      packageJson,
      { "0.1.0": "1.12.7" },
    )).toThrow("desktop and mobile boundary");
    expect(() => releaseContract.assertPackageLockContract(
      packageJson,
      {
        ...packageLock,
        packages: {
          "": {
            ...packageLock.packages[""],
            version: "0.1.1",
          },
        },
      },
    )).toThrow("root package");
  });

  it.each(["v0.1.0", "00.1.0", "0.01.0", "0.1", "latest"])(
    "rejects non-canonical version %s",
    (version) => {
      expect(() => releaseContract.assertReleaseVersion(version)).toThrow(
        "without a v prefix or leading zeroes",
      );
    },
  );

  it("requires the numeric tag to equal the package version", () => {
    expect(() => releaseContract.assertReleaseTag("0.1.0", "0.1.0")).not.toThrow();
    expect(() => releaseContract.assertReleaseTag("0.1.1", "0.1.0")).toThrow(
      "does not match package version",
    );
  });
});
