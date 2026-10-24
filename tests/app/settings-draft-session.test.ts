import { describe, expect, it, vi } from "vitest";
import { LinkIntegritySettingTab } from "../../src/app/settings-tab";
import { createDefaultSettings, type LinkIntegritySettings } from "../../src/shared/settings";

function setup() {
  let settings: LinkIntegritySettings = { ...createDefaultSettings(), ignoreRules: ["A", "B"].map((name) => ({
    id: name, enabled: true, scope: "hide-broken-result", matcher: { kind: "source-path", value: `${name}.md` },
    createdAt: 1, note: name,
  })) };
  const owner = {
    getSettings: () => settings, isSettingsWriteProtected: () => false,
    updateSettings: (next: LinkIntegritySettings) => { settings = next; },
    previewExpectedRule: () => ({ matchCount: 0, samples: [], errors: [] }),
    previewIgnoreRule: async () => ({ matchCount: 1, samples: [] }),
    getIndexRevision: () => "1:1", getSettingsSaveStatus: () => ({ state: "saved", error: null }),
    subscribeToSettingsSaveStatus: () => () => undefined, retrySettingsSave: async () => undefined,
    getIndexStatus: () => ({ state: "ready", current: 0, total: 0, errorMessage: null }),
    subscribeToIndexStatus: () => () => undefined,
    getIndexDiagnostics: () => ({ fileCount: 2, sourceCount: 2, occurrenceCount: 1, pendingEventCount: 0,
      lastFullRebuild: null, lastIncrementalUpdate: null }),
    subscribeToIndexDiagnostics: () => () => undefined, rebuild: async () => undefined,
    hasVaultFile: () => true, openVaultFile: async () => undefined, reportSettingsError: vi.fn(),
  };
  const tab = new LinkIntegritySettingTab({} as never, owner as never);
  Object.assign(tab, { activeTab: "broken-links" });
  document.body.append(tab.containerEl);
  tab.display();
  const cards = () => [...tab.containerEl.querySelectorAll<HTMLDetailsElement>(".link-integrity-settings-rule")];
  const selectTab = (id: string) => tab.containerEl.querySelector<HTMLButtonElement>(`[data-tab-id="${id}"]`)!.click();
  return { tab, owner, cards, selectTab, settings: () => settings,
    replace: (next: LinkIntegritySettings) => { settings = next; } };
}

function action(container: Element, label: string): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label)!;
}
function field(card: Element, label: string): HTMLInputElement {
  return [...card.querySelectorAll("label")].find((element) => element.querySelector("span")?.textContent === label)!
    .querySelector<HTMLInputElement>("input")!;
}
function edit(card: HTMLDetailsElement, label: string, value: string): void {
  card.open = true;
  const control = field(card, label);
  control.value = value;
  control.dispatchEvent(new Event("input"));
}
async function preview(card: Element): Promise<void> {
  action(card, "Preview").click();
  await vi.waitFor(() => expect(action(card, "Save").disabled).toBe(false));
}

describe("imperative settings draft session", () => {
  it("keeps other raw drafts and expansion across save and tab changes, but invalidates previews", async () => {
    const h = setup();
    edit(h.cards()[1]!, "Match value", "B-edited.md");
    await preview(h.cards()[1]!);
    const add = action(h.tab.containerEl, "Add ignore rule");
    add.click();
    expect(h.cards()).toHaveLength(3);
    edit(h.cards()[2]!, "Note", "Unfinished C");
    expect(field(h.cards()[2]!, "Match value").value).toBe("");
    await preview(h.cards()[0]!);
    action(h.cards()[0]!, "Save").click();
    expect(h.cards()).toHaveLength(3);
    expect(field(h.cards()[1]!, "Match value").value).toBe("B-edited.md");
    expect(h.cards()[1]!.open).toBe(true);
    expect(action(h.cards()[1]!, "Save").disabled).toBe(true);
    expect(field(h.cards()[2]!, "Note").value).toBe("Unfinished C");
    expect(action(h.cards()[2]!, "Save").disabled).toBe(true);
    expect(h.settings().ignoreRules[1]?.matcher.value).toBe("B.md");
    h.selectTab("general");
    h.selectTab("broken-links");
    expect(h.cards()).toHaveLength(3);
    expect(field(h.cards()[1]!, "Match value").value).toBe("B-edited.md");
    const staleAdd = action(h.tab.containerEl, "Add ignore rule");
    h.tab.hide();
    staleAdd.dispatchEvent(new Event("click"));
    h.tab.display();
    expect(h.cards()).toHaveLength(2);
    expect(field(h.cards()[1]!, "Match value").value).toBe("B.md");
    h.tab.hide();
    h.tab.containerEl.remove();
  });

  it.each(["changed", "deleted"])("keeps the original dirty baseline when persisted B is %s during another save", async (change) => {
    const h = setup();
    edit(h.cards()[1]!, "Match value", "My B.md");
    h.replace({ ...h.settings(), ignoreRules: change === "deleted"
      ? h.settings().ignoreRules.filter(({ id }) => id !== "B")
      : h.settings().ignoreRules.map((rule) => rule.id === "B" ? { ...rule, matcher: { ...rule.matcher, value: "External.md" } } : rule) });
    await preview(h.cards()[0]!);
    action(h.cards()[0]!, "Save").click();
    expect(h.cards()).toHaveLength(2);
    expect(field(h.cards()[1]!, "Match value").value).toBe("My B.md");
    await preview(h.cards()[1]!);
    action(h.cards()[1]!, "Save").click();
    expect(h.cards()[1]!.textContent).toContain("changed elsewhere");
    expect(h.settings().ignoreRules.find(({ id }) => id === "B")?.matcher.value)
      .toBe(change === "deleted" ? undefined : "External.md");
    action(h.cards()[1]!, "Cancel").click();
    if (change === "deleted") expect(h.cards()).toHaveLength(1);
    else expect(field(h.cards()[1]!, "Match value").value).toBe("External.md");
    h.tab.hide();
    h.tab.containerEl.remove();
  });
});
