export const IGNORE_RULE_SCOPES = [
  "hide-broken-result",
  "exclude-isolated-candidate",
  "ignore-target",
  "ignore-occurrence",
  "exclude-graph-contribution",
] as const;

export type IgnoreRuleScope = (typeof IGNORE_RULE_SCOPES)[number];

export const IGNORE_MATCHER_KINDS = [
  "source-path",
  "path-prefix",
  "target-path",
  "occurrence-id",
  "format-family",
  "extension",
] as const;

export type IgnoreMatcherKind = (typeof IGNORE_MATCHER_KINDS)[number];

export interface IgnoreRule {
  readonly id: string;
  readonly enabled: boolean;
  readonly scope: IgnoreRuleScope;
  readonly matcher: {
    readonly kind: IgnoreMatcherKind;
    readonly value: string;
  };
  readonly createdAt: number;
  readonly note: string;
}

export interface IgnoreEvaluationContext {
  readonly sourcePath?: string | null | undefined;
  readonly candidatePath?: string | null | undefined;
  readonly targetPath?: string | null | undefined;
  readonly occurrenceId?: string | null | undefined;
  readonly formatFamilyIds?: readonly string[] | undefined;
  readonly extension?: string | null | undefined;
}

export interface IgnoreEvaluation {
  readonly matchedRuleIds: readonly string[];
  readonly hideBrokenResult: boolean;
  readonly excludeIsolatedCandidate: boolean;
  readonly ignoreTarget: boolean;
  readonly ignoreOccurrence: boolean;
  readonly excludeGraphContribution: boolean;
}

export interface IgnoreRulePreview {
  readonly matchCount: number;
  readonly samples: readonly string[];
}

export class IgnoreService {
  private readonly enabledRules: readonly IgnoreRule[];
  private readonly graphContributionRules: readonly IgnoreRule[];

  constructor(rules: readonly IgnoreRule[]) {
    this.enabledRules = rules.filter(({ enabled }) => enabled);
    this.graphContributionRules = this.enabledRules.filter(isGraphContributionRule);
  }

  evaluate(context: IgnoreEvaluationContext): IgnoreEvaluation {
    const matching = this.enabledRules.filter((rule) => ignoreRuleMatches(rule, context));
    const scopes = new Set(matching.map(({ scope }) => scope));
    return {
      matchedRuleIds: matching.map(({ id }) => id),
      hideBrokenResult: scopes.has("hide-broken-result"),
      excludeIsolatedCandidate: scopes.has("exclude-isolated-candidate"),
      ignoreTarget: scopes.has("ignore-target"),
      ignoreOccurrence: scopes.has("ignore-occurrence"),
      excludeGraphContribution: scopes.has("exclude-graph-contribution"),
    };
  }

  shouldHideBrokenResult(context: IgnoreEvaluationContext): boolean {
    const result = this.evaluate(context);
    return result.hideBrokenResult || result.ignoreTarget || result.ignoreOccurrence;
  }

  shouldExcludeIsolatedCandidate(context: IgnoreEvaluationContext): boolean {
    return this.evaluate(context).excludeIsolatedCandidate;
  }

  shouldExcludeGraphContribution(context: IgnoreEvaluationContext): boolean {
    return this.graphContributionRules.some((rule) => ignoreRuleMatches(rule, context));
  }

  getGraphContributionRules(): readonly IgnoreRule[] {
    return this.graphContributionRules;
  }

  preview(
    rule: IgnoreRule,
    contexts: readonly IgnoreEvaluationContext[],
    sampleLimit = 5,
  ): IgnoreRulePreview {
    return previewIgnoreRule(rule, contexts, sampleLimit);
  }
}

export function isIgnoreRuleScope(value: unknown): value is IgnoreRuleScope {
  return typeof value === "string" &&
    (IGNORE_RULE_SCOPES as readonly string[]).includes(value);
}

export function isIgnoreMatcherKind(value: unknown): value is IgnoreMatcherKind {
  return typeof value === "string" &&
    (IGNORE_MATCHER_KINDS as readonly string[]).includes(value);
}

export function isGraphContributionRule(rule: Pick<IgnoreRule, "scope">): boolean {
  return rule.scope === "exclude-graph-contribution";
}

