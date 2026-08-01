import { describe, expect, it } from "vitest";

import {
  IgnoreService,
  ignoreRuleMatches,
  normalizeIgnoreRules,
  previewIgnoreRule,
  type IgnoreRule,
} from "../../src/shared/ignore-rules";

const RULES: readonly IgnoreRule[] = [
  rule("source", "hide-broken-result", "source-path", "Notes/A.md"),
  rule("folder", "exclude-isolated-candidate", "path-prefix", "Archive"),
  rule("target", "ignore-target", "target-path", "Missing.md"),
  rule("occ", "ignore-occurrence", "occurrence-id", "occ-1"),
  rule("format", "exclude-isolated-candidate", "format-family", "pdf"),
  rule("extension", "exclude-isolated-candidate", "extension", ".drawio"),
  rule("graph", "exclude-graph-contribution", "path-prefix", "Generated"),
];

describe("IgnoreService", () => {
  it("evaluates diagnostic, candidate, and graph scopes independently", () => {
    const service = new IgnoreService(RULES);
    expect(service.shouldHideBrokenResult({ sourcePath: "Notes/A.md" })).toBe(true);
    expect(service.shouldHideBrokenResult({ targetPath: "Missing.md" })).toBe(true);
    expect(service.shouldExcludeIsolatedCandidate({ candidatePath: "Archive/old.md" }))
      .toBe(true);
    expect(service.shouldExcludeIsolatedCandidate({ formatFamilyIds: ["pdf"] })).toBe(true);
    expect(service.shouldExcludeIsolatedCandidate({ candidatePath: "Map.DRAWIO" })).toBe(true);
    expect(service.shouldExcludeGraphContribution({ sourcePath: "Generated/index.md" }))
      .toBe(true);
    expect(service.getGraphContributionRules().map(({ id }) => id)).toEqual(["graph"]);
  });

  it("uses folder boundaries rather than raw prefix matching", () => {
    const folderRule = RULES[1];
    expect(folderRule).toBeDefined();
    expect(ignoreRuleMatches(folderRule!, { candidatePath: "Archive/a.md" })).toBe(true);
    expect(ignoreRuleMatches(folderRule!, { candidatePath: "Archive-old/a.md" })).toBe(false);
  });

  it("returns match counts and bounded samples", () => {
    const preview = previewIgnoreRule(RULES[1]!, [
      { candidatePath: "Archive/a.md" },
      { candidatePath: "Archive/b.md" },
      { candidatePath: "Notes/c.md" },
    ], 1);
    expect(preview).toEqual({ matchCount: 2, samples: ["Archive/a.md"] });
  });

  it("drops malformed and duplicate persisted rules", () => {
    expect(normalizeIgnoreRules([RULES[0], RULES[0], { id: "bad id" }]))
      .toHaveLength(1);
  });
});

function rule(
  id: string,
  scope: IgnoreRule["scope"],
  kind: IgnoreRule["matcher"]["kind"],
  value: string,
): IgnoreRule {
  return {
    id,
    enabled: true,
    scope,
    matcher: { kind, value },
    createdAt: 1,
    note: "",
  };
}
