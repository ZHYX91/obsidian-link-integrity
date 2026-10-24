import { describe, expect, it, vi } from "vitest";
import { renderIgnoreRules } from "../../src/ui/settings/ignore-rule-editor";
import { createDefaultSettings } from "../../src/shared/settings";
import { createTranslator } from "../../src/shared/i18n";
import type { IgnoreRule, IgnoreRulePreview } from "../../src/shared/ignore-rules";
import type { SettingsUiContext } from "../../src/ui/settings/types";

const rule: IgnoreRule = {
  id: "archive", enabled: true, scope: "hide-broken-result",
  matcher: { kind: "path-prefix", value: "Archive" }, createdAt: 1, note: "Archive rule",
};

function setup(overrides: Partial<SettingsUiContext> = {}) {
  let settings = { ...createDefaultSettings(), ignoreRules: [rule] };
  let revision = "1:1";
  let indexChanged: (() => void) | undefined;
  const onSettingsChange = vi.fn((next) => { settings = next; });
  const preview = vi.fn(async () => ({
    matchCount: 3, samples: ["Archive/a.md"], affectedFileCount: 2, affectedConnectionCount: 1,
  }));
  const unsubscribe = vi.fn();
  const container = document.createElement("div");
  const cleanup = renderIgnoreRules(container, {
    settings, getSettings: () => settings, translator: createTranslator("en", "en"),
    writeProtected: false, createId: () => "new-rule", onSettingsChange,
    getIndexRevision: () => revision,
    subscribeIndexDiagnostics: (listener) => { indexChanged = () => listener({} as never); return unsubscribe; },
    requestIgnoreRulePreview: preview,
    ...overrides,
  }, "broken");
  const action = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((item) => item.textContent === text)!;
  const field = (text: string) => Array.from(container.querySelectorAll("label"))
    .find((label) => label.querySelector("span")?.textContent === text)!
    .querySelector<HTMLInputElement | HTMLSelectElement>("input,select")!;
  const change = (text: string, value: string) => {
    const control = field(text); control.value = value;
    control.dispatchEvent(new Event(control.tagName === "INPUT" ? "input" : "change"));
  };
  return { container, cleanup, action, field, change, preview, onSettingsChange, unsubscribe,
    advanceIndex: () => { revision = "2:1"; indexChanged?.(); },
    replaceRule: () => { settings = { ...settings, ignoreRules: [{ ...rule, note: "Changed elsewhere" }] }; },
  };
}

