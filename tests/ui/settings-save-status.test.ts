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
    expect(container.hidden).toBe(true);
    const notify = listener as ((status: SettingsSaveStatus) => void) | null;
    notify?.({ state: "saving", error: null });
    expect(status?.textContent).toBe("Saving settings");
    expect(container.hidden).toBe(false);
    cleanup();
    expect(container.hidden).toBe(false);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("provides index status and a manual rebuild action in General settings", () => {
    const container = document.createElement("div");
    const rebuild = vi.fn();
    const unsubscribeStatus = vi.fn();
    const unsubscribeDiagnostics = vi.fn();
    const cleanup = renderCustomSetting(container, "index-maintenance", {
      settings: createDefaultSettings(),
      translator: createTranslator("en", "en"),
      writeProtected: false,
      createId: (kind) => kind,
      onSettingsChange: vi.fn(),
      getIndexStatus: () => ({
        state: "ready",
        current: 0,
        total: 0,
        errorMessage: null,
      }),
      subscribeIndexStatus: () => unsubscribeStatus,
      getIndexDiagnostics: () => ({
        fileCount: 12_438,
        sourceCount: 10_904,
        occurrenceCount: 86_201,
        pendingEventCount: 0,
        lastFullRebuild: {
          completedAt: Date.UTC(2026, 7, 9, 6, 32),
          durationMs: 1_240,
          fileCount: 12_438,
          sourceCount: 10_904,
          occurrenceCount: 86_201,
        },
        lastIncrementalUpdate: {
          completedAt: Date.UTC(2026, 7, 9, 6, 34),
          durationMs: 18,
          eventCount: 7,
          affectedSourceCount: 7,
        },
      }),
      subscribeIndexDiagnostics: () => unsubscribeDiagnostics,
      rebuildIndex: rebuild,
    });

    expect(container.textContent).toContain("Ready · 12,438 files · 86,201 references");
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("Analyzed sources10,904");
    expect(details?.textContent).toContain("Memory only; rebuilt after restart");
    const button = Array.from(container.querySelectorAll("button"))
      .find(({ textContent }) => textContent === "Rebuild index");
    button?.click();
    expect(rebuild).toHaveBeenCalledOnce();
    cleanup();
    expect(unsubscribeStatus).toHaveBeenCalledOnce();
    expect(unsubscribeDiagnostics).toHaveBeenCalledOnce();
  });
});
