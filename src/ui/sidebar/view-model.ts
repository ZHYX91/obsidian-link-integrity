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
import { WorkScheduler } from "../../scheduling/work-scheduler";
import { sortSteps } from "../../scheduling/sort-steps";

export const SIDEBAR_RESULT_BATCH_SIZE = 100;

export function createSidebarViewModelSelector(): typeof createSidebarViewModel {
  let previous: SidebarQuerySnapshot | null = null;
  let previousKey = "";
  let model: SidebarViewModel | null = null;
  return (snapshot, state, prepared) => {
    const key = JSON.stringify({
      ...state, selectedFormatFamilyIds: [...state.selectedFormatFamilyIds],
      expandedBrokenFolderPaths: [...state.expandedBrokenFolderPaths],
    });
    if (model !== null && previous !== null && key === previousKey &&
      snapshot.brokenLinks === previous.brokenLinks &&
      snapshot.isolatedFiles === previous.isolatedFiles &&
      snapshot.noIncomingFiles === previous.noIncomingFiles &&
      snapshot.brokenLinksKnown === previous.brokenLinksKnown &&
      snapshot.isolatedFilesKnown === previous.isolatedFilesKnown) {
      return { ...model, status: snapshot.status };
    }
    previous = snapshot;
    previousKey = key;
    model = createSidebarViewModel(snapshot, state, prepared);
    return model;
  };
}

interface PreparedItems {
  readonly broken: readonly BrokenLinkResult[];
  readonly isolated: readonly IsolatedFileResult[];
  readonly counts?: PreparedCounts;
}

interface PreparedCounts {
  readonly groups: ReadonlyMap<string, number>;
  readonly folders: ReadonlyMap<string, number>;
  readonly files: ReadonlyMap<string, number>;
  readonly directFolderCount: number;
  readonly isolatedBadge: number;
  readonly isolatedExpected: number;
  readonly isolatedScope: number;
}

export function createScheduledViewModelSelector(): (
  snapshot: SidebarQuerySnapshot, state: SidebarViewState,
) => Promise<SidebarViewModel | null> {
  const select = createSidebarViewModelSelector();
  let previous: SidebarQuerySnapshot | null = null;
  let key = "";
  let prepared: PreparedItems = { broken: [], isolated: [] };
  let revision = 0;
  return async (snapshot, state) => {
    const nextKey = JSON.stringify([
      state.activeTab, state.search, state.brokenView, state.brokenSort, state.brokenGrouping,
      state.isolatedMode, state.isolatedView, state.isolatedSort, state.showExpectedIsolated,
      [...state.selectedFormatFamilyIds],
    ]);
    const operation = ++revision;
    if (previous === null || key !== nextKey || previous.brokenLinks !== snapshot.brokenLinks ||
      previous.isolatedFiles !== snapshot.isolatedFiles || previous.noIncomingFiles !== snapshot.noIncomingFiles) {
      const scheduler = new WorkScheduler();
      const broken: BrokenLinkResult[] = [];
      const isolated: IsolatedFileResult[] = [];
      const search = state.search.trim().toLocaleLowerCase();
      if (state.activeTab === "broken-links") {
        for (const item of snapshot.brokenLinks) {
          if (brokenMatches(item, search)) broken.push(item);
          const pause = scheduler.checkpoint();
          if (pause !== null) await pause;
          if (operation !== revision) return null;
        }
      } else {
        const source = state.isolatedMode === "isolated" ? snapshot.isolatedFiles : snapshot.noIncomingFiles;
        for (const item of source) {
          if ((item.expectation.kind === "unexpected" || state.showExpectedIsolated) &&
            (item.formatFamilyIds ?? [item.formatFamilyId]).some((id) => state.selectedFormatFamilyIds.has(id)) &&
            pathMatches(item.path, search)) isolated.push(item);
          const pause = scheduler.checkpoint();
          if (pause !== null) await pause;
          if (operation !== revision) return null;
        }
      }
      const sort = state.brokenView === "list" ? "path" : state.brokenSort;
      const grouping = state.brokenView === "list" ? "source" : state.brokenGrouping;
      const counts = await prepareCounts(broken, snapshot, state, scheduler, () => operation === revision);
      if (counts === null) return null;
      const sortedBroken = await sortVisible(broken, brokenComparator(broken, sort, grouping, counts.groups),
        key === nextKey && sort !== "count" ? prepared.broken : null,
        (item) => item.id, scheduler, () => operation === revision);
      if (sortedBroken === null) return null;
      const sortedIsolated = await sortVisible(isolated,
        isolatedComparator(state.isolatedView === "tree" ? "path" : state.isolatedSort),
        key === nextKey ? prepared.isolated : null,
        (item) => item.path, scheduler, () => operation === revision);
      if (sortedIsolated === null || operation !== revision) return null;
      const result = { broken: sortedBroken, isolated: sortedIsolated, counts };
      prepared = result;
      previous = snapshot;
      key = nextKey;
    }
    return select(snapshot, state, prepared);
  };
}

