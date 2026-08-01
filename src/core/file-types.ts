export const FILE_TYPE_CATEGORY_IDS = [
  "obsidian",
  "image",
  "audio",
  "video",
  "fixed-layout",
  "other",
] as const;

export type FileTypeCategoryId = (typeof FILE_TYPE_CATEGORY_IDS)[number];

export const FORMAT_FAMILY_IDS = [
  "markdown",
  "bases",
  "canvas",
  "jpeg",
  "png",
  "tiff",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
  "heif-heic",
  "flac",
  "m4a-aac",
  "mp3",
  "ogg-audio",
  "wav",
  "webm-audio",
  "3gp-audio",
  "mkv",
  "mov",
  "mp4-m4v",
  "ogv",
  "webm-video",
  "pdf",
  "office-document",
  "office-spreadsheet",
  "office-presentation",
  "archive",
  "ebook",
  "other-custom",
] as const;

export type FormatFamilyId = (typeof FORMAT_FAMILY_IDS)[number];

export interface FormatFamilyDefinition {
  readonly id: FormatFamilyId;
  readonly labelKey: `fileType.family.${FormatFamilyId}`;
  readonly extensions: readonly string[];
}

export interface FileTypeCategoryDefinition {
  readonly id: FileTypeCategoryId;
  readonly labelKey: `fileType.category.${FileTypeCategoryId}`;
  readonly families: readonly FormatFamilyDefinition[];
}

const family = (
  id: FormatFamilyId,
  extensions: readonly string[],
): FormatFamilyDefinition => ({
  id,
  labelKey: `fileType.family.${id}`,
  extensions,
});

export const FILE_TYPE_CATEGORIES: readonly FileTypeCategoryDefinition[] = [
  {
    id: "obsidian",
    labelKey: "fileType.category.obsidian",
    families: [
      family("markdown", ["md"]),
      family("bases", ["base"]),
      family("canvas", ["canvas"]),
    ],
  },
  {
    id: "image",
    labelKey: "fileType.category.image",
    families: [
      family("jpeg", ["jpg", "jpeg", "jpe"]),
      family("png", ["png"]),
      family("tiff", ["tif", "tiff"]),
      family("gif", ["gif"]),
      family("webp", ["webp"]),
      family("avif", ["avif"]),
      family("bmp", ["bmp"]),
      family("svg", ["svg"]),
      family("heif-heic", ["heif", "heic"]),
    ],
  },
  {
    id: "audio",
    labelKey: "fileType.category.audio",
    families: [
      family("flac", ["flac"]),
      family("m4a-aac", ["m4a", "aac"]),
      family("mp3", ["mp3"]),
      family("ogg-audio", ["ogg", "oga"]),
      family("wav", ["wav"]),
      family("webm-audio", ["webm"]),
      family("3gp-audio", ["3gp"]),
    ],
  },
  {
    id: "video",
    labelKey: "fileType.category.video",
    families: [
      family("mkv", ["mkv"]),
      family("mov", ["mov"]),
      family("mp4-m4v", ["mp4", "m4v"]),
      family("ogv", ["ogv"]),
      family("webm-video", ["webm"]),
    ],
  },
  {
    id: "fixed-layout",
    labelKey: "fileType.category.fixed-layout",
    families: [family("pdf", ["pdf"])],
  },
  {
    id: "other",
    labelKey: "fileType.category.other",
    families: [
      family("office-document", ["doc", "docx", "odt", "rtf"]),
      family("office-spreadsheet", ["xls", "xlsx", "ods"]),
      family("office-presentation", ["ppt", "pptx", "odp"]),
      family("archive", ["zip", "7z", "rar", "tar", "gz", "bz2", "xz"]),
      family("ebook", ["epub", "mobi", "azw", "azw3"]),
      family("other-custom", []),
    ],
  },
] as const;

export const DEFAULT_ISOLATED_CANDIDATE_FAMILIES:
readonly FormatFamilyId[] = [...FORMAT_FAMILY_IDS];

export interface FileExtensionClassification {
  readonly extension: string;
  readonly familyIds: readonly FormatFamilyId[];
  readonly categoryIds: readonly FileTypeCategoryId[];
  readonly primaryFamilyId: FormatFamilyId;
  readonly primaryCategoryId: FileTypeCategoryId;
  readonly isKnown: boolean;
}

const familiesByExtension = new Map<string, FormatFamilyDefinition[]>();
const categoryByFamily = new Map<FormatFamilyId, FileTypeCategoryId>();

for (const category of FILE_TYPE_CATEGORIES) {
  for (const formatFamily of category.families) {
    categoryByFamily.set(formatFamily.id, category.id);
    for (const extension of formatFamily.extensions) {
      const matches = familiesByExtension.get(extension) ?? [];
      matches.push(formatFamily);
      familiesByExtension.set(extension, matches);
    }
  }
}

const preferredAmbiguousFamily = new Map<string, FormatFamilyId>([
  ["webm", "webm-video"],
]);

export function classifyFileExtension(pathOrExtension: string): FileExtensionClassification {
  const extension = normalizeExtension(pathOrExtension);
  const knownMatches = familiesByExtension.get(extension) ?? [];
  const matches = knownMatches.length > 0
    ? knownMatches
    : [getFamily("other-custom")];
  const preferredId = preferredAmbiguousFamily.get(extension);
  const primary = matches.find(({ id }) => id === preferredId) ?? matches[0];
  if (primary === undefined) {
    throw new Error("File type registry must always produce a primary family.");
  }
  const categoryIds = Array.from(new Set(matches.map(({ id }) => getCategoryId(id))));

  return {
    extension,
    familyIds: matches.map(({ id }) => id),
    categoryIds,
    primaryFamilyId: primary.id,
    primaryCategoryId: getCategoryId(primary.id),
    isKnown: knownMatches.length > 0,
  };
}

export function normalizeExtension(pathOrExtension: string): string {
  const normalized = pathOrExtension.trim().split("\\").join("/").toLocaleLowerCase("en-US");
  const segments = normalized.split("/");
  const basename = segments[segments.length - 1] ?? normalized;
  if (!normalized.includes("/") && !basename.includes(".")) return basename;
  if (basename.startsWith(".") && basename.indexOf(".", 1) === -1) {
    return basename.slice(1);
  }
  const dotIndex = basename.lastIndexOf(".");
  return dotIndex > 0 && dotIndex < basename.length - 1
    ? basename.slice(dotIndex + 1)
    : "";
}

function getFamily(id: FormatFamilyId): FormatFamilyDefinition {
  for (const category of FILE_TYPE_CATEGORIES) {
    const match = category.families.find((candidate) => candidate.id === id);
    if (match !== undefined) return match;
  }
  throw new Error(`Unknown format family: ${id}`);
}

function getCategoryId(id: FormatFamilyId): FileTypeCategoryId {
  const categoryId = categoryByFamily.get(id);
  if (categoryId === undefined) throw new Error(`No category for format family: ${id}`);
  return categoryId;
}
