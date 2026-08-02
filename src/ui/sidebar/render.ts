import type { Translator } from "../../shared/i18n";
import {
  renderFileTypeSelection,
  type FileTypeCategoryOption,
} from "../file-type-selection";
import { moveHorizontalTabIndex, revealHorizontalTab } from "../tab-navigation";
import type {
  BrokenLinkResult,
  IsolatedFileResult,
  SidebarNavigationPort,
  SidebarTabId,
} from "./types";
import {
  SIDEBAR_RESULT_BATCH_SIZE,
  type BrokenGroupViewModel,
  type IsolatedTreeNode,
  type SidebarViewModel,
  type SidebarViewState,
} from "./view-model";

export interface SidebarRenderOptions {
  readonly model: SidebarViewModel;
  readonly state: SidebarViewState;
  readonly translator: Translator;
  readonly navigation: SidebarNavigationPort;
  readonly fileTypeCategories: readonly FileTypeCategoryOption[];
  readonly defaultFormatFamilyIds: ReadonlySet<string>;
  readonly allowNoIncomingFilter: boolean;
  readonly showStatus?: boolean;
  readonly onStateChange: (state: SidebarViewState) => void;
  readonly onActionError?: (error: unknown) => void;
  readonly document?: Document;
  readonly mountElement?: HTMLElement;
}

export function renderSidebar(
  container: HTMLElement,
  options: SidebarRenderOptions,
): () => void {
  container.replaceChildren();
  container.classList.add("link-integrity-sidebar");
  container.dir = options.translator.direction;
  const resolvedOptions: SidebarRenderOptions = {
    ...options,
    document: container.ownerDocument,
    mountElement: container,
  };
  const root = container.ownerDocument.createElement("div");
  root.className = "link-integrity-sidebar-root";
  container.append(root);

  renderHeader(root, resolvedOptions);
  const panel = renderTabs(root, resolvedOptions);
  renderToolbar(panel, resolvedOptions);
  if (options.model.status.state === "idle") {
    renderEmptyState(
      panel,
      options.translator.t("status.idle"),
      options.translator.t("status.idle.description"),
    );
  } else if (options.model.activeTab === "broken-links") {
    renderBrokenResults(panel, resolvedOptions);
  } else {
    renderIsolatedResults(panel, resolvedOptions);
  }

  return () => {
    root.remove();
    container.classList.remove("link-integrity-sidebar");
    container.removeAttribute("dir");
  };
}

function renderHeader(container: HTMLElement, options: SidebarRenderOptions): void {
  const { t } = options.translator;
  const header = container.ownerDocument.createElement("header");
  header.className = "link-integrity-sidebar-header";
  const heading = createText(container.ownerDocument, "h2", t("app.name"));
  const actions = container.ownerDocument.createElement("div");
  actions.className = "link-integrity-sidebar-header-actions";
  actions.append(
    createActionButton(container.ownerDocument, t("common.refresh"), () =>
      runAction(options.navigation.refresh, options.onActionError)),
    createActionButton(container.ownerDocument, t("common.settings"), () =>
      runAction(options.navigation.openSettings, options.onActionError)),
  );
  header.append(heading, actions);

  if (options.showStatus === false && options.model.status.state !== "idle") {
    container.append(header);
    return;
  }
  const status = createText(
    container.ownerDocument,
    "div",
    formatStatus(options),
    `link-integrity-status is-${options.model.status.state}`,
  );
  status.setAttribute("role", options.model.status.state === "failed" ? "alert" : "status");
  status.setAttribute("aria-live", "polite");
  header.append(status);
  container.append(header);
}

