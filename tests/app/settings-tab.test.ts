import { describe, expect, it, vi } from "vitest";

import type { ExpectedIsolationRule } from "../../src/core";
import { LinkIntegritySettingTab } from "../../src/app/settings-tab";
import { createDefaultSettings, type LinkIntegritySettings } from "../../src/shared/settings";
import type { SettingsUiContext } from "../../src/ui/settings";

describe("LinkIntegritySettingTab", () => {
  it("bridges declarative controls and the shared settings context", async () => {
    let settings: LinkIntegritySettings = createDefaultSettings();
    let writeProtected = false;
    const owner = {
      getSettings: () => settings,
      isSettingsWriteProtected: () => writeProtected,
      updateSettings: vi.fn((next: LinkIntegritySettings) => {
        settings = next;
      }),
      previewExpectedRule: vi.fn(() => ({
        ruleId: "rule",
        name: "Rule",
        matchCount: 1,
        samples: ["A.md"],
        errors: [],
      })),
      previewIgnoreRule: vi.fn(() => ({
        matchedCount: 1,
        samples: ["A.md"],
        invalidReason: null,
      })),
      getSettingsSaveStatus: vi.fn(() => ({ state: "saved", error: null })),
      subscribeToSettingsSaveStatus: vi.fn(() => () => undefined),
      retrySettingsSave: vi.fn(async () => undefined),
      getIndexStatus: vi.fn(() => ({
        state: "ready",
        current: 0,
        total: 0,
        errorMessage: null,
      })),
      subscribeToIndexStatus: vi.fn(() => () => undefined),
      rebuild: vi.fn(async () => undefined),
      hasVaultFile: vi.fn(() => true),
      openVaultFile: vi.fn(async () => undefined),
      reportSettingsError: vi.fn(),
    };
    const tab = new LinkIntegritySettingTab({} as never, owner as never);

    expect(tab.getControlValue("general.scanOnStartup")).toBe(false);
    expect(tab.getControlValue("not-a-control")).toBeUndefined();
    tab.setControlValue("general.scanOnStartup", true);
    expect(settings.general.scanOnStartup).toBe(true);
    writeProtected = true;
    tab.setControlValue("general.scanOnStartup", false);
    expect(settings.general.scanOnStartup).toBe(true);
    writeProtected = false;

    expect(tab.getSettingDefinitions()).toEqual([]);
    expect(tab.getDeclarativeSettingDefinitions()).not.toHaveLength(0);
    const context = (tab as unknown as { createContext(): SettingsUiContext }).createContext();
    expect(context.getSettings!()).toBe(settings);
    expect(context.createId!("expected-rule")).toMatch(/^expected-rule:/u);
    context.onSettingsChange!(createDefaultSettings(), "query-only");
    expect(owner.updateSettings).toHaveBeenCalled();
    expect(context.getExpectedRulePreview!("missing")).toEqual({ state: "idle", stats: null });
    expect(context.getIgnoreRulePreview!("missing")).toBeNull();
    expect(context.getSaveStatus!()).toEqual({ state: "saved", error: null });
    expect(typeof context.subscribeSaveStatus!(() => undefined)).toBe("function");
    await context.retrySave!();
    expect(context.getIndexStatus!().state).toBe("ready");
    expect(typeof context.subscribeIndexStatus!(() => undefined)).toBe("function");
    await context.rebuildIndex!();
    expect(context.fileExists!("A.md")).toBe(true);
    await context.openFile!("A.md");
    context.onError!(new Error("test"));
    expect(owner.reportSettingsError).toHaveBeenCalled();

    const rule = expectedRule();
    const publish = vi.fn();
    context.requestExpectedRulePreview!(rule, publish);
    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      state: "ready",
    })));
    context.requestIgnoreRulePreview!({
      id: "ignore",
      enabled: true,
      scope: "hide-broken-result",
      matcher: { kind: "source-path", value: "A.md" },
      createdAt: 1,
      note: "",
    });
    await vi.waitFor(() => expect(owner.previewIgnoreRule).toHaveBeenCalled());

    tab.hide();
  });
});

function expectedRule(): ExpectedIsolationRule {
  return {
    id: "rule",
    name: "Rule",
    enabled: true,
    fileTypeFamilyIds: [],
    fileTypeCategoryIds: [],
    fileExtensions: [],
    folder: { path: "Archive", mode: "recursive" },
    namingPatterns: [],
  };
}
