import type { LinkIndex } from "../../core/link-index";
import { PotentialMentionMatcher } from "../../core/potential-mention-matcher";
import type { MentionRange, PotentialMentionSource } from "../../core/potential-mention-model";
import { normalizeVaultPath } from "../../core/model";
import { WorkScheduler, type WorkSchedulerOptions } from "../../scheduling/work-scheduler";
import type { PotentialMentionPort } from "./ports";

export type { PotentialMentionSource } from "../../core/potential-mention-model";

export interface MentionReverseSnapshot {
  readonly targetPath: string;
  readonly state: "scanning" | "complete" | "cancelled" | "stale" | "failed";
  readonly checked: number;
  readonly total: number;
  readonly sources: readonly PotentialMentionSource[];
}

export class MentionRequestCancelledError extends Error {
  public constructor() {
    super("Potential mention request was superseded or cancelled.");
    this.name = "MentionRequestCancelledError";
  }
}

/** Separate derived state. This service can read LinkIndex but never mutates its graph. */
export class PotentialMentionService {
  private namesGeneration = 0;
  private sourceGeneration = 0;
  private reverseGeneration = 0;
  private matcher: PotentialMentionMatcher | null = null;
  private matcherRequest: Promise<PotentialMentionMatcher> | null = null;
  private readonly activeSources = new Map<string, { text: string; request: Promise<PotentialMentionSource> }>();

  public get aliasesComplete(): boolean { return this.port.aliasesComplete?.() ?? true; }

  public constructor(
    private readonly getIndex: () => LinkIndex,
    private readonly port: PotentialMentionPort,
    private readonly schedulerOptions: WorkSchedulerOptions = {},
  ) {}

  public invalidateTargets(): void {
    this.namesGeneration += 1;
    this.matcher = null;
    this.matcherRequest = null;
    this.invalidateSources();
  }

  public invalidateSources(): void {
    this.sourceGeneration += 1;
    this.reverseGeneration += 1;
    this.activeSources.clear();
  }

  public cancelReverseLookup(): void {
    this.reverseGeneration += 1;
  }

  public async matchSource(
    sourcePath: string,
    sourceText: string,
    range?: MentionRange,
    signal?: AbortSignal,
  ): Promise<PotentialMentionSource> {
    let entry = this.activeSources.get(sourcePath);
    if (entry?.text !== sourceText) {
      const request = this.matchFullSource(sourcePath, sourceText);
      entry = { text: sourceText, request };
      // At most four active documents and two million UTF-16 units; reverse scans never enter this cache.
      this.activeSources.delete(sourcePath);
      if (sourceText.length <= 2_000_000) this.activeSources.set(sourcePath, entry);
      let retained = [...this.activeSources.values()].reduce((total, value) => total + value.text.length, 0);
      while (this.activeSources.size > 4 || retained > 2_000_000) {
        const oldest = this.activeSources.keys().next().value as string;
        retained -= this.activeSources.get(oldest)?.text.length ?? 0;
        this.activeSources.delete(oldest);
      }
      void request.catch(() => { if (this.activeSources.get(sourcePath)?.request === request) this.activeSources.delete(sourcePath); });
    }
    const result = await entry.request;
    if (signal?.aborted === true) throw new MentionRequestCancelledError();
    return range === undefined ? result : { ...result,
      matches: result.matches.filter((match) => match.from >= range.from && match.to <= range.to) };
  }

  private async matchFullSource(sourcePath: string, sourceText: string): Promise<PotentialMentionSource> {
    const generation = this.sourceGeneration;
    const scheduler = new WorkScheduler(this.schedulerOptions);
    const current = (): boolean => generation === this.sourceGeneration;
    const matcher = await this.getMatcher();
    if (!current()) throw new MentionRequestCancelledError();
    const excludedRanges = [...await this.port.excludedRanges(sourceText, scheduler)];
    const matches = await consumeSteps(matcher.matchSteps(sourceText, { sourcePath, excludedRanges }), scheduler, current);
    const documentRevision = await mentionDocumentRevision(sourceText);
    if (!current()) throw new MentionRequestCancelledError();
    return { sourcePath: normalizeVaultPath(sourcePath), sourceText, documentRevision,
      matches: withMentionContexts(sourceText, matches) };
  }