function renderTabs(container: HTMLElement, options: SidebarRenderOptions): HTMLElement {
  const { t, direction } = options.translator;
  const definitions: readonly [SidebarTabId, string, number][] = [
    ["broken-links", t("sidebar.tab.broken"), options.model.broken.badgeCount],
    ["isolated-files", t("sidebar.tab.isolated"), options.model.isolated.badgeCount],
  ];
  const tabList = container.ownerDocument.createElement("div");
  tabList.className = "link-integrity-tabs";
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", t("sidebar.tabs.label"));
  tabList.setAttribute("aria-orientation", "horizontal");
  definitions.forEach(([id, label, count], index) => {
    const active = options.model.activeTab === id;
    const button = container.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `link-integrity-tab${active ? " is-active" : ""}`;
    button.id = `link-integrity-sidebar-tab-${id}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("aria-controls", `link-integrity-sidebar-panel-${id}`);
    button.tabIndex = active ? 0 : -1;
    button.append(
      createText(container.ownerDocument, "span", label),
      createText(container.ownerDocument, "span", String(count), "link-integrity-tab-count"),
    );
    button.addEventListener("click", () => {
      selectSidebarTab(options, id);
    });
    button.addEventListener("keydown", (event) => {
      const nextIndex = moveHorizontalTabIndex(index, event.key, definitions.length, direction);
      if (nextIndex === null || nextIndex === index) return;
      event.preventDefault();
      const nextId = definitions[nextIndex]?.[0];
      if (nextId === undefined) return;
      selectSidebarTab(options, nextId);
    });
    tabList.append(button);
  });
  container.append(tabList);

  const panel = container.ownerDocument.createElement("section");
  panel.className = "link-integrity-panel";
  panel.id = `link-integrity-sidebar-panel-${options.model.activeTab}`;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute(
    "aria-labelledby",
    `link-integrity-sidebar-tab-${options.model.activeTab}`,
  );
  panel.tabIndex = 0;
  container.append(panel);
  return panel;
}

function selectSidebarTab(options: SidebarRenderOptions, tabId: SidebarTabId): void {
  options.onStateChange({ ...options.state, activeTab: tabId });
  queueMicrotask(() => {
    const tab = options.mountElement
      ?.querySelector<HTMLButtonElement>(`#link-integrity-sidebar-tab-${tabId}`);
    if (tab?.getAttribute("aria-selected") !== "true") return;
    revealHorizontalTab(tab, true);
  });
}

function renderToolbar(container: HTMLElement, options: SidebarRenderOptions): void {
  const { t } = options.translator;
  const toolbar = container.ownerDocument.createElement("div");
  toolbar.className = "link-integrity-toolbar";
  const search = container.ownerDocument.createElement("input");
  search.type = "search";
  search.value = options.state.search;
  search.placeholder = t("sidebar.search.placeholder");
  search.setAttribute("aria-label", t("common.search"));
  search.addEventListener("input", () => {
    options.onStateChange({
      ...options.state,
      search: search.value,
      brokenResultOffset: 0,
      isolatedResultOffset: 0,
    });
  });
  toolbar.append(search);

  if (options.model.activeTab === "broken-links") {
    toolbar.append(
      toggleButton(
        container.ownerDocument,
        t("sidebar.broken.view.group"),
        options.state.brokenView === "group",
        () => options.onStateChange({
          ...options.state,
          brokenView: "group",
          brokenResultOffset: 0,
        }),
      ),
      toggleButton(
        container.ownerDocument,
        t("sidebar.broken.view.list"),
        options.state.brokenView === "list",
        () => options.onStateChange({
          ...options.state,
          brokenView: "list",
          brokenResultOffset: 0,
        }),
      ),
    );
    if (options.state.brokenView === "group") {
      toolbar.append(createSelect(container.ownerDocument, [
        ["target", t("sidebar.broken.group.target")],
        ["source", t("sidebar.broken.group.source")],
      ], options.state.brokenGrouping, (value) => {
        if (value === "target" || value === "source") {
          options.onStateChange({
            ...options.state,
            brokenGrouping: value,
            brokenResultOffset: 0,
          });
        }
      }, t("settings.broken.defaultGrouping")));
    }
    toolbar.append(createSelect(container.ownerDocument, [
      ["path", t("settings.sort.path")],
      ["count", t("settings.sort.count")],
    ], options.state.brokenSort, (value) => {
      if (value === "path" || value === "count") {
        options.onStateChange({
          ...options.state,
          brokenSort: value,
          brokenResultOffset: 0,
        });
      }
    }, t("settings.broken.defaultSort")));
  } else {
    toolbar.append(
      toggleButton(
        container.ownerDocument,
        t("sidebar.isolated.view.list"),
        options.state.isolatedView === "list",
        () => options.onStateChange({
          ...options.state,
          isolatedView: "list",
          isolatedResultOffset: 0,
        }),
      ),
      toggleButton(
        container.ownerDocument,
        t("sidebar.isolated.view.tree"),
        options.state.isolatedView === "tree",
        () => options.onStateChange({
          ...options.state,
          isolatedView: "tree",
          isolatedResultOffset: 0,
        }),
      ),
    );
    if (options.allowNoIncomingFilter) {
      toolbar.append(createSelect(container.ownerDocument, [
        ["isolated", t("sidebar.tab.isolated")],
        ["no-incoming", t("sidebar.isolated.noIncoming")],
      ], options.state.isolatedMode, (value) => {
        if (value === "isolated" || value === "no-incoming") {
          options.onStateChange({
            ...options.state,
            isolatedMode: value,
            isolatedResultOffset: 0,
          });
        }
      }, t("settings.isolated.advancedMode")));
    }
    toolbar.append(createSelect(container.ownerDocument, [
      ["path", t("settings.sort.path")],
      ["name", t("settings.sort.name")],
      ["modified", t("settings.sort.modified")],
      ["broken-count", t("settings.sort.count")],
    ], options.state.isolatedSort, (value) => {
      if (
        value === "path" ||
        value === "name" ||
        value === "modified" ||
        value === "broken-count"
      ) {
        options.onStateChange({
          ...options.state,
          isolatedSort: value,
          isolatedResultOffset: 0,
        });
      }
    }, t("settings.isolated.defaultSort")));
  }
  container.append(toolbar);
}

