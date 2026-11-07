import { describe, expect, it } from "vitest";

import {
  createOccurrenceId,
  occurrenceIdMatches,
  occurrenceIdSource,
  renameOccurrenceIdSource,
} from "../../src/core/occurrence-identity";
import {
  ignoreRuleMatches,
  renameOccurrenceRuleSources,
  type IgnoreRule,
} from "../../src/shared/ignore-rules";

describe("occurrence identity", () => {
  it("rewrites persisted source identity for file and folder renames", () => {
    const savedId = id("Folder/Source.md");
    const currentId = id("Renamed/Source.md");
    const rule: IgnoreRule = {
      id: "occurrence-rule",
      enabled: true,
      scope: "ignore-occurrence",
      matcher: { kind: "occurrence-id", value: savedId },
      createdAt: 1,
      note: "",
    };
    const [renamed] = renameOccurrenceRuleSources([rule], "Folder", "Renamed");
    expect(renamed).toBeDefined();
    expect(ignoreRuleMatches(renamed ?? rule, { occurrenceId: currentId })).toBe(true);
  });

  it("does not match or rewrite an unidentifiable positional rule", () => {
    const legacy = "Source.md\u0000markdown-link\u00003:0\u00002";
    expect(occurrenceIdMatches(legacy, id("Source.md"))).toBe(false);
    expect(occurrenceIdMatches(legacy, legacy)).toBe(false);
    expect(occurrenceIdSource(legacy)).toBeNull();
    expect(renameOccurrenceIdSource(legacy, "Source.md", "Renamed.md")).toBe(legacy);
  });
});

function id(sourcePath: string): string {
  return createOccurrenceId({
    sourcePath,
    kind: "markdown-link",
    raw: "[[Missing]]",
    linktext: "Missing",
    duplicateIndex: 0,
    duplicateCount: 1,
  });
}