describe("ignore rule drafts", () => {
  it("ignores queued actions after a ready draft is closed", async () => {
    const view = setup();
    view.action("Preview").click();
    await vi.waitFor(() => expect(view.action("Save").disabled).toBe(false));
    view.cleanup();
    for (const action of ["Save", "Delete", "Preview", "Cancel"]) {
      // dispatchEvent also covers a click queued before disabled was applied.
      view.action(action).dispatchEvent(new Event("click"));
    }
    expect(view.onSettingsChange).not.toHaveBeenCalled();
    expect(view.preview).toHaveBeenCalledOnce();
    expect(view.action("Save").disabled).toBe(true);
  });

  it("labels all controls and saves graph changes only after preview", async () => {
    const view = setup();
    for (const label of ["Scope", "Match by", "Match value", "Note"]) expect(view.field(label)).toBeTruthy();
    view.change("Scope", "exclude-graph-contribution");
    expect(view.onSettingsChange).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("connected files appear isolated");
    expect(view.action("Save").disabled).toBe(true);
    view.action("Preview").click();
    await vi.waitFor(() => expect(view.action("Save").disabled).toBe(false));
    expect(view.container.textContent).toContain("Files involved: 2");
    view.action("Save").click();
    expect(view.onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({
      ignoreRules: [expect.objectContaining({ scope: "exclude-graph-contribution" })],
    }), "regraph");
    view.cleanup();
  });

  it("cancel restores persisted fields without changing settings", () => {
    const view = setup();
    view.change("Match value", "Other");
    view.change("Scope", "exclude-graph-contribution");
    view.action("Cancel").click();
    expect(view.field("Match value").value).toBe("Archive");
    expect(view.field("Scope").value).toBe("hide-broken-result");
    expect(view.onSettingsChange).not.toHaveBeenCalled();
    view.cleanup();
  });

  it("invalidates results on input and index publication", async () => {
    const view = setup();
    view.action("Preview").click();
    await vi.waitFor(() => expect(view.action("Save").disabled).toBe(false));
    view.change("Match value", "Other");
    expect(view.action("Save").disabled).toBe(true);
    expect(view.container.textContent).not.toContain("Matches 3 items");
    view.action("Preview").click();
    await vi.waitFor(() => expect(view.action("Save").disabled).toBe(false));
    view.advanceIndex();
    expect(view.action("Save").disabled).toBe(true);
    expect(view.container.textContent).toContain("The index changed");
    view.cleanup();
  });

  it("discards late previews after a new draft or closing the section", async () => {
    let resolve!: (value: IgnoreRulePreview) => void;
    let signal: AbortSignal | undefined;
    const view = setup({ requestIgnoreRulePreview: (_rule, currentSignal) => {
      signal = currentSignal;
      return new Promise((done) => { resolve = done; });
    } });
    view.action("Preview").click();
    view.change("Match value", "Other");
    expect(signal?.aborted).toBe(true);
    resolve({ matchCount: 999, samples: [] });
    await Promise.resolve();
    expect(view.container.textContent).not.toContain("999");
    expect(view.action("Save").disabled).toBe(true);
    view.action("Preview").click();
    view.cleanup();
    expect(signal?.aborted).toBe(true);
    resolve({ matchCount: 999, samples: [] });
    await Promise.resolve();
    expect(view.unsubscribe).toHaveBeenCalledOnce();
  });

  it("rejects empty values and retains a current preview for trimmed input", async () => {
    const view = setup();
    view.change("Match value", " ");
    expect(view.action("Preview").disabled).toBe(true);
    expect(view.container.textContent).toContain("Enter a path");
    view.change("Match value", " Archive ");
    view.action("Preview").click();
    await vi.waitFor(() => expect(view.action("Save").disabled).toBe(false));
    view.cleanup();
  });

  it("does not overwrite a rule changed elsewhere while the draft was open", async () => {
    const view = setup();
    view.action("Preview").click();
    await vi.waitFor(() => expect(view.action("Save").disabled).toBe(false));
    view.replaceRule();
    view.action("Save").click();
    expect(view.onSettingsChange).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("changed elsewhere");
    view.cleanup();
  });

  it("keeps a new rule local until saved and removes it on cancel", () => {
    const view = setup();
    view.action("Add ignore rule").click();
    const cards = view.container.querySelectorAll("details");
    expect(cards).toHaveLength(2);
    expect(view.onSettingsChange).not.toHaveBeenCalled();
    Array.from(cards[1]!.querySelectorAll<HTMLButtonElement>("button"))
      .find((item) => item.textContent === "Cancel")!.click();
    expect(view.container.querySelectorAll("details")).toHaveLength(1);
    view.cleanup();
  });

  it("keeps write-protected rules read-only", () => {
    const view = setup({ writeProtected: true });
    expect(view.field("Scope").disabled).toBe(true);
    expect(view.action("Preview").disabled).toBe(true);
    expect(view.action("Save").disabled).toBe(true);
    expect(view.action("Delete").disabled).toBe(true);
    view.cleanup();
  });

  it("requires a ready index rather than offering an empty initial preview", () => {
    const view = setup({ getIndexStatus: () => ({
      state: "idle", current: 0, total: 0, errorMessage: null,
    }) });
    expect(view.action("Preview").disabled).toBe(true);
    expect(view.action("Save").disabled).toBe(true);
    expect(view.container.textContent).toContain("Build a current index in General");
    view.cleanup();
  });
});
