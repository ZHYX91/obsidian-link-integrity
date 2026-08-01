import type { LinkOccurrenceKind } from "./model";
import {
  isFileLevelResolved,
  normalizeFileRecord,
  normalizeLookupKey,
  normalizeVaultPath,
  validateSourceSnapshot,
  type FileRecord,
  type LinkOccurrence,
  type SourceSnapshot,
} from "./model";
import {
  EMPTY_GRAPH_CONTRIBUTION_SCOPE,
  isGraphContributionAllowed,
  type GraphContributionScope,
} from "./scopes";

export interface LinkIndexOptions {
  readonly contributionScope?: GraphContributionScope;
}

export interface EdgeContribution {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly total: number;
  readonly byKind: ReadonlyMap<LinkOccurrenceKind, number>;
}

export interface CanonicalLinkIndexState {
  readonly files: readonly {
    readonly path: string;
    readonly extension: string;
    readonly lookupKeys: readonly string[];
    readonly modifiedAt: number;
  }[];
  readonly snapshots: readonly {
    readonly sourcePath: string;
    readonly occurrences: readonly {
      readonly id: string;
      readonly lookupKey: string;
      readonly targetPath: string | null;
      readonly fileStatus: LinkOccurrence["fileStatus"];
      readonly subpathStatus: LinkOccurrence["subpathStatus"];
    }[];
  }[];
  readonly edges: readonly {
    readonly sourcePath: string;
    readonly targetPath: string;
    readonly total: number;
    readonly byKind: readonly (readonly [LinkOccurrenceKind, number])[];
  }[];
  readonly selfLinks: readonly (readonly [string, number])[];
}

interface MutableEdgeContribution {
  readonly sourcePath: string;
  readonly targetPath: string;
  total: number;
  readonly byKind: Map<LinkOccurrenceKind, number>;
}

export class LinkIndex {
  private filesByPath = new Map<string, FileRecord>();
  private readonly snapshotsBySource = new Map<string, SourceSnapshot>();
  private readonly occurrencesById = new Map<string, LinkOccurrence>();
  private readonly occurrenceIdsByLookupKey = new Map<string, Set<string>>();
  private readonly occurrenceIdsByTargetPath = new Map<string, Set<string>>();
  private readonly edgesBySource = new Map<string, Map<string, MutableEdgeContribution>>();
  private readonly edgesByTarget = new Map<string, Map<string, MutableEdgeContribution>>();
  private readonly selfLinkCounts = new Map<string, number>();
  private contributionScope: GraphContributionScope;

  public constructor(
    files: readonly FileRecord[] = [],
    options: LinkIndexOptions = {},
  ) {
    this.contributionScope = cloneContributionScope(
      options.contributionScope ?? EMPTY_GRAPH_CONTRIBUTION_SCOPE,
    );
    this.replaceFiles(files);
  }

  public get files(): readonly FileRecord[] {
    return Array.from(this.filesByPath.values());
  }

  public get snapshots(): readonly SourceSnapshot[] {
    return Array.from(this.snapshotsBySource.values());
  }

  public get occurrences(): readonly LinkOccurrence[] {
    return Array.from(this.occurrencesById.values());
  }

  public getFile(path: string): FileRecord | null {
    return this.filesByPath.get(normalizeVaultPath(path)) ?? null;
  }

  public hasFile(path: string): boolean {
    return this.filesByPath.has(normalizeVaultPath(path));
  }

  public getSourceSnapshot(sourcePath: string): SourceSnapshot | null {
    return this.snapshotsBySource.get(normalizeVaultPath(sourcePath)) ?? null;
  }

  public getOccurrence(id: string): LinkOccurrence | null {
    return this.occurrencesById.get(id) ?? null;
  }

  public replaceFiles(files: readonly FileRecord[]): void {
    const next = new Map<string, FileRecord>();
    for (const input of files) {
      const file = normalizeFileRecord(input);
      if (next.has(file.path)) throw new Error(`Duplicate file path: ${file.path}`);
      next.set(file.path, file);
    }
    const changedExistencePaths = new Set<string>();
    for (const path of this.filesByPath.keys()) {
      if (!next.has(path)) changedExistencePaths.add(path);
    }
    for (const path of next.keys()) {
      if (!this.filesByPath.has(path)) changedExistencePaths.add(path);
    }

    for (const sourcePath of Array.from(this.snapshotsBySource.keys())) {
      if (!next.has(sourcePath)) this.replaceSourceSnapshot(sourcePath, null);
    }
    const affectedOccurrences = Array.from(changedExistencePaths)
      .flatMap((path) => Array.from(this.occurrenceIdsByTargetPath.get(path) ?? []))
      .map((id) => this.occurrencesById.get(id))
      .filter((occurrence): occurrence is LinkOccurrence => occurrence !== undefined);
    for (const occurrence of affectedOccurrences) this.removeGraphContribution(occurrence);
    this.filesByPath = next;
    for (const occurrence of affectedOccurrences) this.addGraphContribution(occurrence);
  }

