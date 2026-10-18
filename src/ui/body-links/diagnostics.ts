import type { BrokenReason } from "../sidebar/types";

export interface BodyDiagnosticItem { readonly from: number; readonly to: number; readonly diagnostic: { readonly reason: BrokenReason; readonly targetText: string };
  readonly occurrence: { readonly position: { readonly line: number | null } | null }; }
export interface BodyDiagnosticSource { readonly sourcePath: string; readonly state: "pending" | "ready"; readonly hints: readonly BodyDiagnosticItem[]; }
import type { Translator } from "../../shared/i18n";

export function bodyReasonKey(reason: BrokenReason): "sidebar.broken.reason.missingFile" | "sidebar.broken.reason.missingHeading" | "sidebar.broken.reason.missingBlock" | "sidebar.broken.reason.invalid" {
  return reason === "missing-file" ? "sidebar.broken.reason.missingFile" : reason === "missing-heading" ? "sidebar.broken.reason.missingHeading"
    : reason === "missing-block" ? "sidebar.broken.reason.missingBlock" : "sidebar.broken.reason.invalid";
}

/** Read-only, paged diagnostic entry for touch and uncertain reading mappings. */
export function openBodyLinkDiagnostics(document: Document, translator: Translator, source: BodyDiagnosticSource,
  navigate: (hint: BodyDiagnosticItem) => void, onClose: () => void): () => void {
  const dialog = document.createElement("dialog"); dialog.className = "link-integrity-body-diagnostics";
  dialog.dir = translator.direction;
  dialog.setAttribute("aria-label", translator.t("body.command"));
  const previous = document.activeElement; let page = 0; let closed = false;
  const close = (): void => {
    if (closed) return; closed = true; dialog.remove(); onClose();
    if (previous instanceof document.defaultView!.HTMLElement && previous.isConnected) previous.focus();
  };
  const render = (): void => {
    dialog.replaceChildren();
    const heading = document.createElement("h3"); heading.textContent = translator.t("body.command");
    const help = document.createElement("p"); help.textContent = translator.t(source.state === "pending" ? "body.pending" : "body.explanation");
    const cancel = document.createElement("button"); cancel.textContent = translator.t("common.cancel"); cancel.addEventListener("click", close);
    dialog.append(heading, help, cancel);
    if (source.state === "ready" && source.hints.length === 0) { const empty = document.createElement("p"); empty.textContent = translator.t("body.none"); dialog.append(empty); }
    for (const hint of source.hints.slice(page * 50, (page + 1) * 50)) {
      const button = document.createElement("button"); button.className = "link-integrity-body-diagnostic";
      const target = document.createElement("strong"); target.textContent = hint.diagnostic.targetText;
      const reason = document.createElement("span"); reason.textContent = translator.t(bodyReasonKey(hint.diagnostic.reason));
      const location = document.createElement("small"); location.textContent = `${source.sourcePath} · ${translator.t("body.line", { line: (hint.occurrence.position?.line ?? 0) + 1 })}`;
      button.append(target, reason, location); button.addEventListener("click", () => { if (!closed) { navigate(hint); close(); } }); dialog.append(button);
    }
    if (source.hints.length > 50) {
      for (const direction of [-1, 1]) {
        const button = document.createElement("button"); button.textContent = translator.t(direction < 0 ? "common.previous" : "common.next");
        button.disabled = page + direction < 0 || (page + direction) * 50 >= source.hints.length;
        button.addEventListener("click", () => { page += direction; render(); }); dialog.append(button);
      }
    }
    cancel.focus();
  };
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close(); } });
  document.body.append(dialog); render(); if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", ""); return close;
}
