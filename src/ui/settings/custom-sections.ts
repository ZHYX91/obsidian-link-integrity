import {
  PERIODIC_NOTE_KINDS,
  type ExpectedIsolationRule,
  type ExpectedNamingPattern,
  type PeriodicNoteKind,
} from "../../core/expected-isolation-rules";
import {
  DEFAULT_ISOLATED_CANDIDATE_FAMILIES,
  type FormatFamilyId,
} from "../../core/file-types";
import {
  IGNORE_MATCHER_KINDS,
  type IgnoreMatcherKind,
  type IgnoreRule,
  type IgnoreRuleScope,
} from "../../shared/ignore-rules";
import {
  normalizeSettings,
  type IsolatedFileSettings,
  type LinkIntegritySettings,
  type SettingsChangeImpact,
} from "../../shared/settings";
import {
  renderFileTypeSelection,
  type FileTypeSelectionModel,
} from "../file-type-selection";
import { createFileTypeCategoryOptions } from "../file-type-options";
import type { SettingsCustomSectionId, SettingsUiContext } from "./types";

export function renderCustomSetting(
  settingElement: HTMLElement,
  id: SettingsCustomSectionId,
  context: SettingsUiContext,
): () => void {
  const body = settingElement.ownerDocument.createElement("div");
  body.className = "link-integrity-settings-custom-body";
  settingElement.append(body);
  const cleanup = id === "persistence-status"
    ? renderPersistenceStatus(body, context)
    : id === "isolated-candidate-types"
    ? renderCandidateTypes(body, context)
    : id === "expected-isolation-rules"
      ? renderExpectedRules(body, context)
      : id === "periodic-notes-preset"
        ? renderPeriodicPreset(body, context)
        : renderIgnoreRules(body, context, id === "broken-ignore-rules" ? "broken" : "isolated");
  return () => {
    cleanup?.();
    body.remove();
  };
}

function renderPersistenceStatus(
  container: HTMLElement,
  context: SettingsUiContext,
): (() => void) | undefined {
  const status = container.ownerDocument.createElement("div");
  status.className = "link-integrity-persistence-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const retry = button(container, context.translator.t("common.retry"), () => runAction(
    () => context.retrySave?.(),
    context,
  ));
  const update = (snapshot = context.getSaveStatus?.()): void => {
    const state = snapshot?.state ?? "saved";
    status.textContent = context.translator.t(`status.save.${state}`);
    retry.hidden = state !== "pending";
    retry.disabled = state !== "pending" || context.retrySave === undefined;
  };
  container.prepend(status);
  update();
  return context.subscribeSaveStatus?.(update);
}

function renderCandidateTypes(
  container: HTMLElement,
  context: SettingsUiContext,
): (() => void) | undefined {
  const settings = currentSettings(context);
  const { t } = context.translator;
  const categories = createFileTypeCategoryOptions(context.translator);
  const model: FileTypeSelectionModel = {
    categories,
    selectedFormatIds: new Set(settings.isolatedFiles.candidateFormatFamilyIds),
    defaultFormatIds: new Set(DEFAULT_ISOLATED_CANDIDATE_FAMILIES),
  };
  const cleanup = renderFileTypeSelection(container, model, {
    selectAllLabel: t("common.selectAll"),
    clearLabel: t("common.clear"),
    restoreDefaultLabel: t("common.restoreDefault"),
    selectedCountLabel: (selected, total) => t("fileType.selectedCount", { selected, total }),
    onChange: (selected) => {
      const next = currentSettings(context);
      commitIsolated(context, {
        ...next.isolatedFiles,
        candidateFormatFamilyIds: Array.from(selected)
          .filter((id): id is FormatFamilyId => isFormatFamilyId(id)),
      }, "query-only");
    },
  });

  const custom = labeledTextarea(
    container,
    t("fileType.customExtensions"),
    t("fileType.customExtensions.description"),
    settings.isolatedFiles.customExtensions.join("\n"),
  );
  custom.textarea.disabled = context.writeProtected;
  custom.textarea.addEventListener("change", () => {
    const next = currentSettings(context);
    commitIsolated(context, {
      ...next.isolatedFiles,
      customExtensions: lines(custom.textarea.value),
    }, "query-only");
  });
  disableControls(container, context.writeProtected);
  return cleanup;
}

