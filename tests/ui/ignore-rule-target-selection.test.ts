import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIgnoreRules } from "../../src/ui/settings/ignore-rule-editor";
import { normalizeIgnoreRule, previewIgnoreRule, type IgnoreRule, type IgnoreRulePreview } from "../../src/shared/ignore-rules";
import { createDefaultSettings, type LinkIntegritySettings } from "../../src/shared/settings";
import { createTranslator } from "../../src/shared/i18n";
import type { IgnoreRuleDraft, SettingsUiContext } from "../../src/ui/settings/types";

const cleanups = new Set<() => void>();
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.clear();
});

function setup(
  matcher: IgnoreRule["matcher"] = { kind: "target-path", value: "Topic.md" },
  overrides: Partial<SettingsUiContext> = {},
) {
  const original = normalizeIgnoreRule({
    id: "target", enabled: true, scope: "ignore-target", matcher, createdAt: 1, note: "Target rule",
  })!;
  let settings: LinkIntegritySettings = { ...createDefaultSettings(), ignoreRules: [original] };
  const drafts = new Map<string, IgnoreRuleDraft>();
  const onSettingsChange = vi.fn((next: LinkIntegritySettings) => { settings = next; });
  const preview = vi.fn(async (rule: IgnoreRule, _signal: AbortSignal) => previewIgnoreRule(rule, [
    { targetPath: "Topic.md", sourcePath: "Note.md" },
    { targetPath: "Archive/Topic.md", sourcePath: "Note.md" },
    { targetPath: "Archive/Topic#literal.md", sourcePath: "Note.md" },
  ]));
  const context: SettingsUiContext = {
    settings, getSettings: () => settings, translator: createTranslator("en", "en"),
    ignoreRuleDrafts: drafts, writeProtected: false, createId: () => "new-rule", onSettingsChange,
    getIndexRevision: () => "1:1", requestIgnoreRulePreview: preview, ...overrides,
  };
  const container = document.createElement("div");
  document.body.append(container);
  let cleanup = renderIgnoreRules(container, context, "broken");
  cleanups.add(() => { cleanup(); container.remove(); });
  const action = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((control) => control.textContent === text)!;
  const field = (text: string) => [...container.querySelectorAll("label")]
    .find((label) => label.querySelector("span")?.textContent === text)!
    .querySelector<HTMLInputElement | HTMLSelectElement>("input,select")!;
  const change = (text: string, value: string) => {
    const control = field(text);
    control.value = value;
    control.dispatchEvent(new Event(control.tagName === "INPUT" ? "input" : "change"));
  };
  const enabled = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const setEnabled = (checked: boolean) => {
    enabled().checked = checked;
    enabled().dispatchEvent(new Event("change"));
  };
  const previewAndSave = async () => {
    action("Preview").click();
    await vi.waitFor(() => expect(action("Save").disabled).toBe(false));
    action("Save").click();
  };
  return {
    container, original, drafts, preview, onSettingsChange, action, field, change, enabled, setEnabled, previewAndSave,
    settings: () => settings,
    redraw: () => { cleanup(); container.replaceChildren(); cleanup = renderIgnoreRules(container, context, "broken"); },
    dispose: () => cleanup(),
  };
}

