import type {
  BrokenGrouping,
  BrokenLinkResult,
  BrokenSort,
  BrokenViewMode,
  IndexStatus,
  IsolatedFileResult,
  IsolatedQueryMode,
  IsolatedSort,
  IsolatedViewMode,
  SidebarQuerySnapshot,
  SidebarTabId,
} from "./types";

export const SIDEBAR_RESULT_BATCH_SIZE = 100;

export interface SidebarViewState {
  readonly activeTab: SidebarTabId;
  readonly search: string;
  readonly brokenView: BrokenViewMode;
  readonly brokenGrouping: BrokenGrouping;
  readonly brokenSort: BrokenSort;
  readonly isolatedView: IsolatedViewMode;
  readonly isolatedSort: IsolatedSort;
  readonly isolatedMode: IsolatedQueryMode;
  readonly showExpectedIsolated: boolean;
  readonly selectedFormatFamilyIds: ReadonlySet<string>;
  readonly brokenResultOffset: number;
  readonly isolatedResultOffset: number;
  readonly expandedBrokenFolderPaths: ReadonlySet<string>;
}

export interface BrokenGroupViewModel {
  readonly key: string;
  readonly label: string;
  readonly reason: BrokenLinkResult["reason"] | null;
  readonly totalCount: number;
  readonly items: readonly BrokenLinkResult[];
}

export interface IsolatedTreeNode {
  readonly name: string;
  readonly path: string;
  readonly folders: readonly IsolatedTreeNode[];
  readonly files: readonly IsolatedFileResult[];
}

export interface BrokenSourceFileNode {
  readonly path: string;
  readonly name: string;
  readonly totalCount: number;
  readonly items: readonly BrokenLinkResult[];
}

export interface BrokenFolderTreeNode {
  readonly name: string;
  readonly path: string;
  readonly totalCount: number;
  readonly folders: readonly BrokenFolderTreeNode[];
  readonly files: readonly BrokenSourceFileNode[];
}

export interface SidebarViewModel {
  readonly activeTab: SidebarTabId;
  readonly status: IndexStatus;
  readonly search: string;
  readonly broken: {
    readonly badgeCount: number;
    readonly badgeKnown: boolean;
    readonly uniqueTargetCount: number;
    readonly sourceFileCount: number;
    readonly sourceFolderCount: number;
    readonly visibleCount: number;
    readonly renderedCount: number;
    readonly pageStart: number;
    readonly view: BrokenViewMode;
    readonly grouping: BrokenGrouping;
    readonly items: readonly BrokenLinkResult[];
    readonly groups: readonly BrokenGroupViewModel[];
    readonly folderTree: BrokenFolderTreeNode;
  };
  readonly isolated: {
    readonly badgeCount: number;
    readonly badgeKnown: boolean;
    readonly expectedCount: number;
    readonly configuredScopeCount: number;
    readonly visibleCount: number;
    readonly renderedCount: number;
    readonly pageStart: number;
    readonly view: IsolatedViewMode;
    readonly mode: IsolatedQueryMode;
    readonly items: readonly IsolatedFileResult[];
    readonly tree: IsolatedTreeNode;
  };
}

