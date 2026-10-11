import { Worker } from "node:worker_threads";
import path from "node:path";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { extractMarkdownNonLinkExclusions, type BodyRange } from "../../src/adapters/obsidian/body-link-syntax";

const oldUrlPattern = /[a-z][a-z0-9+.-]*:\/\/[^\s<>]+|mailto:[^\s<>]+|\bwww\.[^\s<>]+|[\w.+-]+@[\w.-]+\.[\p{L}]{2,}/giu;
const urlCases = ["https://site/a,b", "prefix123http+v1.2://host/x", "MAILTO:me@example.org", "www.example.com, end", "xwww.example.com",
  "mail a+b_c.d-9@foo.bar.co trailing", "a@b", "a@b.c", "a@.com", "a@..com", "a@foo.com+c@d.org", "a@foo.comhttp://dest",
  "xwww.example.com@foo.bar", "a@f.中文", "a@f.abé.cd", "a@f.a1.com-42", "ſ@K.co", "Kttp://x", "www.", "mailto:"];
function oldUrls(text: string): BodyRange[] { return [...text.matchAll(oldUrlPattern)].map((match) => ({ from: match.index, to: match.index + match[0].length })); }
function coverage(text: string, ranges: readonly BodyRange[]): string {
  return Array.from({ length: text.length }, (_, index) => ranges.some((range) => range.from <= index && index < range.to) ? "1" : "0").join("");
}
function randomCases(alphabet: string, count: number): string[] {
  let seed = 731; const cases: string[] = [];
  for (let example = 0; example < count; example += 1) {
    let source = "";
    for (let index = 0; index < 60; index += 1) { seed = Math.imul(seed, 1664525) + 1013904223 >>> 0; source += alphabet[seed % alphabet.length]; }
    cases.push(source);
  }
  return cases;
}

describe("linear body syntax semantics", () => {
  it("preserves URL/email leftmost matching, Unicode TLDs, and negative incomplete addresses", async () => {
    for (const text of [...urlCases, ...randomCases("abcxyzABC0123_+.-@:/!ü中 ", 300)]) expect(await extractMarkdownNonLinkExclusions(text), text).toEqual(oldUrls(text));
  });
  it("preserves incomplete line/EOF and escaped bracket protection without masking complete links", async () => {
    const patterns = [/\\\[[\s\S]*?(?:\\\]|$)/gu, /!?\[[^\]\r\n]*(?=\r|\n|$)/gu, /!?\[[^\]\r\n]*\]\([^\r\n)]*(?=\r|\n|$)/gu];
    const cases = ["[[Missing]]", "[label](Missing)", "[label](Missing", "![[", "[[a]] [[", "[x](a) [tail", "[x]( [y](", "\\[x\\] [[Missing]]", "[tail\r\nbody", ...randomCases("ab[]()!\\\r\n", 300)];
    for (const text of cases) {
      const expected = patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => ({ from: match.index, to: match.index + match[0].length })));
      for (const opening of text.matchAll(/!?\[\[/gu)) if (text.indexOf("]]", opening.index + opening[0].length) < 0) expected.push({ from: opening.index, to: text.length });
      expect(coverage(text, await extractMarkdownNonLinkExclusions(text)), text).toBe(coverage(text, expected));
    }
  });
});

describe("bounded body scanner worker regression", () => {
  let workerSource = "";
  beforeAll(async () => {
    const bundle = await build({ entryPoints: [path.resolve(import.meta.dirname, "../../src/adapters/obsidian/body-link-syntax.ts")],
      bundle: true, write: false, platform: "node", format: "cjs" });
    workerSource = bundle.outputFiles[0]!.text + `
      const { parentPort } = require("node:worker_threads");
      parentPort.on("message", async text => {
        try {
          const started = performance.now();
          const ranges = await module.exports.extractMarkdownNonLinkExclusions(text);
          parentPort.postMessage({ rangeCount: ranges.length, milliseconds: performance.now() - started });
        } catch (error) { parentPort.postMessage({ error: String(error) }); }
      });`;
  });
  const shapes = ["x", "7", ".", "+", "-", "!", ":", "中", "[", "\\[", "[x](", "x7.+-"];
  it.each(shapes)("finishes long %s input in a separately terminable worker", async (shape) => {
    for (const size of [100_000, 200_000]) {
      const source = shape.repeat(Math.ceil(size / shape.length)).slice(0, size);
      const result = await boundedScan(workerSource, source);
      expect(result.error).toBeUndefined(); expect(result.rangeCount).toBeLessThanOrEqual(3);
    }
  });
  it.each(["a@", "x"])("bounds delimiter failure for %s and a large mixed plain body", async (prefix) => {
    const source = prefix === "a@" ? prefix + ".".repeat(200_000) : "x".repeat(200_000) + ":";
    expect((await boundedScan(workerSource, source)).rangeCount).toBe(0);
    expect((await boundedScan(workerSource, "x7.+-".repeat(400_000))).rangeCount).toBe(0);
  });
  it("bounds the two-million-letter source without truncating or hiding ordinary text", async () => {
    expect((await boundedScan(workerSource, "x".repeat(2_000_000))).rangeCount).toBe(0);
  });
});

async function boundedScan(source: string, input: string): Promise<{ rangeCount?: number; error?: string }> {
  const worker = new Worker(source, { eval: true });
  try {
    return await new Promise((resolve, reject) => {
      // A worker watchdog bounds a regression failure; this is not a host latency guarantee.
      const timer = setTimeout(() => { reject(new Error("Body scanner worker exceeded its five-second regression watchdog.")); }, 5_000);
      worker.once("message", (value: { rangeCount?: number; error?: string }) => { clearTimeout(timer); resolve(value); });
      worker.once("error", (error) => { clearTimeout(timer); reject(error); }); worker.postMessage(input);
    });
  } finally { await worker.terminate(); }
}
