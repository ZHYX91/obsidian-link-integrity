import { describe, expect, it } from "vitest";

import {
  createFileRecord,
  LinkIndex,
  makeOccurrenceLookupKey,
  type LinkOccurrence,
} from "../../src/core";
import { SidebarQueryService } from "../../src/app/sidebar-query-service";
import { createDefaultSettings } from "../../src/shared/settings";

describe("SidebarQueryService", () => {
  it("keeps expected isolation separate while still reporting its broken links", () => {
    const files = [
      createFileRecord("Daily/2026-08-02.md"),
      createFileRecord("Loose.md"),
      createFileRecord("Connected-A.md"),
      createFileRecord("Connected-B.md"),
    ];
    const index = new LinkIndex(files);
    index.replaceSourceSnapshot("Daily/2026-08-02.md", {
      sourcePath: "Daily/2026-08-02.md",
      occurrences: [
        resolved("Daily/2026-08-02.md", "Daily/2026-08-02.md", "self"),
        missing("Daily/2026-08-02.md", "Missing daily target", "daily-missing"),
      ],
    });
    index.replaceSourceSnapshot("Loose.md", {
      sourcePath: "Loose.md",
      occurrences: [missing("Loose.md", "Missing", "loose-missing")],
    });
    index.replaceSourceSnapshot("Connected-A.md", {
      sourcePath: "Connected-A.md",
      occurrences: [resolved("Connected-A.md", "Connected-B.md", "connection")],
    });
    const defaults = createDefaultSettings();
    const settings = {
      ...defaults,
      isolatedFiles: {
        ...defaults.isolatedFiles,
        periodicNotesPreset: {
          ...defaults.isolatedFiles.periodicNotesPreset,
          enabled: true,
          entries: {
            ...defaults.isolatedFiles.periodicNotesPreset.entries,
            daily: {
              enabled: true,
              folder: "Daily",
              includeSubfolders: true,
              dateFormats: ["YYYY-MM-DD"],
            },
          },
        },
      },
    };
    const query = new SidebarQueryService(() => index, () => settings);

    const snapshot = query.getSnapshot();

    expect(snapshot.isolatedFiles).toEqual([
      expect.objectContaining({
        path: "Daily/2026-08-02.md",
        brokenOutgoingCount: 1,
        expectation: expect.objectContaining({ kind: "expected" }),
      }),
      expect.objectContaining({
        path: "Loose.md",
        brokenOutgoingCount: 1,
        expectation: { kind: "unexpected", ruleIds: [] },
      }),
    ]);
    expect(snapshot.brokenLinks.map(({ sourcePath }) => sourcePath)).toEqual([
      "Daily/2026-08-02.md",
      "Loose.md",
    ]);
    expect(index.getSelfLinkCount("Daily/2026-08-02.md")).toBe(1);
    expect(index.getIncomingNeighborCount("Daily/2026-08-02.md")).toBe(0);
  });

  it("applies broken-result and isolated-candidate rules without changing the graph", () => {
    const index = new LinkIndex([
      createFileRecord("Hidden-source.md"),
      createFileRecord("Hidden-candidate.pdf"),
    ]);
    index.replaceSourceSnapshot("Hidden-source.md", {
      sourcePath: "Hidden-source.md",
      occurrences: [missing("Hidden-source.md", "Missing", "hidden-occurrence")],
    });
    const defaults = createDefaultSettings();
    const settings = {
      ...defaults,
      ignoreRules: [
        {
          id: "hide-one",
          enabled: true,
          scope: "ignore-occurrence" as const,
          matcher: { kind: "occurrence-id" as const, value: "hidden-occurrence" },
          createdAt: 0,
          note: "",
        },
        {
          id: "hide-pdf",
          enabled: true,
          scope: "exclude-isolated-candidate" as const,
          matcher: { kind: "source-path" as const, value: "Hidden-candidate.pdf" },
          createdAt: 0,
          note: "",
        },
      ],
    };
    const query = new SidebarQueryService(() => index, () => settings);

    const snapshot = query.getSnapshot();

    expect(snapshot.brokenLinks).toEqual([]);
    expect(snapshot.isolatedFiles.map(({ path }) => path)).toEqual(["Hidden-source.md"]);
    expect(index.getOutgoingNeighborCount("Hidden-source.md")).toBe(0);
  });
});

function resolved(sourcePath: string, targetPath: string, id: string): LinkOccurrence {
  return {
    id,
    sourcePath,
    raw: `[[${targetPath}]]`,
    linkpath: targetPath,
    subpath: null,
    lookupKey: makeOccurrenceLookupKey(targetPath, sourcePath),
    kind: "markdown-link",
    position: null,
    destinationKind: "internal",
    targetPath,
    fileStatus: "resolved",
    subpathStatus: "none",
  };
}

function missing(sourcePath: string, linkpath: string, id: string): LinkOccurrence {
  return {
    id,
    sourcePath,
    raw: `[[${linkpath}]]`,
    linkpath,
    subpath: null,
    lookupKey: makeOccurrenceLookupKey(linkpath, sourcePath),
    kind: "markdown-link",
    position: null,
    destinationKind: "internal",
    targetPath: null,
    fileStatus: "missing",
    subpathStatus: "none",
  };
}
