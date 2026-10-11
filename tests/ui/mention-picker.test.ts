import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "../../src/shared/i18n";
import { openMentionPicker } from "../../src/ui/mentions/picker";

afterEach(() => document.body.replaceChildren());

describe("mention picker", () => {
  it("pages all ambiguous targets and requires source navigation before explicit writing", async () => {
    let ready = false;
    const actions = { navigate: vi.fn(async () => { ready = true; }), openTarget: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined), canCreate: () => ready, close: vi.fn() };
    const picker = openMentionPicker(document, createTranslator("en", "en"), actions);
    const match = { from: 2, to: 5, text: "白云山", targets: Array.from({ length: 101 }, (_, index) =>
      ({ path: `Target-${index}.md`, nameKinds: ["title" as const] })) };
    const source = { sourcePath: "Source.md", documentRevision: "revision", matches: [match] };
    picker.update([], "Scanning");
    expect(document.body.textContent).not.toContain("No potential");
    picker.update([source], "Complete", true);
    const click = async (label: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label);
      expect(button).toBeDefined(); button!.click(); await new Promise((resolve) => window.setTimeout(resolve, 0));
    };
    document.querySelector<HTMLButtonElement>(".link-integrity-mention-picker-results button")!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(document.querySelectorAll("button:disabled").length).toBeGreaterThanOrEqual(50);
    await click("Open source and validate range");
    await click("Next");
    await click("Next");
    expect(document.body.textContent).toContain("Target-100.md");
    await click("Create link");
    expect(actions.create).toHaveBeenCalledWith(source, match, "Target-100.md");
    expect(document.querySelector("dialog")).toBeNull();
    expect(actions.close).toHaveBeenCalledTimes(1);
  });

  it("keeps the exact target action focused during progress and falls back safely when it disappears", async () => {
    const create = vi.fn(async () => undefined);
    const picker = openMentionPicker(document, createTranslator("en", "en"), {
      navigate: async () => undefined, openTarget: async () => undefined, create, canCreate: () => true, close: () => undefined,
    });
    const match = { from: 0, to: 3, text: "白云山", targets: ["A.md", "B.md"].map((path) => ({ path, nameKinds: ["alias" as const] })) };
    const source = { sourcePath: "Source.md", documentRevision: "revision", matches: [match] };
    picker.update([source], "Scanning");
    document.querySelector<HTMLButtonElement>(".link-integrity-mention-picker-results button")!.click();
    await Promise.resolve(); await Promise.resolve();
    const createButtons = () => [...document.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent === "Create link");
    createButtons()[1]!.focus();
    picker.update([source], "Checked more sources");
    expect(document.activeElement).toBe(createButtons()[1]);
    (document.activeElement as HTMLButtonElement).click();
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith(source, match, "B.md"));

    const removed = openMentionPicker(document, createTranslator("en", "en"), {
      navigate: async () => undefined, openTarget: async () => undefined, create, canCreate: () => true, close: () => undefined,
    });
    removed.update([source], "Scanning");
    document.querySelector<HTMLButtonElement>(".link-integrity-mention-picker-results button")!.click();
    await Promise.resolve(); await Promise.resolve();
    createButtons()[1]!.focus();
    removed.update([], "Stale");
    expect(document.activeElement?.textContent).toBe("Cancel");
    removed.close();
  });

  it("loads complete range pages on demand and discards late output from an obsolete page", async () => {
    const match = (from: number) => ({ from, to: from + 1, text: "山", targets: [{ path: "Target.md", nameKinds: ["alias" as const] }] });
    let release!: (matches: ReturnType<typeof match>[]) => void;
    const loadMatches = vi.fn((offset: number) => new Promise<ReturnType<typeof match>[]>((resolve) => {
      if (offset === 50) release = resolve; else resolve([match(offset)]);
    }));
    const source = { sourcePath: "Source.md", documentRevision: "revision", matches: Array.from({ length: 50 }, (_, index) => match(index)),
      matchCount: 101, loadMatches };
    const picker = openMentionPicker(document, createTranslator("en", "en"), {
      navigate: async () => undefined, openTarget: async () => undefined, create: async () => undefined, canCreate: () => false, close: () => undefined,
    });
    picker.update([source], "Complete", true);
    const next = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Next")!;
    next().click();
    await Promise.resolve(); await Promise.resolve();
    expect(loadMatches).toHaveBeenCalledWith(50, 50);
    next().click();
    await vi.waitFor(() => expect(document.querySelectorAll(".link-integrity-mention-picker-results button")).toHaveLength(1));
    expect(loadMatches).toHaveBeenCalledWith(100, 1);
    release(Array.from({ length: 50 }, (_, index) => match(index + 50)));
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelectorAll(".link-integrity-mention-picker-results button")).toHaveLength(1);
    picker.close();
  });

  it("rebinds a selected range to fresh targets and rejects a queued action from removed DOM", async () => {
    const create = vi.fn(async () => undefined);
    const picker = openMentionPicker(document, createTranslator("en", "en"), {
      navigate: async () => undefined, openTarget: async () => undefined, create, canCreate: () => true, close: () => undefined,
    });
    const match = { from: 0, to: 3, text: "白云山", targets: ["A.md", "B.md"].map((path) => ({ path, nameKinds: ["alias" as const] })) };
    const source = { sourcePath: "Source.md", documentRevision: "revision", matches: [match] };
    picker.update([source], "Scanning");
    document.querySelector<HTMLButtonElement>(".link-integrity-mention-picker-results button")!.click();
    await Promise.resolve(); await Promise.resolve();
    const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent === "Create link");
    buttons()[1]!.focus();
    buttons()[1]!.click();
    const latestMatch = { ...match, targets: match.targets.slice(0, 1) };
    const latestSource = { ...source, matches: [latestMatch] };
    picker.update([latestSource], "Fresh targets");
    await Promise.resolve(); await Promise.resolve();
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(document.body.textContent).not.toContain("B.md");
    expect(create).not.toHaveBeenCalled();
    expect(buttons()).toHaveLength(1);
    buttons()[0]!.click();
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith(latestSource, latestMatch, "A.md"));
  });

  it("returns to range selection when replacement data cannot prove the selected range", async () => {
    const picker = openMentionPicker(document, createTranslator("en", "en"), {
      navigate: async () => undefined, openTarget: async () => undefined, create: async () => undefined, canCreate: () => true, close: () => undefined,
    });
    const source = { sourcePath: "Source.md", documentRevision: "revision", matches: [
      { from: 0, to: 3, text: "白云山", targets: [{ path: "B.md", nameKinds: ["alias" as const] }] },
    ] };
    picker.update([source], "Complete", true);
    document.querySelector<HTMLButtonElement>(".link-integrity-mention-picker-results button")!.click();
    await Promise.resolve(); await Promise.resolve();
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Create link")!.focus();
    picker.update([{ ...source, matches: [] }], "Updated", true);
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(document.body.textContent).not.toContain("B.md");
    picker.close();
  });

  it("retains a selected later range only for the same lazy source provider", async () => {
    const match = (from: number) => ({ from, to: from + 1, text: "山", targets: [{ path: "Later.md", nameKinds: ["alias" as const] }] });
    const source = { sourcePath: "Source.md", documentRevision: "revision", matches: Array.from({ length: 50 }, (_, index) => match(index)),
      matchCount: 51, loadMatches: vi.fn(async (offset: number) => [match(offset)]) };
    const picker = openMentionPicker(document, createTranslator("en", "en"), {
      navigate: async () => undefined, openTarget: async () => undefined, create: async () => undefined, canCreate: () => true, close: () => undefined,
    });
    picker.update([source], "Complete", true);
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Next")!.click();
    await vi.waitFor(() => expect(document.querySelectorAll(".link-integrity-mention-picker-results button")).toHaveLength(1));
    document.querySelector<HTMLButtonElement>(".link-integrity-mention-picker-results button")!.click();
    await Promise.resolve(); await Promise.resolve();
    picker.update([source], "Progress");
    expect(document.body.textContent).toContain("Later.md");
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Create link")!.focus();
    picker.update([{ ...source, loadMatches: vi.fn(async () => []) }], "Replaced provider");
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(document.body.textContent).not.toContain("Later.md");
    picker.close();
  });
});
