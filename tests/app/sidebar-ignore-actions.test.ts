import { Notice } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { applySidebarIgnore } from "../../src/app/sidebar-ignore-actions";
import { createDefaultSettings } from "../../src/shared/settings";

describe("sidebar ignore actions", () => {
  it("leaves settings unchanged if the owning plugin unloads during preview", async () => {
    let active = true;
    const update = vi.fn();
    await applySidebarIgnore({
      getSettings: createDefaultSettings, isActive: () => active, update,
      preview: async () => { active = false; return { matchCount: 1, samples: [] }; },
    }, "hide-broken-result", "source-path", "A.md", "Hide source", document.createElement("div"));
    expect(update).not.toHaveBeenCalled();
  });

  it("undo removes only its own rule and cannot write after unload", async () => {
    let settings = createDefaultSettings();
    let active = true;
    const update = vi.fn((next) => { settings = next; });
    const port = {
      getSettings: () => settings, isActive: () => active, update,
      preview: async () => ({ matchCount: 1, samples: [] }),
    };
    const notices = (Notice as unknown as { messages: unknown[] }).messages;
    await applySidebarIgnore(port, "hide-broken-result", "source-path", "A.md", "Hide A", document.createElement("div"));
    const firstUndo = (notices.at(-1) as DocumentFragment).querySelector<HTMLButtonElement>("button")!;
    await applySidebarIgnore(port, "hide-broken-result", "source-path", "B.md", "Hide B", document.createElement("div"));
    const secondUndo = (notices.at(-1) as DocumentFragment).querySelector<HTMLButtonElement>("button")!;
    firstUndo.click();
    expect(settings.ignoreRules.map(({ matcher }) => matcher.value)).toEqual(["B.md"]);
    active = false;
    secondUndo.click();
    expect(settings.ignoreRules.map(({ matcher }) => matcher.value)).toEqual(["B.md"]);
    expect(update).toHaveBeenCalledTimes(3);
  });
});
