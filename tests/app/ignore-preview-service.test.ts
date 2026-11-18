import { describe, expect, it, vi } from "vitest";
import { IgnorePreviewService } from "../../src/app/ignore-preview-service";
import { LinkIndex, createFileRecord } from "../../src/core";
import type { IgnoreRule } from "../../src/shared/ignore-rules";
import { occurrence, snapshot } from "../core/test-helpers";

const rule: IgnoreRule = { id: "markdown", enabled: false, scope: "hide-broken-result",
  matcher: { kind: "format-family", value: "markdown" }, createdAt: 1, note: "" };

function fixture(missing: boolean): LinkIndex {
  const index = new LinkIndex([createFileRecord("A.md"), createFileRecord("Target.md")]);
  index.replaceSourceSnapshot("A.md", snapshot("A.md", Array.from({ length: 256 }, (_, n) =>
    occurrence(`link-${n}`, "A.md", { fileStatus: missing ? "missing" : "resolved" }))));
  return index;
}

describe("scheduled ignore previews", () => {
  it("yields for non-diagnostics and cancels superseded work", async () => {
    const index = fixture(false);
    const abort = new AbortController();
    const yields = vi.fn(async () => { abort.abort(); });
    const service = new IgnorePreviewService(() => index, { yieldEvery: 8, yieldControl: yields });
    await expect(service.preview(rule, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(yields).toHaveBeenCalledTimes(1);
  });

  it("restarts against the current index instead of publishing a mixed count", async () => {
    let index = fixture(true);
    let swapped = false;
    const service = new IgnorePreviewService(() => index, {
      yieldEvery: 8,
      yieldControl: async () => {
        if (!swapped) { swapped = true; index = fixture(false); }
      },
    });
    expect(await service.preview(rule)).toEqual({
      matchCount: 0, samples: [], affectedFileCount: 0, affectedConnectionCount: 0,
    });
    expect(swapped).toBe(true);
  });

  it("refreshes source metadata and discards partial results when the same index changes", async () => {
    const index = fixture(true);
    const service = new IgnorePreviewService(() => index, {
      yieldEvery: 8,
      yieldControl: vi.fn(async () => undefined).mockImplementationOnce(async () => {
        index.replaceFileRecord("A.md", { ...createFileRecord("A.md"), extension: "png" });
      }),
    });
    expect(await service.preview(rule)).toEqual({
      matchCount: 0, samples: [], affectedFileCount: 0, affectedConnectionCount: 0,
    });
    expect(await service.preview({ ...rule, matcher: { kind: "format-family", value: "png" } })).toEqual({
      matchCount: 256, samples: Array<string>(5).fill("A.md"), affectedFileCount: 1, affectedConnectionCount: 0,
    });
    index.replaceFileRecord("A.md", createFileRecord("A.md"));
    expect((await service.preview(rule)).matchCount).toBe(256);
  });

  it("refreshes a missing graph endpoint when the vault adds it during a preview", async () => {
    const index = fixture(false);
    index.replaceFileRecord("Target.md", null);
    const service = new IgnorePreviewService(() => index, {
      yieldEvery: 8,
      yieldControl: vi.fn(async () => undefined).mockImplementationOnce(async () => {
        index.replaceFileRecord("Target.md", createFileRecord("Target.md"));
      }),
    });
    expect(await service.preview({ ...rule, scope: "exclude-graph-contribution" })).toEqual({
      matchCount: 256, samples: Array<string>(5).fill("A.md"), affectedFileCount: 2, affectedConnectionCount: 1,
    });
  });

  it("counts disabled drafts and bounds samples while yielding", async () => {
    const index = fixture(true);
    const fileReads = vi.spyOn(index, "getFile");
    const yields = vi.fn(async () => undefined);
    const service = new IgnorePreviewService(() => index, { yieldEvery: 8, yieldControl: yields });
    const result = await service.preview(rule);
    expect(result.matchCount).toBe(256);
    expect(result.samples).toHaveLength(5);
    expect(fileReads.mock.calls).toEqual([["A.md"]]);
    expect(yields).toHaveBeenCalled();
  });

  it("does not enumerate unrelated files for a source rule", async () => {
    const index = fixture(true);
    vi.spyOn(index, "iterateOccurrences").mockImplementation(() => { throw new Error("Global scan"); });
    const service = new IgnorePreviewService(() => index);
    expect((await service.preview({ ...rule, matcher: { kind: "source-path", value: "A.md" } })).matchCount)
      .toBe(256);
  });

  it("counts distinct file connections and endpoints, excluding self-links", async () => {
    const index = new LinkIndex([createFileRecord("A.md"), createFileRecord("Target.md")]);
    index.replaceSourceSnapshot("A.md", snapshot("A.md", [
      occurrence("one", "A.md", { fileStatus: "resolved", targetPath: "Target.md" }),
      occurrence("two", "A.md", { fileStatus: "resolved", targetPath: "Target.md" }),
      occurrence("self", "A.md", { fileStatus: "resolved", targetPath: "A.md" }),
    ]));
    index.replaceSourceSnapshot("Target.md", snapshot("Target.md", [
      occurrence("reverse", "Target.md", { targetPath: "A.md" }),
    ]));
    const preview = await new IgnorePreviewService(() => index).preview({
      ...rule, scope: "exclude-graph-contribution",
    });
    expect(preview).toMatchObject({ matchCount: 3, affectedFileCount: 2, affectedConnectionCount: 2 });
  });
});
