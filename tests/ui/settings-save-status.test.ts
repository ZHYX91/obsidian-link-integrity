import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "../../src/shared/i18n";
import { createDefaultSettings } from "../../src/shared/settings";
import type { SettingsSaveStatus } from "../../src/shared/settings-save-coordinator";
import { renderCustomSetting } from "../../src/ui/settings/custom-sections";

describe("settings persistence status", () => {
  it("surfaces pending failures and exposes a retry action", () => {
    const container = document.createElement("div");
    const retry = vi.fn();
    const cleanup = renderCustomSetting(container, "persistence-status", {
      settings: createDefaultSettings(),
      translator: createTranslator("en", "en"),
      writeProtected: false,
      createId: (kind) => kind,
      onSettingsChange: vi.fn(),
      getSaveStatus: () => ({ state: "pending", error: new Error("disk full") }),
      retrySave: retry,
    });
    expect(container.textContent).toContain("Settings could not be saved");
    const retryButton = Array.from(container.querySelectorAll("button"))
      .find(({ textContent }) => textContent === "Retry");
    expect(retryButton?.hidden).toBe(false);
    retryButton?.click();
    expect(retry).toHaveBeenCalledOnce();
    cleanup();
  });

  it("updates an aria-live status through subscription and unsubscribes on cleanup", () => {
    const container = document.createElement("div");
    let listener: ((status: SettingsSaveStatus) => void) | null = null;
    const unsubscribe = vi.fn();
    const cleanup = renderCustomSetting(container, "persistence-status", {
      settings: createDefaultSettings(),
      translator: createTranslator("en", "en"),
      writeProtected: false,
      createId: (kind) => kind,
      onSettingsChange: vi.fn(),
      getSaveStatus: () => ({ state: "saved", error: null }),
      subscribeSaveStatus: (next) => {
        listener = next;
        return unsubscribe;
      },
    });
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Settings saved");
    const notify = listener as ((status: SettingsSaveStatus) => void) | null;
    notify?.({ state: "saving", error: null });
    expect(status?.textContent).toBe("Saving settings");
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
