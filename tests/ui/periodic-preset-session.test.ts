import { describe, expect, it, vi } from "vitest";

import { LinkIntegritySettingTab } from "../../src/app/settings-tab";
import { createDefaultSettings, type LinkIntegritySettings, type SettingsChangeImpact } from "../../src/shared/settings";

describe("periodic-note settings", () => {
  it("keeps the user's place and open entries while saving successive preset edits", () => {
    let settings = createDefaultSettings();
    const owner = {
      getSettings: () => settings,
      isSettingsWriteProtected: () => false,
      getSettingsSaveStatus: () => ({ state: "saved", error: null }),
      subscribeToSettingsSaveStatus: () => () => undefined,
      getIndexStatus: () => ({ state: "idle", current: 0, total: 0, errorMessage: null }),
      subscribeToIndexStatus: () => () => undefined,
      getIndexDiagnostics: () => undefined,
      subscribeToIndexDiagnostics: () => () => undefined,
      updateSettings: vi.fn((next: LinkIntegritySettings, _impact: SettingsChangeImpact) => { settings = next; }),
    };
    const tab = new LinkIntegritySettingTab({} as never, owner as never);
    const container = tab.containerEl;
    const selectTab = (id: string) => container.querySelector<HTMLButtonElement>(`[data-tab-id="${id}"]`)!.click();
    const section = () => container.querySelector<HTMLElement>('[data-section-id="periodic-notes-preset"]')!;
    document.body.append(container);
    try {
      tab.display();
      selectTab("isolated-files");
      const preset = section();
      const [daily, weekly] = Array.from(preset.querySelectorAll("details")) as [HTMLDetailsElement, HTMLDetailsElement];
      daily.open = weekly.open = true;
      const master = preset.querySelector<HTMLInputElement>("input")!;
      const folder = daily.querySelector<HTMLInputElement>('input[type="text"]')!;
      const formats = daily.querySelector("textarea")!;
      const weekEnabled = weekly.querySelector<HTMLInputElement>("summary input")!;
      const recursive = daily.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!;
      container.scrollTop = 416;
      for (const enabled of [true, false]) {
        master.focus();
        master.click();
        expect(document.activeElement).toBe(master);
        expect(section()).toBe(preset);
        expect(container.scrollTop).toBe(416);
        expect(daily.open && weekly.open).toBe(true);
        expect(settings.isolatedFiles.periodicNotesPreset.enabled).toBe(enabled);
      }
      folder.focus();
      folder.value = " Journal/Daily ";
      folder.dispatchEvent(new Event("change"));
      expect(document.activeElement).toBe(folder);
      expect(folder.value).toBe("Journal/Daily");
      formats.value = "";
      formats.dispatchEvent(new Event("change"));
      expect(formats.value).toBe("YYYY-MM-DD");
      recursive.click();
      weekEnabled.click();
      master.click();
      expect(settings.isolatedFiles.periodicNotesPreset.entries.daily).toEqual({
        enabled: true, folder: "Journal/Daily", dateFormats: ["YYYY-MM-DD"], includeSubfolders: false,
      });
      expect(settings.isolatedFiles.periodicNotesPreset.entries.weekly.enabled).toBe(false);
      expect(settings.isolatedFiles.periodicNotesPreset.enabled).toBe(true);
      expect(daily.open && weekly.open).toBe(true);
      expect(owner.updateSettings.mock.calls.every(([, impact]) => impact === "query-only")).toBe(true);

      selectTab("general");
      selectTab("isolated-files");
      expect(section().querySelector("details[open]")).toBeNull();
      section().querySelector("details")!.open = true;
      tab.hide();
      tab.display();
      expect(section().querySelector("details[open]")).toBeNull();
      expect(section().querySelector<HTMLInputElement>("input")!.checked).toBe(true);
    } finally {
      tab.hide();
      container.remove();
    }
  });
});