export function createSidebarViewModel(
  snapshot: SidebarQuerySnapshot,
  state: SidebarViewState,
): SidebarViewModel {
  const normalizedSearch = state.search.trim().toLocaleLowerCase();
  const visibleBrokenItems = state.activeTab === "broken-links"
    ? sortBrokenLinks(
      snapshot.brokenLinks.filter((result) => brokenMatches(result, normalizedSearch)),
      state.brokenView === "list" ? "path" : state.brokenSort,
      state.brokenView === "list" ? "source" : state.brokenGrouping,
    )
    : [];
  const brokenPageStart = normalizePageStart(
    state.brokenResultOffset,
    visibleBrokenItems.length,
  );
  const brokenItems = visibleBrokenItems.slice(
    brokenPageStart,
    brokenPageStart + SIDEBAR_RESULT_BATCH_SIZE,
  );
  const sourceIsolatedItems = state.isolatedMode === "isolated"
    ? snapshot.isolatedFiles
    : snapshot.noIncomingFiles;
  const unexpectedIsolatedItems = sourceIsolatedItems
    .filter(({ expectation }) => expectation.kind === "unexpected");
  const expectedIsolatedItems = sourceIsolatedItems
    .filter(({ expectation }) => expectation.kind === "expected");
  const visibleIsolatedItems = state.activeTab === "isolated-files"
    ? sortIsolatedFiles(
      sourceIsolatedItems.filter((result) =>
        (result.expectation.kind === "unexpected" || state.showExpectedIsolated) &&
        (result.formatFamilyIds ?? [result.formatFamilyId])
          .some((familyId) => state.selectedFormatFamilyIds.has(familyId)) &&
        pathMatches(result.path, normalizedSearch)),
      state.isolatedView === "tree" ? "path" : state.isolatedSort,
    )
    : [];
  const isolatedPageStart = normalizePageStart(
    state.isolatedResultOffset,
    visibleIsolatedItems.length,
  );
  const isolatedItems = visibleIsolatedItems.slice(
    isolatedPageStart,
    isolatedPageStart + SIDEBAR_RESULT_BATCH_SIZE,
  );

  return {
    activeTab: state.activeTab,
    status: snapshot.status,
    search: state.search,
    broken: {
      badgeCount: snapshot.brokenLinks.length,
      badgeKnown: snapshot.brokenLinksKnown,
      uniqueTargetCount: state.brokenGrouping === "target"
        ? new Set(visibleBrokenItems.map(targetGroupKey)).size
        : 0,
      sourceFileCount: state.brokenGrouping === "source"
        ? new Set(visibleBrokenItems.map(({ sourcePath }) => sourcePath)).size
        : 0,
      sourceFolderCount: state.brokenGrouping === "source-folder"
        ? new Set(visibleBrokenItems.map(({ sourcePath }) =>
          sourceFolderPath(sourcePath))).size
        : 0,
      visibleCount: visibleBrokenItems.length,
      renderedCount: brokenItems.length,
      pageStart: brokenPageStart,
      view: state.brokenView,
      grouping: state.brokenGrouping,
      items: brokenItems,
      groups: state.brokenView === "group" && state.brokenGrouping !== "source-folder"
        ? groupBrokenLinks(
          brokenItems,
          state.brokenGrouping,
          state.brokenSort,
          visibleBrokenItems,
        )
        : [],
      folderTree: state.brokenView === "group" && state.brokenGrouping === "source-folder"
        ? buildBrokenFolderTree(brokenItems, visibleBrokenItems, state.brokenSort)
        : EMPTY_BROKEN_FOLDER_TREE,
    },
    isolated: {
      badgeCount: snapshot.isolatedFiles
        .filter(({ expectation }) => expectation.kind === "unexpected").length,
      badgeKnown: snapshot.isolatedFilesKnown,
      expectedCount: expectedIsolatedItems.length,
      configuredScopeCount: unexpectedIsolatedItems.length + expectedIsolatedItems.length,
      visibleCount: visibleIsolatedItems.length,
      renderedCount: isolatedItems.length,
      pageStart: isolatedPageStart,
      view: state.isolatedView,
      mode: state.isolatedMode,
      items: isolatedItems,
      tree: buildIsolatedTree(isolatedItems),
    },
  };
}

const EMPTY_BROKEN_FOLDER_TREE: BrokenFolderTreeNode = Object.freeze({
  name: "",
  path: "",
  totalCount: 0,
  folders: [],
  files: [],
});

function normalizePageStart(offset: number, resultCount: number): number {
  if (resultCount === 0) return 0;
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  const requestedPageStart = Math.floor(safeOffset / SIDEBAR_RESULT_BATCH_SIZE) *
    SIDEBAR_RESULT_BATCH_SIZE;
  const lastPageStart = Math.floor((resultCount - 1) / SIDEBAR_RESULT_BATCH_SIZE) *
    SIDEBAR_RESULT_BATCH_SIZE;
  return Math.min(requestedPageStart, lastPageStart);
}

