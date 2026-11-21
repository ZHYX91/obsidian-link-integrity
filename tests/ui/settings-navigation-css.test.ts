import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { styleDeclarations } from "../helpers/stylesheet";

const tabSelector = ".link-integrity-settings-tabs > button.link-integrity-settings-tab";

describe("settings navigation CSS", () => {
  it("uses the same accent for the index details chevron and its expanded logical edge", () => {
    const card = ".link-integrity-index-details";
    const css = readFileSync(path.resolve(import.meta.dirname, "../../styles.css"), "utf8");
    const rule = (selector: string) => css.split(selector + " {")[1]?.split("}")[0];
    expect(rule(card)).toContain("background: color-mix(in srgb, var(--interactive-accent) 5%, var(--background-primary))");
    expect(rule(card)).toContain("border: 1px solid var(--background-modifier-border)");
    expect(rule(`${card} > summary::before`)).toContain("color: var(--interactive-accent)");
    expect(rule(`${card}[open] > .link-integrity-index-metrics`))
      .toContain("border-inline-start: 2px solid var(--interactive-accent)");
  });

  it("resets theme buttons and keeps the active tab unmistakable", () => {
    const tab = styleDeclarations(tabSelector);
    for (const [property, value] of [
      ["appearance", "none"],
      ["background", "transparent"],
      ["border", "0px"],
      ["border-block-end", "2px solid transparent"],
    ] as const) {
      expect(tab.getPropertyValue(property), property).toBe(value);
      expect(tab.getPropertyPriority(property), property).toBe("important");
    }
    const active = styleDeclarations(`${tabSelector}.is-active`);
    expect(active.getPropertyValue("border-block-end-color")).toBe("var(--interactive-accent)");
    expect(active.getPropertyValue("font-weight")).toBe("var(--font-semibold)");
    expect(active.getPropertyPriority("border-block-end-color")).toBe("important");
    expect(active.getPropertyPriority("font-weight")).toBe("important");
  });

  it("uses the shared spacing and minimum-size contract", () => {
    const tabs = styleDeclarations(".link-integrity-settings-tabs");
    expect(tabs.getPropertyValue("align-items")).toBe("stretch");
    expect(tabs.getPropertyValue("gap")).toBe("var(--size-2-1)");
    expect(tabs.getPropertyValue("margin")).toBe("0px");
    expect(tabs.getPropertyValue("overflow-x")).toBe("auto");
    const panel = styleDeclarations(".link-integrity-settings-panel");
    expect(panel.getPropertyValue("margin-block-start")).toBe("var(--size-4-5)");
    expect(panel.getPropertyValue("padding-block-start")).toBe("0");
    const tab = styleDeclarations(tabSelector);
    expect(tab.getPropertyValue("block-size")).toBe("auto");
    expect(tab.getPropertyValue("min-block-size")).toBe("34px");
    expect(tab.getPropertyValue("padding")).toBe("7px 12px");
    expect(tab.getPropertyPriority("padding")).toBe("important");
    expect(tab.getPropertyValue("cursor")).toBe("var(--cursor, default)");
  });
});
