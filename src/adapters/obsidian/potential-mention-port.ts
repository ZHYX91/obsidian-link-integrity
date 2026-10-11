import { parseFrontMatterAliases, type MetadataCache, type Vault } from "obsidian";

import type { FileRecord } from "../../core/model";
import type { MentionName } from "../../core/potential-mention-model";
import type { PotentialMentionPort } from "../../features/mentions/ports";
import type { WorkScheduler } from "../../scheduling/work-scheduler";
import { extractMarkdownMentionExclusions } from "./mention-body";

export class ObsidianPotentialMentionPort implements PotentialMentionPort {
  public readonly excludedRanges = extractMarkdownMentionExclusions;
  private complete = true;
  public readonly aliasesComplete = (): boolean => this.complete;

  public constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
    private readonly getOpenSource: (path: string) => string | null = () => null,
  ) {}

  public async collectNames(files: Iterable<FileRecord>, scheduler: WorkScheduler): Promise<readonly MentionName[]> {
    const names: MentionName[] = [];
    this.complete = true;
    for (const record of files) {
      if (record.extension === "md") {
        const title = record.path.slice(record.path.lastIndexOf("/") + 1).replace(/\.md$/iu, "");
        if (title.trim().length > 0) names.push({ text: title, targetPath: record.path, kind: "title" });
        const file = this.vault.getFileByPath(record.path);
        if (file !== null) {
          const cache = this.metadataCache.getFileCache(file);
          if (cache === null) this.complete = false;
          for (const value of parseFrontMatterAliases(cache?.frontmatter ?? null) ?? []) {
            const alias = value.trim();
            if (alias.length > 0 && !/[\r\n]/u.test(alias)) {
              names.push({ text: alias, targetPath: record.path, kind: "alias" });
            }
            const pause = scheduler.checkpoint();
            if (pause !== null) await pause;
          }
        }
      }
      const pause = scheduler.checkpoint();
      if (pause !== null) await pause;
    }
    return names;
  }

  public async readSource(sourcePath: string): Promise<string | null> {
    const openSource = this.getOpenSource(sourcePath);
    if (openSource !== null) return openSource;
    const file = this.vault.getFileByPath(sourcePath);
    if (file === null || file.extension.toLocaleLowerCase("en-US") !== "md") return null;
    return this.vault.cachedRead(file);
  }
}