function renderBrokenResults(container: HTMLElement, options: SidebarRenderOptions): void {
  const { t } = options.translator;
  const summary = createText(
    container.ownerDocument,
    "p",
    `${t("sidebar.broken.occurrences", { count: options.model.broken.badgeCount })} · ${
      t("sidebar.broken.targets", { count: options.model.broken.uniqueTargetCount })}`,
    "link-integrity-result-summary",
  );
  if (options.model.broken.renderedCount !== options.model.broken.badgeCount) {
    summary.append(` · ${formatResultRange(
      options.model.broken,
      options.model.broken.badgeCount,
      options,
    )}`);
  }
  container.append(summary);

  if (options.model.broken.items.length === 0) {
    renderEmptyState(
      container,
      t("sidebar.broken.empty.title"),
      t("sidebar.broken.empty.description"),
    );
    return;
  }
  if (options.model.broken.view === "group") {
    const list = container.ownerDocument.createElement("div");
    list.className = "link-integrity-broken-groups";
    for (const group of options.model.broken.groups) list.append(renderBrokenGroup(group, options));
    container.append(list);
  } else {
    const list = container.ownerDocument.createElement("ul");
    list.className = "link-integrity-result-list";
    for (const item of options.model.broken.items) list.append(renderBrokenItem(item, options));
    container.append(list);
  }
  renderPagination(container, options, "broken-links");
}

function renderBrokenGroup(
  group: BrokenGroupViewModel,
  options: SidebarRenderOptions,
): HTMLElement {
  const element = documentFor(options).createElement("details");
  element.className = "link-integrity-broken-group";
  element.open = true;
  const summary = documentFor(options).createElement("summary");
  summary.append(
    createText(documentFor(options), "span", group.label),
    createText(documentFor(options), "span", String(group.totalCount), "link-integrity-count"),
  );
  if (group.reason !== null) {
    summary.append(createText(
      documentFor(options),
      "span",
      formatBrokenReason(group.reason, options.translator),
      "link-integrity-reason",
    ));
  }
  element.append(summary);
  const list = documentFor(options).createElement("ul");
  for (const item of group.items) list.append(renderBrokenItem(item, options));
  element.append(list);
  return element;
}