function renderExpectedRules(container: HTMLElement, context: SettingsUiContext): void {
  const { t } = context.translator;
  const settings = currentSettings(context);
  const help = textElement(container, "p", t("settings.expected.conditions"));
  help.className = "link-integrity-help-text";
  container.append(help);

  for (const rule of settings.isolatedFiles.expectedRules) {
    container.append(renderExpectedRule(container.ownerDocument, rule, context));
  }
  const add = button(container, t("settings.expected.addRule"), () => {
    const next = currentSettings(context);
    const rule = createExpectedRule(context.createId("expected-rule"));
    commitIsolated(context, {
      ...next.isolatedFiles,
      expectedRules: [...next.isolatedFiles.expectedRules, rule],
    }, "query-only");
  });
  add.disabled = context.writeProtected;
}

function renderExpectedRule(
  document: Document,
  rule: ExpectedIsolationRule,
  context: SettingsUiContext,
): HTMLElement {
  const { t } = context.translator;
  const details = document.createElement("details");
  details.className = "link-integrity-settings-rule";
  const summary = document.createElement("summary");
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = rule.enabled;
  enabled.disabled = context.writeProtected;
  enabled.addEventListener("click", (event) => event.stopPropagation());
  enabled.addEventListener("change", () => replaceExpectedRule(context, {
    ...rule,
    enabled: enabled.checked,
  }));
  summary.append(enabled, document.createTextNode(rule.name));
  details.append(summary);

  const name = labeledInput(details, t("settings.expected.ruleName"), rule.name);
  name.input.disabled = context.writeProtected;
  name.input.addEventListener("change", () => replaceExpectedRule(context, {
    ...rule,
    name: name.input.value,
  }));

  const categories = createFileTypeCategoryOptions(context.translator);
  renderFileTypeSelection(details, {
    categories,
    selectedFormatIds: new Set(rule.fileTypeFamilyIds),
    defaultFormatIds: new Set(["markdown"]),
  }, {
    selectAllLabel: t("common.selectAll"),
    clearLabel: t("common.clear"),
    restoreDefaultLabel: t("common.restoreDefault"),
    selectedCountLabel: (selected, total) => t("fileType.selectedCount", { selected, total }),
    onChange: (selected) => replaceExpectedRule(context, {
      ...rule,
      fileTypeFamilyIds: Array.from(selected).filter(isFormatFamilyId),
    }),
  });

  const extensions = labeledInput(
    details,
    t("settings.expected.fileExtensions"),
    rule.fileExtensions.join(", "),
  );
  extensions.input.disabled = context.writeProtected;
  extensions.input.addEventListener("change", () => replaceExpectedRule(context, {
    ...rule,
    fileExtensions: splitExtensions(extensions.input.value),
  }));

  const folderRow = document.createElement("div");
  folderRow.className = "link-integrity-rule-condition";
  const folderInput = document.createElement("input");
  folderInput.type = "text";
  folderInput.value = rule.folder?.path ?? "";
  folderInput.placeholder = t("settings.expected.folder");
  folderInput.disabled = context.writeProtected;
  const folderMode = select(document, [
    ["exact", t("settings.expected.folderExact")],
    ["recursive", t("settings.expected.folderRecursive")],
  ], rule.folder?.mode ?? "recursive");
  folderMode.disabled = context.writeProtected;
  const updateFolder = (): void => replaceExpectedRule(context, {
    ...rule,
    folder: folderInput.value.trim().length === 0
      ? null
      : { path: folderInput.value, mode: folderMode.value === "exact" ? "exact" : "recursive" },
  });
  folderInput.addEventListener("change", updateFolder);
  folderMode.addEventListener("change", updateFolder);
  folderRow.append(folderInput, folderMode);
  details.append(folderRow);

  const patternHeading = textElement(details, "h4", t("settings.expected.namingPatterns"));
  details.append(patternHeading);
  for (const pattern of rule.namingPatterns) {
    details.append(renderExpectedPattern(document, rule, pattern, context));
  }
  const addPattern = button(details, t("settings.expected.addPattern"), () => {
    replaceExpectedRule(context, {
      ...rule,
      namingPatterns: [...rule.namingPatterns, {
        id: context.createId("expected-pattern"),
        kind: "glob",
        pattern: "*",
        flags: "iu",
        target: "basename",
      }],
    });
  });
  addPattern.disabled = context.writeProtected;

  const preview = context.getExpectedRulePreview?.(rule.id);
  const previewElement = document.createElement("div");
  previewElement.className = "link-integrity-settings-rule-preview";
  if (preview?.state === "loading") {
    previewElement.textContent = t("settings.expected.previewLoading");
  } else if (preview?.state === "failed") {
    previewElement.textContent = t("settings.expected.previewFailed");
  } else if (preview?.stats !== null && preview?.stats !== undefined) {
    previewElement.textContent = preview.stats.errors.length > 0
      ? preview.stats.errors.join(" ")
      : preview.stats.matchCount === 0
      ? t("settings.expected.previewEmpty")
      : t("settings.expected.preview", {
        count: preview.stats.matchCount,
        samples: preview.stats.samples.join(", "),
      });
  }
  details.append(previewElement);
  if (context.requestExpectedRulePreview !== undefined) {
    const refresh = button(details, t("settings.expected.refreshPreview"), () => runAction(
      () => context.requestExpectedRulePreview?.(rule),
      context,
    ));
    refresh.disabled = context.writeProtected;
  }
  const remove = button(details, t("common.delete"), () => {
    const settings = currentSettings(context);
    commitIsolated(context, {
      ...settings.isolatedFiles,
      expectedRules: settings.isolatedFiles.expectedRules
        .filter(({ id }) => id !== rule.id),
    }, "query-only");
  });
  remove.className = "mod-warning";
  remove.disabled = context.writeProtected;
  return details;
}

