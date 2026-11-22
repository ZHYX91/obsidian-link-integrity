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
    button.disabled = true;
    button.className = "link-integrity-tab-arrow";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.dataset.direction = pointsRight ? "right" : "left";
    return button;
  }

  // The previous label is on the right in RTL. Comparing physical rectangles
  // also handles partial tabs without depending on the browser's RTL scrollLeft.
  const previous = arrow(previousLabel, direction === "rtl");
  const next = arrow(nextLabel, direction === "ltr");
  frame.append(previous, tabs, next);
  previous.addEventListener("click", () => scroll(direction === "rtl", next));
  next.addEventListener("click", () => scroll(direction === "ltr", previous));

  function distanceToEdge(tab: HTMLElement, viewport: DOMRect, right: boolean): number {
    const bounds = tab.getBoundingClientRect();
    return right ? bounds.right - viewport.right : viewport.left - bounds.left;
  }

  function firstClippedTab(right: boolean): HTMLElement | undefined {
    const viewport = tabs.getBoundingClientRect();
    if (viewport.width <= 0) return;
    let nearest = Infinity;
    let target: HTMLElement | undefined;
    for (const tab of labels) {
      const distance = distanceToEdge(tab, viewport, right);
      if (distance <= 0.5 || distance >= nearest) continue;
      nearest = distance;
      target = tab;
    }
    return target;
  }

  function scroll(right: boolean, other: HTMLButtonElement): void {
    const target = firstClippedTab(right);
    if (target === undefined) return;
    // The reverse control can appear during this move. Reveal the original
    // target using the space that will remain once that control is visible.
    other.disabled = false;
    const viewport = tabs.getBoundingClientRect();
    const distance = Math.max(0, Math.min(distanceToEdge(target, viewport, right), viewport.width));
    if (distance > 0) tabs.scrollBy({ left: right ? distance : -distance, behavior: "instant" });
    update();
  }

  function update(): void {
    const focused = doc.activeElement;
    // Compare content with the whole row so the arrows cannot create overflow.
    const overflowing = frame.clientWidth > 0 && tabs.scrollWidth > frame.clientWidth;
    frame.classList.toggle("has-overflow", overflowing);
    const earlier = overflowing && firstClippedTab(direction === "rtl") !== undefined;
    const later = overflowing && firstClippedTab(direction === "ltr") !== undefined;
    previous.disabled = !earlier;
    next.disabled = !later;
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
