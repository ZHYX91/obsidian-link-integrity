import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(path.resolve(import.meta.dirname, "../../styles.css"), "utf8");

describe("sidebar navigation CSS", () => {
  it("combines the active accent line with a semibold label", () => {
    expect(styles).toMatch(
      /\.link-integrity-sidebar button\.link-integrity-tab\.is-active\s*\{[^}]*box-shadow:\s*inset 0 -2px var\(--interactive-accent\);[^}]*font-weight:\s*var\(--font-semibold\);/s,
    );
  });
});
