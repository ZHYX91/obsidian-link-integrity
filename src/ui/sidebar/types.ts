export type {
  BrokenGrouping,
  BrokenSort,
  BrokenViewMode,
  IsolatedSort,
  IsolatedViewMode,
  SidebarTabId,
} from "../../shared/settings";
export type IsolatedQueryMode = "isolated" | "no-incoming";
export type BrokenReason =
  | "missing-file"
  | "missing-heading"
  | "missing-block"
  | "invalid";

export interface ResultLocation {
  readonly line: number | null;
  readonly column: number | null;
  readonly property: string | null;
  readonly canvasNodeId: string | null;
}

export interface BrokenLinkResult {
  readonly id: string;
  readonly sourcePath: string;
  readonly targetText: string;
  readonly resolvedTargetPath: string | null;
  readonly rawText: string;
  readonly context: string;
  readonly reason: BrokenReason;
  readonly location: ResultLocation;
}

export interface IsolatedFileResult {
  readonly path: string;
  readonly formatFamilyId: string;
  readonly formatFamilyIds?: readonly string[];
  readonly modifiedAt: number;
  readonly brokenOutgoingCount: number;
  readonly incomingCount: number;
  readonly outgoingCount: number;
  readonly expectation: {
    readonly kind: "unexpected" | "expected";
    readonly ruleIds: readonly string[];
  };
}

export interface IndexStatus {
  readonly state: "idle" | "scanning" | "ready" | "stale" | "failed";
  readonly current: number;
  readonly total: number;
  readonly errorMessage: string | null;
}

export interface SidebarQuerySnapshot {
  readonly status: IndexStatus;
  readonly brokenLinks: readonly BrokenLinkResult[];
  readonly isolatedFiles: readonly IsolatedFileResult[];
  readonly noIncomingFiles: readonly IsolatedFileResult[];
}

export interface SidebarQueryPort {
  readonly getSnapshot: () => SidebarQuerySnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface SidebarNavigationPort {
  readonly openBrokenLink: (result: BrokenLinkResult) => void | Promise<void>;
  readonly openFile: (path: string) => void | Promise<void>;
  readonly openSettings: () => void | Promise<void>;
  readonly refresh: () => void | Promise<void>;
  readonly openBrokenLinkActions?: (
    result: BrokenLinkResult,
    anchor: HTMLElement,
  ) => void | Promise<void>;
  readonly openIsolatedFileActions?: (
    result: IsolatedFileResult,
    anchor: HTMLElement,
  ) => void | Promise<void>;
}
