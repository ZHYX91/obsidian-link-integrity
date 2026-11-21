import { describe, expect, it, vi } from "vitest";
import { runIndexPreview } from "../../src/app/index-preview";
import { createFileRecord, expectedRuleStatsSteps, LinkIndex, type ExpectedIsolationRule } from "../../src/core";

const rule: ExpectedIsolationRule = {
  id: "archive", name: "Archive", enabled: true, folder: { path: "Archive", mode: "recursive" },
  namingPatterns: [], fileExtensions: [], fileTypeFamilyIds: [], fileTypeCategoryIds: [],
};
const scan = (index: LinkIndex) => expectedRuleStatsSteps(index.iterateFiles(), rule);

describe("expected-isolation rule preview", () => {
  it("discards partial results after an index replacement while yielding", async () => {
    let index = new LinkIndex(Array.from({ length: 1000 }, (_, i) => createFileRecord(`Archive/${i}.md`)));
    const replacement = new LinkIndex([createFileRecord("Archive/current.md")]);
    const result = await runIndexPreview(() => index, scan, undefined, {
      yieldEvery: 16, yieldControl: async () => { index = replacement; },
    });
    expect(result).toMatchObject({ matchCount: 1, samples: ["Archive/current.md"] });
  });

  it("stops iterating when the dialog is dismissed during a preview", async () => {
    const abort = new AbortController();
    const index = new LinkIndex(Array.from({ length: 1000 }, (_, i) => createFileRecord(`Archive/${i}.md`)));
    const copiedFiles = vi.spyOn(index, "files", "get");
    const pause = vi.fn(async () => { abort.abort(); });
    await expect(runIndexPreview(() => index, scan, abort.signal, { yieldEvery: 16, yieldControl: pause })).rejects.toThrow();
    expect(pause).toHaveBeenCalledOnce();
    expect(copiedFiles).not.toHaveBeenCalled();
  });
});
