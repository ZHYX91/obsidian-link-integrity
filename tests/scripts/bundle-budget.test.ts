import { describe, expect, it } from "vitest";
// @ts-ignore Plain JavaScript release tooling is exercised directly by Vitest.
import * as budgetSource from "../../scripts/bundle-budget.mjs";

interface BundleBudgetModule {
  BUNDLE_MAXIMUM_BYTES: number;
  BUNDLE_REFERENCE_BYTES: number;
  measureBundleBudget(actualBytes: number): {
    actualBytes: number;
    headroomBytes: number;
    headroomPercent: number;
    maximumBytes: number;
    referenceBytes: number;
  };
}

const budget = budgetSource as unknown as BundleBudgetModule;

describe("bundle budget", () => {
  it("tracks the reviewed 0.2.8 runtime baseline with meaningful growth room", () => {
    expect(budget.BUNDLE_REFERENCE_BYTES).toBe(499_922);
    expect(budget.BUNDLE_MAXIMUM_BYTES).toBe(625_000);
    expect(budget.BUNDLE_MAXIMUM_BYTES / budget.BUNDLE_REFERENCE_BYTES)
      .toBeGreaterThanOrEqual(1.2);
    expect(budget.BUNDLE_MAXIMUM_BYTES / budget.BUNDLE_REFERENCE_BYTES)
      .toBeLessThan(1.3);

    const measured = budget.measureBundleBudget(budget.BUNDLE_REFERENCE_BYTES);
    expect(measured).toMatchObject({
      actualBytes: budget.BUNDLE_REFERENCE_BYTES,
      headroomBytes: 125_078,
      maximumBytes: budget.BUNDLE_MAXIMUM_BYTES,
      referenceBytes: budget.BUNDLE_REFERENCE_BYTES,
    });
    expect(measured.headroomPercent).toBeGreaterThan(20);
    expect(() => budget.measureBundleBudget(budget.BUNDLE_MAXIMUM_BYTES + 1)).toThrow(
      "exceeds",
    );
  });

  it("rejects invalid measurements and invalid ceiling crossings", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => budget.measureBundleBudget(value)).toThrow();
    }
  });
});
