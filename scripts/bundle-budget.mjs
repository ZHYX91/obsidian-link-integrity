// Measured on 2026-08-02 with Node 24.19.0 and npm 11.17.0 after
// `npm ci && npm run build:bundle`; then
// `node -p "require('node:fs').statSync('dist/main.js').size"` printed 280147
// after all eleven catalogs became independently complete.
export const BUNDLE_REFERENCE_BYTES = 280_147;

// Roughly 1.8x the measured baseline: enough room for reviewed feature growth,
// while still blocking accidental source maps, unminified output, or a major
// dependency expansion. Raising it requires a new measured reference and review.
export const BUNDLE_MAXIMUM_BYTES = 500_000;

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
  return {
    actualBytes,
    maximumBytes: BUNDLE_MAXIMUM_BYTES,
    referenceBytes: BUNDLE_REFERENCE_BYTES,
  };
}
