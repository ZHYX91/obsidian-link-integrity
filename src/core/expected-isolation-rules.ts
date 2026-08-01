import {
  FILE_TYPE_CATEGORY_IDS,
  FORMAT_FAMILY_IDS,
  classifyFileExtension,
  normalizeExtension,
  type FileTypeCategoryId,
  type FormatFamilyId,
} from "./file-types";
import type { FileRecord } from "./model";
import { normalizeVaultPath } from "./model";

export const EXPECTED_NAMING_PATTERN_KINDS = ["date-format", "glob", "regex"] as const;
export type ExpectedNamingPatternKind = (typeof EXPECTED_NAMING_PATTERN_KINDS)[number];
export type ExpectedPatternTarget = "basename" | "path";

export interface ExpectedNamingPattern {
  readonly id: string;
  readonly kind: ExpectedNamingPatternKind;
  readonly pattern: string;
  readonly flags: string;
  readonly target: ExpectedPatternTarget;
}

export interface ExpectedFolderCondition {
  readonly path: string;
  readonly mode: "exact" | "recursive";
}

/** File type, folder, and the pattern group are AND conditions; patterns are OR. */
export interface ExpectedIsolationRule {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly fileTypeFamilyIds: readonly FormatFamilyId[];
  readonly fileTypeCategoryIds: readonly FileTypeCategoryId[];
  readonly fileExtensions: readonly string[];
  readonly folder: ExpectedFolderCondition | null;
  readonly namingPatterns: readonly ExpectedNamingPattern[];
}

/** Compatibility name used by the isolated-file projection. */
export type ExpectedIsolatedRule = ExpectedIsolationRule;

export interface ExpectedRuleMatch {
  readonly expected: boolean;
  readonly matchedRuleIds: readonly string[];
}

export interface ExpectedRuleStats {
  readonly ruleId: string;
  readonly name: string;
  readonly matchCount: number;
  readonly samples: readonly string[];
  readonly errors: readonly string[];
}

export const PERIODIC_NOTE_KINDS = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;

export type PeriodicNoteKind = (typeof PERIODIC_NOTE_KINDS)[number];
export type PeriodicNotePresetId = PeriodicNoteKind;

export interface PeriodicNotePresetEntry {
  readonly enabled: boolean;
  readonly folder: string;
  readonly includeSubfolders: boolean;
  readonly dateFormats: readonly string[];
}

export interface PeriodicNotesPreset {
  readonly enabled: boolean;
  readonly entries: Readonly<Record<PeriodicNoteKind, PeriodicNotePresetEntry>>;
}

export const PERIODIC_NOTE_PRESETS: Readonly<Record<PeriodicNoteKind, {
  readonly defaultName: string;
  readonly dateFormat: string;
}>> = {
  daily: { defaultName: "Daily notes", dateFormat: "YYYY-MM-DD" },
  weekly: { defaultName: "Weekly notes", dateFormat: "GGGG-[W]WW" },
  monthly: { defaultName: "Monthly notes", dateFormat: "YYYY-MM" },
  quarterly: { defaultName: "Quarterly notes", dateFormat: "YYYY-[Q]Q" },
  yearly: { defaultName: "Yearly notes", dateFormat: "YYYY" },
};

const compiledPatternCache = new WeakMap<ExpectedNamingPattern, RegExp>();
const validationCache = new WeakMap<ExpectedIsolationRule, readonly string[]>();

export function createDefaultPeriodicNotesPreset(): PeriodicNotesPreset {
  return {
    enabled: false,
    entries: Object.fromEntries(PERIODIC_NOTE_KINDS.map((kind) => [
      kind,
      periodicEntry("", [PERIODIC_NOTE_PRESETS[kind].dateFormat]),
    ])) as unknown as Readonly<Record<PeriodicNoteKind, PeriodicNotePresetEntry>>,
  };
}

