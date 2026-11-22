import { normalizePath, type Plugin } from "obsidian";

/** Read and optionally update data.json at the host's atomic commit point. */
export async function processSettingsData<T>(
  plugin: Plugin,
  update: (raw: unknown) => { readonly result: T; readonly write?: unknown },
): Promise<T> {
  const { vault } = plugin.app;
  const directory = plugin.manifest.dir ?? `${vault.configDir}/plugins/${plugin.manifest.id}`;
  const path = normalizePath(`${directory}/data.json`);
  // An empty append creates the first file without replacing one that arrived via Sync.
  if (!(await vault.adapter.exists(path))) await vault.adapter.append(path, "");
  let result: T;
  const unchanged = new Error("Settings file already current");
  try {
    await vault.adapter.process(path, (raw) => {
      const change = update(raw.length === 0 ? null : JSON.parse(raw) as unknown);
      result = change.result;
      if (change.write === undefined) throw unchanged;
      return JSON.stringify(change.write, null, 2);
    });
  } catch (error) {
    if (error !== unchanged) throw error;
  }
  return result!;
}
