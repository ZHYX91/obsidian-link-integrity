import { afterEach, describe, expect, it, vi } from "vitest";
import { openBodyLinkDiagnostics } from "../../src/ui/body-links/diagnostics";
import { createTranslator } from "../../src/shared/i18n";
import { bodySetup } from "../helpers/body-links";

afterEach(() => document.body.replaceChildren());
describe("read-only body diagnostics", () => {
  it("uses the selected locale direction without changing the host and preserves mixed-path navigation", async () => {
    document.body.dir = "ltr";
    const test = bodySetup("[[مجلد/Target-中文-123#Missing heading]]");
    const source = await test.service.source(test.path, test.text);
    const focus = document.createElement("button"); document.body.append(focus); focus.focus();
    const navigate = vi.fn(); const closed = vi.fn();
    const close = openBodyLinkDiagnostics(document, createTranslator("ar", "en"), source, navigate, closed);
    expect(document.querySelector("dialog")!.dir).toBe("rtl");
    expect(document.body.dir).toBe("ltr");
    const row = document.querySelector<HTMLButtonElement>(".link-integrity-body-diagnostic")!;
    expect(row.textContent).toContain("مجلد/Target-中文-123#Missing heading");
    row.click();
    expect(navigate).toHaveBeenCalledWith(source.hints[0]);
    expect(closed).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(focus); close();
    document.body.dir = "rtl";
    const closeEnglish = openBodyLinkDiagnostics(document, createTranslator("en", "ar"), source, vi.fn(), vi.fn());
    expect(document.querySelector("dialog")!.dir).toBe("ltr");
    expect(document.body.dir).toBe("rtl"); closeEnglish(); document.body.removeAttribute("dir");
  });
  it("pages all rows, wraps long target paths and closes safely with focus restored", async () => {
    const test = bodySetup(Array.from({ length: 75 }, (_, index) => `[[Long folder/Missing-${index}|Label]]`).join("\n"));
    const source = await test.service.source(test.path, test.text); const focus = document.createElement("button"); document.body.append(focus); focus.focus();
    const navigate = vi.fn(); const closed = vi.fn(); const close = openBodyLinkDiagnostics(document, createTranslator("en", "en"), source, navigate, closed);
    expect(document.querySelectorAll(".link-integrity-body-diagnostic")).toHaveLength(50);
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Next")!.click();
    expect(document.querySelectorAll(".link-integrity-body-diagnostic")).toHaveLength(25);
    document.querySelector<HTMLButtonElement>(".link-integrity-body-diagnostic")!.click(); expect(navigate).toHaveBeenCalledOnce(); expect(closed).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(focus); close(); expect(closed).toHaveBeenCalledOnce();
  });
  it("shows an honest pending/empty result, hides single-page controls and exits by Escape", async () => {
    const test = bodySetup(); test.setReady(false); const pending = await test.service.source(test.path, test.text);
    const close = openBodyLinkDiagnostics(document, createTranslator("zh-CN", "en"), pending, vi.fn(), vi.fn());
    expect(document.body.textContent).toContain("请稍后重试"); expect(document.querySelector(".link-integrity-body-diagnostic")).toBeNull(); close();
    test.setReady(true); const ready = await test.service.source(test.path, test.text);
    const dialogClose = openBodyLinkDiagnostics(document, createTranslator("en", "en"), { ...ready, hints: [] }, vi.fn(), vi.fn());
    expect(document.body.textContent).toContain("No confirmed"); expect(document.body.textContent).not.toContain("Next");
    document.querySelector("dialog")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })); expect(document.querySelector("dialog")).toBeNull(); dialogClose();
  });
});
