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
});
