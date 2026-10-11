import { describe, expect, it, vi } from "vitest";
import { bodySourceRange, canonicalBodyDestination } from "../../src/adapters/obsidian/body-link-port";
import { extractMarkdownNonLinkExclusions } from "../../src/adapters/obsidian/body-link-syntax";
import { protectedBodySyntax, ordinaryListBodySyntax } from "../fixtures/body-protected-syntax";
import { bodySetup } from "../helpers/body-links";

describe("current explicit body proof", () => {
  it("projects all three confirmed missing reasons and keeps valid file graph contributions", async () => {
    const test = bodySetup("[[Missing]] [[Target#Heading]] [[Target#^block]] [[Target]]");
    const before = test.index.toCanonicalState();
    const result = await test.service.source(test.path, test.text);
    expect(result.state).toBe("ready"); expect(result.links).toHaveLength(4);
    expect(result.hints.map((hint) => hint.diagnostic.reason)).toEqual(["missing-file", "missing-heading", "missing-block"]);
    expect(test.index.toCanonicalState()).toEqual(before);
    expect(test.index.getOutgoingNeighborCount(test.path)).toBe(1);
  });
  it.each(protectedBodySyntax)("protects %s even when an indexed range is supplied", async (_name, source) => {
    const current = source.replace("白云山", "[[Missing]]");
    const test = bodySetup("[[Missing]]"); const from = current.indexOf("[[Missing]]");
    const prefix = current.slice(0, from); const line = prefix.split("\n").length - 1;
    const column = from - (current.lastIndexOf("\n", from) + 1);
    const occurrence = { ...test.index.getSourceSnapshot(test.path)!.occurrences[0]!, position: { line, column, endLine: line, endColumn: column + 11, property: null, canvasNodeId: null } };
    test.index.replaceSourceSnapshot(test.path, { sourcePath: test.path, occurrences: [occurrence] }); test.bodies.set(test.path, current);
    expect((await test.service.source(test.path, current)).hints).toEqual([]);
  });
  it.each(ordinaryListBodySyntax)("retains normal list links: %s", async (source) => {
    const test = bodySetup(source.replace("白云山", "[[Missing]]"));
    expect((await test.service.source(test.path, test.text)).hints).toHaveLength(1);
  });
  it.each(["~~~\n[[Missing]]\n~~~", "%%\n[[Missing]]\n%%", "---\nfield: '[[Missing]]'\n---", "<!-- [[Missing]] -->", "`[[Missing]]`", "$[[Missing]]$"])("protects non-body syntax: %s", async (text) => {
    const ranges = await extractMarkdownNonLinkExclusions(text); const from = text.indexOf("[[Missing]]");
    expect(ranges.some((range) => range.from <= from && range.to >= from + 11)).toBe(true);
  });
  it("rejects a stale same-offset link after an equal-length prefix becomes a code fence", async () => {
    const test = bodySetup("abc\n[[Missing]]"); const current = "```\n[[Missing]]";
    test.bodies.set(test.path, current);
    expect((await test.service.source(test.path, current)).hints).toEqual([]);
  });
  it("proves normalized CRLF coordinates and rejects changed raw text/cache/file identity", async () => {
    const test = bodySetup("🌤️\r\n[[Missing]]");
    expect((await test.service.source(test.path, test.text.replace(/\r\n/gu, "\n"))).hints[0]?.from).toBe(4);
    test.service.invalidate(); expect((await test.service.source(test.path, "Other\n[[Missing]]")).state).toBe("pending");
    const read = vi.spyOn(test.app.vault, "cachedRead").mockImplementation(async () => { test.caches.set(test.path, {}); return test.text; });
    expect((await test.port.proveSource(test.path, test.text, test.index.getSourceSnapshot(test.path)!, new AbortController().signal))).toBeNull(); read.mockRestore();
  });
  it("does not confirm missing targets while metadata is pending or the target has appeared", async () => {
    const test = bodySetup("[[Missing]] [[Target#Heading]]"); const source = await test.service.source(test.path, test.text);
    test.pending.add("Target.md"); expect(test.port.isConfirmed(source.links[1]!)).toBe(false);
    test.files.set("Missing.md", test.files.get("Target.md")!); expect(test.port.isConfirmed(source.links[0]!)).toBe(false);
    delete test.app.metadataCache.unresolvedLinks[test.path]; test.files.delete("Missing.md"); expect(test.port.isConfirmed(source.links[0]!)).toBe(false);
    test.pending.add(test.path); expect(await test.port.proveSource(test.path, test.text, test.index.getSourceSnapshot(test.path)!, new AbortController().signal)).toBeNull();
  });
  it("rejects absent metadata, cancelled proof, malformed offsets and encoded destinations", async () => {
    const test = bodySetup(); const abort = new AbortController(); abort.abort();
    expect(await test.port.proveSource(test.path, test.text, test.index.getSourceSnapshot(test.path)!, abort.signal)).toBeNull();
    test.caches.delete(test.path); expect((await test.service.source(test.path, test.text)).state).toBe("pending");
    expect(bodySourceRange("x", [0], null)).toBeNull();
    expect(bodySourceRange("x", [0], { line: 0, column: -1, endLine: 0, endColumn: 1, property: null, canvasNodeId: null })).toBeNull();
    expect(canonicalBodyDestination("%GG")).toBeNull(); expect(canonicalBodyDestination("Target%23Heading")).toBe('["Target","#Heading"]');
  });
});
