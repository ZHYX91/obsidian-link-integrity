import type { FileRecord, SourceSnapshot } from "../../core/model";

export interface LinkIndexPort {
  readonly listFiles: () => Promise<readonly FileRecord[]>;
  readonly getFileRecord: (sourcePath: string) => Promise<FileRecord | null>;
  readonly buildSourceSnapshot: (sourcePath: string) => Promise<SourceSnapshot | null>;
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
