import { describe, expect, it, vi } from "vitest";

import { LinkIndex } from "../../src/core/link-index";
import { createFileRecord } from "../../src/core/model";
import type { GraphContributionPolicyContext } from "../../src/core/scopes";
import { occurrence, snapshot } from "./test-helpers";

describe("LinkIndex", () => {
  it("counts valid non-self edges by occurrence kind", () => {
    const index = new LinkIndex([
      createFileRecord("Source.md"),
      createFileRecord("Target.md"),
    ]);
    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("one", "Source.md", { targetPath: "Target.md" }),
      occurrence("two", "Source.md", {
        targetPath: "Target.md",
        kind: "markdown-embed",
        subpath: "#Missing",
        subpathStatus: "missing-heading",
      }),
      occurrence("self", "Source.md", { targetPath: "Source.md" }),
      occurrence("external", "Source.md", {
        destinationKind: "external",
        fileStatus: "invalid",
        targetPath: null,
      }),
    ]));

    expect(index.getOutgoingNeighborCount("Source.md")).toBe(1);
    expect(index.getIncomingNeighborCount("Target.md")).toBe(1);
    expect(index.getOutgoingContributionCount("Source.md")).toBe(2);
    expect(index.getSelfLinkCount("Source.md")).toBe(1);
    expect(index.getOutgoingEdges("Source.md")[0]?.byKind).toEqual(new Map([
      ["markdown-link", 1],
      ["markdown-embed", 1],
    ]));
  });

  it("atomically replaces a complete source snapshot without stale edges or refs", () => {
    const index = new LinkIndex([
      createFileRecord("Source.md"),
      createFileRecord("First.md"),
      createFileRecord("Second.md"),
    ]);
    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("old", "Source.md", {
        linkpath: "First",
        lookupKey: "first",
        targetPath: "First.md",
      }),
    ]));
    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("new", "Source.md", {
        linkpath: "Second",
        lookupKey: "second",
        targetPath: "Second.md",
      }),
    ]));

    expect(index.getIncomingNeighborCount("First.md")).toBe(0);
    expect(index.getIncomingNeighborCount("Second.md")).toBe(1);
    expect(index.getOccurrenceIdsByLookupKey("first")).toEqual(new Set());
    expect(index.getOccurrenceIdsByLookupKey("second")).toEqual(new Set(["new"]));
  });

  it("indexes lookup refs for both resolved and broken occurrences", () => {
    const index = new LinkIndex([createFileRecord("Source.md")]);
    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("valid-looking", "Source.md", {
        lookupKey: "note",
        targetPath: "Source.md",
      }),
      occurrence("missing", "Source.md", {
        lookupKey: "note",
        fileStatus: "missing",
        targetPath: null,
      }),
    ]));
    expect(index.getOccurrenceIdsByLookupKey("note")).toEqual(
      new Set(["valid-looking", "missing"]),
    );
  });

  it("recomputes graph existence and advanced contribution exclusions", () => {
    const files = [createFileRecord("Source.md"), createFileRecord("Target.md")];
    const index = new LinkIndex(files);
    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("edge", "Source.md", { targetPath: "Target.md" }),
    ]));
    index.setContributionScope({ excludedOccurrenceIds: new Set(["edge"]) });
    expect(index.getOutgoingNeighborCount("Source.md")).toBe(0);
    index.setContributionScope({});
    expect(index.getOutgoingNeighborCount("Source.md")).toBe(1);
    index.replaceFiles([files[0]!]);
    expect(index.getOutgoingNeighborCount("Source.md")).toBe(0);
  });

  it("does not rebuild graph state for semantically equal contribution scopes", () => {
    const index = new LinkIndex([
      createFileRecord("Source.md"),
      createFileRecord("Target.md"),
    ]);
    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("edge", "Source.md", { targetPath: "Target.md" }),
    ]));
    index.setContributionScope({
      excludedSourcePaths: new Set(["First.md", "Second.md"]),
      excludedTargetPaths: new Set(["Third.md", "Fourth.md"]),
      excludedOccurrenceIds: new Set(["first", "second"]),
    });
    const before = index.toCanonicalState();
    const rebuildGraphState = vi.spyOn(
      index as unknown as { rebuildGraphState(): void },
      "rebuildGraphState",
    );

    index.setContributionScope({
      excludedSourcePaths: new Set(["Second.md", "First.md"]),
      excludedTargetPaths: new Set(["Fourth.md", "Third.md"]),
      excludedOccurrenceIds: new Set(["second", "first"]),
    });

    expect(rebuildGraphState).not.toHaveBeenCalled();
    expect(index.toCanonicalState()).toEqual(before);
  });

  it("treats omitted and empty contribution exclusions as the same scope", () => {
    const index = new LinkIndex();
    const rebuildGraphState = vi.spyOn(
      index as unknown as { rebuildGraphState(): void },
      "rebuildGraphState",
    );

    index.setContributionScope({
      excludedSourcePaths: new Set(),
      excludedTargetPaths: new Set(),
      excludedOccurrenceIds: new Set(),
    });

    expect(rebuildGraphState).not.toHaveBeenCalled();
  });

  it("keeps policy-based graph contribution equal to materialized exclusions", () => {
    const files = [
      createFileRecord("Source.md"),
      createFileRecord("First.md"),
      createFileRecord("Second.md"),
    ];
    const policyIndex = new LinkIndex(files, {
      contributionPolicy: {
        allows: ({ occurrence: item }) => !item.id.startsWith("excluded"),
      },
    });
    const materializedIndex = new LinkIndex(files);
    const replacements = [
      snapshot("Source.md", [
        occurrence("excluded-old", "Source.md", { targetPath: "First.md" }),
        occurrence("included-old", "Source.md", { targetPath: "Second.md" }),
      ]),
      snapshot("Source.md", [
        occurrence("excluded-new", "Source.md", { targetPath: "Second.md" }),
        occurrence("included-new", "Source.md", { targetPath: "First.md" }),
      ]),
    ];

    for (const replacement of replacements) {
      policyIndex.replaceSourceSnapshot("Source.md", replacement);
      materializedIndex.replaceSourceSnapshot("Source.md", replacement);
      materializedIndex.setContributionScope({
        excludedOccurrenceIds: new Set(
          replacement.occurrences
            .filter(({ id }) => id.startsWith("excluded"))
            .map(({ id }) => id),
        ),
      });
      expect(policyIndex.toCanonicalState()).toEqual(materializedIndex.toCanonicalState());
    }
  });

  it("evaluates only old and new source occurrences during policy-aware replacement", () => {
    const allows = vi.fn((context: GraphContributionPolicyContext) =>
      !context.occurrence.id.startsWith("excluded"));
    const index = new LinkIndex([
      createFileRecord("Source.md"),
      createFileRecord("Target.md"),
    ], { contributionPolicy: { allows } });
    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("included-old", "Source.md", { targetPath: "Target.md" }),
      occurrence("excluded-old", "Source.md", { targetPath: "Target.md" }),
    ]));
    allows.mockClear();
    const rebuildGraphState = vi.spyOn(
      index as unknown as { rebuildGraphState(): void },
      "rebuildGraphState",
    );

    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("included-new", "Source.md", { targetPath: "Target.md" }),
      occurrence("excluded-new", "Source.md", { targetPath: "Target.md" }),
    ]));

    expect(allows).toHaveBeenCalledTimes(4);
    expect(allows.mock.calls.map(([context]) => context.occurrence.id)).toEqual([
      "included-old",
      "excluded-old",
      "included-new",
      "excluded-new",
    ]);
    expect(rebuildGraphState).not.toHaveBeenCalled();
    expect(index.getOutgoingContributionCount("Source.md")).toBe(1);
  });

  it("re-evaluates source metadata used by the contribution policy", () => {
    const source = createFileRecord("Source.md");
    const index = new LinkIndex([
      source,
      createFileRecord("Target.md"),
    ], {
      contributionPolicy: {
        allows: ({ sourceFile }) => sourceFile.extension === "md",
      },
    });
    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("edge", "Source.md", { targetPath: "Target.md" }),
    ]));

    index.replaceFileRecord("Source.md", { ...source, extension: "txt" });
    expect(index.getOutgoingNeighborCount("Source.md")).toBe(0);

    index.replaceFileRecord("Source.md", source);
    expect(index.getOutgoingNeighborCount("Source.md")).toBe(1);
  });

  it("keeps the stored snapshot identity when normalized semantics are unchanged", () => {
    const index = new LinkIndex([
      createFileRecord("Folder/Source.md"),
      createFileRecord("Folder/Target.md"),
    ]);
    index.replaceSourceSnapshot("Folder/Source.md", snapshot("Folder/Source.md", [
      occurrence("edge", "Folder/Source.md", {
        lookupKey: "folder/target",
        targetPath: "Folder/Target.md",
      }),
    ]));
    const stored = index.getSourceSnapshot("Folder/Source.md");
    const before = index.toCanonicalState();
    expect(stored).not.toBeNull();

    index.replaceSourceSnapshot("Folder\\Source.md", {
      sourcePath: " Folder\\Source.md ",
      occurrences: stored!.occurrences.map((item) => ({
        ...item,
        sourcePath: "Folder\\Source.md",
        lookupKey: " FOLDER\\TARGET ",
        targetPath: "Folder\\Target.md",
      })),
    });

    expect(index.getSourceSnapshot("Folder/Source.md")).toBe(stored);
    expect(index.getSourceSnapshot("Folder/Source.md")?.occurrences[0]).toBe(
      stored?.occurrences[0],
    );
    expect(index.toCanonicalState()).toEqual(before);
  });

  it("replaces one file record without rebuilding the registry", () => {
    const source = createFileRecord("Source.md", { modifiedAt: 1 });
    const target = createFileRecord("Target.md", { modifiedAt: 2 });
    const index = new LinkIndex([source, target]);
    index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [
      occurrence("edge", "Source.md", { targetPath: "Target.md" }),
    ]));

    index.replaceFileRecord("Source.md", createFileRecord("Source.md", { modifiedAt: 3 }));

    expect(index.getFile("Source.md")?.modifiedAt).toBe(3);
    expect(index.getFile("Target.md")).toEqual(target);
    expect(index.getOutgoingNeighborCount("Source.md")).toBe(1);
  });
});
