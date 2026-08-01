import { describe, expect, it } from "vitest";
// @ts-ignore Plain JavaScript release tooling is exercised directly by Vitest.
import * as historySource from "../../scripts/github-release-contract.mjs";

interface ReleaseHistoryModule {
  compareStableVersions(left: string, right: string): number;
  selectReleaseHistory(
    releases: unknown[],
    candidate: string,
    options?: { allowSameTag?: boolean },
  ): {
    baseline: { tag_name: string } | null;
    sameTagRelease: { tag_name: string } | null;
  };
}

const history = historySource as unknown as ReleaseHistoryModule;

const release = (
  tag_name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  draft: false,
  prerelease: false,
  published_at: "2026-08-02T00:00:00Z",
  tag_name,
  ...overrides,
});

describe("stable Release history", () => {
  it("selects the highest lower real stable Release and ignores non-releases", () => {
    const selected = history.selectReleaseHistory([
      release("0.8.0"),
      release("0.9.0"),
      release("0.9.5", { draft: true }),
      release("v0.9.9"),
      release("0.9.8", { prerelease: true }),
    ], "1.0.0");
    expect(selected.baseline?.tag_name).toBe("v0.9.9");
    expect(selected.sameTagRelease).toBeNull();
  });

  it("requires a strictly newer preflight while permitting only same-tag reruns", () => {
    const releases = [release("1.0.0")];
    expect(() => history.selectReleaseHistory(releases, "1.0.0")).toThrow(
      "not newer",
    );
    expect(history.selectReleaseHistory(
      releases,
      "1.0.0",
      { allowSameTag: true },
    ).sameTagRelease?.tag_name).toBe("1.0.0");
    expect(() => history.selectReleaseHistory(
      [...releases, release("1.1.0")],
      "1.0.0",
      { allowSameTag: true },
    )).toThrow("1.1.0");
    expect(() => history.selectReleaseHistory(
      [release("v1.0.0")],
      "1.0.0",
      { allowSameTag: true },
    )).toThrow("v1.0.0");
  });

  it("fails closed when a draft or prerelease already occupies the candidate version", () => {
    expect(() => history.selectReleaseHistory(
      [release("1.0.0", { draft: true, published_at: null })],
      "1.0.0",
      { allowSameTag: true },
    )).toThrow("non-published Releases: 1.0.0");
    expect(() => history.selectReleaseHistory(
      [release("v1.0.0", { prerelease: true })],
      "1.0.0",
      { allowSameTag: true },
    )).toThrow("non-published Releases: v1.0.0");
  });

  it("compares arbitrarily large numeric components without Number coercion", () => {
    expect(history.compareStableVersions(
      "999999999999999999999.0.0",
      "1000000000000000000000.0.0",
    )).toBeLessThan(0);
  });
});
