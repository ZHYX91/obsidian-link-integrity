import { describe, expect, it } from "vitest";

import {
  createFileRecord,
  makeFileLookupKeys,
  makeOccurrenceLookupKey,
  normalizeLookupKey,
  validateSourceSnapshot,
} from "../../src/core/model";
import { occurrence, snapshot } from "./test-helpers";

describe("core model normalization", () => {
  it("uses one conservative lookup-key namespace", () => {
    expect(normalizeLookupKey(" Folder\\Note.MD ")).toBe("folder/note");
    expect(normalizeLookupKey("notes/foo.bar")).toBe("notes/foo.bar");
    expect(makeFileLookupKeys("Folder/Note.md")).toEqual(["folder/note", "note"]);
    expect(makeOccurrenceLookupKey("../Target.md", "Folder/Sub/Source.md")).toBe(
      "folder/target",
    );
    expect(createFileRecord("Folder/Note.md").lookupKeys).toEqual(["folder/note", "note"]);
  });

  it("rejects inconsistent resolution state before index mutation", () => {
    const invalid = {
      ...occurrence("bad", "Source.md", { targetPath: "Target.md" }),
      fileStatus: "missing" as const,
    };
    expect(() => validateSourceSnapshot(snapshot("Source.md", [invalid]))).toThrow(
      "Unresolved occurrence",
    );
  });
});
