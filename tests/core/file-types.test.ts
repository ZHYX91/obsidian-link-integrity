import { describe, expect, it } from "vitest";

import {
  DEFAULT_ISOLATED_CANDIDATE_FAMILIES,
  FILE_TYPE_CATEGORIES,
  FORMAT_FAMILY_IDS,
  classifyFileExtension,
} from "../../src/core/file-types";
import { createFileRecord } from "../../src/core/model";
import { isCandidateFile } from "../../src/core/scopes";

describe("file type registry", () => {
  it("groups extension aliases into stable format families", () => {
    expect(classifyFileExtension("Images/Photo.JPEG")).toMatchObject({
      extension: "jpeg",
      familyIds: ["jpeg"],
      categoryIds: ["image"],
      primaryFamilyId: "jpeg",
    });
    expect(classifyFileExtension("scan.TIF").familyIds).toEqual(["tiff"]);
    expect(classifyFileExtension("document.pdf").primaryCategoryId).toBe("fixed-layout");
  });

  it("represents ambiguous WebM media without losing either category", () => {
    const result = classifyFileExtension("clip.webm");
    expect(result.familyIds).toEqual(["webm-audio", "webm-video"]);
    expect(result.categoryIds).toEqual(["audio", "video"]);
    expect(result.primaryFamilyId).toBe("webm-video");
  });

  it("classifies unknown extensions as custom attachments", () => {
    expect(classifyFileExtension("diagram.drawio")).toMatchObject({
      extension: "drawio",
      familyIds: ["other-custom"],
      categoryIds: ["other"],
      isKnown: false,
    });
  });

  it("keeps registry IDs unique and selects every family by default", () => {
    const registered = FILE_TYPE_CATEGORIES.flatMap(({ families }) =>
      families.map(({ id }) => id));
    expect(new Set(registered).size).toBe(registered.length);
    expect(registered).toEqual(FORMAT_FAMILY_IDS);
    expect(DEFAULT_ISOLATED_CANDIDATE_FAMILIES).toEqual(FORMAT_FAMILY_IDS);
  });

  it("treats other-custom as a configured extension slot, not every unknown file", () => {
    const defaultFamilies = new Set(DEFAULT_ISOLATED_CANDIDATE_FAMILIES);
    const drawio = createFileRecord("diagram.DRAWIO");

    expect(isCandidateFile(drawio, {
      familyIds: defaultFamilies,
      customExtensions: new Set(),
    })).toBe(false);
    expect(isCandidateFile(drawio, {
      familyIds: defaultFamilies,
      customExtensions: new Set([".drawio"]),
    })).toBe(true);
    expect(isCandidateFile(drawio, {
      familyIds: new Set(DEFAULT_ISOLATED_CANDIDATE_FAMILIES.filter((id) =>
        id !== "other-custom")),
      customExtensions: new Set(["drawio"]),
    })).toBe(false);
  });
});
