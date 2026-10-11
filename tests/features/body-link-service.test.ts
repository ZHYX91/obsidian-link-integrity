import { describe, expect, it, vi } from "vitest";
import { BodyLinkService } from "../../src/features/body-links/body-link-service";
import { createFileRecord } from "../../src/core";
import { bodySetup } from "../helpers/body-links";

describe("body projection lifecycle and visibility", () => {
  it("reads only the requested source, shares proof and preserves graph/isolation", async () => {
    const test = bodySetup(); const enumeration = vi.spyOn(test.index, "iterateFiles"); const before = test.index.toCanonicalState();
    await Promise.all([test.service.source(test.path, test.text), test.service.source(test.path, test.text)]);
    expect(test.app.vault.cachedRead).toHaveBeenCalledOnce(); expect(enumeration).not.toHaveBeenCalled();
    expect(test.index.toCanonicalState()).toEqual(before);
  });
  it("shares sidebar diagnostic toggles and ignore policy", async () => {
    const test = bodySetup(); Object.assign(test.settings.brokenLinks.diagnostics, { missingFiles: false });
    expect((await test.service.source(test.path, test.text)).hints).toEqual([]);
    Object.assign(test.settings.brokenLinks.diagnostics, { missingFiles: true }); test.service.invalidate();
    Object.assign(test.settings, { ignoreRules: [{ id: "hide", enabled: true, scope: "hide-broken-result", matcher: { kind: "source-path", value: test.path }, createdAt: 1, note: "" }] });
    expect((await test.service.source(test.path, test.text)).hints).toEqual([]);
    Object.assign(test.settings.brokenLinks, { showIgnored: true }); test.service.invalidate(); expect((await test.service.source(test.path, test.text)).hints).toHaveLength(1);
  });
  it("keeps pending requests non-diagnostic and aborts on invalidation including uncached large text", async () => {
    const test = bodySetup(); test.setReady(false);
    expect((await test.service.source(test.path, test.text)).state).toBe("pending"); expect(test.app.vault.cachedRead).not.toHaveBeenCalled();
    let release!: () => void; let signal!: AbortSignal;
    const service = new BodyLinkService(() => test.index, () => true, {
      proveSource: async (_path, _text, _snapshot, input) => { signal = input; await new Promise<void>((resolve) => { release = resolve; }); return []; }, isConfirmed: () => true,
    });
    const promise = service.source(test.path, "x".repeat(2_000_001)); service.invalidate(); expect(signal.aborted).toBe(true); release(); expect((await promise).state).toBe("pending");
  });
  it("rejects caller cancellation/snapshot replacement", async () => {
    const test = bodySetup(); const abort = new AbortController(); abort.abort(); expect((await test.service.source(test.path, test.text, abort.signal)).state).toBe("pending");
    let resolve!: (value: []) => void;
    const port = { proveSource: vi.fn(() => new Promise<[]>((done) => { resolve = done; })), isConfirmed: () => true };
    const service = new BodyLinkService(() => test.index, () => true, port);
    const promise = service.source(test.path, test.text); test.index.replaceSourceSnapshot(test.path, { sourcePath: test.path, occurrences: [] }); resolve([]);
    expect((await promise).state).toBe("pending");
  });
  it("shares oversized in-flight proof/projection but retains no completed body", async () => {
    const test = bodySetup(); const text = "x".repeat(2_000_001); let release!: () => void;
    const proof = vi.fn(async () => { await new Promise<void>((done) => { release = done; }); return []; });
    const service = new BodyLinkService(() => test.index, () => true, { proveSource: proof, isConfirmed: () => true });
    const requests = Array.from({ length: 50 }, () => service.source(test.path, text));
    expect(proof).toHaveBeenCalledOnce(); release(); const results = await Promise.all(requests);
    expect(new Set(results).size).toBe(1); expect(results[0]!.state).toBe("ready");
    const maps = service as unknown as { cache: Map<string, unknown>; inFlight: Map<string, unknown> };
    expect(maps.cache.size).toBe(0); expect(maps.inFlight.size).toBe(0);
    const next = service.source(test.path, text); expect(proof).toHaveBeenCalledTimes(2); release(); await next;
  });
  it("does not let a superseded oversized request remove or publish its replacement", async () => {
    const test = bodySetup(); const releases: (() => void)[] = []; const signals: AbortSignal[] = [];
    const proof = vi.fn(async (_path: string, _text: string, _snapshot: unknown, signal: AbortSignal) => {
      signals.push(signal); await new Promise<void>((done) => { releases.push(done); }); return [];
    });
    const service = new BodyLinkService(() => test.index, () => true, { proveSource: proof, isConfirmed: () => true });
    const first = service.source(test.path, "a".repeat(2_000_001)); const next = service.source(test.path, "b".repeat(2_000_001));
    expect(signals[0]!.aborted).toBe(true); releases[0]!(); expect((await first).state).toBe("pending");
    const shared = service.source(test.path, "b".repeat(2_000_001)); expect(proof).toHaveBeenCalledTimes(2);
    releases[1]!(); expect(await shared).toBe(await next);
  });
  it("enforces the four-document/total-text cache budget without discarding current results", async () => {
    const test = bodySetup(); const proof = vi.fn(async () => []);
    const service = new BodyLinkService(() => test.index, () => true, { proveSource: proof, isConfirmed: () => true });
    for (let index = 0; index < 5; index += 1) {
      const path = `Note-${index}.md`; test.index.replaceFileRecord(path, createFileRecord(path)); test.index.replaceSourceSnapshot(path, { sourcePath: path, occurrences: [] });
      expect((await service.source(path, "body")).state).toBe("ready");
    }
    expect((service as unknown as { cache: Map<string, unknown> }).cache.size).toBe(4);
    await service.source("Note-0.md", "body"); expect(proof).toHaveBeenCalledTimes(6);
    for (let index = 0; index < 3; index += 1) await service.source(`Note-${index}.md`, "x".repeat(900_000));
    const entries = [...(service as unknown as { cache: Map<string, { text: string }> }).cache.values()];
    expect(entries.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(2_000_000);
  });
  it("never paints invalid, pending or unsupported statuses as errors", async () => {
    const test = bodySetup("[[Missing]]"); const base = test.index.getSourceSnapshot(test.path)!.occurrences[0]!;
    for (const [fileStatus, subpathStatus] of [["invalid", "none"], ["pending", "pending"], ["resolved", "unsupported"]] as const) {
      test.index.replaceSourceSnapshot(test.path, { sourcePath: test.path, occurrences: [{ ...base, fileStatus, subpathStatus, targetPath: fileStatus === "resolved" ? "Target.md" : null }] });
      test.service.invalidate(); expect((await test.service.source(test.path, test.text)).hints).toEqual([]);
    }
  });
});
