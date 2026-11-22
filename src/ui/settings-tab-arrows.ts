/** Reveal clipped labels without changing the selected settings panel. */
export function addSettingsTabArrows(
  tabs: HTMLElement,
  direction: "ltr" | "rtl",
  previousLabel: string,
  nextLabel: string,
): () => void {
  const doc = tabs.ownerDocument;
  const frame = doc.createElement("div");
  frame.className = "link-integrity-tab-frame";
  tabs.replaceWith(frame);
  const labels = Array.from(tabs.querySelectorAll<HTMLElement>('[role="tab"]'));

  function arrow(label: string, pointsRight: boolean): HTMLButtonElement {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "link-integrity-tab-arrow";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.dataset.direction = pointsRight ? "right" : "left";
    button.addEventListener("click", () => {
      const distance = nextDistance(pointsRight);
      if (distance !== 0) tabs.scrollBy({ left: distance, behavior: "instant" });
      update();
    });
    return button;
  }

  // The previous label is on the right in RTL. Comparing physical rectangles
  // also handles partial tabs without depending on the browser's RTL scrollLeft.
  const previous = arrow(previousLabel, direction === "rtl");
  const next = arrow(nextLabel, direction === "ltr");
  frame.append(previous, tabs, next);

  function nextDistance(right: boolean): number {
    const viewport = tabs.getBoundingClientRect();
    if (viewport.width <= 0) return 0;
    let nearest = Infinity;
    for (const tab of labels) {
      const bounds = tab.getBoundingClientRect();
      const distance = right ? bounds.right - viewport.right : viewport.left - bounds.left;
      if (distance > 0.5) nearest = Math.min(nearest, distance);
    }
    if (!Number.isFinite(nearest)) return 0;
    // A long translated label may need several clicks to traverse.
    return Math.min(nearest, viewport.width) * (right ? 1 : -1);
  }

  function update(): void {
    const focused = doc.activeElement;
    // Compare content with the whole row so the arrows cannot create overflow.
    const overflowing = frame.clientWidth > 0 && tabs.scrollWidth > frame.clientWidth;
    frame.classList.toggle("has-overflow", overflowing);
    previous.disabled = !overflowing || nextDistance(direction === "rtl") === 0;
    next.disabled = !overflowing || nextDistance(direction === "ltr") === 0;
    if ((focused === previous && previous.disabled) || (focused === next && next.disabled)) {
      const remaining = previous.disabled ? next : previous;
      const target = remaining.disabled ? tabs.querySelector<HTMLElement>('[aria-selected="true"]') : remaining;
      target?.focus({ preventScroll: true });
    }
  }

  const view = doc.defaultView;
  let pendingFrame: number | undefined;
  const observer = view?.ResizeObserver ? new view.ResizeObserver(() => {
    if (pendingFrame !== undefined) return;
    pendingFrame = view.requestAnimationFrame(() => {
      pendingFrame = undefined;
      update();
    });
  }) : undefined;
  observer?.observe(frame);
  for (const tab of labels) observer?.observe(tab);
  tabs.addEventListener("scroll", update, { passive: true });
  view?.addEventListener("resize", update);
  update();
  return () => {
    tabs.removeEventListener("scroll", update);
    view?.removeEventListener("resize", update);
    observer?.disconnect();
    if (pendingFrame !== undefined) view?.cancelAnimationFrame(pendingFrame);
  };
}
