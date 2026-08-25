import { describe, expect, it } from "vitest";

import {
  createOccurrenceId,
  occurrenceIdMatches,
} from "../../src/core/occurrence-identity";
import {
  ignoreRuleMatches,
  renameOccurrenceRuleSources,
  type IgnoreRule,
} from "../../src/shared/ignore-rules";

describe("occurrence identity", () => {
  it("rewrites persisted source identity for file and folder renames", () => {
    const savedId = id("Folder/Source.md", "1:0", 1);
    const currentId = id("Renamed/Source.md", "8:0", 4);
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

  it("keeps legacy IDs compatible at their original location", () => {
    const currentId = id("Source.md", "3:0", 2);
    expect(occurrenceIdMatches("Source.md\u0000markdown-link\u00003:0\u00002", currentId)).toBe(true);
  });
});

function id(sourcePath: string, location: string, legacyOrdinal: number): string {
  return createOccurrenceId({
    sourcePath,
    kind: "markdown-link",
    raw: "[[Missing]]",
    linktext: "Missing",
    duplicateIndex: 0,
    duplicateCount: 1,
    location,
    legacyOrdinal,
  });
}
