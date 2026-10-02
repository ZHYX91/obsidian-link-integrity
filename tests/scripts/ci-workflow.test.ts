import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const audit = workflow.split("\n  audit:\n", 2)[1]?.split("\n  verify:\n", 1)[0] ?? "";
const verify = workflow.split("\n  verify:\n", 2)[1] ?? "";

describe("CI workflow evidence boundary", () => {
  it("keeps dependency auditing independent from repository verification", () => {
    expect(audit).toContain("npm audit --audit-level=high");
    expect(audit).toContain("npm ci");
    expect(verify).not.toContain("npm audit");
    expect(verify).toContain("npm run check");
    expect(verify).toContain("npm run bench:index");
  });

  it("pins the common runtime and action inputs in both jobs", () => {
    expect(workflow.match(/runs-on: ubuntu-24\.04/gu)).toHaveLength(2);
    expect(workflow.match(/node-version: 24\.19\.0/gu)).toHaveLength(2);
    expect(workflow.match(/npm@11\.17\.0/gu)).toHaveLength(2);
    expect(workflow.match(/persist-credentials: false/gu)).toHaveLength(2);
    const pins = [...workflow.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/gu)]
      .map((match) => match[1] ?? "");
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.every((pin) => /^[0-9a-f]{40}$/u.test(pin))).toBe(true);
  });
});