function renderBrokenItem(
  item: BrokenLinkResult,
  options: SidebarRenderOptions,
): HTMLLIElement {
  const document = documentFor(options);
  const row = document.createElement("li");
  row.className = "link-integrity-result-row";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-integrity-result-main";
  button.setAttribute("aria-label", options.translator.t("sidebar.broken.openSource", {
    path: item.sourcePath,
  }));
  const location = item.location.line === null ? "" : `:${item.location.line + 1}`;
  button.append(
    createText(document, "span", `${item.sourcePath}${location}`, "link-integrity-result-path"),
    createText(document, "span", item.context || item.rawText, "link-integrity-result-context"),
    createText(
      document,
      "span",
      formatBrokenReason(item.reason, options.translator),
      "link-integrity-reason",
    ),
  );
  button.addEventListener("click", () => runAction(
    () => options.navigation.openBrokenLink(item),
    options.onActionError,
  ));
  const more = moreButton(document, options.translator.t("common.more"), (anchor) => runAction(
    () => options.navigation.openBrokenLinkActions === undefined
      ? options.navigation.openBrokenLink(item)
      : options.navigation.openBrokenLinkActions(item, anchor),
    options.onActionError,
  ));
  row.append(button, more);
  return row;
}

function renderIsolatedResults(container: HTMLElement, options: SidebarRenderOptions): void {
  const { t } = options.translator;
  if (options.model.isolated.mode === "no-incoming") {
    const warning = createText(
      container.ownerDocument,
      "p",
      t("sidebar.isolated.noIncomingWarning"),
      "link-integrity-warning",
    );
    warning.setAttribute("role", "note");
    container.append(warning);
  }

  const expectedToggle = container.ownerDocument.createElement("label");
  expectedToggle.className = "link-integrity-advanced-toggle";
  const expectedCheckbox = container.ownerDocument.createElement("input");
  expectedCheckbox.type = "checkbox";
  expectedCheckbox.checked = options.state.showExpectedIsolated;
  expectedCheckbox.addEventListener("change", () => options.onStateChange({
    ...options.state,
    showExpectedIsolated: expectedCheckbox.checked,
    isolatedResultOffset: 0,
  }));
  expectedToggle.append(
    expectedCheckbox,
    createText(container.ownerDocument, "span", t("sidebar.isolated.showExpected")),
    createText(
      container.ownerDocument,
      "span",
      t("sidebar.isolated.expectedCount", { count: options.model.isolated.expectedCount }),
      "link-integrity-count",
    ),
  );
  container.append(
    expectedToggle,
    createText(
      container.ownerDocument,
      "p",
      t("sidebar.isolated.showExpected.description"),
      "link-integrity-help-text",
    ),
  );

  const typeFilter = container.ownerDocument.createElement("details");
  typeFilter.className = "link-integrity-temporary-filter";
  typeFilter.append(createText(container.ownerDocument, "summary", t("sidebar.fileTypes")));
  renderFileTypeSelection(typeFilter, {
    categories: options.fileTypeCategories,
    selectedFormatIds: options.state.selectedFormatFamilyIds,
    defaultFormatIds: options.defaultFormatFamilyIds,
  }, {
    temporaryDescription: t("sidebar.fileTypes.temporary"),
    selectAllLabel: t("common.selectAll"),
    clearLabel: t("common.clear"),
    restoreDefaultLabel: t("common.restoreDefault"),
    selectedCountLabel: (selected, total) => t("fileType.selectedCount", { selected, total }),
    onChange: (selectedFormatFamilyIds) => options.onStateChange({
      ...options.state,
      selectedFormatFamilyIds,
      isolatedResultOffset: 0,
    }),
  });
  container.append(typeFilter);

  const summary = createText(
    container.ownerDocument,
    "p",
    formatResultRange(
      options.model.isolated,
      options.state.showExpectedIsolated
        ? options.model.isolated.configuredScopeCount
        : options.model.isolated.configuredScopeCount - options.model.isolated.expectedCount,
      options,
    ),
    "link-integrity-result-summary",
  );
  container.append(summary);
  if (options.model.isolated.items.length === 0) {
    renderEmptyState(
      container,
      t("sidebar.isolated.empty.title"),
      t("sidebar.isolated.empty.description"),
    );
    return;
  }
  if (options.model.isolated.view === "tree") {
    const tree = container.ownerDocument.createElement("ul");
    tree.className = "link-integrity-isolated-tree";
    tree.setAttribute("role", "tree");
    appendTreeChildren(tree, options.model.isolated.tree, options);
    container.append(tree);
  } else {
    const list = container.ownerDocument.createElement("ul");
    list.className = "link-integrity-result-list";
    for (const item of options.model.isolated.items) list.append(renderIsolatedItem(item, options));
    container.append(list);
  }
  renderPagination(container, options, "isolated-files");
}

