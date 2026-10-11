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
  const close = (): void => {
    if (closed) return;
    closed = true;
    actions.close();
    dialog.remove();
    if (previousFocus instanceof document.defaultView!.HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
  const button = (label: string, action: () => void | Promise<void>, disabled = false): HTMLButtonElement => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.disabled = disabled;
    element.addEventListener("click", () => {
      Promise.resolve().then(action).catch(() => { status = translator.t("mentions.changed"); render(); });
    });
    return element;
  };
  const render = (): void => {
    if (closed) return;
    const focusLabel = dialog.contains(document.activeElement) ? document.activeElement?.textContent : null;
    dialog.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = translator.t("mentions.title");
    const explanation = document.createElement("p");
    explanation.textContent = translator.t("mentions.explanation");
    const state = document.createElement("p");
    state.setAttribute("role", "status");
    state.textContent = status;
    dialog.append(heading, explanation, state, button(translator.t("common.cancel"), close));
    const content = document.createElement("div");
    content.className = "link-integrity-mention-picker-results";
    dialog.append(content);
    if (selected === null) {
      let total = 0;
      const rows: Array<{ source: PotentialMentionSource; match: PotentialMentionMatch }> = [];
      for (const source of sources) {
        for (const match of source.matches) {
          if (total >= page * 50 && rows.length < 50) rows.push({ source, match });
          total += 1;
        }
      }
      for (const row of rows) content.append(button(`${row.source.sourcePath} · ${translator.t("mentions.range", {
        text: row.match.text, line: row.match.context?.line ?? "?",
      })} · ${row.match.context?.excerpt ?? ""}`, () => { selected = row; targetPage = 0; render(); }));
      if (total === 0 && complete) {
        const empty = document.createElement("p");
        empty.textContent = translator.t("mentions.none");
        content.append(empty);
      }
      dialog.append(button(translator.t("common.previous"), () => { page -= 1; render(); }, page === 0),
        button(translator.t("common.next"), () => { page += 1; render(); }, (page + 1) * 50 >= total));
    } else {
      const { source, match } = selected;
      const range = document.createElement("p");
      range.textContent = `${source.sourcePath} · ${translator.t("mentions.range", { text: match.text, line: match.context?.line ?? "?" })} · ${match.context?.excerpt ?? ""}`;
      content.append(range, button(translator.t("mentions.openSource"), async () => { await actions.navigate(source, match); render(); }));
      for (const target of match.targets.slice(targetPage * 50, (targetPage + 1) * 50)) {
        const row = document.createElement("div");
        const label = document.createElement("p");
        label.textContent = `${target.path} · ${target.nameKinds.map((kind) => translator.t(kind === "title"
          ? "mentions.titleMatch" : "mentions.aliasMatch")).join(" / ")}`;
        row.append(label, button(translator.t("mentions.openTarget"), () => actions.openTarget(target.path)),
          button(translator.t("mentions.create"), async () => { await actions.create(source, match, target.path); close(); }, !actions.canCreate(source)));
        content.append(row);
      }
      dialog.append(button(translator.t("common.previous"), () => { targetPage -= 1; render(); }, targetPage === 0),
        button(translator.t("common.next"), () => { targetPage += 1; render(); }, (targetPage + 1) * 50 >= match.targets.length),
        button(translator.t("common.clear"), () => { selected = null; render(); }));
    }
    if (focusLabel !== null) [...dialog.querySelectorAll<HTMLButtonElement>("button")]
      .find((element) => !element.disabled && element.textContent === focusLabel)?.focus();
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
  return { close, update: (next, nextStatus, done = false) => { sources = next; status = nextStatus; complete = done; render(); } };
}
