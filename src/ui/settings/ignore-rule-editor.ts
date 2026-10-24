import {
  IGNORE_MATCHER_KINDS,
  normalizeIgnoreRule,
  type IgnoreRule,
  type IgnoreRulePreview,
  type IgnoreRuleScope,
} from "../../shared/ignore-rules";
import { normalizeSettings } from "../../shared/settings";
import { button, checkboxLabel, labeledInput, select, textElement, runAction } from "./dom-controls";
import { PreviewRequestCoordinator } from "./preview-coordinator";
import type { SettingsUiContext } from "./types";

/** Owns unsaved edits and their preview; never writes settings on input changes. */
export function renderIgnoreRules(
  container: HTMLElement,
  context: SettingsUiContext,
  domain: "broken" | "isolated",
): () => void {
  const cleanups = new Set<() => void>();
  const settings = context.getSettings?.() ?? context.settings;
  const rules = settings.ignoreRules.filter(({ scope }) => belongsToDomain(scope, domain));
  const empty = textElement(container, "p", context.translator.t("settings.ignore.empty"));
  empty.hidden = rules.length > 0;
  container.append(empty);
  const append = (rule: IgnoreRule, isNew: boolean): void => {
    empty.hidden = true;
    const editor = createRuleEditor(container, context, rule, isNew);
    cleanups.add(editor.cleanup);
  };
  for (const rule of rules) append(rule, false);
  const add = button(container, context.translator.t("settings.ignore.addRule"), () => append({
    id: context.createId("ignore-rule"),
    enabled: true,
    scope: domain === "broken" ? "hide-broken-result" : "exclude-isolated-candidate",
    matcher: { kind: "path-prefix", value: "" },
    createdAt: Date.now(),
    note: "",
  }, true));
  add.disabled = context.writeProtected;
  return () => { for (const cleanup of cleanups) cleanup(); };
}

