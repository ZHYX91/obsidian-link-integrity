import { describe, expect, it } from "vitest";

import {
  createOccurrenceIgnoreContext,
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

  it("derives format families when callers only have source file metadata", () => {
    const markdown = rule("markdown", "hide-broken-result", "format-family", "markdown");
    expect(ignoreRuleMatches(markdown, { sourcePath: "Notes/A.md", extension: "md" })).toBe(true);
    expect(ignoreRuleMatches(markdown, { sourcePath: "Notes/A.pdf", extension: "pdf" })).toBe(false);
  });

  it("treats ignore-target rules as file targets rather than subpath identities", () => {
    const target = rule("target-heading", "ignore-target", "target-path", "Missing.md#Heading");
    expect(ignoreRuleMatches(target, { targetPath: "Missing.md" })).toBe(true);
    expect(ignoreRuleMatches(RULES[2]!, { targetPath: "Missing.md#Another heading" })).toBe(true);
  });

  it("builds one canonical occurrence context for previews and execution", () => {
    const context = createOccurrenceIgnoreContext({
      id: "occ-1",
      sourcePath: "Notes/A.md",
      raw: "[[Missing.md#Heading]]",
      linkpath: "Missing.md",
      subpath: "#Heading",
      lookupKey: "missing.md",
      kind: "markdown-link",
      position: null,
      destinationKind: "internal",
      targetPath: null,
      fileStatus: "missing",
      subpathStatus: "pending",
    }, "md");
    expect(context).toEqual(expect.objectContaining({
      sourcePath: "Notes/A.md",
      targetPath: "Missing.md#Heading",
      occurrenceId: "occ-1",
      formatFamilyIds: ["markdown"],
      extension: "md",
    }));
    expect(ignoreRuleMatches(RULES[2]!, context)).toBe(true);
  });

  it("uses folder boundaries rather than raw prefix matching", () => {
    const folderRule = RULES[1];
    expect(folderRule).toBeDefined();
    expect(ignoreRuleMatches(folderRule!, { candidatePath: "Archive/a.md" })).toBe(true);
    expect(ignoreRuleMatches(folderRule!, { candidatePath: "Archive-old/a.md" })).toBe(false);
  });

  it("returns match counts and bounded samples from any iterable", () => {
    function* contexts() {
      yield { candidatePath: "Archive/a.md" };
      yield { candidatePath: "Archive/b.md" };
      yield { candidatePath: "Notes/c.md" };
    }
    const preview = previewIgnoreRule(RULES[1]!, contexts(), 1);
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
