import { afterEach, describe, expect, it, vi } from "vitest";

import { LinkIntegritySettingTab } from "../../src/app/settings-tab";
import { createTranslator } from "../../src/shared/i18n";
import { createDefaultSettings } from "../../src/shared/settings";
import { renderImperativeSettings } from "../../src/ui/settings/render";
import type { SettingsUiContext } from "../../src/ui/settings/types";

const controls = vi.hoisted(() => [] as Array<{
  kind: "toggle" | "dropdown";
  disabled: boolean;
  value: unknown;
  change: (value: never) => void;
}>);

vi.mock("obsidian", () => {
  class Control {
    readonly selectEl = document.createElement("select");
    readonly toggleEl = document.createElement("label");
    readonly checkbox = document.createElement("input");
    disabled = false;
    value: unknown;
    change: (value: never) => void = () => undefined;
    constructor(readonly kind: "toggle" | "dropdown", container: HTMLElement) {
      this.checkbox.type = "checkbox";
      this.toggleEl.tabIndex = 0;
      this.checkbox.tabIndex = -1;
      this.toggleEl.append(this.checkbox);
      container.append(kind === "toggle" ? this.toggleEl : this.selectEl);
      controls.push(this);
    }
    setValue(value: unknown): this { this.value = value; return this; }
    setDisabled(value: boolean): this { this.disabled = value; return this; }
    addOption(): this { return this; }
    onChange(callback: (value: never) => void): this { this.change = callback; return this; }
  }
  return {
    getLanguage: () => "en",
    PluginSettingTab: class {
      readonly containerEl = document.createElement("div");
      hide(): void {}
    },
    setIcon: vi.fn(),
    Setting: class {
      settingEl: HTMLElement;
      constructor(container: HTMLElement) {
        this.settingEl = document.createElement("div");
        container.append(this.settingEl);
      }
      setName(): this { return this; }
      setDesc(): this { return this; }
      setDisabled(): this { return this; }
      addToggle(callback: (control: Control) => void): this {
        callback(new Control("toggle", this.settingEl)); return this;
      }
      addDropdown(callback: (control: Control) => void): this {
        callback(new Control("dropdown", this.settingEl)); return this;
      }
    },
  };
});

vi.mock("../../src/ui/settings/custom-sections", () => ({
  renderCustomSetting: () => () => undefined,
}));

describe("imperative settings controls", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    controls.splice(0);
    vi.restoreAllMocks();
  });

  function render(overrides: Partial<SettingsUiContext> = {}) {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const context: SettingsUiContext = {
      settings: createDefaultSettings(),
      translator: createTranslator("en", "en"),
      writeProtected: false,
      createId: (kind) => `${kind}:test`,
      onSettingsChange: vi.fn(),
      onError: vi.fn(),
      ...overrides,
    };
    const container = document.createElement("div");
    cleanups.push(renderImperativeSettings(container, context, {
      activeTab: "general", onSelectTab: vi.fn(),
    }));
    return { context, container };
  }

  function change(kind: "toggle" | "dropdown", value: unknown) {
    const control = controls.find((item) => item.kind === kind);
    if (control === undefined) throw new Error(`Missing ${kind} control`);
    control.change(value as never);
  }

  it("keeps newer periodic presets when another control from the same render is changed", () => {
    const initial = createDefaultSettings();
    const latest = {
      ...initial,
      isolatedFiles: {
        ...initial.isolatedFiles,
        periodicNotesPreset: { ...initial.isolatedFiles.periodicNotesPreset, enabled: true },
      },
    };
    const { context } = render({ getSettings: () => latest });
    change("toggle", true);
    expect(context.onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({
      isolatedFiles: expect.objectContaining({ periodicNotesPreset: latest.isolatedFiles.periodicNotesPreset }),
    }), "query-only", "keep-controls");
  });

  it("gives the single focusable native checkbox its localized name and committed state", () => {
    const { container } = render();
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.getAttribute("aria-label")).toBeTruthy();
    expect(checkbox.parentElement?.tabIndex).toBe(-1);
    expect(checkbox.tabIndex).toBe(0);
    expect(checkbox.checked).toBe(false);
    change("toggle", true);
    expect(checkbox.checked).toBe(true);
    expect(container.querySelector("select")?.getAttribute("aria-label")).toBeTruthy();
  });

  it("commits toggle and locale selections without mutating the supplied settings", () => {
    const { context } = render();
    change("toggle", true);
    expect(context.onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({
      general: expect.objectContaining({ scanOnStartup: true }),
    }), "query-only", "keep-controls");
    change("dropdown", "de");
    expect(context.onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({
      general: expect.objectContaining({ locale: "de" }),
    }), "query-only");
    expect(context.settings.general.scanOnStartup).toBe(false);
    expect(context.settings.general.locale).toBe("auto");
  });

  it("keeps a changed toggle mounted and restores the owning field on a language redraw", () => {
    let settings = createDefaultSettings();
    const owner = {
      getSettings: () => settings,
      updateSettings: (next: typeof settings) => { settings = next; },
      isSettingsWriteProtected: () => false,
    };
    const tab = new LinkIntegritySettingTab({} as never, owner as never);
    const panel = tab.containerEl;
    document.body.append(panel);
    cleanups.push(() => { tab.hide(); panel.remove(); });
    tab.display();

    const toggle = panel.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    toggle.focus();
    change("toggle", true);
    expect(settings.general.scanOnStartup).toBe(true);
    expect(toggle.checked).toBe(true);
    expect(document.activeElement).toBe(toggle);

    const language = panel.querySelector<HTMLSelectElement>("select")!;
    panel.scrollTop = 123;
    language.focus();
    change("dropdown", "ar");
    const replacement = panel.querySelector<HTMLSelectElement>("select")!;
    expect(settings.general.locale).toBe("ar");
    expect(panel.dir).toBe("rtl");
    expect(language.isConnected).toBe(false);
    expect(document.activeElement).toBe(replacement);
    expect(panel.scrollTop).toBe(123);
  });

  it.each(["toggle", "dropdown"] as const)("reports synchronous %s commit failures", (kind) => {
    const failure = new Error("commit failed");
    const { context } = render({ onSettingsChange: () => { throw failure; } });
    change(kind, kind === "toggle" ? true : "de");
    expect(context.onError).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it.each(["toggle", "dropdown"] as const)("reports rejected %s commits", async (kind) => {
    const failure = new Error("async commit failed");
    const { context } = render({ onSettingsChange: () => Promise.reject(failure) });
    change(kind, kind === "toggle" ? true : "de");
    await Promise.resolve();
    expect(context.onError).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it("disables controls and warns when a newer settings schema is write-protected", () => {
    const { context, container } = render({ writeProtected: true });
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("Settings were created by a newer plugin version");
    expect(container.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((control) => control.disabled)).toBe(true);
    expect(context.onSettingsChange).not.toHaveBeenCalled();
  });
});
