import {
  PERIODIC_NOTE_KINDS,
  type ExpectedIsolationRule,
} from "../core";
import type { IsolatedFileSettings } from "../shared/settings";

export function findPureExpectedFolderRule(
  rules: readonly ExpectedIsolationRule[],
  path: string,
  mode: "exact" | "recursive",
): ExpectedIsolationRule | null {
  return rules.find((rule) =>
    rule.folder?.path === path &&
    rule.folder.mode === mode &&
    rule.fileTypeFamilyIds.length === 0 &&
    rule.fileTypeCategoryIds.length === 0 &&
    rule.fileExtensions.length === 0 &&
    rule.namingPatterns.length === 0) ?? null;
}

export function renameExpectedIsolationFolder(
  settings: IsolatedFileSettings,
  oldPath: string,
  newPath: string,
): IsolatedFileSettings {
  if (oldPath.length === 0 || oldPath === newPath) return settings;
  let changed = false;
  const rename = (path: string): string => {
    const renamed = renamePathPrefix(path, oldPath, newPath);
    if (renamed !== path) changed = true;
    return renamed;
  };
  const expectedFilePaths = settings.expectedFilePaths.map(rename);
  const expectedRules = settings.expectedRules.map((rule) => {
    if (rule.folder === null) return rule;
    const path = rename(rule.folder.path);
    return path === rule.folder.path ? rule : {
      ...rule,
      folder: { ...rule.folder, path },
    };
  });
  const entries = Object.fromEntries(PERIODIC_NOTE_KINDS.map((kind) => {
    const entry = settings.periodicNotesPreset.entries[kind];
    const folder = rename(entry.folder);
    return [kind, folder === entry.folder ? entry : { ...entry, folder }];
  })) as typeof settings.periodicNotesPreset.entries;
  if (!changed) return settings;
  return {
    ...settings,
    expectedFilePaths,
    expectedRules,
    periodicNotesPreset: {
      ...settings.periodicNotesPreset,
      entries,
    },
  };
}

function renamePathPrefix(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  return path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path;
}