  public replaceFileRecord(pathInput: string, input: FileRecord | null): void {
    const path = normalizeVaultPath(pathInput);
    const file = input === null ? null : normalizeFileRecord(input);
    if (file !== null && file.path !== path) {
      throw new Error(`Replacement file path does not match: ${path}`);
    }
    const existed = this.filesByPath.has(path);
    if (!existed && file === null) return;

    if (file === null && this.snapshotsBySource.has(path)) {
      this.replaceSourceSnapshot(path, null);
    }
    const existenceChanged = existed !== (file !== null);
    const affectedOccurrences = existenceChanged
      ? Array.from(this.occurrenceIdsByTargetPath.get(path) ?? [])
        .map((id) => this.occurrencesById.get(id))
        .filter((occurrence): occurrence is LinkOccurrence => occurrence !== undefined)
      : [];
    for (const occurrence of affectedOccurrences) this.removeGraphContribution(occurrence);
    if (file === null) this.filesByPath.delete(path);
    else this.filesByPath.set(path, file);
    for (const occurrence of affectedOccurrences) this.addGraphContribution(occurrence);
  }

  public setContributionScope(scope: GraphContributionScope): void {
    this.contributionScope = cloneContributionScope(scope);
    this.rebuildGraphState();
  }

  public replaceSourceSnapshot(
    sourcePathInput: string,
    snapshot: SourceSnapshot | null,
  ): void {
    const sourcePath = normalizeVaultPath(sourcePathInput);
    const normalized = snapshot === null ? null : normalizeSnapshot(snapshot);
    if (normalized !== null) {
      if (normalized.sourcePath !== sourcePath) {
        throw new Error("Snapshot source does not match the replacement source path.");
      }
      if (!this.filesByPath.has(sourcePath)) {
        throw new Error(`Cannot index a source that is not in the file registry: ${sourcePath}`);
      }
      validateSourceSnapshot(normalized);
      this.validateOccurrenceIds(sourcePath, normalized);
    }

    const previous = this.snapshotsBySource.get(sourcePath);
    if (previous !== undefined) {
      for (const occurrence of previous.occurrences) this.removeOccurrence(occurrence);
      this.snapshotsBySource.delete(sourcePath);
    }
    if (normalized !== null) {
      this.snapshotsBySource.set(sourcePath, normalized);
      for (const occurrence of normalized.occurrences) this.addOccurrence(occurrence);
    }
  }

  public getOccurrenceIdsByLookupKey(lookupKey: string): ReadonlySet<string> {
    return new Set(this.occurrenceIdsByLookupKey.get(normalizeLookupKey(lookupKey)) ?? []);
  }

  public getSourcePathsByLookupKeys(lookupKeys: Iterable<string>): ReadonlySet<string> {
    const result = new Set<string>();
    for (const lookupKey of lookupKeys) {
      for (const id of this.getOccurrenceIdsByLookupKey(lookupKey)) {
        const occurrence = this.occurrencesById.get(id);
        if (occurrence !== undefined) result.add(occurrence.sourcePath);
      }
    }
    return result;
  }

  public getSourcePathsByTargetPath(targetPathInput: string): ReadonlySet<string> {
    const targetPath = normalizeVaultPath(targetPathInput);
    const result = new Set<string>();
    for (const id of this.occurrenceIdsByTargetPath.get(targetPath) ?? []) {
      const occurrence = this.occurrencesById.get(id);
      if (occurrence !== undefined) result.add(occurrence.sourcePath);
    }
    return result;
  }

  public getOutgoingEdges(sourcePathInput: string): readonly EdgeContribution[] {
    const sourcePath = normalizeVaultPath(sourcePathInput);
    return Array.from(this.edgesBySource.get(sourcePath)?.values() ?? [], freezeEdge);
  }

  public getIncomingEdges(targetPathInput: string): readonly EdgeContribution[] {
    const targetPath = normalizeVaultPath(targetPathInput);
    return Array.from(this.edgesByTarget.get(targetPath)?.values() ?? [], freezeEdge);
  }

