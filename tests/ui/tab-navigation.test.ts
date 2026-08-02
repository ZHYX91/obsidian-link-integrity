import { describe, expect, it, vi } from "vitest";

import {
  moveHorizontalTabIndex,
  revealHorizontalTab,
} from "../../src/ui/tab-navigation";

describe("tab navigation", () => {
  it("uses visual arrow direction in LTR and RTL", () => {
    expect(moveHorizontalTabIndex(0, "ArrowRight", 3, "ltr")).toBe(1);
    expect(moveHorizontalTabIndex(0, "ArrowRight", 3, "rtl")).toBe(2);
    expect(moveHorizontalTabIndex(1, "Home", 3, "rtl")).toBe(0);
    expect(moveHorizontalTabIndex(1, "End", 3, "ltr")).toBe(2);
  });

  it.each(["ltr", "rtl"] as const)(
    "delegates clipped-tab reveal to the browser in %s layouts",
    (direction) => {
      const tabList = document.createElement("div");
      const tab = document.createElement("button");
      tabList.dir = direction;
      tabList.scrollLeft = direction === "rtl" ? -120 : 120;
      tabList.append(tab);
      document.body.append(tabList);
      const scrollIntoView = vi.fn();
      Object.defineProperty(tab, "scrollIntoView", {
        configurable: true,
        value: scrollIntoView,
      });

      revealHorizontalTab(tab, true);

      expect(scrollIntoView).toHaveBeenCalledWith({
        block: "nearest",
        inline: "nearest",
      });
      expect(document.activeElement).toBe(tab);
      // The helper must not normalize Chromium's negative RTL scrollLeft model.
      expect(tabList.scrollLeft).toBe(direction === "rtl" ? -120 : 120);
      tabList.remove();
    },
  );

  it("falls back to native focus when scrollIntoView is unavailable", () => {
    const tab = document.createElement("button");
    document.body.append(tab);
    Object.defineProperty(tab, "scrollIntoView", {
      configurable: true,
      value: undefined,
    });

    revealHorizontalTab(tab, true);

    expect(document.activeElement).toBe(tab);
    tab.remove();
  });
});