export function createPeriodicExpectedIsolatedRule(
  presetId: PeriodicNoteKind,
  options: {
    readonly id?: string;
    readonly name?: string;
    readonly enabled?: boolean;
    readonly folderPath?: string;
    readonly folderMode?: "exact" | "recursive";
    readonly dateFormats?: readonly string[];
    readonly fileTypeFamilyIds?: readonly FormatFamilyId[];
    readonly fileTypeCategoryIds?: readonly FileTypeCategoryId[];
    readonly fileExtensions?: readonly string[];
  } = {},
): ExpectedIsolationRule {
  const preset = PERIODIC_NOTE_PRESETS[presetId];
  const formats = options.dateFormats ?? [preset.dateFormat];
  return {
    id: options.id ?? `periodic-${presetId}`,
    name: options.name ?? preset.defaultName,
    enabled: options.enabled ?? true,
    fileTypeFamilyIds: options.fileTypeFamilyIds ?? ["markdown"],
    fileTypeCategoryIds: options.fileTypeCategoryIds ?? [],
    fileExtensions: normalizeExtensions(options.fileExtensions ?? []),
    folder: options.folderPath === undefined
      ? null
      : {
        path: normalizeFolderPath(options.folderPath),
        mode: options.folderMode ?? "recursive",
      },
    namingPatterns: formats.map((format, index) => ({
      id: `${presetId}-format-${index + 1}`,
      kind: "date-format",
      pattern: format,
      flags: "u",
      target: "basename",
    })),
  };
}

export function createPeriodicExpectedIsolationRules(
  preset: PeriodicNotesPreset,
): readonly ExpectedIsolationRule[] {
  if (!preset.enabled) return [];
  return PERIODIC_NOTE_KINDS
    .filter((kind) => preset.entries[kind].enabled)
    .map((kind) => {
      const entry = preset.entries[kind];
      return createPeriodicExpectedIsolatedRule(kind, {
        folderPath: entry.folder,
        folderMode: entry.includeSubfolders ? "recursive" : "exact",
        dateFormats: entry.dateFormats,
      });
    });
}

export function normalizeExpectedIsolationRules(value: unknown): ExpectedIsolationRule[] {
  if (!Array.isArray(value)) return [];
  const result: ExpectedIsolationRule[] = [];
  const seenIds = new Set<string>();
  for (const candidate of value) {
    const rule = normalizeExpectedIsolationRule(candidate);
    if (rule === null || seenIds.has(rule.id)) continue;
    seenIds.add(rule.id);
    result.push(rule);
  }
  return result;
}

export function normalizePeriodicNotesPreset(value: unknown): PeriodicNotesPreset {
  const defaults = createDefaultPeriodicNotesPreset();
  if (!isRecord(value)) return defaults;
  const entries = isRecord(value.entries) ? value.entries : {};
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    entries: Object.fromEntries(PERIODIC_NOTE_KINDS.map((kind) => [
      kind,
      normalizePeriodicEntry(entries[kind], defaults.entries[kind]),
    ])) as unknown as Readonly<Record<PeriodicNoteKind, PeriodicNotePresetEntry>>,
  };
}

export function hasExpectedRuleCondition(rule: ExpectedIsolationRule): boolean {
  return rule.fileTypeFamilyIds.length > 0 ||
    rule.fileTypeCategoryIds.length > 0 ||
    rule.fileExtensions.length > 0 ||
    rule.folder !== null ||
    rule.namingPatterns.length > 0;
}

export function matchExpectedIsolationRules(
  file: FileRecord,
  rules: readonly ExpectedIsolationRule[],
): ExpectedRuleMatch {
  const matchedRuleIds = rules
    .filter((rule) => rule.enabled && matchesExpectedIsolationRule(file, rule))
    .map(({ id }) => id);
  return { expected: matchedRuleIds.length > 0, matchedRuleIds };
}

export const matchExpectedIsolatedRules = matchExpectedIsolationRules;

