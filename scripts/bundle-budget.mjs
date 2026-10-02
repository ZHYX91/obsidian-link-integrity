// Measured from the immutable 0.2.8 production asset published from
// 902b881585c346e599656c3d5629017165c5da9c:
// main.js = 499,922 bytes.
//
// The large step between 0.2.6 and 0.2.7 is attributable to adding the runtime
// yaml package used by Bases parsing and syntax-range-aware Frontmatter
// navigation. That dependency is intentional product code, not test/debug
// material. The reference therefore follows the reviewed runtime baseline.
export const BUNDLE_REFERENCE_BYTES = 499_922;

// Keep roughly 25% reviewed growth room above the measured runtime while still
// rejecting accidental source maps, unminified output, or another large
// dependency expansion. Raising this ceiling requires a new measured reference
// and an explanation of the runtime growth.
export const BUNDLE_MAXIMUM_BYTES = 625_000;

export function measureBundleBudget(actualBytes) {
  if (!Number.isSafeInteger(actualBytes) || actualBytes <= 0) {
    throw new Error(`Bundle size must be a positive safe integer: ${String(actualBytes)}`);
  }
  if (
    !Number.isSafeInteger(BUNDLE_REFERENCE_BYTES) ||
    BUNDLE_REFERENCE_BYTES <= 0 ||
    !Number.isSafeInteger(BUNDLE_MAXIMUM_BYTES) ||
    BUNDLE_MAXIMUM_BYTES < BUNDLE_REFERENCE_BYTES
  ) {
    throw new Error("Bundle reference and maximum budget are invalid");
  }
  if (actualBytes > BUNDLE_MAXIMUM_BYTES) {
    throw new Error(
      `dist/main.js exceeds the ${BUNDLE_MAXIMUM_BYTES}-byte budget: ${actualBytes}`,
    );
  }
  const headroomBytes = BUNDLE_MAXIMUM_BYTES - actualBytes;
  const headroomPercent = headroomBytes / BUNDLE_MAXIMUM_BYTES * 100;
  return {
    actualBytes,
    headroomBytes,
    headroomPercent,
    maximumBytes: BUNDLE_MAXIMUM_BYTES,
    referenceBytes: BUNDLE_REFERENCE_BYTES,
  };
}
