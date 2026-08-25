import { afterEach, describe, expect, it, vi } from "vitest";

import { createTranslator } from "../../src/shared/i18n";
import { createDefaultSettings } from "../../src/shared/settings";
import { renderImperativeSettings } from "../../src/ui/settings/render";
import type { SettingsUiContext } from "../../src/ui/settings/types";

vi.mock("../../src/ui/settings/definitions", () => ({
  getSettingsPageDefinitions: () => [
    { id: "general", label: "General", sections: [{ items: [] }] },
    { id: "broken-links", label: "Broken links", sections: [] },
    { id: "isolated-files", label: "Isolated files", sections: [] },
  ],
}));

describe("imperative settings tab reveal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["LTR", "en", "en", 120],
    ["RTL with Chromium negative scrollLeft", "auto", "ar", -120],
  ] as const)("reveals and focuses the active tab in %s", (
    _label,
    locale,
    hostLocale,
    initialScrollLeft,
  ) => {
    let scheduled: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      scheduled = callback;
      return 47;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame");
    const container = document.createElement("div");
    document.body.append(container);
    const cleanup = renderImperativeSettings(
      container,
      context(locale, hostLocale),
      {
        activeTab: "isolated-files",
        focusActiveTab: true,
        onSelectTab: vi.fn(),
      },
    );
    const tabList = container.querySelector<HTMLElement>('[role="tablist"]');
    const activeTab = container.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="true"]',
    );
    expect(tabList).not.toBeNull();
    expect(activeTab).not.toBeNull();
    if (tabList === null || activeTab === null) throw new Error("Settings tabs were not rendered.");
    tabList.scrollLeft = initialScrollLeft;
    const scrollIntoView = vi.fn();
    Object.defineProperty(activeTab, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    scheduled?.(0);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(document.activeElement).toBe(activeTab);
    expect(tabList.scrollLeft).toBe(initialScrollLeft);
    cleanup();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(47);
    container.remove();
  });

  it("reveals an initially active hidden tab without stealing focus", () => {
    let scheduled: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      scheduled = callback;
      return 11;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    const cleanup = renderImperativeSettings(
      container,
      context("en", "en"),
      {
        activeTab: "isolated-files",
        focusActiveTab: false,
        onSelectTab: vi.fn(),
      },
    );
    const activeTab = container.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="true"]',
    );
    if (activeTab === null) throw new Error("Active settings tab was not rendered.");
    const scrollIntoView = vi.fn();
    Object.defineProperty(activeTab, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    scheduled?.(0);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(document.activeElement).toBe(outside);
    cleanup();
    outside.remove();
    container.remove();
  });

  it("cancels a pending reveal when the legacy settings surface is cleaned up", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(91);
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame");
    const container = document.createElement("div");
    const cleanup = renderImperativeSettings(
      container,
      context("en", "en"),
      {
        activeTab: "general",
        onSelectTab: vi.fn(),
      },
    );

    cleanup();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(91);
    expect(container.childElementCount).toBe(0);
  });

  it("routes tab selection through the legacy settings rerender callback", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(13);
    const onSelectTab = vi.fn();
    const container = document.createElement("div");
    const cleanup = renderImperativeSettings(
      container,
      context("en", "en"),
      {
        activeTab: "general",
        onSelectTab,
      },
    );

    container.querySelector<HTMLButtonElement>('[data-tab-id="isolated-files"]')?.click();

    expect(onSelectTab).toHaveBeenCalledOnce();
    expect(onSelectTab).toHaveBeenCalledWith("isolated-files", true);
    cleanup();
  });

  it("does not render an empty duplicate heading for an unlabelled section", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(14);
    const container = document.createElement("div");
    const cleanup = renderImperativeSettings(
      container,
      context("en", "en"),
      {
        activeTab: "general",
        onSelectTab: vi.fn(),
      },
    );

    expect(container.querySelector(".link-integrity-settings-section")).not.toBeNull();
    expect(container.querySelector(".link-integrity-settings-section > h3")).toBeNull();
    cleanup();
  });
});

function context(locale: "auto" | "en", hostLocale: string): SettingsUiContext {
  return {
    settings: createDefaultSettings(),
    translator: createTranslator(locale, hostLocale),
    writeProtected: false,
    createId: (kind) => `${kind}:test`,
    onSettingsChange: vi.fn(),
  };
}
