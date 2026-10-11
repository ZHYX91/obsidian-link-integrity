import type { PotentialMentionMatch } from "../../core/potential-mention-model";
import type { PotentialMentionSource } from "../../core/potential-mention-model";
import type { Translator } from "../../shared/i18n";

export interface MentionPickerActions {
  readonly navigate: (source: PotentialMentionSource, match: PotentialMentionMatch) => Promise<void>;
  readonly openTarget: (path: string) => Promise<void>;
  readonly create: (source: PotentialMentionSource, match: PotentialMentionMatch, targetPath: string) => Promise<void>;
  readonly canCreate: (source: PotentialMentionSource) => boolean;
  readonly close: () => void;
}

export interface MentionPicker {
  readonly update: (sources: readonly PotentialMentionSource[], status: string, complete?: boolean) => void;
  readonly close: () => void;
}

export function openMentionPicker(document: Document, translator: Translator, actions: MentionPickerActions): MentionPicker {
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "link-integrity-mention-picker";
  dialog.setAttribute("aria-label", translator.t("mentions.title"));
  document.body.append(dialog);
  let sources: readonly PotentialMentionSource[] = [];
  let status = "";
  let complete = false;
  let page = 0;
  let targetPage = 0;
  let selected: { source: PotentialMentionSource; match: PotentialMentionMatch } | null = null;
  let closed = false;
  let renderGeneration = 0;
  const close = (): void => {
    if (closed) return;
    closed = true;
    actions.close();
    dialog.remove();
    if (previousFocus instanceof document.defaultView!.HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
  const rangeKey = (source: PotentialMentionSource, match: PotentialMentionMatch): string =>
    JSON.stringify([source.sourcePath, source.documentRevision, match.from, match.to]);
  const button = (key: string, label: string, action: () => void | Promise<void>, disabled = false): HTMLButtonElement => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.disabled = disabled;
    element.dataset.mentionAction = key;
    element.addEventListener("click", () => {
      Promise.resolve().then(() => { if (!closed && !element.disabled && dialog.contains(element)) return action(); })
        .catch(() => { status = translator.t("mentions.changed"); render(); });
    });
    return element;
  };
  const render = (): void => {
    if (closed) return;
    const generation = ++renderGeneration;
    const focused = dialog.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusKey = focused?.dataset.mentionAction;
    dialog.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = translator.t("mentions.title");
    const explanation = document.createElement("p");
    explanation.textContent = translator.t("mentions.explanation");
    const state = document.createElement("p");
    state.setAttribute("role", "status");
    state.textContent = status;
    const cancel = button("cancel", translator.t("common.cancel"), close);
    const restoreFocus = () => {
      if (focusKey !== undefined) ([...dialog.querySelectorAll<HTMLButtonElement>("button")]
        .find((element) => !element.disabled && element.dataset.mentionAction === focusKey) ?? cancel).focus();
    };
    dialog.append(heading, explanation, state, cancel);
    const content = document.createElement("div");
    content.className = "link-integrity-mention-picker-results";
    dialog.append(content);
    if (selected === null) {
      const total = sources.reduce((sum, source) => sum + (source.matchCount ?? source.matches.length), 0);
      page = Math.min(page, Math.max(0, Math.ceil(total / 50) - 1));
      const requests: Array<{ source: PotentialMentionSource; offset: number; count: number }> = [];
      let skip = page * 50;
      let remaining = 50;
      for (const source of sources) {
        const count = source.matchCount ?? source.matches.length;
        if (skip >= count) { skip -= count; continue; }
        const take = Math.min(remaining, count - skip);
        requests.push({ source, offset: skip, count: take });
        remaining -= take;
        skip = 0;
        if (remaining === 0) break;
      }
      const appendRows = (rows: readonly { source: PotentialMentionSource; match: PotentialMentionMatch }[]) => {
        if (closed || generation !== renderGeneration) return;
        content.setAttribute("aria-busy", "false");
        for (const row of rows) content.append(button(`range:${rangeKey(row.source, row.match)}`, `${row.source.sourcePath} · ${translator.t("mentions.range", {
          text: row.match.text, line: row.match.context?.line ?? "?",
        })} · ${row.match.context?.excerpt ?? ""}`, () => { selected = row; targetPage = 0; render(); }));
        restoreFocus();
      };
      if (requests.every(({ source, offset, count }) => source.matches.length >= offset + count)) {
        appendRows(requests.flatMap(({ source, offset, count }) => source.matches.slice(offset, offset + count).map((match) => ({ source, match }))));
      } else {
        content.setAttribute("aria-busy", "true");
        void (async () => {
          const rows: Array<{ source: PotentialMentionSource; match: PotentialMentionMatch }> = [];
          for (const { source, offset, count } of requests) {
            const matches = source.loadMatches === undefined ? source.matches.slice(offset, offset + count) : await source.loadMatches(offset, count);
            if (closed || generation !== renderGeneration) return;
            rows.push(...matches.map((match) => ({ source, match })));
          }
          appendRows(rows);
        })().catch(() => {
          if (closed || generation !== renderGeneration) return;
          state.textContent = translator.t("mentions.changed");
          content.setAttribute("aria-busy", "false");
          cancel.focus();
        });
      }
      if (total === 0 && complete) {
        const empty = document.createElement("p");
        empty.textContent = translator.t("mentions.none");
        content.append(empty);
      }
      dialog.append(button("ranges:previous", translator.t("common.previous"), () => { page -= 1; render(); }, page === 0),
        button("ranges:next", translator.t("common.next"), () => { page += 1; render(); }, (page + 1) * 50 >= total));
    } else {
      const { source, match } = selected;
      targetPage = Math.min(targetPage, Math.max(0, Math.ceil(match.targets.length / 50) - 1));
      const range = document.createElement("p");
      range.textContent = `${source.sourcePath} · ${translator.t("mentions.range", { text: match.text, line: match.context?.line ?? "?" })} · ${match.context?.excerpt ?? ""}`;
      const key = rangeKey(source, match);
      content.append(range, button(`source:${key}`, translator.t("mentions.openSource"), async () => { await actions.navigate(source, match); render(); }));
      for (const target of match.targets.slice(targetPage * 50, (targetPage + 1) * 50)) {
        const row = document.createElement("div");
        const label = document.createElement("p");
        label.textContent = `${target.path} · ${target.nameKinds.map((kind) => translator.t(kind === "title"
          ? "mentions.titleMatch" : "mentions.aliasMatch")).join(" / ")}`;
        row.append(label, button(`target:${key}:${target.path}`, translator.t("mentions.openTarget"), () => actions.openTarget(target.path)),
          button(`create:${key}:${target.path}`, translator.t("mentions.create"), async () => { await actions.create(source, match, target.path); close(); }, !actions.canCreate(source)));
        content.append(row);
      }
      dialog.append(button(`targets:previous:${key}`, translator.t("common.previous"), () => { targetPage -= 1; render(); }, targetPage === 0),
        button(`targets:next:${key}`, translator.t("common.next"), () => { targetPage += 1; render(); }, (targetPage + 1) * 50 >= match.targets.length),
        button(`clear:${key}`, translator.t("common.clear"), () => { selected = null; render(); }));
    }
    restoreFocus();
  };
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    event.preventDefault();
  });
  render();
  dialog.showModal();
  return { close, update: (next, nextStatus, done = false) => {
    if (selected !== null) {
      const current = selected;
      const source = next.find((source) => source.sourcePath === current.source.sourcePath && source.documentRevision === current.source.documentRevision);
      const match = source?.matches.find((match) => match.from === current.match.from && match.to === current.match.to && match.text === current.match.text);
      if (source !== undefined && match !== undefined) selected = match.targets.length > 0 ? { source, match } : null;
      // An unchanged lazy provider owns the same proven page. A replacement without the exact range
      // cannot inherit old actions; return to range selection instead of guessing or retaining targets.
      else if (source === undefined || source !== current.source || source.loadMatches === undefined) selected = null;
    }
    sources = next; status = nextStatus; complete = done; render();
  } };
}
