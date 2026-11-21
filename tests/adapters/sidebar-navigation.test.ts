import { describe, expect, it } from "vitest";
import { findCurrentMarkdownResultPosition as locate } from "../../src/adapters/obsidian/sidebar-navigation";

const result = (rawText: string, line: number | null, column: number | null, property: string | null = null) =>
  ({ rawText, location: { line, column, property, canvasNodeId: null } });

describe("sidebar source navigation", () => {
  it.each(["\n", "\r\n", "\r"])("proves the current token and preserves UTF-16 coordinates with %j", async (eol) => {
    const saved = ["intro", "😀 [[Missing]]", "end"];
    const diagnostic = result("[[Missing]]", 1, 3);
    expect(await locate(saved.join(eol), diagnostic)).toEqual({ line: 1, ch: 3 });
    for (const [open, close] of [["```", "```"], ["~~~", "~~~"], ["%%", "%%"], ["<!--", "-->"],
      ["<script>", "</script>"], ["$$", "$$"]]) {
      expect(await locate([open, saved[1], close].join(eol), diagnostic)).toBeNull();
    }
    expect(await locate("prefix \\[[Missing]]", result("[[Missing]]", 0, 8))).toBeNull();
    expect(await locate("![[Missing]]", result("[[Missing]]", 0, 1))).toBeNull();
    expect(await locate(["---", 'x: "[[Missing]]"', "---"].join(eol), result("[[Missing]]", 1, 4))).toBeNull();
    expect(await locate(saved.join(eol), result("[[Missing]]", 0, null))).toBeNull();
    expect(await locate(saved.join(eol), result("[[Missing]]", 1, null))).toEqual({ line: 1, ch: 0 });
    expect(await locate(["[first", "second](file)"].join(eol), result("[first\nsecond](file)", 0, 0)))
      .toEqual({ line: 0, ch: 0 });
  });

  it.each(["[some **text**][ref]", "[ref][]", "[ref]", "![Some `formatted` text][ref]"])(
    "retains native %s only while its definition is active", async (raw) => {
      expect(await locate(`${raw}\n\n[ref]: Missing`, result(raw, 0, 0))).toEqual({ line: 0, ch: 0 });
      expect(await locate(`${raw}\n\n` + "```\n[ref]: Missing\n```", result(raw, 0, 0))).toBeNull();
    });
  it("retains native inline links whose label contains formatting", async () => {
    const raw = "[text with `sample` and **bold**](Missing)";
    expect(await locate(raw, result(raw, 0, 0))).toEqual({ line: 0, ch: 0 });
  });

  it.each(["\n", "\r\n", "\r"])("checks actual decoded YAML values with %j", async (eol) => {
    const yaml = (lines: string[]) => ["---", ...lines, "---", "[[Missing]]"].join(eol);
    const nav = (lines: string[], key: string, raw = "[[Missing]]") =>
      locate(yaml(lines), result(raw, null, null, key));
    expect(await nav(['target: "[[Fixed]]" # [[Missing]]', 'other: "[[Missing]]"'], "target")).toBeNull();
    expect(await nav(['"a.b": "[[Missing]]"'], "a.b")).toEqual({ line: 1, ch: 0 });
    expect(await nav(['"a.b": "[[Missing]]"', 'a: { b: "[[Missing]]" }'], "a.b")).toBeNull();
    const sequence = ["items:", '  - "[[Missing]]"', '  - "[[Fixed]]"'];
    expect(await nav(sequence, "items")).toEqual({ line: 1, ch: 0 });
    expect(await nav(sequence, "items.0")).toEqual({ line: 2, ch: 0 });
    expect(await nav(sequence, "items.1")).toBeNull();
    expect(await nav(["nested:", '  other: "[[Missing]]"'], "nested")).toBeNull();
    expect(await nav(["target: '`[[Missing]]`'"], "target")).toBeNull();
    expect(await nav(['target: "\\x5b[Missing]]"'], "target")).toEqual({ line: 1, ch: 0 });
    expect(await nav(["notes: |", "  [use `this`](Missing)"], "notes", "[use `this`](Missing)"))
      .toEqual({ line: 1, ch: 0 });
  });

  it("resolves large property maps in chunks and detects duplicates across groups", async () => {
    const keys = Array.from({ length: 2000 }, (_, index) => `key${index}: value`);
    const source = (tail: string) => ["---", ...keys, tail, "---", "body"].join("\n");
    const hit = result("[[Missing]]", null, null, "target");
    expect(await locate(source('target: "[[Missing]]"'), hit)).toEqual({ line: 2001, ch: 0 });
    expect(await locate(source('target: "[[Missing]]"\nkey0: duplicate'), hit)).toBeNull();
    const controller = new AbortController();
    const pending = locate(source('target: "[[Missing]]"'), hit, controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
  });

  it("abandons superseded work on large editor snapshots", async () => {
    const controller = new AbortController();
    const pending = locate("[[Missing]]\n".repeat(25000), result("[[Missing]]", 0, 0), controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
  });
});
