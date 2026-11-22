import { describe, expect, it, vi } from "vitest";
import { addSettingsTabArrows } from "../../src/ui/settings-tab-arrows";

describe("settings tab overflow", () => {
  it.each(["ltr", "rtl"] as const)("reveals hidden labels in %s without selecting a tab", (direction) => {
    const tabs = document.createElement("div");
    document.body.append(tabs);
    const widths = [60, 130, 65];
    let viewportWidth = 100;
    let position = 0;
    const total = widths.reduce((sum, width) => sum + width, 0);
    const rect = (left: number, width: number): DOMRect => new DOMRect(left, 0, width, 34);
    vi.spyOn(tabs, "getBoundingClientRect").mockImplementation(() => rect(0, viewportWidth));
    Object.defineProperty(tabs, "scrollWidth", { get: () => total });
    const onSelection = vi.fn();
    const labels = widths.map((width, index) => {
      const label = document.createElement("button");
      label.setAttribute("role", "tab");
      label.setAttribute("aria-selected", String(index === 0));
      label.addEventListener("click", onSelection);
      const start = widths.slice(0, index).reduce((sum, value) => sum + value, 0);
      vi.spyOn(label, "getBoundingClientRect").mockImplementation(() => {
        const left = direction === "ltr" ? start - position : viewportWidth - start - width + position;
        return rect(left, width);
      });
      tabs.append(label);
      return label;
    });
    const cleanup = addSettingsTabArrows(tabs, direction, "Earlier", "More");
    const frame = tabs.parentElement!;
    Object.defineProperty(frame, "clientWidth", { get: () => viewportWidth + 64 });
    const previous = frame.querySelector<HTMLButtonElement>('[aria-label="Earlier"]')!;
    const next = frame.querySelector<HTMLButtonElement>('[aria-label="More"]')!;
    const scrollBy = vi.fn(({ left }: ScrollToOptions) => {
      position += (left ?? 0) * (direction === "ltr" ? 1 : -1);
    });
    Object.defineProperty(tabs, "scrollBy", { value: scrollBy });
    window.dispatchEvent(new Event("resize"));
    expect(frame.classList.contains("has-overflow")).toBe(true);
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    next.click();
    expect(position).toBe(90);
    expect(previous.disabled).toBe(false);
    next.focus();
    next.click();
    expect(position).toBe(155);
    expect(next.disabled).toBe(true);
    expect(document.activeElement).toBe(previous);
    previous.click();
    expect(position).toBe(60);
    position = 0;
    tabs.dispatchEvent(new Event("scroll"));
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    expect(labels[0]?.getAttribute("aria-selected")).toBe("true");
    expect(onSelection).not.toHaveBeenCalled();

    viewportWidth = 200; // The 255px row fits when the two 32px gutters are released.
    window.dispatchEvent(new Event("resize"));
    expect(frame.classList.contains("has-overflow")).toBe(false);
    expect(next.disabled).toBe(true);
    cleanup();
    viewportWidth = 100;
    window.dispatchEvent(new Event("resize"));
    expect(frame.classList.contains("has-overflow")).toBe(false);
    frame.remove();
  });
});