function formatResultRange(
  result: { readonly pageStart: number; readonly renderedCount: number },
  total: number,
  options: SidebarRenderOptions,
): string {
  if (result.renderedCount === 0) {
    return options.translator.t("sidebar.filteredSummary", { visible: 0, total });
  }
  return options.translator.t("sidebar.pageSummary", {
    start: result.pageStart + 1,
    end: result.pageStart + result.renderedCount,
    total,
  });
}

function renderPagination(
  container: HTMLElement,
  options: SidebarRenderOptions,
  tabId: SidebarTabId,
): void {
  const result = tabId === "broken-links" ? options.model.broken : options.model.isolated;
  if (result.visibleCount <= SIDEBAR_RESULT_BATCH_SIZE && result.pageStart === 0) return;
  const pagination = container.ownerDocument.createElement("nav");
  pagination.className = "link-integrity-pagination";
  pagination.setAttribute("aria-label", options.translator.t("sidebar.pagination"));
  const previous = createActionButton(
    container.ownerDocument,
    options.translator.t("common.previous"),
    () => options.onStateChange(tabId === "broken-links"
      ? {
        ...options.state,
        brokenResultOffset: Math.max(0, result.pageStart - SIDEBAR_RESULT_BATCH_SIZE),
      }
      : {
        ...options.state,
        isolatedResultOffset: Math.max(0, result.pageStart - SIDEBAR_RESULT_BATCH_SIZE),
      }),
  );
  previous.disabled = result.pageStart === 0;
  const next = createActionButton(
    container.ownerDocument,
    options.translator.t("common.next"),
    () => options.onStateChange(tabId === "broken-links"
      ? {
        ...options.state,
        brokenResultOffset: result.pageStart + SIDEBAR_RESULT_BATCH_SIZE,
      }
      : {
        ...options.state,
        isolatedResultOffset: result.pageStart + SIDEBAR_RESULT_BATCH_SIZE,
      }),
  );
  next.disabled = result.pageStart + result.renderedCount >= result.visibleCount;
  pagination.append(previous, next);
  container.append(pagination);
}

function appendTreeChildren(
  parent: HTMLUListElement,
  node: IsolatedTreeNode,
  options: SidebarRenderOptions,
): void {
  for (const folder of node.folders) {
    const item = parent.ownerDocument.createElement("li");
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-expanded", "true");
    const details = parent.ownerDocument.createElement("details");
    details.open = true;
    details.append(createText(parent.ownerDocument, "summary", folder.name));
    const group = parent.ownerDocument.createElement("ul");
    group.setAttribute("role", "group");
    appendTreeChildren(group, folder, options);
    details.append(group);
    item.append(details);
    parent.append(item);
  }
  for (const file of node.files) {
    const item = renderIsolatedItem(file, options);
    item.setAttribute("role", "treeitem");
    parent.append(item);
  }
}

