import type { LinkIndex } from "../../core/link-index";
import { PotentialMentionMatcher } from "../../core/potential-mention-matcher";
import type { MentionRange, PotentialMentionMatch, PotentialMentionSource } from "../../core/potential-mention-model";
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
  readonly matchCount: number;
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
  private readonly activeSources = new Map<string, { text: string; range: string; request: Promise<PotentialMentionSource> }>();

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
    range?: MentionRange | readonly MentionRange[],
    signal?: AbortSignal,
  ): Promise<PotentialMentionSource> {
    let entry = this.activeSources.get(sourcePath);
    const ranges = range === undefined ? undefined : "from" in range ? [range] : range;
    const rangeKey = ranges?.map(({ from, to }) => `${from}:${to}`).join(",") ?? "full";
    if (entry?.text !== sourceText || entry.range !== rangeKey) {
      const request = this.matchFullSource(sourcePath, sourceText, ranges);
      entry = { text: sourceText, range: rangeKey, request };
      // At most four active documents and two million UTF-16 units; reverse scans never enter this cache.
      this.activeSources.delete(sourcePath);
      if (ranges !== undefined && sourceText.length <= 2_000_000) this.activeSources.set(sourcePath, entry);
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
    return result;
  }

  private async matchFullSource(sourcePath: string, sourceText: string, ranges?: readonly MentionRange[]): Promise<PotentialMentionSource> {
    const generation = this.sourceGeneration;
    const scheduler = new WorkScheduler(this.schedulerOptions);
    const current = (): boolean => generation === this.sourceGeneration;
    const matcher = await this.getMatcher();
    if (!current()) throw new MentionRequestCancelledError();
    const excludedRanges = [...await this.port.excludedRanges(sourceText, scheduler)];
    const matches = await consumeSteps(matcher.matchSteps(sourceText, { sourcePath, excludedRanges,
      ...(ranges === undefined ? {} : { ranges }) }), scheduler, current);
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
    let matchCount = 0;
    let retained = 0;
    let observedStale = false;
    let lastProgressAt = 0;
    const snapshot = (state: MentionReverseSnapshot["state"]): MentionReverseSnapshot => ({
      targetPath, state, checked, total: sourcePaths.length, sources: [...sources], matchCount,
    });
    const cancelled = (): boolean => generation !== this.reverseGeneration || options.signal?.aborted === true;
    const stale = (): boolean => observedStale || namesGeneration !== this.namesGeneration || sourceGeneration !== this.sourceGeneration ||
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
      const targetMatcher = await consumeSteps(matcher.forTargetSteps(targetPath), scheduler, () => !stale() && !cancelled());
      for (const sourcePath of sourcePaths) {
        if (stale()) return snapshot("stale");
        if (cancelled()) return snapshot("cancelled");
        const sourceText = await this.port.readSource(sourcePath);
        if (stale()) return snapshot("stale");
        if (cancelled()) return snapshot("cancelled");
        if (sourceText === null) return snapshot("stale");
        if (sourceText !== null && sourcePath !== targetPath) {
          const excludedRanges = await this.port.excludedRanges(sourceText, scheduler);
          let count = 0;
          const first: PotentialMentionMatch[] = [];
          await consumeMatches(targetMatcher.scanSteps(sourceText, { sourcePath, excludedRanges }), scheduler,
            () => !stale() && !cancelled(), (match) => {
              count += 1;
              if (retained + first.length < 50) first.push(match);
            });
          if (count > 0) {
            const documentRevision = await mentionDocumentRevision(sourceText);
            if (stale() || cancelled()) return snapshot(stale() ? "stale" : "cancelled");
            const loadMatches = async (offset: number, limit: number): Promise<readonly PotentialMentionMatch[]> => {
              if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 0 || limit > 50) throw new RangeError("Invalid mention page");
              const fail = (): never => {
                observedStale = true;
                options.onProgress?.(snapshot("stale"));
                throw new MentionRequestCancelledError();
              };
              const assertCurrent = (): void => {
                if (cancelled()) throw new MentionRequestCancelledError();
                if (stale()) fail();
              };
              assertCurrent();
              if (stale() || this.getIndex().getFile(sourcePath)?.extension !== "md") return fail();
              const text = await this.port.readSource(sourcePath);
              assertCurrent();
              if (text === null) return fail();
              const revision = await mentionDocumentRevision(text);
              assertCurrent();
              if (revision !== documentRevision) return fail();
              const pageScheduler = new WorkScheduler(this.schedulerOptions);
              const excluded = await this.port.excludedRanges(text, pageScheduler);
              assertCurrent();
              const page: PotentialMentionMatch[] = [];
              if (limit === 0) return page;
              let ordinal = 0;
              const steps = targetMatcher.scanSteps(text, { sourcePath, excludedRanges: excluded });
              for (const match of steps) {
                if (match !== undefined) {
                  if (ordinal >= offset && page.length < limit) page.push(match);
                  ordinal += 1;
                }
                if (page.length >= limit) break;
                const pause = pageScheduler.checkpoint();
                if (pause !== null) await pause;
                assertCurrent();
              }
              assertCurrent();
              return withMentionContexts(text, matcher.withAllTargets(page, sourcePath));
            };
            const matches = withMentionContexts(sourceText, matcher.withAllTargets(first, sourcePath));
            retained += matches.length;
            matchCount += count;
            sources.push({ sourcePath, documentRevision, matchCount: count, matches, loadMatches });
          }
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
    if (match.from < position) { position = 0; line = 1; }
    while (position < match.from) {
      if (source[position] === "\r") { line += 1; if (source[position + 1] === "\n") position += 1; }
      else if (source[position] === "\n") line += 1;
      position += 1;
    }
    return { ...match, context: { line, excerpt: source.slice(Math.max(0, match.from - 30), match.to + 30).replace(/\s+/gu, " ") } };
  });
}

async function consumeMatches(steps: Generator<void | PotentialMentionMatch>, scheduler: WorkScheduler,
  current: () => boolean, accept: (match: PotentialMentionMatch) => void): Promise<void> {
  for (const match of steps) {
    if (match !== undefined) accept(match);
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
    if (!current()) throw new MentionRequestCancelledError();
  }
  if (!current()) throw new MentionRequestCancelledError();
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
