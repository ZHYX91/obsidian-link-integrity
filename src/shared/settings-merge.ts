import { loadSettings, normalizeSettings, type LinkIntegritySettings, type SettingsLoadResult } from "./settings";

export function settingsFileUpdate(
  base: LinkIntegritySettings,
  local: LinkIntegritySettings,
  raw: unknown,
): { readonly result: SettingsLoadResult; readonly write?: LinkIntegritySettings } {
  const current = loadSettings(raw);
  if (current.writeProtected) return { result: current };
  const merged = mergeSettings(base, local, current.settings);
  if (raw !== null && !current.shouldPersistMigration && JSON.stringify(current.settings) === JSON.stringify(merged)) {
    return { result: current };
  }
  return { result: loadSettings(merged), write: merged };
}

/** Apply only local edits since the last observed disk version to the latest settings. */
export function mergeSettings(
  base: LinkIntegritySettings,
  local: LinkIntegritySettings,
  disk: LinkIntegritySettings,
): LinkIntegritySettings {
  return normalizeSettings(mergeValue(base, local, disk));
}

function mergeValue(base: unknown, local: unknown, disk: unknown): unknown {
  if (JSON.stringify(base) === JSON.stringify(local)) return disk;
  if (JSON.stringify(base) === JSON.stringify(disk)) return local;
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(disk)) {
    // Settings lists contain unique strings or records with stable IDs.
    const key = (entry: unknown): unknown => isObject(entry) ? entry.id : entry;
    const before = new Map(base.map((entry: unknown) => [key(entry), entry]));
    const edited = new Map(local.map((entry: unknown) => [key(entry), entry]));
    const onDisk = new Set(disk.map(key));
    const result: unknown[] = [];
    for (const entry of disk as unknown[]) {
      const id = key(entry);
      if (!before.has(id)) result.push(edited.has(id) ? edited.get(id) : entry);
      else if (edited.has(id)) result.push(mergeValue(before.get(id), edited.get(id), entry));
    }
    for (const entry of local as unknown[]) {
      const id = key(entry);
      if (!onDisk.has(id) && (!before.has(id) || JSON.stringify(before.get(id)) !== JSON.stringify(entry))) {
        result.push(entry);
      }
    }
    return result;
  }
  if (isObject(base) && isObject(local) && isObject(disk)) {
    const merged: Record<string, unknown> = { ...disk };
    for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
      if (!(key in local)) delete merged[key];
      else if (key in disk || JSON.stringify(local[key]) !== JSON.stringify(base[key])) {
        merged[key] = mergeValue(base[key], local[key], disk[key]);
      }
    }
    return merged;
  }
  return local;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