export function groupBrokenLinks(
  items: readonly BrokenLinkResult[],
  grouping: BrokenGrouping,
  sort: BrokenSort,
  allVisibleItems: readonly BrokenLinkResult[] = items,
): readonly BrokenGroupViewModel[] {
  const totalCounts = new Map<string, number>();
  for (const item of allVisibleItems) {
    const key = grouping === "target"
      ? targetGroupKey(item)
      : grouping === "source"
        ? item.sourcePath
        : sourceFolderPath(item.sourcePath);
    totalCounts.set(key, (totalCounts.get(key) ?? 0) + 1);
  }
  const groups = new Map<string, BrokenLinkResult[]>();
  for (const item of items) {
    const key = grouping === "target"
      ? targetGroupKey(item)
      : grouping === "source"
        ? item.sourcePath
        : sourceFolderPath(item.sourcePath);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  const result = Array.from(groups, ([key, groupItems]) => ({
    key,
    label: key,
    reason: grouping === "target" && groupItems.every(({ reason }) =>
      reason === groupItems[0]?.reason)
      ? groupItems[0]?.reason ?? null
      : null,
    totalCount: totalCounts.get(key) ?? groupItems.length,
    items: sortBrokenLinks(groupItems, "path"),
  }));
  return result.sort((left, right) => sort === "count"
    ? right.totalCount - left.totalCount || left.label.localeCompare(right.label)
    : left.label.localeCompare(right.label));
}

export function buildBrokenFolderTree(
  items: readonly BrokenLinkResult[],
  allVisibleItems: readonly BrokenLinkResult[] = items,
  sort: BrokenSort = "path",
): BrokenFolderTreeNode {
  const mutableRoot = createMutableBrokenFolder("", "");
  const folderCounts = new Map<string, number>();
  const fileCounts = new Map<string, number>();
  for (const item of allVisibleItems) {
    fileCounts.set(item.sourcePath, (fileCounts.get(item.sourcePath) ?? 0) + 1);
    const segments = sourceFolderPath(item.sourcePath).split("/").filter(Boolean);
    folderCounts.set("", (folderCounts.get("") ?? 0) + 1);
    let folderPath = "";
    for (const segment of segments) {
      folderPath = folderPath.length === 0 ? segment : `${folderPath}/${segment}`;
      folderCounts.set(folderPath, (folderCounts.get(folderPath) ?? 0) + 1);
    }
  }
  for (const item of items) {
    const segments = item.sourcePath.split("/").filter(Boolean);
    const name = segments.pop();
    if (name === undefined) continue;
    let current = mutableRoot;
    for (const segment of segments) {
      const folderPath = current.path.length === 0 ? segment : `${current.path}/${segment}`;
      const child = current.folders.get(segment) ?? createMutableBrokenFolder(segment, folderPath);
      current.folders.set(segment, child);
      current = child;
    }
    const file = current.files.get(item.sourcePath) ?? {
      path: item.sourcePath,
      name,
      items: [],
    };
    file.items.push(item);
    current.files.set(item.sourcePath, file);
  }
  return freezeBrokenFolder(mutableRoot, folderCounts, fileCounts, sort);
}

export function buildIsolatedTree(items: readonly IsolatedFileResult[]): IsolatedTreeNode {
  const mutableRoot: MutableTreeNode = createMutableNode("", "");
  for (const item of items) {
    const segments = item.path.split("/").filter(Boolean);
    const fileName = segments.pop();
    if (fileName === undefined) continue;
    let current = mutableRoot;
    for (const segment of segments) {
      const folderPath = current.path.length === 0 ? segment : `${current.path}/${segment}`;
      const child = current.folders.get(segment) ?? createMutableNode(segment, folderPath);
      current.folders.set(segment, child);
      current = child;
    }
    current.files.push(item);
  }
  return freezeTree(mutableRoot);
}

function sortBrokenLinks(
  items: readonly BrokenLinkResult[],
  sort: BrokenSort,
  grouping: BrokenGrouping = "target",
): BrokenLinkResult[] {
  const result = [...items];
  const groupKey = (item: BrokenLinkResult): string => grouping === "target"
    ? targetGroupKey(item)
    : grouping === "source"
      ? item.sourcePath
      : sourceFolderPath(item.sourcePath);
  const groupCounts = new Map<string, number>();
  if (sort === "count") {
    for (const item of items) {
      const key = groupKey(item);
      groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
    }
  }
  result.sort((left, right) => sort === "count"
    ? (groupCounts.get(groupKey(right)) ?? 0) -
        (groupCounts.get(groupKey(left)) ?? 0) ||
      groupKey(left).localeCompare(groupKey(right)) ||
      left.sourcePath.localeCompare(right.sourcePath) ||
      compareLocations(left, right)
    : groupKey(left).localeCompare(groupKey(right)) ||
      left.sourcePath.localeCompare(right.sourcePath) ||
      compareLocations(left, right));
  return result;
}

function sortIsolatedFiles(
  items: readonly IsolatedFileResult[],
  sort: IsolatedSort,
): IsolatedFileResult[] {
  const result = [...items];
  result.sort((left, right) => {
    if (sort === "modified") return right.modifiedAt - left.modifiedAt ||
      left.path.localeCompare(right.path);
    if (sort === "broken-count") {
      return right.brokenOutgoingCount - left.brokenOutgoingCount ||
        left.path.localeCompare(right.path);
    }
    if (sort === "name") return fileName(left.path).localeCompare(fileName(right.path)) ||
      left.path.localeCompare(right.path);
    return left.path.localeCompare(right.path);
  });
  return result;
}

function targetGroupKey(item: BrokenLinkResult): string {
  return item.targetText;
}

function sourceFolderPath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function brokenMatches(item: BrokenLinkResult, search: string): boolean {
  if (search.length === 0) return true;
  return [item.sourcePath, item.targetText, item.resolvedTargetPath ?? "", item.rawText, item.context]
    .some((value) => value.toLocaleLowerCase().includes(search));
}

function pathMatches(path: string, search: string): boolean {
  return search.length === 0 || path.toLocaleLowerCase().includes(search);
}

function compareLocations(left: BrokenLinkResult, right: BrokenLinkResult): number {
  return (left.location.line ?? Number.MAX_SAFE_INTEGER) -
    (right.location.line ?? Number.MAX_SAFE_INTEGER) ||
    (left.location.column ?? Number.MAX_SAFE_INTEGER) -
    (right.location.column ?? Number.MAX_SAFE_INTEGER);
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

interface MutableTreeNode {
  readonly name: string;
  readonly path: string;
  readonly folders: Map<string, MutableTreeNode>;
  readonly files: IsolatedFileResult[];
}

interface MutableBrokenFile {
  readonly path: string;
  readonly name: string;
  readonly items: BrokenLinkResult[];
}

interface MutableBrokenFolder {
  readonly name: string;
  readonly path: string;
  readonly folders: Map<string, MutableBrokenFolder>;
  readonly files: Map<string, MutableBrokenFile>;
}

function createMutableNode(name: string, path: string): MutableTreeNode {
  return { name, path, folders: new Map(), files: [] };
}

function freezeTree(node: MutableTreeNode): IsolatedTreeNode {
  return {
    name: node.name,
    path: node.path,
    folders: Array.from(node.folders.values())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(freezeTree),
    files: [...node.files].sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function createMutableBrokenFolder(name: string, path: string): MutableBrokenFolder {
  return { name, path, folders: new Map(), files: new Map() };
}

function freezeBrokenFolder(
  node: MutableBrokenFolder,
  folderCounts: ReadonlyMap<string, number>,
  fileCounts: ReadonlyMap<string, number>,
  sort: BrokenSort,
): BrokenFolderTreeNode {
  const folders = Array.from(node.folders.values())
    .map((folder) => freezeBrokenFolder(folder, folderCounts, fileCounts, sort))
    .sort((left, right) => sort === "count"
      ? right.totalCount - left.totalCount || left.path.localeCompare(right.path)
      : left.path.localeCompare(right.path));
  const files = Array.from(node.files.values())
    .map((file) => ({
      path: file.path,
      name: file.name,
      totalCount: fileCounts.get(file.path) ?? file.items.length,
      items: sortBrokenLinks(file.items, "path"),
    }))
    .sort((left, right) => sort === "count"
      ? right.totalCount - left.totalCount || left.path.localeCompare(right.path)
      : left.path.localeCompare(right.path));
  return {
    name: node.name,
    path: node.path,
    totalCount: folderCounts.get(node.path) ?? 0,
    folders,
    files,
  };
}