function renderExpectedPattern(
  document: Document,
  rule: ExpectedIsolationRule,
  pattern: ExpectedNamingPattern,
  context: SettingsUiContext,
): HTMLElement {
  const { t } = context.translator;
  const row = document.createElement("div");
  row.className = "link-integrity-rule-pattern";
  const kind = select(document, [
    ["date-format", t("settings.expected.dateFormat")],
    ["glob", t("settings.expected.glob")],
    ["regex", t("settings.expected.regex")],
  ], pattern.kind);
  const target = select(document, [
    ["basename", t("settings.expected.patternTarget.basename")],
    ["path", t("settings.expected.patternTarget.path")],
  ], pattern.target);
  const input = document.createElement("input");
  input.type = "text";
  input.value = pattern.pattern;
  input.setAttribute("aria-label", t("settings.expected.namingPatterns"));
  const flags = document.createElement("input");
  flags.type = "text";
  flags.value = pattern.flags;
  flags.className = "link-integrity-regex-flags";
  flags.hidden = pattern.kind !== "regex";
  const update = (): void => replaceExpectedPattern(context, rule, {
    ...pattern,
    kind: kind.value === "date-format" || kind.value === "regex" ? kind.value : "glob",
    target: target.value === "path" ? "path" : "basename",
    pattern: input.value,
    flags: kind.value === "regex" ? flags.value : kind.value === "glob" ? "iu" : "u",
  });
  kind.addEventListener("change", update);
  target.addEventListener("change", update);
  input.addEventListener("change", update);
  flags.addEventListener("change", update);
  const remove = button(row, t("common.delete"), () => replaceExpectedRule(context, {
    ...rule,
    namingPatterns: rule.namingPatterns.filter(({ id }) => id !== pattern.id),
  }));
  for (const control of [kind, target, input, flags, remove]) control.disabled = context.writeProtected;
  row.append(kind, target, input, flags, remove);
  return row;
}

function renderPeriodicPreset(container: HTMLElement, context: SettingsUiContext): void {
  const settings = currentSettings(context);
  const preset = settings.isolatedFiles.periodicNotesPreset;
  const master = checkboxLabel(
    container,
    context.translator.t("settings.expected.periodicPreset"),
    preset.enabled,
  );
  master.checkbox.disabled = context.writeProtected;
  master.checkbox.addEventListener("change", () => updatePeriodicPreset(context, {
    ...preset,
    enabled: master.checkbox.checked,
  }));
  for (const kind of PERIODIC_NOTE_KINDS) {
    container.append(renderPeriodicEntry(container.ownerDocument, kind, context));
  }
}