export function matchesExpectedIsolationRule(
  file: FileRecord,
  rule: ExpectedIsolationRule,
): boolean {
  if (!rule.enabled || validateExpectedIsolationRule(rule).length > 0) return false;
  if (!matchesFileType(file, rule)) return false;
  if (rule.folder !== null && !matchesFolder(file.path, rule.folder)) return false;
  if (rule.namingPatterns.length === 0) return true;
  return rule.namingPatterns.some((pattern) => matchesPattern(file, pattern));
}

export const matchesExpectedIsolatedRule = matchesExpectedIsolationRule;

export function getExpectedRuleStats(
  files: readonly FileRecord[],
  rules: readonly ExpectedIsolationRule[],
  sampleLimit = 5,
): readonly ExpectedRuleStats[] {
  return rules.map((rule) => {
    const errors = validateExpectedIsolationRule(rule);
    const matches = errors.length === 0
      ? files.filter((file) => matchesExpectedIsolationRule(file, rule))
      : [];
    return {
      ruleId: rule.id,
      name: rule.name,
      matchCount: matches.length,
      samples: matches.slice(0, Math.max(0, sampleLimit)).map(({ path }) => path),
      errors,
    };
  });
}

export function validateExpectedIsolationRule(rule: ExpectedIsolationRule): readonly string[] {
  const cached = validationCache.get(rule);
  if (cached !== undefined) return cached;
  const errors: string[] = [];
  if (!isValidIdentifier(rule.id)) errors.push("Rule ID is invalid.");
  if (rule.name.trim().length === 0) errors.push("Rule name cannot be empty.");
  if (!hasExpectedRuleCondition(rule)) errors.push("Rule must have at least one condition.");
  if (rule.folder !== null) {
    try {
      normalizeFolderPath(rule.folder.path);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const pattern of rule.namingPatterns) {
    try {
      getCompiledPattern(pattern);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  validationCache.set(rule, errors);
  return errors;
}

export const validateExpectedIsolatedRule = validateExpectedIsolationRule;

export function compileDateFormat(format: string): RegExp {
  if (format.length === 0) throw new Error("Date format cannot be empty.");
  const tokens: Readonly<Record<string, string>> = {
    GGGG: "\\d{4}",
    YYYY: "\\d{4}",
    MM: "(?:0[1-9]|1[0-2])",
    DD: "(?:0[1-9]|[12]\\d|3[01])",
    WW: "(?:0[1-9]|[1-4]\\d|5[0-3])",
    Q: "[1-4]",
  };
  const tokenNames = Object.keys(tokens).sort((left, right) => right.length - left.length);
  let source = "^";
  let index = 0;
  while (index < format.length) {
    if (format[index] === "[") {
      const close = format.indexOf("]", index + 1);
      if (close === -1) throw new Error(`Unclosed date-format literal: ${format}`);
      source += escapeRegExp(format.slice(index + 1, close));
      index = close + 1;
      continue;
    }
    const token = tokenNames.find((candidate) => format.startsWith(candidate, index));
    if (token !== undefined) {
      source += tokens[token];
      index += token.length;
      continue;
    }
    const character = format[index] ?? "";
    if (/[A-Za-z]/u.test(character)) {
      throw new Error(`Unsupported date-format token near: ${format.slice(index)}`);
    }
    source += escapeRegExp(character);
    index += 1;
  }
  return new RegExp(`${source}$`, "u");
}

function normalizeExpectedIsolationRule(value: unknown): ExpectedIsolationRule | null {
  if (!isRecord(value)) return null;
  const id = normalizeIdentifier(value.id);
  const name = normalizeLabel(value.name);
  if (id === null || name === null) return null;
  const rule: ExpectedIsolationRule = {
    id,
    name,
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    fileTypeFamilyIds: normalizeFormatFamilyIds(
      value.fileTypeFamilyIds ?? nestedValue(value.fileType, "familyIds"),
    ),
    fileTypeCategoryIds: normalizeCategoryIds(
      value.fileTypeCategoryIds ?? nestedValue(value.fileType, "categoryIds"),
    ),
    fileExtensions: normalizeExtensions(
      value.fileExtensions ?? nestedValue(value.fileType, "extensions"),
    ),
    folder: normalizeFolderCondition(value.folder),
    namingPatterns: normalizeNamingPatterns(value.namingPatterns ?? value.patterns),
  };
  return hasExpectedRuleCondition(rule) ? rule : { ...rule, enabled: false };
}

function normalizeNamingPatterns(value: unknown): ExpectedNamingPattern[] {
  if (!Array.isArray(value)) return [];
  const result: ExpectedNamingPattern[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    if (!isRecord(candidate)) continue;
    const kind = candidate.kind;
    if (!isExpectedNamingPatternKind(kind)) continue;
    const id = normalizeIdentifier(candidate.id) ?? `pattern-${index + 1}`;
    const pattern = normalizePattern(candidate.pattern ?? candidate.format ?? candidate.source, kind);
    if (pattern === null || ids.has(id)) continue;
    ids.add(id);
    result.push({
      id,
      kind,
      pattern,
      flags: normalizePatternFlags(candidate.flags, kind, candidate.caseSensitive),
      target: candidate.target === "path" ? "path" : "basename",
    });
  }
  return result;
}

function normalizeFolderCondition(value: unknown): ExpectedFolderCondition | null {
  if (!isRecord(value) || typeof value.path !== "string") return null;
  const mode = value.mode;
  if (mode !== "exact" && mode !== "recursive") return null;
  try {
    return { path: normalizeFolderPath(value.path), mode };
  } catch {
    return null;
  }
}

function normalizePeriodicEntry(
  value: unknown,
  defaults: PeriodicNotePresetEntry,
): PeriodicNotePresetEntry {
  if (!isRecord(value)) return { ...defaults, dateFormats: [...defaults.dateFormats] };
  const rawFormats = Array.isArray(value.dateFormats) ? value.dateFormats : [];
  const dateFormats = Array.from(new Set(rawFormats
    .map((candidate) => normalizePattern(candidate, "date-format"))
    .filter((candidate): candidate is string => candidate !== null)));
  let folder = defaults.folder;
  if (typeof value.folder === "string") {
    try {
      folder = normalizeFolderPath(value.folder);
    } catch {
      folder = defaults.folder;
    }
  }
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    folder,
    includeSubfolders: typeof value.includeSubfolders === "boolean"
      ? value.includeSubfolders
      : defaults.includeSubfolders,
    dateFormats: dateFormats.length > 0 ? dateFormats : [...defaults.dateFormats],
  };
}

function matchesFileType(file: FileRecord, rule: ExpectedIsolationRule): boolean {
  const hasCondition = rule.fileTypeFamilyIds.length > 0 ||
    rule.fileTypeCategoryIds.length > 0 ||
    rule.fileExtensions.length > 0;
  if (!hasCondition) return true;
  const classification = classifyFileExtension(file.extension.length > 0
    ? file.extension
    : file.path);
  const extension = normalizeExtension(file.extension.length > 0 ? file.extension : file.path);
  return classification.familyIds.some((id) => rule.fileTypeFamilyIds.includes(id)) ||
    classification.categoryIds.some((id) => rule.fileTypeCategoryIds.includes(id)) ||
    rule.fileExtensions.includes(extension);
}

function matchesFolder(path: string, condition: ExpectedFolderCondition): boolean {
  const folder = normalizeFolderPath(condition.path);
  const parent = parentFolder(normalizeVaultPath(path));
  if (condition.mode === "exact") return parent === folder;
  return folder.length === 0 || parent === folder || parent.startsWith(`${folder}/`);
}

function matchesPattern(file: FileRecord, pattern: ExpectedNamingPattern): boolean {
  return getCompiledPattern(pattern).test(patternValue(file, pattern.target));
}

function getCompiledPattern(pattern: ExpectedNamingPattern): RegExp {
  const cached = compiledPatternCache.get(pattern);
  if (cached !== undefined) return cached;
  const compiled = compilePattern(pattern);
  compiledPatternCache.set(pattern, compiled);
  return compiled;
}

function compilePattern(pattern: ExpectedNamingPattern): RegExp {
  if (pattern.kind === "date-format") return compileDateFormat(pattern.pattern);
  if (pattern.kind === "glob") return compileGlob(pattern.pattern, pattern.flags.includes("i"));
  if (/[gy]/u.test(pattern.flags)) throw new Error("Regex flags g and y are not supported.");
  const flags = pattern.flags.includes("u") ? pattern.flags : `${pattern.flags}u`;
  return new RegExp(pattern.pattern, flags);
}

function compileGlob(pattern: string, caseInsensitive: boolean): RegExp {
  if (pattern.length === 0) throw new Error("Glob pattern cannot be empty.");
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? "";
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else source += "[^/]*";
    } else if (character === "?") source += "[^/]";
    else source += escapeRegExp(character);
  }
  return new RegExp(`${source}$`, caseInsensitive ? "iu" : "u");
}

