import {
  PERIODIC_NOTE_KINDS,
  type ExpectedIsolationRule,
  type ExpectedNamingPattern,
  type PeriodicNoteKind,
  validateExpectedIsolationRule,
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
import {
  button,
  checkboxLabel,
  disableControls,
  labeledInput,
  labeledTextarea,
  runAction,
  select,
  summaryCheckboxTarget,
  textElement,
} from "./dom-controls";
import type {
  ExpectedRulePreviewState,
  SettingsCustomSectionId,
  SettingsUiContext,
} from "./types";

let expectedRuleDialogCounter = 0;

export function renderCustomSetting(
  settingElement: HTMLElement,
  id: SettingsCustomSectionId,
  context: SettingsUiContext,
): () => void {
  settingElement.classList.add("link-integrity-settings-custom-row");
  const body = settingElement.ownerDocument.createElement("div");
  body.className = "link-integrity-settings-custom-body";
  body.dataset.sectionId = id;
  settingElement.append(body);
  const cleanup = id === "persistence-status"
    ? renderPersistenceStatus(body, context)
    : id === "index-maintenance"
      ? renderIndexMaintenance(body, context)
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
    settingElement.classList.remove("link-integrity-settings-custom-row");
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
    const visible = state !== "saved";
    const row = container.parentElement;
    if (row !== null) row.hidden = !visible;
    status.textContent = context.translator.t(`status.save.${state}`);
    retry.hidden = state !== "pending";
    retry.disabled = state !== "pending" || context.retrySave === undefined;
  };
  container.prepend(status);
  update();
  const unsubscribe = context.subscribeSaveStatus?.(update);
  return () => {
    unsubscribe?.();
    const row = container.parentElement;
    if (row !== null) row.hidden = false;
  };
}

function renderIndexMaintenance(
  container: HTMLElement,
  context: SettingsUiContext,
): (() => void) | undefined {
  const { t } = context.translator;
  const document = container.ownerDocument;
  container.classList.add("link-integrity-index-maintenance");
  const status = document.createElement("div");
  status.className = "link-integrity-index-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const rebuild = button(container, t("index.start"), () => runAction(
    () => context.rebuildIndex?.(),
    context,
  ));
  const details = document.createElement("details");
  details.className = "link-integrity-index-details";
  const detailsSummary = document.createElement("summary");
  detailsSummary.textContent = t("index.details.title");
  const metrics = document.createElement("dl");
  metrics.className = "link-integrity-index-metrics";
  const values = {
    files: appendIndexMetric(metrics, t("index.details.files")),
    sources: appendIndexMetric(metrics, t("index.details.sources")),
    occurrences: appendIndexMetric(metrics, t("index.details.occurrences")),
    fullRebuild: appendIndexMetric(metrics, t("index.details.fullRebuild")),
    incremental: appendIndexMetric(metrics, t("index.details.incremental")),
    pending: appendIndexMetric(metrics, t("index.details.pending")),
    storage: appendIndexMetric(metrics, t("index.details.storage")),
    error: appendIndexMetric(metrics, t("index.details.error")),
  };
  details.append(detailsSummary, metrics);
  container.prepend(status);
  container.append(details);

  const update = (): void => {
    const current = context.getIndexStatus?.() ?? {
      state: "idle" as const,
      current: 0,
      total: 0,
      errorMessage: null,
    };
    const diagnostics = context.getIndexDiagnostics?.() ?? {
      fileCount: 0,
      sourceCount: 0,
      occurrenceCount: 0,
      pendingEventCount: 0,
      lastFullRebuild: null,
      lastIncrementalUpdate: null,
    };
    status.textContent = current.state === "scanning"
      ? t("status.scanning", {
        current: current.current,
        total: current.total,
      })
      : current.state === "ready"
        ? t("index.readySummary", {
          files: formatInteger(diagnostics.fileCount, context.translator.locale),
          occurrences: formatInteger(diagnostics.occurrenceCount, context.translator.locale),
        })
        : t(`status.${current.state}`);
    status.setAttribute("role", current.state === "failed" ? "alert" : "status");
    rebuild.textContent = current.state === "idle"
      ? t("index.start")
      : current.state === "scanning"
        ? t("index.rebuilding")
        : current.state === "failed" || current.state === "stale"
          ? t("index.retry")
          : t("index.rebuild");
    rebuild.disabled = context.rebuildIndex === undefined || current.state === "scanning";
    values.files.textContent = formatInteger(diagnostics.fileCount, context.translator.locale);
    values.sources.textContent = formatInteger(diagnostics.sourceCount, context.translator.locale);
    values.occurrences.textContent = formatInteger(
      diagnostics.occurrenceCount,
      context.translator.locale,
    );
    values.fullRebuild.textContent = formatCompletedOperation(
      diagnostics.lastFullRebuild,
      context,
    );
    values.incremental.textContent = diagnostics.lastIncrementalUpdate === null
      ? t("index.details.never")
      : t("index.details.incrementalValue", {
        time: formatTimestamp(
          diagnostics.lastIncrementalUpdate.completedAt,
          context.translator.locale,
        ),
        sources: formatInteger(
          diagnostics.lastIncrementalUpdate.affectedSourceCount,
          context.translator.locale,
        ),
        duration: formatDuration(
          diagnostics.lastIncrementalUpdate.durationMs,
          context.translator.locale,
        ),
      });
    values.pending.textContent = formatInteger(
      diagnostics.pendingEventCount,
      context.translator.locale,
    );
    values.storage.textContent = t("index.details.memoryOnly");
    const errorRow = values.error.parentElement;
    if (errorRow !== null) errorRow.hidden = current.errorMessage === null;
    values.error.textContent = current.errorMessage ?? "";
  };
  update();
  const unsubscribeStatus = context.subscribeIndexStatus?.(update);
  const unsubscribeDiagnostics = context.subscribeIndexDiagnostics?.(update);
  return () => {
    unsubscribeStatus?.();
    unsubscribeDiagnostics?.();
  };
}

