// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

describe("Link Integrity index disclosure state", () => {
  it("is independent of visible errors and has session-only expansion", () => {
    let expanded = false;
    const panel = document.createElement("section");
    const status = panel.appendChild(document.createElement("div"));
    status.setAttribute("role", "alert");
    status.textContent = "Index failed";
    const render = () => {
      panel.querySelector("details")?.remove();
      const details = panel.appendChild(document.createElement("details"));
      details.open = expanded;
      details.addEventListener("toggle", () => { expanded = details.open; });
      details.appendChild(document.createElement("summary")).textContent = "Index details";
      return details;
    };
    const first = render();
    expect(first.open).toBe(false);
    first.open = true; first.dispatchEvent(new Event("toggle"));
    expect(render().open).toBe(true);
    expect(status.textContent).toBe("Index failed");
    expanded = false; // LinkIntegritySettingTab.hide()
    expect(render().open).toBe(false);
  });
});
