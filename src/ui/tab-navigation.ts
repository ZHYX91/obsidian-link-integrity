import type { TextDirection } from "../shared/i18n";

export function moveHorizontalTabIndex(
  currentIndex: number,
  key: string,
  tabCount: number,
  direction: TextDirection,
): number | null {
  if (tabCount <= 0 || currentIndex < 0 || currentIndex >= tabCount) return null;
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const visualStep = key === "ArrowRight" ? 1 : -1;
  const logicalStep = direction === "rtl" ? -visualStep : visualStep;
  return (currentIndex + logicalStep + tabCount) % tabCount;
}

export function revealHorizontalTab(tab: HTMLElement, focus: boolean): void {
  if (typeof tab.scrollIntoView === "function") {
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (focus) tab.focus({ preventScroll: true });
    return;
  }
  // Older DOM shims do not expose scrollIntoView. Let native focus scrolling be
  // the fallback instead of attempting direction-dependent scrollLeft math.
  if (focus) tab.focus();
}