function appendIndexMetric(container: HTMLDListElement, label: string): HTMLElement {
  const row = container.ownerDocument.createElement("div");
  const term = container.ownerDocument.createElement("dt");
  const value = container.ownerDocument.createElement("dd");
  term.textContent = label;
  row.append(term, value);
  container.append(row);
  return value;
}

function formatCompletedOperation(
  operation: { readonly completedAt: number; readonly durationMs: number } | null,
  context: SettingsUiContext,
): string {
  if (operation === null) return context.translator.t("index.details.never");
  return context.translator.t("index.details.completedValue", {
    time: formatTimestamp(operation.completedAt, context.translator.locale),
    duration: formatDuration(operation.durationMs, context.translator.locale),
  });
}

function formatInteger(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function formatTimestamp(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatDuration(value: number, locale: string): string {
  if (value < 1_000) return `${formatInteger(Math.round(value), locale)} ms`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1_000)} s`;
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

function renderExpectedRules(
  container: HTMLElement,
  context: SettingsUiContext,
): () => void {
  const { t } = context.translator;
  const settings = currentSettings(context);
  const individualHeading = textElement(
    container,
    "h4",
    t("settings.expected.individualFiles"),
  );
  container.append(individualHeading);
  const pathList = container.ownerDocument.createElement("div");
  pathList.className = "link-integrity-expected-file-list";
  if (settings.isolatedFiles.expectedFilePaths.length === 0) {
    const empty = textElement(container, "p", t("settings.expected.individualFiles.empty"));
    empty.className = "link-integrity-help-text";
    pathList.append(empty);
  }
  for (const path of settings.isolatedFiles.expectedFilePaths) {
    const exists = context.fileExists?.(path) ?? false;
    const row = container.ownerDocument.createElement("div");
    row.className = `link-integrity-expected-file-row${exists ? "" : " is-missing"}`;
    const pathText = textElement(container, "span", path);
    pathText.className = "link-integrity-expected-file-path";
    const status = textElement(
      container,
      "small",
      exists ? t("settings.expected.filePresent") : t("settings.expected.fileMissing"),
    );
    const actions = container.ownerDocument.createElement("div");
    actions.className = "link-integrity-expected-file-actions";
    const open = button(actions, t("common.open"), () => runAction(
      () => context.openFile?.(path),
      context,
    ));
    open.disabled = !exists || context.openFile === undefined;
    const remove = button(actions, t("common.remove"), () => {
      const current = currentSettings(context);
      commitIsolated(context, {
        ...current.isolatedFiles,
        expectedFilePaths: current.isolatedFiles.expectedFilePaths
          .filter((candidate) => candidate !== path),
      }, "query-only");
    });
    remove.disabled = context.writeProtected;
    actions.append(open, remove);
    row.append(pathText, status, actions);
    pathList.append(row);
  }
  container.append(pathList, textElement(container, "h4", t("settings.expected.rules")));
  const help = textElement(container, "p", t("settings.expected.description"));
  help.className = "link-integrity-help-text";
  container.append(help);

  let closeEditor: (() => void) | null = null;
  const openEditor = (rule: ExpectedIsolationRule | null): void => {
    closeEditor?.();
    closeEditor = openExpectedRuleDialog(container, rule, context);
  };
  const list = container.ownerDocument.createElement("div");
  list.className = "link-integrity-expected-rule-list";
  for (const rule of settings.isolatedFiles.expectedRules) {
    list.append(renderExpectedRuleCard(container.ownerDocument, rule, context, () => openEditor(rule)));
  }
  container.append(list);
  const add = button(container, t("settings.expected.addRule"), () => openEditor(null));
  add.classList.add("mod-cta", "link-integrity-add-rule");
  add.disabled = context.writeProtected;
  return () => closeEditor?.();
}

function renderExpectedRuleCard(
  document: Document,
  rule: ExpectedIsolationRule,
  context: SettingsUiContext,
  onEdit: () => void,
): HTMLElement {
  const { t } = context.translator;
  const card = document.createElement("article");
  card.className = "link-integrity-expected-rule-card";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = rule.enabled;
  enabled.disabled = context.writeProtected;
  enabled.setAttribute("aria-label", rule.name || t("settings.expected.ruleName"));
  enabled.addEventListener("change", () => replaceExpectedRule(context, {
    ...rule,
    enabled: enabled.checked,
  }));
  const text = document.createElement("div");
  text.className = "link-integrity-expected-rule-card-text";
  const name = document.createElement("strong");
  name.textContent = rule.name || t("settings.expected.ruleName");
  const summary = document.createElement("small");
  summary.textContent = describeExpectedRule(rule, context);
  text.append(name, summary);
  const preview = context.getExpectedRulePreview?.(rule.id);
  if (preview?.state === "ready" && preview.stats !== null) {
    const count = document.createElement("small");
    count.className = "link-integrity-expected-rule-card-count";
    count.textContent = t("settings.ignore.matchCount", { count: preview.stats.matchCount });
    text.append(count);
  }
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = t("common.edit");
  edit.disabled = context.writeProtected;
  edit.addEventListener("click", onEdit);
  card.append(enabled, text, edit);
  return card;
}

function describeExpectedRule(rule: ExpectedIsolationRule, context: SettingsUiContext): string {
  const { t } = context.translator;
  const parts: string[] = [];
  if (rule.folder !== null) {
    parts.push(rule.folder.path, t(rule.folder.mode === "exact"
      ? "settings.expected.folderExact"
      : "settings.expected.folderRecursive"));
  }
  if (rule.fileTypeFamilyIds.length > 0) {
    const labels = new Map(createFileTypeCategoryOptions(context.translator)
      .flatMap(({ formats }) => formats.map(({ id, label }) => [id, label] as const)));
    parts.push(rule.fileTypeFamilyIds.map((id) => labels.get(id) ?? id).join(", "));
  }
  if (rule.fileExtensions.length > 0) parts.push(rule.fileExtensions.map((item) => `.${item}`).join(", "));
  if (rule.namingPatterns.length > 0) {
    parts.push(`${t("settings.expected.namingPatterns")}: ${rule.namingPatterns.length.toString()}`);
  }
  return parts.length > 0 ? parts.join(" · ") : t("common.none");
}

function openExpectedRuleDialog(
  host: HTMLElement,
  sourceRule: ExpectedIsolationRule | null,
  context: SettingsUiContext,
): () => void {
  const document = host.ownerDocument;
  const ownerWindow = document.defaultView;
  const { t } = context.translator;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overlay = document.createElement("div");
  overlay.className = "link-integrity-rule-modal";
  overlay.dir = context.translator.direction;
  const panel = document.createElement("section");
  panel.className = "link-integrity-rule-modal-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  const heading = document.createElement("h3");
  expectedRuleDialogCounter += 1;
  heading.id = `link-integrity-rule-dialog-title-${expectedRuleDialogCounter.toString()}`;
  heading.textContent = sourceRule?.name || t("settings.expected.addRule");
  panel.setAttribute("aria-labelledby", heading.id);
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "link-integrity-rule-modal-close";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", t("common.cancel"));
  const header = document.createElement("header");
  header.append(heading, closeButton);
  const content = document.createElement("div");
  content.className = "link-integrity-rule-modal-content";
  panel.append(header, content);
  overlay.append(panel);
  document.body.append(overlay);

  let closed = false;
  let previewTimer: number | null = null;
  let editorCleanup: (() => void) | null = null;
  let draft = sourceRule === null ? null : cloneExpectedRule(sourceRule);
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (previewTimer !== null) ownerWindow?.clearTimeout(previewTimer);
    editorCleanup?.();
    overlay.remove();
    previousFocus?.focus();
  };
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary',
    ));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const renderTemplatePicker = (): void => {
    content.replaceChildren();
    const help = textElement(content, "p", t("settings.expected.conditions"));
    help.className = "link-integrity-help-text";
    content.append(help);
    const picker = document.createElement("div");
    picker.className = "link-integrity-rule-template-picker";
    const choose = (kind: "folder" | "naming" | "advanced", name: string): void => {
      draft = createExpectedRule(context.createId("expected-rule"), name, kind, context);
      renderEditor(kind !== "folder");
    };
    button(picker, t("settings.expected.periodicPreset"), () => {
      close();
      const preset = host.closest(".link-integrity-settings-panel")
        ?.querySelector<HTMLElement>('[data-section-id="periodic-notes-preset"]');
      preset?.scrollIntoView({ block: "center" });
      preset?.querySelector<HTMLElement>('input, button, summary')?.focus();
    });
    button(picker, t("settings.expected.folder"), () => choose(
      "folder",
      t("settings.expected.folder"),
    ));
    button(picker, t("settings.expected.namingPatterns"), () => choose(
      "naming",
      t("settings.expected.namingPatterns"),
    ));
    button(picker, t("common.advanced"), () => choose("advanced", t("common.advanced")));
    content.append(picker);
  };

  const renderEditor = (advancedOpen = true): void => {
    if (draft === null) return;
    if (previewTimer !== null) ownerWindow?.clearTimeout(previewTimer);
    editorCleanup?.();
    editorCleanup = null;
    content.replaceChildren();
    heading.textContent = sourceRule === null ? t("settings.expected.addRule") : draft.name;
    let updateDraftState = (): void => undefined;

    const name = labeledInput(content, t("settings.expected.ruleName"), draft.name);
    const folderField = document.createElement("label");
    folderField.className = "link-integrity-rule-field";
    const folderLabel = document.createElement("span");
    folderLabel.textContent = t("settings.expected.folder");
    const folderRow = document.createElement("div");
    folderRow.className = "link-integrity-rule-condition";
    const folderInput = document.createElement("input");
    folderInput.type = "text";
    folderInput.value = draft.folder?.path ?? "";
    folderInput.placeholder = t("settings.expected.folder");
    const folderMode = select(document, [
      ["exact", t("settings.expected.folderExact")],
      ["recursive", t("settings.expected.folderRecursive")],
    ], draft.folder?.mode ?? "recursive");
    folderRow.append(folderInput, folderMode);
    folderField.append(folderLabel, folderRow);
    content.append(folderField);

    const advanced = document.createElement("details");
    advanced.className = "link-integrity-rule-advanced";
    advanced.open = advancedOpen;
    const advancedSummary = document.createElement("summary");
    advancedSummary.textContent = t("common.advanced");
    advanced.append(advancedSummary);
    const categories = createFileTypeCategoryOptions(context.translator);
    editorCleanup = renderFileTypeSelection(advanced, {
      categories,
      selectedFormatIds: new Set(draft.fileTypeFamilyIds),
      defaultFormatIds: new Set(["markdown"]),
    }, {
      selectAllLabel: t("common.selectAll"),
      clearLabel: t("common.clear"),
      restoreDefaultLabel: t("common.restoreDefault"),
      selectedCountLabel: (selected, total) => t("fileType.selectedCount", { selected, total }),
      onChange: (selected) => {
        if (draft === null) return;
        draft = {
          ...draft,
          fileTypeFamilyIds: Array.from(selected).filter(isFormatFamilyId),
        };
        updateDraftState();
      },
    });
    const extensions = labeledInput(
      advanced,
      t("settings.expected.fileExtensions"),
      draft.fileExtensions.join(", "),
    );
    const patternHeading = textElement(advanced, "h4", t("settings.expected.namingPatterns"));
    advanced.append(patternHeading);
    for (const pattern of draft.namingPatterns) {
      advanced.append(renderExpectedPatternEditor(document, pattern, context, (nextPattern) => {
        if (draft === null) return;
        draft = {
          ...draft,
          namingPatterns: draft.namingPatterns.map((candidate) =>
            candidate.id === nextPattern.id ? nextPattern : candidate),
        };
        updateDraftState();
      }, () => {
        if (draft === null) return;
        draft = {
          ...draft,
          namingPatterns: draft.namingPatterns.filter(({ id }) => id !== pattern.id),
        };
        renderEditor(true);
      }));
    }
    button(advanced, t("settings.expected.addPattern"), () => {
      if (draft === null) return;
      draft = {
        ...draft,
        namingPatterns: [...draft.namingPatterns, createExpectedPattern(context)],
      };
      renderEditor(true);
    });
    content.append(advanced);

    const validation = document.createElement("div");
    validation.className = "link-integrity-rule-validation";
    validation.setAttribute("role", "alert");
    const preview = document.createElement("div");
    preview.className = "link-integrity-settings-rule-preview";
    preview.setAttribute("role", "status");
    preview.setAttribute("aria-live", "polite");
    content.append(validation, preview);
    const actions = document.createElement("footer");
    actions.className = "link-integrity-rule-modal-actions";
    if (sourceRule !== null) {
      const remove = button(actions, t("common.delete"), () => {
        const settings = currentSettings(context);
        commitIsolated(context, {
          ...settings.isolatedFiles,
          expectedRules: settings.isolatedFiles.expectedRules
            .filter(({ id }) => id !== sourceRule.id),
        }, "query-only");
        close();
      });
      remove.className = "mod-warning";
    }
    button(actions, t("common.cancel"), close);
    const save = button(actions, t("common.save"), () => {
      if (draft === null || validateExpectedIsolationRule(draft).length > 0) return;
      const settings = currentSettings(context);
      const normalizedDraft = { ...draft, name: draft.name.trim() };
      const exists = settings.isolatedFiles.expectedRules.some(({ id }) => id === normalizedDraft.id);
      commitIsolated(context, {
        ...settings.isolatedFiles,
        expectedRules: exists
          ? settings.isolatedFiles.expectedRules.map((candidate) =>
            candidate.id === normalizedDraft.id ? normalizedDraft : candidate)
          : [...settings.isolatedFiles.expectedRules, normalizedDraft],
      }, "query-only");
      close();
    });
    save.className = "mod-cta";
    content.append(actions);

    const schedulePreview = (): void => {
      if (previewTimer !== null) ownerWindow?.clearTimeout(previewTimer);
      const errors = draft === null ? [] : validateExpectedIsolationRule(draft);
      validation.textContent = errors.join(" ");
      validation.hidden = errors.length === 0;
      save.disabled = context.writeProtected || errors.length > 0;
      if (errors.length > 0 || draft === null || context.requestExpectedRulePreview === undefined) {
        preview.textContent = "";
        return;
      }
      const candidate = cloneExpectedRule(draft);
      if (ownerWindow === null) return;
      previewTimer = ownerWindow.setTimeout(() => runAction(
        () => context.requestExpectedRulePreview?.(candidate, (state) => {
          if (closed || !preview.isConnected) return;
          renderExpectedPreview(preview, state, context);
        }),
        context,
      ), 250);
    };
    const updateFolder = (): void => {
      if (draft === null) return;
      draft = {
        ...draft,
        folder: folderInput.value.trim().length === 0
          ? null
          : {
            path: folderInput.value,
            mode: folderMode.value === "exact" ? "exact" : "recursive",
          },
      };
      updateDraftState();
    };
    updateDraftState = (): void => {
      heading.textContent = sourceRule === null ? t("settings.expected.addRule") : draft?.name ?? "";
      schedulePreview();
    };
    name.input.addEventListener("input", () => {
      if (draft === null) return;
      draft = { ...draft, name: name.input.value };
      updateDraftState();
    });
    folderInput.addEventListener("input", updateFolder);
    folderMode.addEventListener("change", updateFolder);
    extensions.input.addEventListener("input", () => {
      if (draft === null) return;
      draft = { ...draft, fileExtensions: splitExtensions(extensions.input.value) };
      updateDraftState();
    });
    disableControls(content, context.writeProtected);
    schedulePreview();
    name.input.focus();
  };

  if (draft === null) renderTemplatePicker();
  else renderEditor(true);
  queueMicrotask(() => {
    content.querySelector<HTMLElement>("button, input, select, textarea")?.focus();
  });
  return close;
}

function renderExpectedPatternEditor(
  document: Document,
  pattern: ExpectedNamingPattern,
  context: SettingsUiContext,
  onChange: (pattern: ExpectedNamingPattern) => void,
  onRemove: () => void,
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
  const update = (): void => {
    const nextKind = kind.value === "date-format" || kind.value === "regex" ? kind.value : "glob";
    flags.hidden = nextKind !== "regex";
    onChange({
      ...pattern,
      kind: nextKind,
      target: target.value === "path" ? "path" : "basename",
      pattern: input.value,
      flags: nextKind === "regex" ? flags.value : nextKind === "glob" ? "iu" : "u",
    });
  };
  kind.addEventListener("change", update);
  target.addEventListener("change", update);
  input.addEventListener("input", update);
  flags.addEventListener("input", update);
  const remove = button(row, t("common.delete"), onRemove);
  remove.className = "mod-warning";
  row.append(kind, target, input, flags, remove);
  return row;
}

function renderExpectedPreview(
  element: HTMLElement,
  preview: ExpectedRulePreviewState,
  context: SettingsUiContext,
): void {
  const { t } = context.translator;
  element.textContent = preview.state === "loading"
    ? t("settings.expected.previewLoading")
    : preview.state === "failed"
      ? t("settings.expected.previewFailed")
      : preview.stats === null
        ? ""
        : preview.stats.errors.length > 0
          ? preview.stats.errors.join(" ")
          : preview.stats.matchCount === 0
            ? t("settings.expected.previewEmpty")
            : t("settings.expected.preview", {
              count: preview.stats.matchCount,
              samples: preview.stats.samples.join(", "),
            });
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
  const entryLabel = t(labels[kind]);
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = entry.enabled;
  enabled.disabled = context.writeProtected;
  enabled.setAttribute("aria-label", entryLabel);
  enabled.addEventListener("click", (event) => event.stopPropagation());
  summary.append(
    summaryCheckboxTarget(document, enabled, entryLabel),
    document.createTextNode(entryLabel),
  );
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
  const enabledLabel = rule.note || rule.matcher.value || t("settings.ignore.title");
  enabled.setAttribute("aria-label", enabledLabel);
  enabled.addEventListener("click", (event) => event.stopPropagation());
  enabled.addEventListener("change", () => replaceIgnoreRule(context, {
    ...rule,
    enabled: enabled.checked,
  }));
  summary.append(
    summaryCheckboxTarget(document, enabled, enabledLabel),
    document.createTextNode(rule.note || rule.matcher.value),
  );
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
    }, rule.scope === "exclude-graph-contribution" ? "regraph" : "query-only");
  });
  remove.className = "mod-warning";
  disableControls(details, context.writeProtected);
  return details;
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
  }, graphChanged ? "regraph" : "query-only");
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

function createExpectedRule(
  id: string,
  name: string,
  kind: "folder" | "naming" | "advanced",
  context: SettingsUiContext,
): ExpectedIsolationRule {
  return {
    id,
    name,
    enabled: true,
    fileTypeFamilyIds: [],
    fileTypeCategoryIds: [],
    fileExtensions: [],
    folder: null,
    namingPatterns: kind === "naming" ? [createExpectedPattern(context)] : [],
  };
}

function createExpectedPattern(context: SettingsUiContext): ExpectedNamingPattern {
  return {
    id: context.createId("expected-pattern"),
    kind: "glob",
    pattern: "",
    flags: "iu",
    target: "basename",
  };
}

function cloneExpectedRule(rule: ExpectedIsolationRule): ExpectedIsolationRule {
  return {
    ...rule,
    fileTypeFamilyIds: [...rule.fileTypeFamilyIds],
    fileTypeCategoryIds: [...rule.fileTypeCategoryIds],
    fileExtensions: [...rule.fileExtensions],
    folder: rule.folder === null ? null : { ...rule.folder },
    namingPatterns: rule.namingPatterns.map((pattern) => ({ ...pattern })),
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
