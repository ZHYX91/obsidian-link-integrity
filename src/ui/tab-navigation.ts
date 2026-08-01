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

export interface ScrollLayout {
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly scrollLeft: number;
  readonly itemOffsetLeft: number;
  readonly itemOffsetWidth: number;
}

export function getRevealScrollLeft(layout: ScrollLayout): number {
  const clientWidth = finiteNonNegative(layout.clientWidth);
  const scrollWidth = finiteNonNegative(layout.scrollWidth);
  const maximum = Math.max(0, scrollWidth - clientWidth);
  const current = clamp(finiteNonNegative(layout.scrollLeft), 0, maximum);
  const start = Number.isFinite(layout.itemOffsetLeft) ? layout.itemOffsetLeft : 0;
  const end = start + finiteNonNegative(layout.itemOffsetWidth);
  if (start < current) return clamp(start, 0, maximum);
  if (end > current + clientWidth) return clamp(end - clientWidth, 0, maximum);
  return current;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
