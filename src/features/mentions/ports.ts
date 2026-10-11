import type { FileRecord } from "../../core/model";
import type { MentionName, MentionRange } from "../../core/potential-mention-model";
import type { WorkScheduler } from "../../scheduling/work-scheduler";

export interface PotentialMentionPort {
  /** Only files in the authoritative registry may supply targets. */
  readonly collectNames: (files: Iterable<FileRecord>, scheduler: WorkScheduler) => Promise<readonly MentionName[]>;
  readonly readSource: (sourcePath: string) => Promise<string | null>;
  readonly excludedRanges: (source: string, scheduler: WorkScheduler) => Promise<readonly MentionRange[]>;
  readonly aliasesComplete?: () => boolean;
}