function createRuleEditor(
  container: HTMLElement,
  context: SettingsUiContext,
  source: IgnoreRule,
  isNew: boolean,
): { readonly cleanup: () => void } {
  const document = container.ownerDocument;
  const { t } = context.translator;
  const requests = new PreviewRequestCoordinator<string, IgnoreRulePreview>();
  let disposed = false;
  let original = source;
  let draft = source;
  let previewIdentity: string | null = null;
  const currentRevision = (): string => `${context.getIndexRevision?.() ?? ""}:${context.getIndexStatus?.().state ?? "ready"}`;
  const indexReady = (): boolean => context.getIndexStatus === undefined || context.getIndexStatus().state === "ready";
  let lastRevision = currentRevision();
  const details = document.createElement("details");
  details.className = "link-integrity-settings-rule";
  details.open = isNew;
  const summary = document.createElement("summary");
  details.append(summary);
  const enabled = checkboxLabel(details, t("common.enabled"), draft.enabled).checkbox;
  const scope = labeledSelect(details, t("settings.ignore.scope"), scopeOptions(context), draft.scope);
  const matcher = labeledSelect(details, t("settings.ignore.matcher"), IGNORE_MATCHER_KINDS.map((kind) => [
    kind, t(matcherLabels[kind]),
  ]), draft.matcher.kind);
  const value = labeledInput(details, t("settings.ignore.value"), draft.matcher.value).input;
  const note = labeledInput(details, t("settings.ignore.ruleNote"), draft.note).input;
  const help = textElement(details, "p", "");
  const validation = textElement(details, "p", "");
  validation.setAttribute("role", "status");
  const preview = textElement(details, "p", t("settings.ignore.previewRequired"));
  preview.className = "link-integrity-settings-rule-preview";
  preview.setAttribute("aria-live", "polite");
  details.append(help, validation, preview);
  const actions = document.createElement("div");
  actions.className = "link-integrity-rule-modal-actions";
  details.append(actions);
  const identity = (rule: IgnoreRule): string => JSON.stringify([
    rule, currentRevision(),
  ]);
  const currentCandidate = (): IgnoreRule | null => normalizeIgnoreRule(draft);
  const refreshSave = (): void => {
    const candidate = currentCandidate();
    save.disabled = context.writeProtected || !indexReady() || candidate === null ||
      previewIdentity !== identity(candidate);
  };
  const invalidate = (message = t("settings.ignore.previewRequired")): void => {
    requests.invalidate();
    previewIdentity = null;
    preview.textContent = indexReady() ? message : t("settings.ignore.indexRequired");
    previewButton.disabled = context.writeProtected || !indexReady() || currentCandidate() === null ||
      context.requestIgnoreRulePreview === undefined;
    refreshSave();
  };
  const update = (): void => {
    draft = {
      ...draft,
      enabled: enabled.checked,
      scope: scope.value as IgnoreRule["scope"],
      matcher: { kind: matcher.value as IgnoreRule["matcher"]["kind"], value: value.value },
      note: note.value,
    };
    summary.textContent = draft.note || draft.matcher.value || t("settings.ignore.addRule");
    const graph = draft.scope === "exclude-graph-contribution";
    details.classList.toggle("is-graph-risk", graph);
    help.classList.toggle("link-integrity-warning", graph);
    help.textContent = graph ? t("settings.ignore.graphWarning")
      : draft.scope === "exclude-isolated-candidate" ? t("settings.ignore.candidateEffect")
        : t("settings.ignore.displayEffect");
    validation.textContent = currentCandidate() === null ? t("settings.ignore.valueRequired") : "";
    invalidate();
  };
  const previewButton = button(actions, t("common.preview"), () => {
    if (disposed) return;
    const candidate = currentCandidate();
    if (!indexReady() || candidate === null || context.requestIgnoreRulePreview === undefined) return;
    const requestedIdentity = identity(candidate);
    void requests.request(candidate.id,
      (signal) => context.requestIgnoreRulePreview!(candidate, signal),
      (state) => {
        if (disposed) return;
        const current = currentCandidate();
        if (current === null || requestedIdentity !== identity(current)) {
          invalidate(t("settings.ignore.previewStale"));
          return;
        }
        previewIdentity = null;
        if (state.state === "ready") {
          previewIdentity = requestedIdentity;
          preview.textContent = t("settings.ignore.matchCount", { count: state.value.matchCount });
          if (state.value.affectedFileCount !== undefined) preview.append(` · ${t("settings.ignore.impact", {
            files: state.value.affectedFileCount,
            connections: state.value.affectedConnectionCount ?? 0,
          })}`);
          if (state.value.samples.length > 0) preview.append(` · ${state.value.samples.join(", ")}`);
        } else {
          preview.textContent = t(state.state === "loading"
            ? "settings.expected.previewLoading" : "settings.expected.previewFailed");
          if (state.state === "failed") context.onError?.(state.error);
        }
        refreshSave();
      });
  });
  const save = button(actions, t("common.save"), () => {
    if (disposed) return;
    const candidate = currentCandidate();
    if (context.writeProtected || !indexReady() || candidate === null || previewIdentity !== identity(candidate)) {
      invalidate();
      return;
    }
    const current = context.getSettings?.() ?? context.settings;
    const stored = current.ignoreRules.find(({ id }) => id === candidate.id);
    if ((isNew && stored !== undefined) || (!isNew && JSON.stringify(stored) !== JSON.stringify(original))) {
      invalidate(t("settings.ignore.sourceChanged"));
      return;
    }
    const graphChanged = original.scope === "exclude-graph-contribution" ||
      candidate.scope === "exclude-graph-contribution";
    runAction(() => context.onSettingsChange(normalizeSettings({
      ...current,
      ignoreRules: isNew ? [...current.ignoreRules, candidate]
        : current.ignoreRules.map((rule) => rule.id === candidate.id ? candidate : rule),
    }), graphChanged ? "regraph" : "query-only"), context);
  });
  save.className = "mod-cta";
  button(actions, t("common.cancel"), () => {
    if (disposed) return;
    if (isNew) { cleanup(); details.remove(); return; }
    original = (context.getSettings?.() ?? context.settings).ignoreRules.find(({ id }) => id === source.id) ?? original;
    draft = original;
    enabled.checked = draft.enabled;
    scope.value = draft.scope;
    matcher.value = draft.matcher.kind;
    value.value = draft.matcher.value;
    note.value = draft.note;
    update();
    details.open = false;
  });
  if (!isNew) {
    const remove = button(actions, t("common.delete"), () => {
      if (disposed) return;
      const current = context.getSettings?.() ?? context.settings;
      const stored = current.ignoreRules.find(({ id }) => id === original.id);
      runAction(() => context.onSettingsChange(normalizeSettings({
        ...current, ignoreRules: current.ignoreRules.filter(({ id }) => id !== original.id),
      }), stored?.scope === "exclude-graph-contribution" ? "regraph" : "query-only"), context);
    });
    remove.disabled = context.writeProtected;
    remove.className = "mod-warning";
  }
  for (const control of [enabled, scope, matcher, value, note]) {
    control.disabled = context.writeProtected;
    control.addEventListener(control === value || control === note ? "input" : "change", update);
  }
  const onIndexChanged = (): void => {
    const revision = currentRevision();
    if (revision === lastRevision) return;
    lastRevision = revision;
    invalidate(t("settings.ignore.previewStale"));
  };
  const unsubscribe = context.subscribeIndexDiagnostics?.(onIndexChanged);
  const unsubscribeStatus = context.subscribeIndexStatus?.(onIndexChanged);
  function cleanup(): void {
    disposed = true;
    previewIdentity = null;
    for (const control of details.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select")) control.disabled = true;
    requests.invalidate();
    unsubscribe?.();
    unsubscribeStatus?.();
  }
  container.append(details);
  update();
  if (isNew) value.focus();
  return { cleanup };
}

function labeledSelect(
  container: HTMLElement,
  labelText: string,
  options: readonly (readonly [string, string])[],
  selected: string,
): HTMLSelectElement {
  const label = container.ownerDocument.createElement("label");
  label.className = "link-integrity-rule-field";
  label.append(textElement(label, "span", labelText));
  const control = select(container.ownerDocument, options, selected);
  label.append(control);
  container.append(label);
  return control;
}

function belongsToDomain(scope: IgnoreRuleScope, domain: "broken" | "isolated"): boolean {
  return scope === "exclude-graph-contribution" || (domain === "broken"
    ? scope === "hide-broken-result" || scope === "ignore-target" || scope === "ignore-occurrence"
    : scope === "exclude-isolated-candidate");
}

function scopeOptions(context: SettingsUiContext): readonly (readonly [string, string])[] {
  const { t } = context.translator;
  return [
    ["hide-broken-result", t("ignore.scope.hideBroken")],
    ["exclude-isolated-candidate", t("ignore.scope.excludeIsolated")],
    ["ignore-target", t("ignore.scope.ignoreTarget")],
    ["ignore-occurrence", t("ignore.scope.ignoreOccurrence")],
    ["exclude-graph-contribution", t("ignore.scope.excludeGraph")],
  ];
}

const matcherLabels = {
  "source-path": "settings.ignore.matcher.sourcePath",
  "path-prefix": "settings.ignore.matcher.pathPrefix",
  "target-path": "settings.ignore.matcher.targetPath",
  "occurrence-id": "settings.ignore.matcher.occurrenceId",
  "format-family": "settings.ignore.matcher.formatFamily",
  extension: "settings.ignore.matcher.extension",
} as const;