function patternValue(file: FileRecord, target: ExpectedPatternTarget): string {
  return target === "path" ? file.path : basenameWithoutExtension(file);
}

function basenameWithoutExtension(file: FileRecord): string {
  const segments = file.path.split("/");
  const basename = segments[segments.length - 1] ?? file.path;
  const extension = normalizeExtension(file.extension.length > 0 ? file.extension : file.path);
  return extension.length > 0 && basename.toLocaleLowerCase("en-US").endsWith(`.${extension}`)
    ? basename.slice(0, -(extension.length + 1))
    : basename;
}

function parentFolder(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function normalizeFolderPath(path: string): string {
  const trimmed = path.trim().split("\\").join("/").replace(/^\/+|\/+$/gu, "");
  if (trimmed.length === 0) return "";
  return normalizeVaultPath(trimmed);
}

function periodicEntry(folder: string, dateFormats: readonly string[]): PeriodicNotePresetEntry {
  return { enabled: true, folder, includeSubfolders: true, dateFormats: [...dateFormats] };
}

function normalizeFormatFamilyIds(value: unknown): FormatFamilyId[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isFormatFamilyId)));
}

function normalizeCategoryIds(value: unknown): FileTypeCategoryId[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isFileTypeCategoryId)));
}

function normalizeExtensions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map(normalizeExtension)
    .filter((candidate) => candidate.length > 0)));
}