function renderPeriodicEntry(
  document: Document,
  kind: PeriodicNoteKind,
  context: SettingsUiContext,
): HTMLElement {
  const { t } = context.translator;
  const preset = currentSettings(context).isolatedFiles.periodicNotesPreset;
  const entry = preset.entries[kind];
  const labels = {
    daily: "settings.expected.period.daily",
    weekly: "settings.expected.period.weekly",
    monthly: "settings.expected.period.monthly",
    quarterly: "settings.expected.period.quarterly",
    yearly: "settings.expected.period.yearly",
  } as const;
  const details = document.createElement("details");
  details.className = "link-integrity-periodic-entry";
  const summary = document.createElement("summary");
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = entry.enabled;
  enabled.disabled = context.writeProtected;
  enabled.addEventListener("click", (event) => event.stopPropagation());
  summary.append(enabled, document.createTextNode(t(labels[kind])));
  details.append(summary);
  const folder = labeledInput(details, t("settings.expected.periodFolder"), entry.folder);
  const formats = labeledTextarea(
    details,
    t("settings.expected.periodFormats"),
    "",
    entry.dateFormats.join("\n"),
  );
  const recursive = checkboxLabel(
    details,
    t("settings.expected.periodRecursive"),
    entry.includeSubfolders,
  );
  const update = (): void => {
    const current = currentSettings(context).isolatedFiles.periodicNotesPreset;
    updatePeriodicPreset(context, {
      ...current,
      entries: {
        ...current.entries,
        [kind]: {
          enabled: enabled.checked,
          folder: folder.input.value,
          includeSubfolders: recursive.checkbox.checked,
          dateFormats: lines(formats.textarea.value),
        },
      },
    });
  };
  enabled.addEventListener("change", update);
  folder.input.addEventListener("change", update);
  formats.textarea.addEventListener("change", update);
  recursive.checkbox.addEventListener("change", update);
  for (const control of [folder.input, formats.textarea, recursive.checkbox]) {
    control.disabled = context.writeProtected;
  }
  return details;
}

function renderIgnoreRules(
  container: HTMLElement,
  context: SettingsUiContext,
  domain: "broken" | "isolated",
): void {
  const settings = currentSettings(context);
  const rules = settings.ignoreRules.filter(({ scope }) => scopeBelongsToDomain(scope, domain));
  if (rules.length === 0) {
    container.append(textElement(container, "p", context.translator.t("settings.ignore.empty")));
  }
  for (const rule of rules) container.append(renderIgnoreRule(container.ownerDocument, rule, context));
  const add = button(container, context.translator.t("settings.ignore.addRule"), () => {
    const current = currentSettings(context);
    const rule: IgnoreRule = {
      id: context.createId("ignore-rule"),
      enabled: true,
      scope: domain === "broken" ? "hide-broken-result" : "exclude-isolated-candidate",
      matcher: { kind: "path-prefix", value: "_archive" },
      createdAt: Date.now(),
      note: "",
    };
    commitSettings(context, { ...current, ignoreRules: [...current.ignoreRules, rule] }, "query-only");
  });
  add.disabled = context.writeProtected;
}

