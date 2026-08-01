import { describe, expect, it } from "vitest";

import {
  getRevealScrollLeft,
  moveHorizontalTabIndex,
} from "../../src/ui/tab-navigation";

describe("tab navigation", () => {
  it("uses visual arrow direction in LTR and RTL", () => {
    expect(moveHorizontalTabIndex(0, "ArrowRight", 3, "ltr")).toBe(1);
    expect(moveHorizontalTabIndex(0, "ArrowRight", 3, "rtl")).toBe(2);
    expect(moveHorizontalTabIndex(1, "Home", 3, "rtl")).toBe(0);
    expect(moveHorizontalTabIndex(1, "End", 3, "ltr")).toBe(2);
  });

  it("reveals a clipped tab without overscrolling", () => {
    expect(getRevealScrollLeft({
      clientWidth: 100,
      scrollWidth: 300,
      scrollLeft: 50,
      itemOffsetLeft: 170,
      itemOffsetWidth: 40,
    })).toBe(110);
    expect(getRevealScrollLeft({
      clientWidth: 100,
      scrollWidth: 300,
      scrollLeft: 50,
      itemOffsetLeft: 60,
      itemOffsetWidth: 20,
    })).toBe(50);
  });
});