function renderIsolatedItem(
  item: IsolatedFileResult,
  options: SidebarRenderOptions,
): HTMLLIElement {
  const document = documentFor(options);
  const row = document.createElement("li");
  row.className = `link-integrity-result-row${
    item.expectation.kind === "expected" ? " is-expected" : ""}${
    item.brokenOutgoingCount > 0 ? " is-low-confidence" : ""}`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-integrity-result-main";
  button.append(
    createText(document, "span", item.path, "link-integrity-result-path"),
    createText(
      document,
      "span",
      item.expectation.kind === "expected"
        ? item.brokenOutgoingCount > 0
          ? options.translator.t("sidebar.isolated.expectedWithBroken", {
            count: item.brokenOutgoingCount,
          })
          : options.translator.t("sidebar.isolated.expected")
        : item.brokenOutgoingCount > 0
          ? options.translator.t("sidebar.isolated.lowConfidence", {
            count: item.brokenOutgoingCount,
          })
          : options.translator.t("sidebar.isolated.highConfidence"),
      item.expectation.kind === "expected"
        ? "link-integrity-confidence is-expected"
        : item.brokenOutgoingCount > 0
          ? "link-integrity-confidence is-low"
          : "link-integrity-confidence is-high",
    ),
  );
  button.addEventListener("click", () => runAction(
    () => options.navigation.openFile(item.path),
    options.onActionError,
  ));
  const more = moreButton(document, options.translator.t("common.more"), (anchor) => runAction(
    () => options.navigation.openIsolatedFileActions === undefined
      ? options.navigation.openFile(item.path)
      : options.navigation.openIsolatedFileActions(item, anchor),
    options.onActionError,
  ));
  row.append(button, more);
  return row;
}

function renderEmptyState(container: HTMLElement, title: string, description: string): void {
  const empty = container.ownerDocument.createElement("div");
  empty.className = "link-integrity-empty-state";
  empty.append(
    createText(container.ownerDocument, "h3", title),
    createText(container.ownerDocument, "p", description),
  );
  container.append(empty);
}

function formatStatus(options: SidebarRenderOptions): string {
  const { status } = options.model;
  const { t } = options.translator;
  if (status.state === "scanning") {
    return t("status.scanning", { current: status.current, total: status.total });
  }
  if (status.state === "stale") return t("status.stale");
  if (status.state === "failed") return status.errorMessage ?? t("status.failed");
  if (status.state === "idle") return t("status.idle");
  return t("status.ready");
}

function formatBrokenReason(
  reason: BrokenLinkResult["reason"],
  translator: Translator,
): string {
  if (reason === "missing-file") return translator.t("sidebar.broken.reason.missingFile");
  if (reason === "missing-heading") {
    return translator.t("sidebar.broken.reason.missingHeading");
  }
  if (reason === "missing-block") return translator.t("sidebar.broken.reason.missingBlock");
  return translator.t("sidebar.broken.reason.invalid");
}

function createSelect(
  document: Document,
  options: readonly (readonly [string, string])[],
  selected: string,
  onChange: (value: string) => void,
  ariaLabel?: string,
): HTMLSelectElement {
  const select = document.createElement("select");
  if (ariaLabel !== undefined) select.setAttribute("aria-label", ariaLabel);
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    select.append(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function toggleButton(
  document: Document,
  label: string,
  pressed: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const button = createActionButton(document, label, onClick);
  button.className = pressed ? "is-active" : "";
  button.setAttribute("aria-pressed", String(pressed));
  return button;
}

function moreButton(
  document: Document,
  label: string,
  onClick: (button: HTMLButtonElement) => void,
): HTMLButtonElement {
  const button = createActionButton(document, "…", () => onClick(button));
  button.className = "link-integrity-more-button";
  button.setAttribute("aria-label", label);
  return button;
}

function createActionButton(
  document: Document,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createText(
  document: Document,
  tag: "div" | "h2" | "h3" | "p" | "span" | "summary",
  text: string,
  className?: string,
): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className !== undefined) element.className = className;
  return element;
}

function runAction(action: () => void | Promise<void>, onError?: (error: unknown) => void): void {
  try {
    const result = action();
    if (result instanceof Promise) void result.catch((error: unknown) => onError?.(error));
  } catch (error) {
    onError?.(error);
  }
}

function documentFor(options: SidebarRenderOptions): Document {
  // All render inputs originate from one mounted document. This helper keeps
  // nested row builders free of host globals in tests and embedded windows.
  return options.document ?? window.document;
}
