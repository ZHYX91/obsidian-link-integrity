import { describe, expect, it } from "vitest";
// @ts-ignore Plain JavaScript release tooling is exercised directly by Vitest.
import * as budgetSource from "../../scripts/bundle-budget.mjs";

interface BundleBudgetModule {
  BUNDLE_MAXIMUM_BYTES: number;
  BUNDLE_REFERENCE_BYTES: number;
  measureBundleBudget(actualBytes: number): {
    actualBytes: number;
    maximumBytes: number;
    referenceBytes: number;
  };
}

const budget = budgetSource as unknown as BundleBudgetModule;

describe("bundle budget", () => {
  it("records a measured reference and enforces a larger explicit maximum", () => {
    expect(budget.BUNDLE_REFERENCE_BYTES).toBe(205_884);
    expect(budget.BUNDLE_MAXIMUM_BYTES).toBeGreaterThan(budget.BUNDLE_REFERENCE_BYTES);
    expect(budget.measureBundleBudget(205_884)).toEqual({
      actualBytes: 205_884,
      maximumBytes: budget.BUNDLE_MAXIMUM_BYTES,
      referenceBytes: budget.BUNDLE_REFERENCE_BYTES,
    });
    expect(() => budget.measureBundleBudget(budget.BUNDLE_MAXIMUM_BYTES + 1)).toThrow(
      "exceeds",
    );
  });
});
