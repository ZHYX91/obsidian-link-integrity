import { Notice, getLanguage } from "obsidian";
import { createTranslator } from "../shared/i18n";
import type { IgnoreRule, IgnoreRulePreview } from "../shared/ignore-rules";
import {
  classifySettingChange,
  type LinkIntegritySettings,
  type SettingsChangeImpact,
} from "../shared/settings";

export interface SidebarIgnoreActionPort {
  readonly getSettings: () => LinkIntegritySettings;
  readonly isActive: () => boolean;
  readonly preview: (rule: IgnoreRule) => Promise<IgnoreRulePreview>;
  readonly update: (settings: LinkIntegritySettings, impact: SettingsChangeImpact) => void;
}

/** Owns one explicit sidebar shortcut and its exact-rule Undo notice. */
export async function applySidebarIgnore(
  port: SidebarIgnoreActionPort,
  scope: IgnoreRule["scope"],
  kind: IgnoreRule["matcher"]["kind"],
  value: string,
  label: string,
  anchor: HTMLElement,
): Promise<void> {
  const document = anchor.ownerDocument;
  const suffix = document.defaultView?.crypto.randomUUID?.() ?? Date.now().toString(36);
  const rule: IgnoreRule = {
    id: `ignore-rule:${suffix}`, enabled: true, scope,
    matcher: { kind, value }, createdAt: Date.now(), note: label,
  };
  const preview = await port.preview(rule);
  if (!port.isActive()) return;
  const current = port.getSettings();
  port.update({ ...current, ignoreRules: [...current.ignoreRules, rule] }, classifySettingChange(rule));
  const { t } = createTranslator(current.general.locale, getLanguage());
  const fragment = document.createDocumentFragment();
  const message = document.createElement("span");
  message.textContent = `${label} · ${t("settings.ignore.matchCount", { count: preview.matchCount })}`;
  const undo = document.createElement("button");
  undo.type = "button";
  undo.textContent = t("common.undo");
  fragment.append(message, document.createTextNode(" "), undo);
  const notice = new Notice(fragment, 8_000);
  undo.addEventListener("click", () => {
    if (!port.isActive()) return;
    const settings = port.getSettings();
    port.update({
      ...settings,
      ignoreRules: settings.ignoreRules.filter(({ id }) => id !== rule.id),
    }, classifySettingChange(rule));
    notice.hide();
  }, { once: true });
}