describe("target-path selection in the ignore-rule settings DOM", () => {
  it("keeps an old short target paused and explains its missing source context", async () => {
    const view = setup();
    expect(view.container.textContent).toContain("target path has no source context");
    expect(view.container.textContent).toContain("full Vault path");
    expect(view.enabled().checked).toBe(false);
    expect(view.enabled().disabled).toBe(true);
    expect(view.action("Use this Vault path").hidden).toBe(false);
    expect(view.onSettingsChange).not.toHaveBeenCalled();
    view.change("Note", "New note only");
    view.setEnabled(true);
    expect(view.enabled().checked).toBe(false);
    expect(view.drafts.get("target")?.draft.matcher).toEqual({ kind: "target-path", value: "Topic.md" });
    view.action("Preview").click();
    await vi.waitFor(() => expect(view.container.textContent).toContain("Matches 0 items"));
    expect(view.action("Save").disabled).toBe(true);
    expect(view.preview.mock.calls[0]?.[0]).toMatchObject({ enabled: false, matcher: { value: "Topic.md" } });
    expect(view.onSettingsChange).not.toHaveBeenCalled();
  });

  it("lets the user explicitly confirm an unchanged value, then enable, preview and save it", async () => {
    const view = setup();
    view.action("Use this Vault path").click();
    expect(view.field("Match value").value).toBe("Topic.md");
    expect(view.enabled().disabled).toBe(false);
    expect(view.enabled().checked).toBe(false);
    expect(view.action("Use this Vault path").hidden).toBe(true);
    expect(view.container.textContent).not.toContain("target path has no source context");
    expect(view.action("Save").disabled).toBe(true);
    view.setEnabled(true);
    await view.previewAndSave();
    expect(view.settings().ignoreRules[0]).toMatchObject({
      enabled: true, matcher: { kind: "target-path", value: "Topic.md", pathKind: "vault" },
    });
    expect(view.preview.mock.calls[0]?.[0].matcher.pathKind).toBe("vault");
  });

  it("treats an edited full path as an explicit selection without changing stored settings early", async () => {
    const view = setup();
    view.change("Match value", "Archive/Topic.md");
    expect(view.action("Use this Vault path").hidden).toBe(true);
    expect(view.onSettingsChange).not.toHaveBeenCalled();
    expect(view.settings().ignoreRules[0]).toEqual(view.original);
    view.setEnabled(true);
    await view.previewAndSave();
    expect(view.settings().ignoreRules[0]?.matcher).toEqual({
      kind: "target-path", value: "Archive/Topic.md", pathKind: "vault",
    });
  });

  it("marks a newly selected target matcher as a Vault path", async () => {
    const view = setup({ kind: "source-path", value: "Archive/Topic.md" });
    view.change("Match by", "target-path");
    await view.previewAndSave();
    expect(view.settings().ignoreRules[0]?.matcher).toEqual({
      kind: "target-path", value: "Archive/Topic.md", pathKind: "vault",
    });
  });

  it("retains selected literal hash paths across note, scope, enablement and redraw changes", async () => {
    const view = setup({ kind: "target-path", value: "Archive/Topic#literal.md", pathKind: "vault" });
    view.change("Note", "Edited note");
    view.change("Scope", "hide-broken-result");
    view.setEnabled(false);
    view.redraw();
    expect(view.enabled().disabled).toBe(false);
    expect(view.enabled().checked).toBe(false);
    view.setEnabled(true);
    await view.previewAndSave();
    expect(view.settings().ignoreRules[0]).toMatchObject({
      enabled: true, note: "Edited note", scope: "hide-broken-result",
      matcher: { kind: "target-path", value: "Archive/Topic#literal.md", pathKind: "vault" },
    });
    expect(view.container.textContent).toContain("Matches 1 item");
  });

  it("removes the target marker when a different matcher is selected", async () => {
    const view = setup({ kind: "target-path", value: "Topic.md", pathKind: "vault" });
    view.change("Match by", "source-path");
    await view.previewAndSave();
    expect(view.settings().ignoreRules[0]?.matcher).toEqual({ kind: "source-path", value: "Topic.md" });
  });

  it("retains an unknown target marker until the user confirms the full path", async () => {
    const view = setup({ kind: "target-path", value: "Archive/Topic.md", pathKind: "future-vault" });
    view.change("Note", "Keep this rule");
    view.redraw();
    expect(view.drafts.get("target")?.draft.matcher.pathKind).toBe("future-vault");
    expect(view.enabled().disabled).toBe(true);
    view.action("Preview").click();
    await vi.waitFor(() => expect(view.container.textContent).toContain("Matches 0 items"));
    expect(view.action("Save").disabled).toBe(true);
    view.action("Use this Vault path").click();
    view.setEnabled(true);
    await view.previewAndSave();
    expect(view.settings().ignoreRules[0]).toMatchObject({
      enabled: true,
      matcher: { kind: "target-path", value: "Archive/Topic.md", pathKind: "vault" },
    });
  });

  it.each(["./Topic.md", "../Topic.md", "Archive/../Topic.md"])(
    "cannot confirm or save the relative target %s", async (path) => {
      const view = setup({ kind: "target-path", value: path });
      expect(view.action("Use this Vault path").disabled).toBe(true);
      view.action("Use this Vault path").dispatchEvent(new Event("click"));
      expect(view.drafts.get("target")?.draft.matcher.pathKind).toBeUndefined();
      view.change("Match value", path);
      expect(view.container.textContent).toContain("without ./ or ../ segments");
      expect(view.action("Preview").disabled).toBe(true);
      expect(view.action("Save").disabled).toBe(true);
      view.action("Save").dispatchEvent(new Event("click"));
      expect(view.onSettingsChange).not.toHaveBeenCalled();
      view.change("Match value", "Archive/Topic.md");
      view.setEnabled(true);
      await view.previewAndSave();
      expect(view.settings().ignoreRules[0]?.matcher).toEqual({
        kind: "target-path", value: "Archive/Topic.md", pathKind: "vault",
      });
    },
  );

  it("cancel restores the paused original instead of keeping a draft confirmation", async () => {
    const view = setup();
    view.action("Use this Vault path").click();
    view.setEnabled(true);
    view.action("Preview").click();
    await vi.waitFor(() => expect(view.action("Save").disabled).toBe(false));
    view.action("Cancel").click();
    expect(view.settings().ignoreRules[0]).toEqual(view.original);
    expect(view.drafts.get("target")?.draft).toEqual(view.original);
    expect(view.enabled().checked).toBe(false);
    expect(view.enabled().disabled).toBe(true);
    expect(view.action("Use this Vault path").hidden).toBe(false);
    expect(view.action("Save").disabled).toBe(true);
    expect(view.onSettingsChange).not.toHaveBeenCalled();
  });

  it("aborts an old preview when the target is confirmed and rejects its late result", async () => {
    let finish!: (result: IgnoreRulePreview) => void;
    let signal!: AbortSignal;
    const view = setup(undefined, { requestIgnoreRulePreview: (_rule, currentSignal) => {
      signal = currentSignal;
      return new Promise((resolve) => { finish = resolve; });
    } });
    view.action("Preview").click();
    view.action("Use this Vault path").click();
    expect(signal.aborted).toBe(true);
    finish({ matchCount: 999, samples: [] });
    await Promise.resolve();
    expect(view.container.textContent).not.toContain("999");
    expect(view.action("Save").disabled).toBe(true);
    view.action("Preview").click();
    finish({ matchCount: 1, samples: [] });
    await vi.waitFor(() => expect(view.action("Save").disabled).toBe(false));
  });

  it("does not confirm paths through write-protected or disposed controls", () => {
    for (const writeProtected of [true, false]) {
      const view = setup(undefined, { writeProtected });
      if (!writeProtected) view.dispose();
      expect(view.action("Use this Vault path").disabled).toBe(true);
      view.action("Use this Vault path").dispatchEvent(new Event("click"));
      expect(view.drafts.get("target")?.draft).toEqual(view.original);
      expect(view.onSettingsChange).not.toHaveBeenCalled();
    }
  });
});