function isFormatFamilyId(value: unknown): value is FormatFamilyId {
  return typeof value === "string" &&
    (FORMAT_FAMILY_IDS as readonly string[]).includes(value);
}

function isFileTypeCategoryId(value: unknown): value is FileTypeCategoryId {
  return typeof value === "string" &&
    (FILE_TYPE_CATEGORY_IDS as readonly string[]).includes(value);
}

function isExpectedNamingPatternKind(value: unknown): value is ExpectedNamingPatternKind {
  return typeof value === "string" &&
    (EXPECTED_NAMING_PATTERN_KINDS as readonly string[]).includes(value);
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isValidIdentifier(trimmed) ? trimmed : null;
}

function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 120 ? trimmed : null;
}

function normalizePattern(value: unknown, kind: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const maximum = kind === "regex" ? 512 : 256;
  return trimmed.length > 0 && trimmed.length <= maximum ? trimmed : null;
}

function normalizePatternFlags(value: unknown, kind: ExpectedNamingPatternKind, caseSensitive: unknown): string {
  if (kind === "date-format") return "u";
  if (kind === "glob") return caseSensitive === true ? "u" : "iu";
  const input = typeof value === "string" ? value : "u";
  const flags = Array.from(new Set(input.split("").filter((flag) => flag === "i" || flag === "u")));
  if (!flags.includes("u")) flags.push("u");
  return flags.sort().join("");
}

function nestedValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
