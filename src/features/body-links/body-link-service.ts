import type { LinkIndex } from "../../core/link-index";
import type { LinkOccurrence, SourceSnapshot } from "../../core/model";
import { WorkScheduler } from "../../scheduling/work-scheduler";
import { diagnoseOccurrence, type BrokenLinkDiagnostic } from "../queries/broken-links";

export interface ProvenBodyLink {
  readonly from: number;
  readonly to: number;
  readonly occurrence: LinkOccurrence;
  readonly linktext: string;
  readonly label: string | null;
  readonly embedded: boolean;
}
export interface BodyLinkHint extends ProvenBodyLink { readonly diagnostic: BrokenLinkDiagnostic; }
export interface BodyLinkSource {
  readonly sourcePath: string;
  readonly text: string;
  readonly state: "ready" | "pending";
  /** Includes valid links so reading mapping never guesses among only the broken subset. */
  readonly links: readonly ProvenBodyLink[];
  readonly hints: readonly BodyLinkHint[];
  readonly snapshot: SourceSnapshot | null;
}
export interface BodyLinkPort {
  proveSource(path: string, text: string, snapshot: SourceSnapshot, signal: AbortSignal): Promise<readonly ProvenBodyLink[] | null>;
  isConfirmed(link: ProvenBodyLink): boolean;
}

/** Per-source derivation only. No registry enumeration, graph mutation or independent Vault scan. */
export class BodyLinkService {
  private generation = 0;
  private readonly requests = new Set<AbortController>();
  private readonly cache = new Map<string, { text: string; snapshot: SourceSnapshot; abort: AbortController;
    promise: Promise<readonly ProvenBodyLink[] | null>; projection?: Promise<BodyLinkSource> }>();

  public constructor(private readonly index: () => LinkIndex, private readonly ready: () => boolean, private readonly port: BodyLinkPort,
    private readonly visibility: (index: LinkIndex) => (diagnostic: BrokenLinkDiagnostic) => boolean = () => () => true) {}

  public invalidate(): void {
    this.generation += 1;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.cache.clear();
  }

  public async source(path: string, text: string, signal?: AbortSignal): Promise<BodyLinkSource> {
    const pending: BodyLinkSource = { sourcePath: path, text, state: "pending", links: [], hints: [], snapshot: null };
    if (signal?.aborted || !this.ready()) return pending;
    const index = this.index();
    const snapshot = index.getSourceSnapshot(path);
    if (snapshot === null || index.getFile(path)?.extension !== "md") return pending;
    const generation = this.generation;
    let entry = this.cache.get(path);
    if (entry?.text !== text || entry.snapshot !== snapshot) {
      entry?.abort.abort();
      this.cache.delete(path);
      const abort = new AbortController();
      this.requests.add(abort);
      entry = { text, snapshot, abort, promise: this.port.proveSource(path, text, snapshot, abort.signal)
        .catch(() => null).finally(() => this.requests.delete(abort)) };
      if (text.length <= 2_000_000) {
        this.cache.set(path, entry);
        let units = [...this.cache.values()].reduce((sum, value) => sum + value.text.length, 0);
        while (this.cache.size > 4 || units > 2_000_000) {
          const oldest = this.cache.keys().next().value!;
          const removed = this.cache.get(oldest)!;
          removed.abort.abort(); this.cache.delete(oldest); units -= removed.text.length;
        }
      }
    }
    const links = await entry.promise;
    if (links === null || entry.abort.signal.aborted || signal?.aborted || generation !== this.generation ||
      !this.ready() || this.index() !== index || this.index().getSourceSnapshot(path) !== snapshot) return pending;
    entry.projection ??= this.project(path, text, snapshot, links, this.visibility(index), generation);
    const result = await entry.projection;
    return signal?.aborted || generation !== this.generation || !this.ready() || this.index() !== index ||
      this.index().getSourceSnapshot(path) !== snapshot ? pending : result;
  }

  private async project(path: string, text: string, snapshot: SourceSnapshot, links: readonly ProvenBodyLink[],
    visible: (diagnostic: BrokenLinkDiagnostic) => boolean, generation: number): Promise<BodyLinkSource> {
    const hints: BodyLinkHint[] = [];
    const scheduler = new WorkScheduler();
    for (const link of links) {
      const diagnostic = diagnoseOccurrence(link.occurrence);
      if (diagnostic !== null && diagnostic.reason !== "invalid" && this.port.isConfirmed(link) &&
        visible(diagnostic)) hints.push({ ...link, diagnostic });
      const pause = scheduler.checkpoint();
      if (pause !== null) await pause;
      if (generation !== this.generation || !this.ready()) return { sourcePath: path, text, state: "pending", links: [], hints: [], snapshot: null };
    }
    return { sourcePath: path, text, state: "ready", links, hints, snapshot };
  }
}
