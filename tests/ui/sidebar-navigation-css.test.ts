import { describe, expect, it } from "vitest";

import { styleDeclarations } from "../helpers/stylesheet";

describe("sidebar navigation CSS", () => {
  it("combines the active accent line with a semibold label", () => {
    const active = styleDeclarations(".link-integrity-sidebar button.link-integrity-tab.is-active");
    expect(active.getPropertyValue("box-shadow")).toBe("inset 0 -2px var(--interactive-accent)");
    expect(active.getPropertyValue("font-weight")).toBe("var(--font-semibold)");
  });
});
