import { describe, expect, it } from "vitest";
// @ts-ignore Plain JavaScript release tooling is exercised directly by Vitest.
import * as runtimeContractSource from "../../scripts/runtime-contract.mjs";

interface RuntimeContractModule {
  assertRuntimeContract(options: {
    configuredNodeVersion: string;
    currentNodeVersion: string;
    currentNpmVersion: string;
    packageJson: {
      engines: { node: string };
      packageManager: string;
    };
  }): void;
  parseNpmVersion(userAgent: string | undefined): string;
}

const runtimeContract = runtimeContractSource as unknown as RuntimeContractModule;

const packageJson = {
  engines: { node: "24.19.0" },
  packageManager: "npm@11.17.0",
};

describe("runtime contract", () => {
  it("accepts only the exact pinned Node.js and npm pair", () => {
    expect(() => runtimeContract.assertRuntimeContract({
      configuredNodeVersion: "24.19.0",
      currentNodeVersion: "24.19.0",
      currentNpmVersion: "11.17.0",
      packageJson,
    })).not.toThrow();

    expect(() => runtimeContract.assertRuntimeContract({
      configuredNodeVersion: "24.19.0",
      currentNodeVersion: "24.18.1",
      currentNpmVersion: "11.17.0",
      packageJson,
    })).toThrow("Node.js 24.19.0 is required");

    expect(() => runtimeContract.assertRuntimeContract({
      configuredNodeVersion: "24.19.0",
      currentNodeVersion: "24.19.0",
      currentNpmVersion: "11.15.0",
      packageJson,
    })).toThrow("npm 11.17.0 is required");
  });

  it("rejects floating configuration and malformed npm user agents", () => {
    expect(() => runtimeContract.assertRuntimeContract({
      configuredNodeVersion: "24",
      currentNodeVersion: "24.19.0",
      currentNpmVersion: "11.17.0",
      packageJson,
    })).toThrow(".node-version must pin an exact Node.js version");
    expect(() => runtimeContract.parseNpmVersion("pnpm/10.0.0")).toThrow(
      "through npm",
    );
    expect(runtimeContract.parseNpmVersion("npm/11.17.0 node/v24.19.0 win32 x64")).toBe(
      "11.17.0",
    );
  });
});
