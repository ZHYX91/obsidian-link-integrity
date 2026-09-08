import {
  renderTabs,
  updateTabs,
  renderContextualStatus,
  renderToolbarControls,
  renderBrokenResults,
  renderIsolatedResults,
  renderEmptyState,
  type SidebarRenderOptions,
} from "./render";
import { runAction } from "./render-controls";

export function renderSidebar(
  container: HTMLElement,
  options: SidebarRenderOptions,
): () => void {
  return mountSidebar(container, options).dispose;
}

export interface SidebarMount {
  readonly update: (options: SidebarRenderOptions) => void;
  readonly dispose: () => void;
}

export function mountSidebar(
  container: HTMLElement,
  initialOptions: SidebarRenderOptions,
): SidebarMount {
  let current = initialOptions;
  let disposed = false;
  let composing = false;
  let controlsKey = "";
  let resultsKey = "";
  const rows: NonNullable<SidebarRenderOptions["rows"]> = new Map();
  const disclosures = new Map<string, boolean>();
  // Event handlers read current state even when their controls survive an update.
  const options: SidebarRenderOptions = {
    get model() { return current.model; },
    get state() { return current.state; },
    get translator() { return current.translator; },
    get navigation() { return current.navigation; },
    get fileTypeCategories() { return current.fileTypeCategories; },
    get defaultFormatFamilyIds() { return current.defaultFormatFamilyIds; },
    get allowNoIncomingFilter() { return current.allowNoIncomingFilter; },
    onStateChange: (state) => current.onStateChange(state),
    onActionError: (error) => current.onActionError?.(error),
    document: container.ownerDocument,
    mountElement: container,
    disclosures,
    rows,
  };
  container.replaceChildren();
  container.classList.add("link-integrity-sidebar");
  const root = container.ownerDocument.createElement("div");
  root.className = "link-integrity-sidebar-root";
  container.append(root);
  const panel = renderTabs(root, options);
  const status = container.ownerDocument.createElement("div");
  const toolbar = container.ownerDocument.createElement("div");
  toolbar.className = "link-integrity-toolbar";
  const search = container.ownerDocument.createElement("input");
  search.type = "search";
  const publishSearch = (): void => {
    if (disposed || composing || search.value === options.state.search) return;
    options.onStateChange({
      ...options.state,
      search: search.value,
      brokenResultOffset: 0,
      isolatedResultOffset: 0,
    });
  };
  search.addEventListener("compositionstart", () => { composing = true; });
  search.addEventListener("compositionend", () => {
    composing = false;
    publishSearch();
  });
  search.addEventListener("input", publishSearch);
  toolbar.append(search);
  const results = container.ownerDocument.createElement("div");
  panel.append(status, toolbar, results);

  const update = (next: SidebarRenderOptions): void => {
    if (disposed) return;
    current = next;
    container.dir = options.translator.direction;
    updateTabs(root, panel, options);
    status.replaceChildren();
    renderContextualStatus(status, options);
    status.hidden = status.childElementCount === 0;
    search.placeholder = options.translator.t("sidebar.search.placeholder");
    search.setAttribute("aria-label", options.translator.t("common.search"));
    if (!composing && search.value !== options.state.search) search.value = options.state.search;
    const nextControlsKey = JSON.stringify([
      options.translator.locale, options.model.activeTab, options.allowNoIncomingFilter,
      options.state.brokenView, options.state.brokenGrouping, options.state.brokenSort,
      options.state.isolatedView, options.state.isolatedMode, options.state.isolatedSort,
    ]);
    if (controlsKey !== nextControlsKey) {
      controlsKey = nextControlsKey;
      for (const control of Array.from(toolbar.children).slice(1)) control.remove();
      renderToolbarControls(toolbar, options);
    }
    const idle = options.model.status.state === "idle";
    toolbar.hidden = idle;
    for (const details of results.querySelectorAll<HTMLDetailsElement>("details[data-disclosure-key]")) {
      const key = details.dataset.disclosureKey;
      if (key !== undefined) disclosures.set(key, details.open);
      if (details.parentElement?.hasAttribute("aria-expanded")) {
        details.parentElement.setAttribute("aria-expanded", String(details.open));
      }
    }
    const nextResultsKey = JSON.stringify([
      options.translator.locale, options.model.activeTab, options.model.search,
      options.model.status.state, options.allowNoIncomingFilter,
      options.model.activeTab === "broken-links" ? options.model.broken : options.model.isolated,
      options.state.showExpectedIsolated, [...options.state.selectedFormatFamilyIds],
      [...options.state.expandedBrokenFolderPaths], [...options.defaultFormatFamilyIds],
    ]);
    if (resultsKey === nextResultsKey) return;
    resultsKey = nextResultsKey;
    const focused = container.ownerDocument.activeElement;
    const restoreFocus = focused instanceof HTMLElement && results.contains(focused);
    results.replaceChildren();
    if (idle) {
      renderEmptyState(results, options.translator.t("status.idle"),
        options.translator.t("status.idle.description"), options.translator.t("index.start"),
        () => runAction(options.navigation.rebuildIndex, options.onActionError));
    } else if (options.model.activeTab === "broken-links") {
      renderBrokenResults(results, options);
    } else {
      renderIsolatedResults(results, options);
    }
    if (restoreFocus && results.contains(focused)) focused.focus();
    for (const [key, row] of rows) if (!results.contains(row.element)) rows.delete(key);
  };
  update(initialOptions);
  return {
    update,
    dispose: () => {
      disposed = true;
      disclosures.clear();
      rows.clear();
      root.remove();
      container.classList.remove("link-integrity-sidebar");
      container.removeAttribute("dir");
    },
  };
}
