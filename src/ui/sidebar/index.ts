export { renderSidebar, type SidebarRenderOptions } from "./render";
export type {
  BrokenGrouping,
  BrokenLinkResult,
  BrokenReason,
  BrokenSort,
  BrokenViewMode,
  IndexStatus,
  IsolatedFileResult,
  IsolatedQueryMode,
  IsolatedSort,
  IsolatedViewMode,
  ResultLocation,
  SidebarNavigationPort,
  SidebarQueryPort,
  SidebarQuerySnapshot,
  SidebarTabId,
} from "./types";
export {
  buildIsolatedTree,
  createSidebarViewModel,
  groupBrokenLinks,
  SIDEBAR_RESULT_BATCH_SIZE,
  type BrokenGroupViewModel,
  type IsolatedTreeNode,
  type SidebarViewModel,
  type SidebarViewState,
} from "./view-model";
