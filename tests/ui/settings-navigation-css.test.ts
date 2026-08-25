import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

describe("settings navigation CSS", () => {
  it("resets theme buttons and keeps the active tab unmistakable", () => {
    expect(styles).toMatch(
      /\.link-integrity-settings-tabs > button\.link-integrity-settings-tab\s*\{[^}]*appearance:\s*none !important;[^}]*background:\s*transparent !important;[^}]*border:\s*0 !important;[^}]*border-block-end:\s*2px solid transparent !important;/s,
    );
    expect(styles).toMatch(
      /\.link-integrity-settings-tabs > button\.link-integrity-settings-tab\.is-active,[\s\S]*?border-block-end-color:\s*var\(--interactive-accent\) !important;[\s\S]*?font-weight:\s*var\(--font-semibold\) !important;/s,
    );
  });

  it("uses the shared spacing and minimum-size contract", () => {
    expect(styles).toMatch(
      /\.link-integrity-settings-tabs\s*\{[^}]*align-items:\s*stretch;[^}]*gap:\s*var\(--size-2-1\);[^}]*margin:\s*0;[^}]*overflow-x:\s*auto;/s,
    );
    expect(styles).toMatch(
      /\.link-integrity-settings-panel\s*\{[^}]*margin-block-start:\s*var\(--size-4-5\);[^}]*padding-block-start:\s*0;/s,
    );
    expect(styles).toMatch(
      /\.link-integrity-settings-tabs > button\.link-integrity-settings-tab\s*\{[^}]*block-size:\s*auto;[^}]*min-block-size:\s*34px;[^}]*padding:\s*7px 12px !important;/s,
    );
  });
});
