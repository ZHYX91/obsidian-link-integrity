import { afterEach, describe, expect, it, vi } from "vitest";

import { createTranslator, type PluginLocale } from "../../src/shared/i18n";
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
    vi.unstubAllGlobals();
  });

  it.each([
    ["LTR", "en", "en", 140],
    ["RTL with Chromium negative scrollLeft", "auto", "ar", -140],
    ["RTL with Arabic selected over an English host", "ar", "en", -140],
  ] as const)("reveals the original selection once the %s row becomes measurable", (
    _label, locale, hostLocale, expectedScroll,
  ) => {
    const container = document.body.appendChild(document.createElement("div"));
    const outside = document.body.appendChild(document.createElement("button"));
    outside.focus();
    const cleanup = renderImperativeSettings(container, context(locale, hostLocale), {
      activeTab: "isolated-files", focusActiveTab: false, onSelectTab: vi.fn(),
    });
    try {
      const list = container.querySelector<HTMLElement>('[role="tablist"]')!;
      const active = list.querySelector<HTMLButtonElement>('[aria-selected="true"]')!;
      let width = 0;
      Object.defineProperty(list, "clientWidth", { get: () => width });
      Object.defineProperty(list.parentElement!, "clientWidth", { get: () => width });
      Object.defineProperty(list, "scrollWidth", { get: () => Math.max(width, 240) });
      vi.spyOn(list, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, list.clientWidth, 34));
      // The last 80px label of a 240px row lies beyond the physical right in LTR
      // and the physical left in RTL. Its position follows the real scrollLeft sign.
      const activeStart = expectedScroll > 0 ? 160 : -140;
      vi.spyOn(active, "getBoundingClientRect").mockImplementation(() => width > 0
        ? new DOMRect(activeStart - list.scrollLeft, 0, 80, 34) : new DOMRect());

      window.dispatchEvent(new Event("resize"));
      expect(list.scrollLeft).toBe(0);
      width = 100;
      window.dispatchEvent(new Event("resize"));
      expect(list.scrollLeft).toBe(expectedScroll);
      expect(document.activeElement).toBe(outside);

      // A later measurement must respect the user's choice to browse other labels.
      list.scrollLeft = 0;
      list.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
      expect(list.scrollLeft).toBe(0);
      expect(active.getAttribute("aria-selected")).toBe("true");

      width = 300;
      window.dispatchEvent(new Event("resize"));
      width = 100;
      window.dispatchEvent(new Event("resize"));
      expect(list.scrollLeft).toBe(expectedScroll);
      expect(document.activeElement).toBe(outside);
    } finally {
      cleanup();
      container.remove();
      outside.remove();
    }
  });

  it("focuses the selected tab and associates each tab with the displayed panel", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const cleanup = renderImperativeSettings(container, context("en", "en"), {
      activeTab: "isolated-files", focusActiveTab: true, onSelectTab: vi.fn(),
    });
    try {
      const active = container.querySelector<HTMLButtonElement>('[aria-selected="true"]')!;
      const panel = container.querySelector<HTMLElement>('[role="tabpanel"]')!;
      expect(document.activeElement).toBe(active);
      expect(panel.getAttribute("aria-labelledby")).toBe(active.id);
      for (const tab of container.querySelectorAll('[role="tab"]')) {
        expect(document.getElementById(tab.getAttribute("aria-controls")!)).toBe(panel);
      }
    } finally {
      cleanup();
      container.remove();
    }
  });

  it.each([["general", "Home"], ["isolated-files", "End"]] as const)(
    "consumes %s endpoint navigation without replacing the selected panel",
    (activeTab, key) => {
      const container = document.createElement("div");
      const onSelectTab = vi.fn();
      const cleanup = renderImperativeSettings(container, context("ar", "en"), { activeTab, onSelectTab });
      const panel = container.querySelector('[role="tabpanel"]');
      const tab = container.querySelector<HTMLButtonElement>('[aria-selected="true"]')!;
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      tab.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(onSelectTab).not.toHaveBeenCalled();
      expect(container.querySelector('[role="tabpanel"]')).toBe(panel);
      cleanup();
    },
  );

  it("cancels a queued resize measurement when settings closes", () => {
    let notify = (): void => { throw new Error("Resize observer was not created"); };
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class implements ResizeObserver {
      readonly observe = vi.fn();
      readonly unobserve = vi.fn();
      readonly disconnect = disconnect;

      constructor(callback: ResizeObserverCallback) {
        notify = () => callback([], this);
      }
    });
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(91);
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const container = document.createElement("div");
    const cleanup = renderImperativeSettings(container, context("en", "en"), {
      activeTab: "general", onSelectTab: vi.fn(),
    });

    notify();
    cleanup();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(91);
    expect(container.childElementCount).toBe(0);
  });

  it("routes tab selection through the legacy settings rerender callback", () => {
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

  it("restores the host language and direction when the translated settings page closes", () => {
    const container = document.createElement("div");
    container.lang = "en";
    container.dir = "auto";
    const cleanup = renderImperativeSettings(container, context("ar", "en"), {
      activeTab: "general",
      onSelectTab: vi.fn(),
    });

    expect(container.lang).toBe("ar");
    expect(container.dir).toBe("rtl");
    cleanup();
    expect(container.lang).toBe("en");
    expect(container.dir).toBe("auto");
  });

  it("does not render an empty duplicate heading for an unlabelled section", () => {
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

function context(locale: PluginLocale, hostLocale: string): SettingsUiContext {
  return {
    settings: createDefaultSettings(),
    translator: createTranslator(locale, hostLocale),
    writeProtected: false,
    createId: (kind) => `${kind}:test`,
    onSettingsChange: vi.fn(),
  };
}