const expectationCounts = new WeakMap<readonly IsolatedFileResult[], number>();

async function countExpected(
  items: readonly IsolatedFileResult[], scheduler: WorkScheduler, isCurrent: () => boolean,
): Promise<number | null> {
  const cached = expectationCounts.get(items);
  if (cached !== undefined) return cached;
  let expected = 0;
  for (const item of items) {
    if (item.expectation.kind === "expected") expected += 1;
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    if (!isCurrent()) return null;
  }
  expectationCounts.set(items, expected);
  return expected;
}

async function prepareCounts(
  broken: readonly BrokenLinkResult[], snapshot: SidebarQuerySnapshot, state: SidebarViewState,
  scheduler: WorkScheduler, isCurrent: () => boolean,
): Promise<PreparedCounts | null> {
  const groups = new Map<string, number>();
  const folders = new Map<string, number>();
  const files = new Map<string, number>();
  const directFolders = new Set<string>();
  for (const item of broken) {
    const folder = sourceFolderPath(item.sourcePath);
    const group = state.brokenGrouping === "target" ? targetGroupKey(item)
      : state.brokenGrouping === "source" ? item.sourcePath : folder;
    groups.set(group, (groups.get(group) ?? 0) + 1);
    files.set(item.sourcePath, (files.get(item.sourcePath) ?? 0) + 1);
    directFolders.add(folder);
    if (state.brokenGrouping === "source-folder") {
      folders.set("", (folders.get("") ?? 0) + 1);
      let path = "";
      for (const segment of folder.split("/").filter(Boolean)) {
        path = path.length === 0 ? segment : `${path}/${segment}`;
        folders.set(path, (folders.get(path) ?? 0) + 1);
      }
    }
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    if (!isCurrent()) return null;
  }
  const expected = await countExpected(snapshot.isolatedFiles, scheduler, isCurrent);
  if (expected === null) return null;
  const isolatedBadge = snapshot.isolatedFiles.length - expected;
  const isolatedExpected = state.isolatedMode === "isolated" ? expected
    : await countExpected(snapshot.noIncomingFiles, scheduler, isCurrent);
  if (isolatedExpected === null) return null;
  return {
    groups, folders, files, directFolderCount: directFolders.size, isolatedBadge, isolatedExpected,
    isolatedScope: (state.isolatedMode === "isolated" ? snapshot.isolatedFiles : snapshot.noIncomingFiles).length,
  };
}

async function sortVisible<T>(
  items: readonly T[], compare: (left: T, right: T) => number, previous: readonly T[] | null,
  keyOf: (item: T) => string, scheduler: WorkScheduler, isCurrent: () => boolean,
): Promise<T[] | null> {
  if (previous === null) return finishSort(sortSteps(items, compare), scheduler, isCurrent);
  const old = new Map<string, T>();
  const current = new Map<string, T>();
  const changed: T[] = [];
  for (const item of previous) {
    old.set(keyOf(item), item);
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    if (!isCurrent()) return null;
  }
  for (const item of items) {
    const key = keyOf(item);
    current.set(key, item);
    if (old.get(key) !== item) changed.push(item);
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    if (!isCurrent()) return null;
  }
  const sorted = await finishSort(sortSteps(changed, compare), scheduler, isCurrent);
  if (sorted === null) return null;
  const result: T[] = [];
  let position = 0;
  for (const item of previous) {
    if (current.get(keyOf(item)) === item) {
      while (position < sorted.length) {
        const update = sorted[position];
        if (update === undefined || compare(update, item) > 0) break;
        result.push(update);
        position += 1;
        const pause = scheduler.checkpoint();
        if (pause !== null) await pause;
        if (!isCurrent()) return null;
      }
      result.push(item);
    }
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    if (!isCurrent()) return null;
  }
  for (; position < sorted.length; position += 1) {
    const item = sorted[position];
    if (item !== undefined) result.push(item);
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    if (!isCurrent()) return null;
  }
  return result;
}

