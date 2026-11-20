import { describe, expect, it, vi } from "vitest";
import { LinkIntegritySettingTab } from "../../src/app/settings-tab";
import { createDefaultSettings } from "../../src/shared/settings";

describe("index details", () => {
  it("keeps the failure visible and forgets expansion when settings close", () => {
    const settings = createDefaultSettings();
    const owner = {
      getSettings: () => settings,
      isSettingsWriteProtected: () => false,
      getSettingsSaveStatus: () => ({ state: "saved", error: null }),
      subscribeToSettingsSaveStatus: () => () => undefined,
      getIndexStatus: () => ({ state: "failed", current: 0, total: 0, errorMessage: "Scan interrupted" }),
      subscribeToIndexStatus: () => () => undefined,
      getIndexDiagnostics: () => undefined,
      subscribeToIndexDiagnostics: () => () => undefined,
      updateSettings: vi.fn(),
    };
    const tab = new LinkIntegritySettingTab({} as never, owner as never);
    const panel = tab.containerEl;
    const details = () => panel.querySelector<HTMLDetailsElement>("details.link-integrity-index-details")!;
    const selectTab = (index: number) => panel.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]!.click();
    tab.display();
    expect(details().open).toBe(false);
    const error = panel.querySelector('[role="alert"]');
    expect(error?.textContent).toContain("Scan failed");
    expect(details().contains(error)).toBe(false);
    expect(details().textContent).toContain("Scan interrupted");
    details().open = true;
    selectTab(1);
    selectTab(0);
    expect(details().open).toBe(true);
    tab.hide();
    tab.display();
    expect(details().open).toBe(false);
    expect(owner.updateSettings).not.toHaveBeenCalled();
    tab.hide();
  });
});
