import type { LinkOccurrenceKind } from "./model";
import { ForkableMap } from "./forkable-map";
import {
  isFileLevelResolved,
  normalizeFileRecord,
  normalizeLookupKey,
  normalizeVaultPath,
  validateSourceSnapshot,
  validateLinkOccurrence,
  type FileRecord,
  type LinkOccurrence,
  type SourceSnapshot,
} from "./model";
import {
  ALLOW_ALL_GRAPH_CONTRIBUTION_POLICY,
  EMPTY_GRAPH_CONTRIBUTION_SCOPE,
  isGraphContributionAllowed,
  type GraphContributionPolicy,
  type GraphContributionScope,
} from "./scopes";

export interface LinkIndexOptions {
  readonly contributionPolicy?: GraphContributionPolicy;
  readonly contributionScope?: GraphContributionScope;
}

export interface EdgeContribution {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly total: number;
  readonly byKind: ReadonlyMap<LinkOccurrenceKind, number>;
}

export interface LinkIndexStatistics {
  readonly fileCount: number;
  readonly sourceCount: number;
  readonly occurrenceCount: number;
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

export interface IndexChanges {
  readonly sourcePaths: ReadonlySet<string>;
  readonly filePaths: ReadonlySet<string>;
  readonly graphPaths: ReadonlySet<string>;
}

export class LinkIndex {
  private filesByPath = new ForkableMap<FileRecord>();
  private snapshotsBySource = new ForkableMap<SourceSnapshot>();
  private occurrencesById = new ForkableMap<LinkOccurrence>();
  private occurrenceIdsByLookupKey = new ForkableMap<Set<string>>();
  private occurrenceIdsByTargetPath = new ForkableMap<Set<string>>();
  private edgesBySource = new ForkableMap<Map<string, MutableEdgeContribution>>();
  private edgesByTarget = new ForkableMap<Map<string, MutableEdgeContribution>>();
  private selfLinkCounts = new ForkableMap<number>();
  private readonly changedSources = new Set<string>();
  private readonly changedFiles = new Set<string>();
  private readonly changedGraphPaths = new Set<string>();
  private revision = 0;
  private contributionPolicy: GraphContributionPolicy;
  private contributionScope: GraphContributionScope;

  public constructor(
    files: readonly FileRecord[] = [],
    options: LinkIndexOptions = {},
  ) {
    this.contributionPolicy = options.contributionPolicy ??
      ALLOW_ALL_GRAPH_CONTRIBUTION_POLICY;
    this.contributionScope = cloneContributionScope(
      options.contributionScope ?? EMPTY_GRAPH_CONTRIBUTION_SCOPE,
    );
    this.replaceFiles(files);
  }

  public get files(): readonly FileRecord[] {
    return Array.from(this.filesByPath.values());
  }

  public get version(): number { return this.revision; }

  public get changes(): IndexChanges {
    return {
      sourcePaths: this.changedSources,
      filePaths: this.changedFiles,
      graphPaths: this.changedGraphPaths,
    };
  }

  public fork(): LinkIndex {
    const next = new LinkIndex([], { contributionPolicy: this.contributionPolicy });
    next.contributionScope = this.contributionScope;
    next.filesByPath = this.filesByPath.fork();
    next.snapshotsBySource = this.snapshotsBySource.fork();
    next.occurrencesById = this.occurrencesById.fork();
    next.occurrenceIdsByLookupKey = this.occurrenceIdsByLookupKey.fork();
    next.occurrenceIdsByTargetPath = this.occurrenceIdsByTargetPath.fork();
    next.edgesBySource = this.edgesBySource.fork();
    next.edgesByTarget = this.edgesByTarget.fork();
    next.selfLinkCounts = this.selfLinkCounts.fork();
    next.revision = this.revision;
    return next;
  }

  public iterateFiles(): Iterable<FileRecord> { return this.filesByPath.values(); }
  public iterateOccurrences(): Iterable<LinkOccurrence> { return this.occurrencesById.values(); }