function renderIgnoreRule(
  document: Document,
  rule: IgnoreRule,
  context: SettingsUiContext,
): HTMLElement {
  const { t } = context.translator;
  const details = document.createElement("details");
  details.className = `link-integrity-settings-rule${
    rule.scope === "exclude-graph-contribution" ? " is-graph-risk" : ""}`;
  const summary = document.createElement("summary");
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = rule.enabled;
  enabled.disabled = context.writeProtected;
  enabled.addEventListener("click", (event) => event.stopPropagation());
  enabled.addEventListener("change", () => replaceIgnoreRule(context, {
    ...rule,
    enabled: enabled.checked,
  }));
  summary.append(enabled, document.createTextNode(rule.note || rule.matcher.value));
  details.append(summary);

  const scope = select(document, scopeOptions(t), rule.scope);
  const matcherKind = select(document, matcherOptions(t), rule.matcher.kind);
  const matcherValue = document.createElement("input");
  matcherValue.type = "text";
  matcherValue.value = rule.matcher.value;
  const note = labeledInput(details, t("settings.ignore.ruleNote"), rule.note);
  const update = (): void => replaceIgnoreRule(context, {
    ...rule,
    scope: scope.value as IgnoreRuleScope,
    matcher: {
      kind: matcherKind.value as IgnoreMatcherKind,
      value: matcherValue.value,
    },
    note: note.input.value,
  });
  scope.addEventListener("change", update);
  matcherKind.addEventListener("change", update);
  matcherValue.addEventListener("change", update);
  note.input.addEventListener("change", update);
  details.append(scope, matcherKind, matcherValue);
  if (rule.scope === "exclude-graph-contribution") {
    const warning = textElement(details, "p", t("settings.ignore.graphWarning"));
    warning.className = "link-integrity-warning";
    details.append(warning);
  }
  const preview = context.getIgnoreRulePreview?.(rule.id);
  if (preview !== null && preview !== undefined) {
    const previewElement = textElement(details, "p", t("settings.ignore.matchCount", {
      count: preview.matchCount,
    }));
    previewElement.className = "link-integrity-settings-rule-preview";
    if (preview.samples.length > 0) previewElement.append(` · ${preview.samples.join(", ")}`);
    details.append(previewElement);
  }
  if (context.requestIgnoreRulePreview !== undefined) {
    button(details, t("common.preview"), () => runAction(
      () => context.requestIgnoreRulePreview?.(rule),
      context,
    ));
  }
  const remove = button(details, t("common.delete"), () => {
    const current = currentSettings(context);
    commitSettings(context, {
      ...current,
      ignoreRules: current.ignoreRules.filter(({ id }) => id !== rule.id),
    }, rule.scope === "exclude-graph-contribution" ? "full-rebuild" : "query-only");
  });
  remove.className = "mod-warning";
  disableControls(details, context.writeProtected);
  return details;
}

function replaceExpectedPattern(
  context: SettingsUiContext,
  rule: ExpectedIsolationRule,
  pattern: ExpectedNamingPattern,
): void {
  replaceExpectedRule(context, {
    ...rule,
    namingPatterns: rule.namingPatterns.map((candidate) =>
      candidate.id === pattern.id ? pattern : candidate),
  });
}

function replaceExpectedRule(context: SettingsUiContext, rule: ExpectedIsolationRule): void {
  const settings = currentSettings(context);
  commitIsolated(context, {
    ...settings.isolatedFiles,
    expectedRules: settings.isolatedFiles.expectedRules.map((candidate) =>
      candidate.id === rule.id ? rule : candidate),
  }, "query-only");
}

function replaceIgnoreRule(context: SettingsUiContext, rule: IgnoreRule): void {
  const settings = currentSettings(context);
  const original = settings.ignoreRules.find(({ id }) => id === rule.id);
  const graphChanged = original?.scope === "exclude-graph-contribution" ||
    rule.scope === "exclude-graph-contribution";
  commitSettings(context, {
    ...settings,
    ignoreRules: settings.ignoreRules.map((candidate) => candidate.id === rule.id ? rule : candidate),
  }, graphChanged ? "full-rebuild" : "query-only");
}

function updatePeriodicPreset(
  context: SettingsUiContext,
  periodicNotesPreset: IsolatedFileSettings["periodicNotesPreset"],
): void {
  const settings = currentSettings(context);
  commitIsolated(context, { ...settings.isolatedFiles, periodicNotesPreset }, "query-only");
}

function commitIsolated(
  context: SettingsUiContext,
  isolatedFiles: IsolatedFileSettings,
  impact: SettingsChangeImpact,
): void {
  const settings = currentSettings(context);
  commitSettings(context, { ...settings, isolatedFiles }, impact);
}

function commitSettings(
  context: SettingsUiContext,
  settings: LinkIntegritySettings,
  impact: SettingsChangeImpact,
): void {
  if (context.writeProtected) return;
  try {
    const operation = context.onSettingsChange(normalizeSettings(settings), impact);
    if (operation instanceof Promise) void operation.catch((error: unknown) => context.onError?.(error));
  } catch (error) {
    context.onError?.(error);
  }
}

function currentSettings(context: SettingsUiContext): LinkIntegritySettings {
  return context.getSettings?.() ?? context.settings;
}

function createExpectedRule(id: string): ExpectedIsolationRule {
  return {
    id,
    name: id,
    enabled: true,
    fileTypeFamilyIds: ["markdown"],
    fileTypeCategoryIds: [],
    fileExtensions: [],
    folder: null,
    namingPatterns: [],
  };
}

function isFormatFamilyId(id: string): id is FormatFamilyId {
  return DEFAULT_ISOLATED_CANDIDATE_FAMILIES.includes(id as FormatFamilyId);
}

