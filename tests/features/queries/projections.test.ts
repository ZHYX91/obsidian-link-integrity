import { describe, expect, it } from "vitest";

import { createPeriodicExpectedIsolatedRule } from "../../../src/core/expected-isolation-rules";
import { LinkIndex } from "../../../src/core/link-index";
import { createFileRecord } from "../../../src/core/model";
import { queryBrokenLinks } from "../../../src/features/queries/broken-links";
import {
  createIsolatedFileProjection,
  queryIsolatedFiles,
} from "../../../src/features/queries/isolated-files";
import { occurrence, snapshot } from "../../core/test-helpers";

describe("broken and isolated projections", () => {
  it("keeps file-level connections when only a heading or block is missing", () => {
    const index = new LinkIndex([
      createFileRecord("Source.md"),
      createFileRecord("Target.md"),
    ]);
    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("heading", "Source.md", {
        targetPath: "Target.md",
        subpath: "#Missing",
        subpathStatus: "missing-heading",
      }),
    ]));

    expect(queryBrokenLinks(index).map(({ reason }) => reason)).toEqual(["missing-heading"]);
    expect(queryIsolatedFiles(index)).toEqual([]);
  });

  it("can hide a missing target by canonical lookup key without changing the graph", () => {
    const index = new LinkIndex([createFileRecord("Source.md")]);
    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("missing", "Source.md", {
        linkpath: "Folder/Target.md",
        lookupKey: "folder/target",
        fileStatus: "missing",
        targetPath: null,
      }),
    ]));
    expect(queryBrokenLinks(index)).toHaveLength(1);
    expect(queryBrokenLinks(index, {
      scope: { excludedLookupKeys: new Set(["FOLDER\\TARGET.MD"]) },
    })).toEqual([]);
    expect(queryIsolatedFiles(index)[0]?.brokenOutgoingCount).toBe(1);
  });

  it("defines isolated as zero valid incoming and outgoing connections", () => {
    const index = new LinkIndex([
      createFileRecord("ConnectedSource.md"),
      createFileRecord("ConnectedTarget.md"),
      createFileRecord("OnlyBroken.md"),
      createFileRecord("SelfOnly.md"),
    ]);
    index.replaceSourceSnapshot("ConnectedSource.md", snapshot("ConnectedSource.md", [
      occurrence("connected", "ConnectedSource.md", { targetPath: "ConnectedTarget.md" }),
    ]));
    index.replaceSourceSnapshot("OnlyBroken.md", snapshot("OnlyBroken.md", [
      occurrence("broken", "OnlyBroken.md", {
        linkpath: "Missing",
        lookupKey: "missing",
        fileStatus: "missing",
        targetPath: null,
      }),
    ]));
    index.replaceSourceSnapshot("SelfOnly.md", snapshot("SelfOnly.md", [
      occurrence("self", "SelfOnly.md", { targetPath: "SelfOnly.md" }),
      occurrence("external", "SelfOnly.md", {
        destinationKind: "external",
        fileStatus: "invalid",
        targetPath: null,
      }),
    ]));

    const isolated = queryIsolatedFiles(index);
    expect(isolated.map(({ path }) => path)).toEqual(["OnlyBroken.md", "SelfOnly.md"]);
    expect(isolated.find(({ path }) => path === "OnlyBroken.md")).toMatchObject({
      brokenOutgoingCount: 1,
      confidence: "low",
      classification: "isolated",
    });
    expect(isolated.find(({ path }) => path === "SelfOnly.md")).toMatchObject({
      brokenOutgoingCount: 0,
      confidence: "high",
    });
  });

  it("offers no-incoming as a separate advanced projection", () => {
    const index = new LinkIndex([
      createFileRecord("Source.md"),
      createFileRecord("Target.md"),
    ]);
    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("out", "Source.md", { targetPath: "Target.md" }),
    ]));
    expect(queryIsolatedFiles(index)).toEqual([]);
    expect(queryIsolatedFiles(index, { mode: "no-incoming" })).toEqual([
      expect.objectContaining({ path: "Source.md", classification: "no-incoming" }),
    ]);
  });

  it("keeps candidate filtering independent from graph contribution", () => {
    const index = new LinkIndex([
      createFileRecord("Source.canvas"),
      createFileRecord("Image.png"),
    ]);
    index.replaceSourceSnapshot("Source.canvas", snapshot("Source.canvas", [
      occurrence("canvas-edge", "Source.canvas", {
        targetPath: "Image.png",
        kind: "canvas-file",
      }),
    ]));
    const imageOnly = {
      familyIds: new Set(["png"] as const),
    };
    expect(queryIsolatedFiles(index, { candidateScope: imageOnly })).toEqual([]);
  });

  it("excludes expected-isolated files from the main count without creating date edges", () => {
    const index = new LinkIndex([
      createFileRecord("Journal/2026-08-01.md"),
      createFileRecord("Journal/2026-08-02.md"),
      createFileRecord("Loose.md"),
    ]);
    const rule = createPeriodicExpectedIsolatedRule("daily", { folderPath: "Journal" });
    const projection = createIsolatedFileProjection(index, { expectedRules: [rule] });
    expect(projection.items.map(({ path }) => path)).toEqual(["Loose.md"]);
    expect(projection.mainCount).toBe(1);
    expect(projection.expectedExcludedCount).toBe(2);
    expect(index.toCanonicalState().edges).toEqual([]);

    const advanced = createIsolatedFileProjection(index, {
      expectedRules: [rule],
      includeExpected: true,
    });
    expect(advanced.items.filter(({ classification }) =>
      classification === "expected-isolated")).toHaveLength(2);
    expect(advanced.items.filter(({ confidence }) => confidence === "high")).toHaveLength(1);
  });
});
