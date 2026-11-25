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
      // Scroll extents are rounded to CSS pixels; label bounds can be fractional.
      if (distance <= 1 || distance >= nearest) continue;
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
    const viewport = earlier && previous.disabled ? tabs.getBoundingClientRect() : undefined;
    previous.disabled = !earlier;
    next.disabled = !later;
    // Keep the same content in view when a scroll reveals the start control.
    if (viewport !== undefined) {
      const resized = tabs.getBoundingClientRect();
      tabs.scrollLeft += direction === "rtl" ? resized.right - viewport.right : resized.left - viewport.left;
    }
    if ((focused === previous && previous.disabled) || (focused === next && next.disabled)) {
      const remaining = previous.disabled ? next : previous;
      const target = remaining.disabled ? tabs.querySelector<HTMLElement>('[aria-selected="true"]') : remaining;
      target?.focus({ preventScroll: true });
    }
  }

  let followSelectedTab = true;
  let automaticScrollPosition: number | null = null;
  function onScroll(): void {
    const automatic = automaticScrollPosition !== null && Math.abs(tabs.scrollLeft - automaticScrollPosition) <= 1;
    automaticScrollPosition = null;
    update();
    // This event can arrive after the host gets a vertical scrollbar. The
    // queued reveal is still automatic even if the new width clips the label.
    if (automatic) return;
    const viewport = tabs.getBoundingClientRect();
    const selected = labels.find(tab => tab.getAttribute("aria-selected") === "true")?.getBoundingClientRect();
    if (!selected || !viewport.width) return;
    // Keep following a visible selection on resize. Preserve a different page
    // when the user has scrolled the selection out of view.
    const visible = Math.min(selected.right, viewport.right) - Math.max(selected.left, viewport.left);
    followSelectedTab = visible >= Math.min(selected.width, viewport.width) - 1;
  }

  function measure(): void {
    const positionBeforeMeasure = tabs.scrollLeft;
    update();
    if (!tabs.clientWidth) return;
    if (!frame.classList.contains("has-overflow")) {
      followSelectedTab = true;
    } else if (followSelectedTab) {
      revealSelection();
    }
    if (tabs.scrollLeft !== positionBeforeMeasure) automaticScrollPosition = tabs.scrollLeft;
  }

  function revealSelection(): void {
    const active = labels.find(tab => tab.getAttribute("aria-selected") === "true");
    if (!active) return;
    const viewport = tabs.getBoundingClientRect();
    const selected = active.getBoundingClientRect();
    if (selected.left < viewport.left && selected.right < viewport.right) tabs.scrollLeft += selected.left - viewport.left;
    else if (selected.right > viewport.right && selected.left > viewport.left) tabs.scrollLeft += selected.right - viewport.right;
    update();
  }

  const view = doc.defaultView;
  let pendingFrame: number | undefined;
  const observer = view?.ResizeObserver ? new view.ResizeObserver(() => {
    if (pendingFrame !== undefined) return;
    pendingFrame = view.requestAnimationFrame(() => {
      pendingFrame = undefined;
      measure();
    });
  }) : undefined;
  observer?.observe(frame);
  for (const tab of labels) observer?.observe(tab);
  tabs.addEventListener("scroll", onScroll, { passive: true });
  view?.addEventListener("resize", measure);
  measure();
  return () => {
    tabs.removeEventListener("scroll", onScroll);
    view?.removeEventListener("resize", measure);
    observer?.disconnect();
    if (pendingFrame !== undefined) view?.cancelAnimationFrame(pendingFrame);
  };
}
