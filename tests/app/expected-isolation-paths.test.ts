import { describe, expect, it } from "vitest";

import type { ExpectedIsolationRule } from "../../src/core";
import {
  findPureExpectedFolderRule,
  renameExpectedIsolationFolder,
} from "../../src/app/expected-isolation-paths";
import { createDefaultSettings } from "../../src/shared/settings";

describe("expected-isolation folder paths", () => {
  it("renames exact files, folder rules, and periodic folders on a folder move", () => {
    const defaults = createDefaultSettings().isolatedFiles;
    const rule = folderRule("archive", "Archive", false);
    const renamed = renameExpectedIsolationFolder({
      ...defaults,
      expectedFilePaths: ["Archive/A.md", "Elsewhere.md"],
      expectedRules: [rule, folderRule("nested", "Archive/Nested", true)],
      periodicNotesPreset: {
        ...defaults.periodicNotesPreset,
        entries: {
          ...defaults.periodicNotesPreset.entries,
          daily: {
            ...defaults.periodicNotesPreset.entries.daily,
            folder: "Archive/Daily",
          },
        },
      },
    }, "Archive", "Stored");

    expect(renamed.expectedFilePaths).toEqual(["Stored/A.md", "Elsewhere.md"]);
    expect(renamed.expectedRules.map(({ folder }) => folder?.path)).toEqual([
      "Stored",
      "Stored/Nested",
    ]);
    expect(renamed.periodicNotesPreset.entries.daily.folder).toBe("Stored/Daily");
  });

  it("keeps settings identity when the renamed folder is unrelated", () => {
    const settings = createDefaultSettings().isolatedFiles;
    expect(renameExpectedIsolationFolder(settings, "Other", "Moved")).toBe(settings);
  });

  it("finds disabled pure folder rules without confusing compound rules", () => {
    const pure = folderRule("pure", "Archive", false);
    const compound = { ...folderRule("compound", "Archive", false), fileExtensions: ["md"] };
    expect(findPureExpectedFolderRule([compound, pure], "Archive", "recursive")).toBe(pure);
  });
});

function folderRule(id: string, path: string, enabled: boolean): ExpectedIsolationRule {
  return {
    id,
    name: id,
    enabled,
    fileTypeFamilyIds: [],
    fileTypeCategoryIds: [],
    fileExtensions: [],
    folder: { path, mode: "recursive" },
    namingPatterns: [],
  };
}
