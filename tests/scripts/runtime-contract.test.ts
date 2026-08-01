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
  engines: { node: "24.18.0" },
  packageManager: "npm@11.16.0",
};

describe("runtime contract", () => {
  it("accepts only the exact pinned Node.js and npm pair", () => {
    expect(() => runtimeContract.assertRuntimeContract({
      configuredNodeVersion: "24.18.0",
      currentNodeVersion: "24.18.0",
      currentNpmVersion: "11.16.0",
      packageJson,
    })).not.toThrow();

    expect(() => runtimeContract.assertRuntimeContract({
      configuredNodeVersion: "24.18.0",
      currentNodeVersion: "24.18.1",
      currentNpmVersion: "11.16.0",
      packageJson,
    })).toThrow("Expected Node.js 24.18.0");

    expect(() => runtimeContract.assertRuntimeContract({
      configuredNodeVersion: "24.18.0",
      currentNodeVersion: "24.18.0",
      currentNpmVersion: "11.15.0",
      packageJson,
    })).toThrow("Expected npm 11.16.0");
  });

  it("rejects floating configuration and malformed npm user agents", () => {
    expect(() => runtimeContract.assertRuntimeContract({
      configuredNodeVersion: "24",
      currentNodeVersion: "24.18.0",
      currentNpmVersion: "11.16.0",
      packageJson,
    })).toThrow(".node-version must contain an exact x.y.z version");
    expect(() => runtimeContract.parseNpmVersion("pnpm/10.0.0")).toThrow(
      "npm_config_user_agent",
    );
    expect(runtimeContract.parseNpmVersion("npm/11.16.0 node/v24.18.0 win32 x64")).toBe(
      "11.16.0",
    );
  });
});
