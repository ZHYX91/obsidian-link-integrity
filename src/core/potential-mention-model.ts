/** Potential text matches are suggestions, never explicit link occurrences or graph edges. */
export type MentionNameKind = "title" | "alias";

export interface MentionName {
  readonly text: string;
  readonly targetPath: string;
  readonly kind: MentionNameKind;
}

export interface MentionRange {
  /** Exact UTF-16 offsets in the original source, with an exclusive end. */
  readonly from: number;
  readonly to: number;
}

export interface PotentialMentionTarget {
  readonly path: string;
  readonly nameKinds: readonly MentionNameKind[];
}

export interface PotentialMentionMatch extends MentionRange {
  readonly text: string;
  /** All targets for the same source range remain available, including ambiguous names. */
  readonly targets: readonly PotentialMentionTarget[];
  readonly context?: { readonly line: number; readonly excerpt: string };
}

export interface PotentialMentionSource {
  readonly sourcePath: string;
  /** Only bounded active-document snapshots retain the source text. */
  readonly sourceText?: string;
  readonly documentRevision: string;
  readonly matches: readonly PotentialMentionMatch[];
}

export interface MentionMatchOptions {
  readonly excludedRanges?: readonly MentionRange[];
  /** Excludes a source file from its own suggestions without changing the dictionary. */
  readonly sourcePath?: string;
}