  public getOutgoingNeighborCount(sourcePath: string): number {
    return this.edgesBySource.get(normalizeVaultPath(sourcePath))?.size ?? 0;
  }

  public getIncomingNeighborCount(targetPath: string): number {
    return this.edgesByTarget.get(normalizeVaultPath(targetPath))?.size ?? 0;
  }

  public getOutgoingContributionCount(sourcePath: string): number {
    return sumEdges(this.edgesBySource.get(normalizeVaultPath(sourcePath))?.values());
  }

  public getIncomingContributionCount(targetPath: string): number {
    return sumEdges(this.edgesByTarget.get(normalizeVaultPath(targetPath))?.values());
  }

  public getSelfLinkCount(path: string): number {
    return this.selfLinkCounts.get(normalizeVaultPath(path)) ?? 0;
  }

  public toCanonicalState(): CanonicalLinkIndexState {
    const edges = Array.from(this.edgesBySource.values())
      .flatMap((targets) => Array.from(targets.values()))
      .sort(compareEdges)
      .map((edge) => ({
        sourcePath: edge.sourcePath,
        targetPath: edge.targetPath,
        total: edge.total,
        byKind: Array.from(edge.byKind.entries()).sort(([left], [right]) =>
          left.localeCompare(right)),
      }));
    return {
      files: Array.from(this.filesByPath.values())
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((file) => ({
          path: file.path,
          extension: file.extension,
          lookupKeys: [...file.lookupKeys].sort(),
          modifiedAt: file.modifiedAt,
        })),
      snapshots: Array.from(this.snapshotsBySource.values())
        .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))
        .map((snapshot) => ({
          sourcePath: snapshot.sourcePath,
          occurrences: snapshot.occurrences
            .map((occurrence) => ({
              id: occurrence.id,
              lookupKey: occurrence.lookupKey,
              targetPath: occurrence.targetPath,
              fileStatus: occurrence.fileStatus,
              subpathStatus: occurrence.subpathStatus,
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
        })),
      edges,
      selfLinks: Array.from(this.selfLinkCounts.entries()).sort(([left], [right]) =>
        left.localeCompare(right)),
    };
  }

  private validateOccurrenceIds(sourcePath: string, snapshot: SourceSnapshot): void {
    for (const occurrence of snapshot.occurrences) {
      const existing = this.occurrencesById.get(occurrence.id);
      if (existing !== undefined && existing.sourcePath !== sourcePath) {
        throw new Error(`Occurrence ID is already used by ${existing.sourcePath}: ${occurrence.id}`);
      }
    }
  }

  private rebuildGraphState(): void {
    this.clearGraphState();
    for (const occurrence of this.occurrencesById.values()) this.addGraphContribution(occurrence);
  }

  private clearGraphState(): void {
    this.edgesBySource.clear();
    this.edgesByTarget.clear();
    this.selfLinkCounts.clear();
  }

  private addOccurrence(occurrence: LinkOccurrence): void {
    this.occurrencesById.set(occurrence.id, occurrence);
    addToSetMap(this.occurrenceIdsByLookupKey, occurrence.lookupKey, occurrence.id);
    if (occurrence.targetPath !== null) {
      addToSetMap(this.occurrenceIdsByTargetPath, occurrence.targetPath, occurrence.id);
    }
    this.addGraphContribution(occurrence);
  }

  private removeOccurrence(occurrence: LinkOccurrence): void {
    this.removeGraphContribution(occurrence);
    this.occurrencesById.delete(occurrence.id);
    removeFromSetMap(this.occurrenceIdsByLookupKey, occurrence.lookupKey, occurrence.id);
    if (occurrence.targetPath !== null) {
      removeFromSetMap(this.occurrenceIdsByTargetPath, occurrence.targetPath, occurrence.id);
    }
  }

  private addGraphContribution(occurrence: LinkOccurrence): void {
    if (!this.canContribute(occurrence)) return;
    const targetPath = occurrence.targetPath;
    if (targetPath === null) return;
    if (occurrence.sourcePath === targetPath) {
      this.selfLinkCounts.set(
        occurrence.sourcePath,
        (this.selfLinkCounts.get(occurrence.sourcePath) ?? 0) + 1,
      );
      return;
    }
    const edge = getOrCreateEdge(this.edgesBySource, occurrence.sourcePath, targetPath);
    edge.total += 1;
    edge.byKind.set(occurrence.kind, (edge.byKind.get(occurrence.kind) ?? 0) + 1);
    getOrCreateTargetEdges(this.edgesByTarget, targetPath).set(occurrence.sourcePath, edge);
  }

  private removeGraphContribution(occurrence: LinkOccurrence): void {
    if (!this.canContribute(occurrence)) return;
    const targetPath = occurrence.targetPath;
    if (targetPath === null) return;
    if (occurrence.sourcePath === targetPath) {
      decrementMapCount(this.selfLinkCounts, occurrence.sourcePath);
      return;
    }
    const targets = this.edgesBySource.get(occurrence.sourcePath);
    const edge = targets?.get(targetPath);
    if (edge === undefined) return;
    edge.total -= 1;
    decrementMapCount(edge.byKind, occurrence.kind);
    if (edge.total === 0) {
      targets?.delete(targetPath);
      if (targets?.size === 0) this.edgesBySource.delete(occurrence.sourcePath);
      const sources = this.edgesByTarget.get(targetPath);
      sources?.delete(occurrence.sourcePath);
      if (sources?.size === 0) this.edgesByTarget.delete(targetPath);
    }
  }

  private canContribute(occurrence: LinkOccurrence): boolean {
    return isFileLevelResolved(occurrence) &&
      occurrence.targetPath !== null &&
      this.filesByPath.has(occurrence.sourcePath) &&
      this.filesByPath.has(occurrence.targetPath) &&
      isGraphContributionAllowed(occurrence, this.contributionScope);
  }
}

function normalizeSnapshot(snapshot: SourceSnapshot): SourceSnapshot {
  const sourcePath = normalizeVaultPath(snapshot.sourcePath);
  return {
    sourcePath,
    occurrences: snapshot.occurrences.map((occurrence) => ({
      ...occurrence,
      sourcePath: normalizeVaultPath(occurrence.sourcePath),
      lookupKey: normalizeLookupKey(occurrence.lookupKey),
      targetPath: occurrence.targetPath === null
        ? null
        : normalizeVaultPath(occurrence.targetPath),
    })),
  };
}

function cloneContributionScope(scope: GraphContributionScope): GraphContributionScope {
  return {
    ...(scope.excludedSourcePaths === undefined
      ? {}
      : { excludedSourcePaths: new Set(scope.excludedSourcePaths) }),
    ...(scope.excludedTargetPaths === undefined
      ? {}
      : { excludedTargetPaths: new Set(scope.excludedTargetPaths) }),
    ...(scope.excludedOccurrenceIds === undefined
      ? {}
      : { excludedOccurrenceIds: new Set(scope.excludedOccurrenceIds) }),
  };
}

function getOrCreateEdge(
  edgesBySource: Map<string, Map<string, MutableEdgeContribution>>,
  sourcePath: string,
  targetPath: string,
): MutableEdgeContribution {
  let targets = edgesBySource.get(sourcePath);
  if (targets === undefined) {
    targets = new Map();
    edgesBySource.set(sourcePath, targets);
  }
  let edge = targets.get(targetPath);
  if (edge === undefined) {
    edge = { sourcePath, targetPath, total: 0, byKind: new Map() };
    targets.set(targetPath, edge);
  }
  return edge;
}

function getOrCreateTargetEdges(
  edgesByTarget: Map<string, Map<string, MutableEdgeContribution>>,
  targetPath: string,
): Map<string, MutableEdgeContribution> {
  let sources = edgesByTarget.get(targetPath);
  if (sources === undefined) {
    sources = new Map();
    edgesByTarget.set(targetPath, sources);
  }
  return sources;
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  let values = map.get(key);
  if (values === undefined) {
    values = new Set();
    map.set(key, values);
  }
  values.add(value);
}

function removeFromSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key);
  values?.delete(value);
  if (values?.size === 0) map.delete(key);
}

function decrementMapCount<K>(map: Map<K, number>, key: K): void {
  const next = (map.get(key) ?? 0) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

function freezeEdge(edge: MutableEdgeContribution): EdgeContribution {
  return {
    sourcePath: edge.sourcePath,
    targetPath: edge.targetPath,
    total: edge.total,
    byKind: new Map(edge.byKind),
  };
}

function sumEdges(edges: Iterable<MutableEdgeContribution> | undefined): number {
  if (edges === undefined) return 0;
  let total = 0;
  for (const edge of edges) total += edge.total;
  return total;
}

function compareEdges(
  left: MutableEdgeContribution,
  right: MutableEdgeContribution,
): number {
  return left.sourcePath.localeCompare(right.sourcePath) ||
    left.targetPath.localeCompare(right.targetPath);
}