export function normalizeIgnoreRules(value: unknown): IgnoreRule[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const result: IgnoreRule[] = [];
  for (const candidate of value) {
    const rule = normalizeIgnoreRule(candidate);
    if (rule === null || seenIds.has(rule.id)) continue;
    seenIds.add(rule.id);
    result.push(rule);
  }
  return result;
}

export function normalizeIgnoreRule(value: unknown): IgnoreRule | null {
  if (!isRecord(value) || !isRecord(value.matcher)) return null;
  const id = normalizeRuleId(value.id);
  const scope = value.scope;
  const kind = value.matcher.kind;
  const matcherValue = normalizeMatcherValue(value.matcher.value);
  if (
    id === null ||
    !isIgnoreRuleScope(scope) ||
    !isIgnoreMatcherKind(kind) ||
    matcherValue === null
  ) return null;

  return {
    id,
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    scope,
    matcher: { kind, value: matcherValue },
    createdAt: normalizeTimestamp(value.createdAt),
    note: typeof value.note === "string" ? value.note.trim().slice(0, 500) : "",
  };
}

export function ignoreRuleMatches(
  rule: IgnoreRule,
  context: IgnoreEvaluationContext,
): boolean {
  return rule.enabled && ignoreMatcherMatches(rule, context);
}

function ignoreMatcherMatches(
  rule: IgnoreRule,
  context: IgnoreEvaluationContext,
): boolean {
  const expected = normalizePath(rule.matcher.value);
  switch (rule.matcher.kind) {
    case "source-path":
      return [context.sourcePath, context.candidatePath]
        .some((path) => path !== null && path !== undefined && normalizePath(path) === expected);
    case "path-prefix":
      return (rule.scope === "ignore-target"
        ? [context.targetPath]
        : [context.sourcePath, context.candidatePath])
        .some((path) => path !== null && path !== undefined &&
          isPathWithinPrefix(normalizePath(path), expected));
    case "target-path":
      return context.targetPath !== null && context.targetPath !== undefined &&
        normalizePath(context.targetPath) === expected;
    case "occurrence-id":
      return context.occurrenceId === rule.matcher.value;
    case "format-family":
      return context.formatFamilyIds?.includes(rule.matcher.value) ?? false;
    case "extension":
      return resolveContextExtension(context) === normalizeExtension(rule.matcher.value);
  }
}

export function previewIgnoreRule(
  rule: IgnoreRule,
  contexts: readonly IgnoreEvaluationContext[],
  sampleLimit = 5,
): IgnoreRulePreview {
  const limit = Number.isFinite(sampleLimit) ? Math.max(0, Math.floor(sampleLimit)) : 5;
  let matchCount = 0;
  const samples: string[] = [];
  for (const context of contexts) {
    if (!ignoreMatcherMatches(rule, context)) continue;
    matchCount += 1;
    if (samples.length < limit) samples.push(describeContext(context));
  }
  return { matchCount, samples };
}

function normalizeRuleId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(trimmed) ? trimmed : null;
}

function normalizeMatcherValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replaceAll("\\", "/");
  return trimmed.length > 0 && trimmed.length <= 1_024 ? trimmed : null;
}

function isPathWithinPrefix(path: string, prefix: string): boolean {
  return prefix.length === 0 || path === prefix || path.startsWith(`${prefix}/`);
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function normalizeExtension(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+/, "");
}

function resolveContextExtension(context: IgnoreEvaluationContext): string {
  if (context.extension !== null && context.extension !== undefined) {
    return normalizeExtension(context.extension);
  }
  const path = context.candidatePath ?? context.sourcePath ?? context.targetPath ?? "";
  const fileName = normalizePath(path).split("/").at(-1) ?? "";
  const dot = fileName.lastIndexOf(".");
  return dot > 0 && dot < fileName.length - 1
    ? normalizeExtension(fileName.slice(dot + 1))
    : "";
}

function describeContext(context: IgnoreEvaluationContext): string {
  return context.candidatePath ??
    context.sourcePath ??
    context.targetPath ??
    context.occurrenceId ??
    context.extension ??
    context.formatFamilyIds?.[0] ??
    "";
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
