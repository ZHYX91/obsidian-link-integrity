import type { FileRecord, SourceSnapshot } from "../../core/model";
import type { WorkScheduler } from "../../scheduling/work-scheduler";

export interface LinkIndexPort {
  readonly listFiles: (scheduler?: WorkScheduler) => Promise<readonly FileRecord[]>;
  readonly getFileRecord: (sourcePath: string) => Promise<FileRecord | null>;
  readonly buildSourceSnapshot: (
    sourcePath: string,
    scheduler?: WorkScheduler,
  ) => Promise<SourceSnapshot | null>;
}

export type SourceEvent =
  | {
    readonly type: "create" | "modify" | "delete";
    readonly path: string;
  }
  | {
    readonly type: "rename";
    readonly oldPath: string;
    readonly path: string;
  }
  | {
    readonly type: "metadata-resolved";
    readonly path: string | null;
  };