async function finishSort<T>(
  steps: Generator<void, T[]>, scheduler: WorkScheduler, isCurrent: () => boolean,
): Promise<T[] | null> {
  let step = steps.next();
  while (!step.done) {
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    if (!isCurrent()) return null;
    step = steps.next();
  }
  return step.value;
}

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
  prepared?: PreparedItems,
): SidebarViewModel {
  const normalizedSearch = state.search.trim().toLocaleLowerCase();
  const visibleBrokenItems = prepared?.broken ?? (state.activeTab === "broken-links"
    ? sortBrokenLinks(
      snapshot.brokenLinks.filter((result) => brokenMatches(result, normalizedSearch)),
      state.brokenView === "list" ? "path" : state.brokenSort,
      state.brokenView === "list" ? "source" : state.brokenGrouping,
    )
    : []);
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
  const unexpectedIsolatedItems = prepared?.counts === undefined ? sourceIsolatedItems
    .filter(({ expectation }) => expectation.kind === "unexpected") : [];
  const expectedIsolatedItems = prepared?.counts === undefined ? sourceIsolatedItems
    .filter(({ expectation }) => expectation.kind === "expected") : [];
  const visibleIsolatedItems = prepared?.isolated ?? (state.activeTab === "isolated-files"
    ? sortIsolatedFiles(
      sourceIsolatedItems.filter((result) =>
        (result.expectation.kind === "unexpected" || state.showExpectedIsolated) &&
        (result.formatFamilyIds ?? [result.formatFamilyId])
          .some((familyId) => state.selectedFormatFamilyIds.has(familyId)) &&
        pathMatches(result.path, normalizedSearch)),
      state.isolatedView === "tree" ? "path" : state.isolatedSort,
    )
    : []);
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
        ? prepared?.counts?.groups.size ?? new Set(visibleBrokenItems.map(targetGroupKey)).size
        : 0,
      sourceFileCount: state.brokenGrouping === "source"
        ? prepared?.counts?.files.size ?? new Set(visibleBrokenItems.map(({ sourcePath }) => sourcePath)).size
        : 0,
      sourceFolderCount: state.brokenGrouping === "source-folder"
        ? prepared?.counts?.directFolderCount ?? new Set(visibleBrokenItems.map(({ sourcePath }) =>
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
          prepared?.counts?.groups,
        )
        : [],
      folderTree: state.brokenView === "group" && state.brokenGrouping === "source-folder"
        ? buildBrokenFolderTree(brokenItems, visibleBrokenItems, state.brokenSort, prepared?.counts)
        : EMPTY_BROKEN_FOLDER_TREE,
    },
    isolated: {
      badgeCount: prepared?.counts?.isolatedBadge ?? snapshot.isolatedFiles
        .filter(({ expectation }) => expectation.kind === "unexpected").length,
      badgeKnown: snapshot.isolatedFilesKnown,
      expectedCount: prepared?.counts?.isolatedExpected ?? expectedIsolatedItems.length,
      configuredScopeCount: prepared?.counts?.isolatedScope ?? (unexpectedIsolatedItems.length + expectedIsolatedItems.length),
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
  preparedCounts?: ReadonlyMap<string, number>,
): readonly BrokenGroupViewModel[] {
  const totalCounts = new Map<string, number>();
  for (const item of preparedCounts === undefined ? allVisibleItems : []) {
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
    totalCount: (preparedCounts ?? totalCounts).get(key) ?? groupItems.length,
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
  preparedCounts?: Pick<PreparedCounts, "folders" | "files">,
): BrokenFolderTreeNode {
  const mutableRoot = createMutableBrokenFolder("", "");
  const folderCounts = new Map<string, number>();
  const fileCounts = new Map<string, number>();
  for (const item of preparedCounts === undefined ? allVisibleItems : []) {
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
  return freezeBrokenFolder(mutableRoot, preparedCounts?.folders ?? folderCounts, preparedCounts?.files ?? fileCounts, sort);
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
  return result.sort(brokenComparator(items, sort, grouping));
}

function brokenComparator(
  items: readonly BrokenLinkResult[], sort: BrokenSort, grouping: BrokenGrouping,
  preparedCounts?: ReadonlyMap<string, number>,
): (left: BrokenLinkResult, right: BrokenLinkResult) => number {
  const groupKey = (item: BrokenLinkResult): string => grouping === "target"
    ? targetGroupKey(item)
    : grouping === "source"
      ? item.sourcePath
      : sourceFolderPath(item.sourcePath);
  const groupCounts = new Map<string, number>();
  if (sort === "count" && preparedCounts === undefined) {
    for (const item of items) {
      const key = groupKey(item);
      groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
    }
  }
  return (left, right) => sort === "count"
    ? ((preparedCounts ?? groupCounts).get(groupKey(right)) ?? 0) -
        ((preparedCounts ?? groupCounts).get(groupKey(left)) ?? 0) ||
      groupKey(left).localeCompare(groupKey(right)) ||
      left.sourcePath.localeCompare(right.sourcePath) ||
      compareLocations(left, right) || left.id.localeCompare(right.id)
    : groupKey(left).localeCompare(groupKey(right)) ||
      left.sourcePath.localeCompare(right.sourcePath) ||
      compareLocations(left, right) || left.id.localeCompare(right.id);
}

function sortIsolatedFiles(
  items: readonly IsolatedFileResult[],
  sort: IsolatedSort,
): IsolatedFileResult[] {
  const result = [...items];
  return result.sort(isolatedComparator(sort));
}

function isolatedComparator(sort: IsolatedSort): (left: IsolatedFileResult, right: IsolatedFileResult) => number {
  return (left, right) => {
    if (sort === "modified") return right.modifiedAt - left.modifiedAt ||
      left.path.localeCompare(right.path);
    if (sort === "broken-count") {
      return right.brokenOutgoingCount - left.brokenOutgoingCount ||
        left.path.localeCompare(right.path);
    }
    if (sort === "name") return fileName(left.path).localeCompare(fileName(right.path)) ||
      left.path.localeCompare(right.path);
    return left.path.localeCompare(right.path);
  };
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
