// Measured from the immutable 0.5.1 production asset published from
// b7be5f4630a4eada0c15a261589079401a712b31:
// main.js = 622,882 bytes, SHA-256
// 4f1e63cf619664a48574c7bc5500514bda3f570f97a678d2d67197057268ba87.
//
// The published parser and body-diagnostic runtime had already consumed nearly
// all of the old ceiling. Complete CommonMark destination semantics also need
// the HTML5 named-entity table and decoder (about 39 KB, imported via
// entities/decode only). This is runtime code, not test or debug material.
// Keep the same approximately 25% growth allowance on the published baseline.
export const BUNDLE_REFERENCE_BYTES = 622_882;

// Keep roughly 25% reviewed growth room above the measured runtime while still
// rejecting accidental source maps, unminified output, or another large
// dependency expansion. Raising this ceiling requires a new measured reference
// and an explanation of the runtime growth.
export const BUNDLE_MAXIMUM_BYTES = 779_000;

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