  public async reverseLookup(
    targetPathInput: string,
    options: {
      readonly signal?: AbortSignal;
      readonly onProgress?: (snapshot: MentionReverseSnapshot) => void;
    } = {},
  ): Promise<MentionReverseSnapshot> {
    const targetPath = normalizeVaultPath(targetPathInput);
    const generation = ++this.reverseGeneration;
    const namesGeneration = this.namesGeneration;
    const sourceGeneration = this.sourceGeneration;
    const index = this.getIndex();
    const sourcePaths = Array.from(index.iterateFiles()).filter(({ extension }) => extension === "md").map(({ path }) => path);
    const registryIdentity = sourcePaths.join("\n");
    const sources: PotentialMentionSource[] = [];
    let checked = 0;
    let lastProgressAt = 0;
    const snapshot = (state: MentionReverseSnapshot["state"]): MentionReverseSnapshot => ({
      targetPath, state, checked, total: sourcePaths.length, sources: [...sources],
    });
    const cancelled = (): boolean => generation !== this.reverseGeneration || options.signal?.aborted === true;
    const stale = (): boolean => namesGeneration !== this.namesGeneration || sourceGeneration !== this.sourceGeneration ||
      index !== this.getIndex();
    const reportProgress = (): void => {
      if (options.onProgress === undefined) return;
      const now = performance.now();
      if (checked !== 1 && checked !== sourcePaths.length && now - lastProgressAt < 100) return;
      lastProgressAt = now;
      options.onProgress(snapshot("scanning"));
    };
    options.onProgress?.(snapshot("scanning"));
    try {
      const matcher = await this.getMatcher();
      const scheduler = new WorkScheduler(this.schedulerOptions);
      for (const sourcePath of sourcePaths) {
        if (stale()) return snapshot("stale");
        if (cancelled()) return snapshot("cancelled");
        const sourceText = await this.port.readSource(sourcePath);
        if (stale()) return snapshot("stale");
        if (cancelled()) return snapshot("cancelled");
        if (sourceText === null) return snapshot("stale");
        if (sourceText !== null && sourcePath !== targetPath) {
          const excludedRanges = await this.port.excludedRanges(sourceText, scheduler);
          const matches = await consumeSteps(matcher.matchSteps(sourceText, { sourcePath, excludedRanges }), scheduler,
            () => !stale() && !cancelled());
          const related = matches.filter((match) => match.targets.some(({ path }) => path === targetPath));
          if (related.length > 0) sources.push({ sourcePath, documentRevision: await mentionDocumentRevision(sourceText),
            matches: withMentionContexts(sourceText, related) });
        }
        checked += 1;
        reportProgress();
        const pause = scheduler.checkpoint();
        if (pause !== null) await pause;
      }
      const registryChanged = Array.from(index.iterateFiles()).filter(({ extension }) => extension === "md")
        .map(({ path }) => path).join("\n") !== registryIdentity;
      return snapshot(stale() || registryChanged || !this.aliasesComplete ? "stale" : cancelled() ? "cancelled" : "complete");
    } catch (error) {
      if (stale()) return snapshot("stale");
      if (cancelled() || error instanceof MentionRequestCancelledError) return snapshot("cancelled");
      return snapshot("failed");
    }
  }

  private getMatcher(): Promise<PotentialMentionMatcher> {
    if (this.matcher !== null) return Promise.resolve(this.matcher);
    if (this.matcherRequest !== null) return this.matcherRequest;
    const generation = this.namesGeneration;
    const scheduler = new WorkScheduler(this.schedulerOptions);
    const index = this.getIndex();
    const current = (): boolean => generation === this.namesGeneration;
    const request = (async (): Promise<PotentialMentionMatcher> => {
      const names = await this.port.collectNames(index.iterateFiles(), scheduler);
      const matcher = await consumeSteps(PotentialMentionMatcher.createSteps(names), scheduler, current);
      if (!current()) throw new MentionRequestCancelledError();
      this.matcher = matcher;
      return matcher;
    })();
    this.matcherRequest = request;
    void request.finally(() => {
      if (this.matcherRequest === request) this.matcherRequest = null;
    }).catch(() => undefined);
    return request;
  }
}

export async function mentionDocumentRevision(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function withMentionContexts(source: string, matches: readonly PotentialMentionSource["matches"][number][]): PotentialMentionSource["matches"] {
  let position = 0;
  let line = 1;
  return matches.map((match) => {
    while (position < match.from) {
      if (source[position] === "\r") { line += 1; if (source[position + 1] === "\n") position += 1; }
      else if (source[position] === "\n") line += 1;
      position += 1;
    }
    return { ...match, context: { line, excerpt: source.slice(Math.max(0, match.from - 30), match.to + 30).replace(/\s+/gu, " ") } };
  });
}

async function consumeSteps<T>(steps: Generator<void, T>, scheduler: WorkScheduler, current: () => boolean): Promise<T> {
  let step = steps.next();
  while (!step.done) {
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    if (!current()) throw new MentionRequestCancelledError();
    step = steps.next();
  }
  if (!current()) throw new MentionRequestCancelledError();
  return step.value;
}