  public get snapshots(): readonly SourceSnapshot[] {
    return Array.from(this.snapshotsBySource.values());
  }

  public get occurrences(): readonly LinkOccurrence[] {
    return Array.from(this.occurrencesById.values());
  }

  public getStatistics(): LinkIndexStatistics {
    return Object.freeze({
      fileCount: this.filesByPath.size,
      sourceCount: this.snapshotsBySource.size,
      occurrenceCount: this.occurrencesById.size,
    });
  }

  public get graphContributionPolicy(): GraphContributionPolicy {
    return this.contributionPolicy;
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

  public validateSourceSnapshotReplacements(
    replacements: readonly {
      readonly sourcePath: string;
      readonly snapshot: SourceSnapshot | null;
    }[],
    availableSourcePaths: ReadonlySet<string> = new Set(this.filesByPath.keys()),
  ): void {
    const batchSources = new Set<string>();
    const batchOccurrenceOwners = new Map<string, string>();
    for (const replacement of replacements) {
      const sourcePath = normalizeVaultPath(replacement.sourcePath);
      if (batchSources.has(sourcePath)) {
        throw new Error(`Duplicate source replacement: ${sourcePath}`);
      }
      batchSources.add(sourcePath);
      if (replacement.snapshot === null) continue;
      const snapshot = normalizeSnapshot(replacement.snapshot);
      if (snapshot.sourcePath !== sourcePath) {
        throw new Error("Snapshot source does not match the replacement source path.");
      }
      if (!availableSourcePaths.has(sourcePath)) {
        throw new Error(`Cannot index a source that is not in the file registry: ${sourcePath}`);
      }
      validateSourceSnapshot(snapshot);
      this.validateOccurrenceIds(sourcePath, snapshot);
      for (const occurrence of snapshot.occurrences) {
        const batchOwner = batchOccurrenceOwners.get(occurrence.id);
        if (batchOwner !== undefined && batchOwner !== sourcePath) {
          throw new Error(`Occurrence ID is already used by ${batchOwner}: ${occurrence.id}`);
        }
        batchOccurrenceOwners.set(occurrence.id, sourcePath);
      }
    }
  }

  public replaceFiles(files: readonly FileRecord[]): void {
    const next = new ForkableMap<FileRecord>();
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
    const affectedOccurrenceIds = new Set<string>();
    for (const path of changedExistencePaths) {
      addAll(affectedOccurrenceIds, this.occurrenceIdsByTargetPath.get(path) ?? []);
    }
    for (const [path, file] of next) {
      const previousFile = this.filesByPath.get(path);
      if (previousFile !== undefined && previousFile.extension !== file.extension) {
        addAll(
          affectedOccurrenceIds,
          this.snapshotsBySource.get(path)?.occurrences.map(({ id }) => id) ?? [],
        );
      }
    }
    const affectedOccurrences = Array.from(affectedOccurrenceIds)
      .map((id) => this.occurrencesById.get(id))
      .filter((occurrence): occurrence is LinkOccurrence => occurrence !== undefined);
    for (const occurrence of affectedOccurrences) this.removeGraphContribution(occurrence);
    this.filesByPath = next;
    this.revision += 1;
    for (const occurrence of affectedOccurrences) this.addGraphContribution(occurrence);
  }

  public replaceFileRecord(pathInput: string, input: FileRecord | null): void {
    const path = normalizeVaultPath(pathInput);
    const file = input === null ? null : normalizeFileRecord(input);
    if (file !== null && file.path !== path) {
      throw new Error(`Replacement file path does not match: ${path}`);
    }
    const previousFile = this.filesByPath.get(path);
    if (previousFile !== undefined && file !== null &&
      previousFile.modifiedAt === file.modifiedAt && previousFile.extension === file.extension &&
      previousFile.targetFingerprint === file.targetFingerprint &&
      previousFile.lookupKeys.length === file.lookupKeys.length &&
      previousFile.lookupKeys.every((key, index) => key === file.lookupKeys[index])) return;
    const existed = previousFile !== undefined;
    if (!existed && file === null) return;

    if (file === null && this.snapshotsBySource.has(path)) {
      this.replaceSourceSnapshot(path, null);
    }
    const existenceChanged = existed !== (file !== null);
    const affectedOccurrenceIds = new Set<string>();
    if (existenceChanged) {
      addAll(affectedOccurrenceIds, this.occurrenceIdsByTargetPath.get(path) ?? []);
    }
    if (previousFile !== undefined && file !== null &&
      previousFile.extension !== file.extension) {
      addAll(
        affectedOccurrenceIds,
        this.snapshotsBySource.get(path)?.occurrences.map(({ id }) => id) ?? [],
      );
    }
    const affectedOccurrences = Array.from(affectedOccurrenceIds)
      .map((id) => this.occurrencesById.get(id))
      .filter((occurrence): occurrence is LinkOccurrence => occurrence !== undefined);
    for (const occurrence of affectedOccurrences) this.removeGraphContribution(occurrence);
    if (file === null) this.filesByPath.delete(path);
    else this.filesByPath.set(path, file);
    this.changedFiles.add(path);
    this.revision += 1;
    for (const occurrence of affectedOccurrences) this.addGraphContribution(occurrence);
  }

  public setContributionScope(scope: GraphContributionScope): void {
    if (areContributionScopesEqual(this.contributionScope, scope)) return;
    this.contributionScope = cloneContributionScope(scope);
    this.revision += 1;
    this.rebuildGraphState();
  }

  public setGraphContributionPolicy(policy: GraphContributionPolicy): void {
    if (this.contributionPolicy === policy) return;
    this.contributionPolicy = policy;
    this.revision += 1;
    this.rebuildGraphState();
  }

  public replaceSourceSnapshot(
    sourcePathInput: string,
    snapshot: SourceSnapshot | null,
  ): void {
    const steps = this.replaceSourceSnapshotSteps(sourcePathInput, snapshot);
    while (!steps.next().done) { /* The synchronous reducer shares all validation and semantics. */ }
  }

  /** Consume asynchronously only on an unpublished staging index. */
  public *replaceSourceSnapshotSteps(
    sourcePathInput: string,
    snapshot: SourceSnapshot | null,
  ): Generator<void> {
    const sourcePath = normalizeVaultPath(sourcePathInput);
    const occurrences: LinkOccurrence[] = [];
    const normalized: SourceSnapshot | null = snapshot === null
      ? null : { sourcePath: normalizeVaultPath(snapshot.sourcePath), occurrences };
    if (normalized !== null) {
      if (normalized.sourcePath !== sourcePath) {
        throw new Error("Snapshot source does not match the replacement source path.");
      }
      if (!this.filesByPath.has(sourcePath)) {
        throw new Error(`Cannot index a source that is not in the file registry: ${sourcePath}`);
      }
      const ids = new Set<string>();
      for (const input of snapshot?.occurrences ?? []) {
        const occurrence = normalizeOccurrence(input);
        validateLinkOccurrence(occurrence, sourcePath, ids);
        const existing = this.occurrencesById.get(occurrence.id);
        if (existing !== undefined && existing.sourcePath !== sourcePath) {
          throw new Error(`Occurrence ID is already used by ${existing.sourcePath}: ${occurrence.id}`);
        }
        occurrences.push(occurrence);
        yield;
      }
    }

    const previous = this.snapshotsBySource.get(sourcePath);
    if (normalized === null && previous === undefined) return;
    if (normalized !== null && previous !== undefined &&
      previous.occurrences.length === normalized.occurrences.length) {
      let equal = true;
      for (let index = 0; index < previous.occurrences.length; index += 1) {
        const occurrence = previous.occurrences[index];
        if (occurrence !== undefined &&
          !areLinkOccurrencesEqual(occurrence, normalized.occurrences[index])) { equal = false; break; }
        yield;
      }
      if (equal) return;
    }
    if (previous !== undefined) {
      for (const occurrence of previous.occurrences) { this.removeOccurrence(occurrence); yield; }
      this.snapshotsBySource.delete(sourcePath);
    }
    if (normalized !== null) {
      this.snapshotsBySource.set(sourcePath, normalized);
      for (const occurrence of normalized.occurrences) { this.addOccurrence(occurrence); yield; }
    }
    this.changedSources.add(sourcePath);
    this.changedGraphPaths.add(sourcePath);
    this.revision += 1;
  }

  public getOccurrenceIdsByLookupKey(lookupKey: string): ReadonlySet<string> {
    return new Set(this.occurrenceIdsByLookupKey.get(normalizeLookupKey(lookupKey)) ?? []);
  }

  public getSourcePathsByLookupKeys(lookupKeys: Iterable<string>): ReadonlySet<string> {
    return new Set(this.iterateSourcePathsByLookupKeys(lookupKeys));
  }

  public *iterateSourcePathsByLookupKeys(lookupKeys: Iterable<string>): Iterable<string> {
    for (const lookupKey of lookupKeys) {
      for (const id of this.occurrenceIdsByLookupKey.get(normalizeLookupKey(lookupKey)) ?? []) {
        const occurrence = this.occurrencesById.get(id);
        if (occurrence !== undefined) yield occurrence.sourcePath;
      }
    }
  }

  public getSourcePathsByTargetPath(targetPathInput: string): ReadonlySet<string> {
    return new Set(this.iterateSourcePathsByTargetPath(targetPathInput));
  }

  public *iterateSourcePathsByTargetPath(targetPathInput: string): Iterable<string> {
    const targetPath = normalizeVaultPath(targetPathInput);
    for (const id of this.occurrenceIdsByTargetPath.get(targetPath) ?? []) {
      const occurrence = this.occurrencesById.get(id);
      if (occurrence !== undefined) yield occurrence.sourcePath;
    }
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
    const targets = editEdges(this.edgesBySource, occurrence.sourcePath);
    const previous = targets.get(targetPath);
    const edge: MutableEdgeContribution = {
      sourcePath: occurrence.sourcePath, targetPath,
      total: previous?.total ?? 0, byKind: new Map(previous?.byKind),
    };
    edge.total += 1;
    edge.byKind.set(occurrence.kind, (edge.byKind.get(occurrence.kind) ?? 0) + 1);
    targets.set(targetPath, edge);
    editEdges(this.edgesByTarget, targetPath).set(occurrence.sourcePath, edge);
    this.changedGraphPaths.add(targetPath);
  }

  private removeGraphContribution(occurrence: LinkOccurrence): void {
    if (!this.canContribute(occurrence)) return;
    const targetPath = occurrence.targetPath;
    if (targetPath === null) return;
    if (occurrence.sourcePath === targetPath) {
      decrementMapCount(this.selfLinkCounts, occurrence.sourcePath);
      return;
    }
    const previous = this.edgesBySource.get(occurrence.sourcePath)?.get(targetPath);
    if (previous === undefined) return;
    const targets = editEdges(this.edgesBySource, occurrence.sourcePath);
    const sources = editEdges(this.edgesByTarget, targetPath);
    const edge = { ...previous, byKind: new Map(previous.byKind) };
    edge.total -= 1;
    decrementMapCount(edge.byKind, occurrence.kind);
    if (edge.total === 0) {
      targets?.delete(targetPath);
      if (targets?.size === 0) this.edgesBySource.delete(occurrence.sourcePath);
      sources?.delete(occurrence.sourcePath);
      if (sources?.size === 0) this.edgesByTarget.delete(targetPath);
    } else {
      targets.set(targetPath, edge);
      sources.set(occurrence.sourcePath, edge);
    }
    this.changedGraphPaths.add(targetPath);
  }

  private canContribute(occurrence: LinkOccurrence): boolean {
    const sourceFile = this.filesByPath.get(occurrence.sourcePath);
    return isFileLevelResolved(occurrence) &&
      occurrence.targetPath !== null &&
      sourceFile !== undefined &&
      this.filesByPath.has(occurrence.targetPath) &&
      isGraphContributionAllowed(occurrence, this.contributionScope) &&
      this.contributionPolicy.allows({ occurrence, sourceFile });
  }
}

function normalizeSnapshot(snapshot: SourceSnapshot): SourceSnapshot {
  const sourcePath = normalizeVaultPath(snapshot.sourcePath);
  return {
    sourcePath,
    occurrences: snapshot.occurrences.map(normalizeOccurrence),
  };
}

function normalizeOccurrence(occurrence: LinkOccurrence): LinkOccurrence {
  return {
    ...occurrence,
    position: occurrence.position === null ? null : { ...occurrence.position },
    sourcePath: normalizeVaultPath(occurrence.sourcePath),
    lookupKey: normalizeLookupKey(occurrence.lookupKey),
    targetPath: occurrence.targetPath === null ? null : normalizeVaultPath(occurrence.targetPath),
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

function areContributionScopesEqual(
  left: GraphContributionScope,
  right: GraphContributionScope,
): boolean {
  return areSetsEqual(left.excludedSourcePaths, right.excludedSourcePaths) &&
    areSetsEqual(left.excludedTargetPaths, right.excludedTargetPaths) &&
    areSetsEqual(left.excludedOccurrenceIds, right.excludedOccurrenceIds);
}

function areSetsEqual<T>(
  left: ReadonlySet<T> | undefined,
  right: ReadonlySet<T> | undefined,
): boolean {
  const leftSize = left?.size ?? 0;
  const rightSize = right?.size ?? 0;
  if (leftSize !== rightSize) return false;
  if (leftSize === 0) return true;
  if (left === undefined || right === undefined) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function areLinkOccurrencesEqual(
  left: LinkOccurrence,
  right: LinkOccurrence | undefined,
): boolean {
  return right !== undefined &&
    left.id === right.id &&
    left.sourcePath === right.sourcePath &&
    left.raw === right.raw &&
    left.linkpath === right.linkpath &&
    left.subpath === right.subpath &&
    left.lookupKey === right.lookupKey &&
    left.kind === right.kind &&
    areSourcePositionsEqual(left.position, right.position) &&
    left.destinationKind === right.destinationKind &&
    left.targetPath === right.targetPath &&
    left.fileStatus === right.fileStatus &&
    left.subpathStatus === right.subpathStatus;
}

function areSourcePositionsEqual(
  left: LinkOccurrence["position"],
  right: LinkOccurrence["position"],
): boolean {
  if (left === right) return true;
  return left !== null && right !== null &&
    left.line === right.line &&
    left.column === right.column &&
    left.endLine === right.endLine &&
    left.endColumn === right.endColumn &&
    left.property === right.property &&
    left.canvasNodeId === right.canvasNodeId;
}

function editEdges(
  map: ForkableMap<Map<string, MutableEdgeContribution>>,
  path: string,
): Map<string, MutableEdgeContribution> {
  return map.edit(path, () => new Map(), (edges) => new Map(edges));
}

function addToSetMap(map: ForkableMap<Set<string>>, key: string, value: string): void {
  const values = map.edit(key, () => new Set(), (items) => new Set(items));
  values.add(value);
}

function removeFromSetMap(map: ForkableMap<Set<string>>, key: string, value: string): void {
  if (!map.has(key)) return;
  const values = map.edit(key, () => new Set(), (items) => new Set(items));
  values?.delete(value);
  if (values?.size === 0) map.delete(key);
}

function addAll<T>(target: Set<T>, values: Iterable<T>): void {
  for (const value of values) target.add(value);
}

function decrementMapCount<K>(map: {
  get: (key: K) => number | undefined;
  set: (key: K, value: number) => unknown;
  delete: (key: K) => unknown;
}, key: K): void {
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