function splitExtensions(value: string): string[] {
  return value.split(/[\s,;]+/u).map((item) => item.trim()).filter(Boolean);
}

function lines(value: string): string[] {
  return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
}

function scopeBelongsToDomain(scope: IgnoreRuleScope, domain: "broken" | "isolated"): boolean {
  if (scope === "exclude-graph-contribution") return true;
  return domain === "broken"
    ? scope === "hide-broken-result" || scope === "ignore-target" || scope === "ignore-occurrence"
    : scope === "exclude-isolated-candidate";
}

function scopeOptions(
  t: SettingsUiContext["translator"]["t"],
): readonly (readonly [string, string])[] {
  return [
    ["hide-broken-result", t("ignore.scope.hideBroken")],
    ["exclude-isolated-candidate", t("ignore.scope.excludeIsolated")],
    ["ignore-target", t("ignore.scope.ignoreTarget")],
    ["ignore-occurrence", t("ignore.scope.ignoreOccurrence")],
    ["exclude-graph-contribution", t("ignore.scope.excludeGraph")],
  ];
}

function matcherOptions(
  t: SettingsUiContext["translator"]["t"],
): readonly (readonly [string, string])[] {
  const labels = {
    "source-path": "settings.ignore.matcher.sourcePath",
    "path-prefix": "settings.ignore.matcher.pathPrefix",
    "target-path": "settings.ignore.matcher.targetPath",
    "occurrence-id": "settings.ignore.matcher.occurrenceId",
    "format-family": "settings.ignore.matcher.formatFamily",
    extension: "settings.ignore.matcher.extension",
  } as const;
  return IGNORE_MATCHER_KINDS.map((kind) => [kind, t(labels[kind])]);
}

function labeledInput(
  container: HTMLElement,
  labelText: string,
  value: string,
): { readonly label: HTMLLabelElement; readonly input: HTMLInputElement } {
  const label = container.ownerDocument.createElement("label");
  label.className = "link-integrity-rule-field";
  const text = container.ownerDocument.createElement("span");
  text.textContent = labelText;
  const input = container.ownerDocument.createElement("input");
  input.type = "text";
  input.value = value;
  label.append(text, input);
  container.append(label);
  return { label, input };
}

function labeledTextarea(
  container: HTMLElement,
  labelText: string,
  description: string,
  value: string,
): { readonly label: HTMLLabelElement; readonly textarea: HTMLTextAreaElement } {
  const label = container.ownerDocument.createElement("label");
  label.className = "link-integrity-rule-field";
  const text = container.ownerDocument.createElement("span");
  text.textContent = labelText;
  const help = container.ownerDocument.createElement("small");
  help.textContent = description;
  const textarea = container.ownerDocument.createElement("textarea");
  textarea.value = value;
  textarea.rows = 3;
  label.append(text, help, textarea);
  container.append(label);
  return { label, textarea };
}

function checkboxLabel(
  container: HTMLElement,
  labelText: string,
  checked: boolean,
): { readonly label: HTMLLabelElement; readonly checkbox: HTMLInputElement } {
  const label = container.ownerDocument.createElement("label");
  label.className = "link-integrity-advanced-toggle";
  const checkbox = container.ownerDocument.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  label.append(checkbox, container.ownerDocument.createTextNode(labelText));
  container.append(label);
  return { label, checkbox };
}

function select(
  document: Document,
  options: readonly (readonly [string, string])[],
  selected: string,
): HTMLSelectElement {
  const element = document.createElement("select");
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    element.append(option);
  }
  return element;
}

function button(container: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const element = container.ownerDocument.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  container.append(element);
  return element;
}

function textElement(
  container: HTMLElement,
  tag: "h4" | "p",
  text: string,
): HTMLElement {
  const element = container.ownerDocument.createElement(tag);
  element.textContent = text;
  return element;
}

function disableControls(container: HTMLElement, disabled: boolean): void {
  if (!disabled) return;
  for (const control of container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
    "input, select, textarea, button",
  )) control.disabled = true;
}

function runAction(action: () => void | Promise<void> | undefined, context: SettingsUiContext): void {
  try {
    const result = action();
    if (result instanceof Promise) void result.catch((error: unknown) => context.onError?.(error));
  } catch (error) {
    context.onError?.(error);
  }
}
