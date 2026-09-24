import { describe, expect, it } from "vitest";

import { compileBoundedRegex } from "../../src/core/bounded-regex";

describe("bounded regex boolean semantics", () => {
  it.each([
    "", "a", "^a$", ".", "[^a]", "[]", "a|ab", "(ab|a)+b", "(?:a?)*",
    "a{0}", "a{2}", "a{1,3}?", "a{2,}", "(ab){1,3}", "^a+a+a+a+a+$",
    "^((a|aa))+$", "^(a+)+$", "a.*b", "\\bword\\b", "\\Ba\\B", "a$",
    "^.$", "😀+", "\\u{1F600}+", "\\uD83D\\uDE00+", "[\\p{L}\\d]+",
    "[\\]\\[]", "\\x61+", "\\cA", "\\0", "^\\s+$", "(a|)b", "^|$",
    "^(?:Daily|Weekly)-\\d{4}-\\d{2}$", "^a{2,4}b{0,2}$", "(a?){3}",
  ])("agrees with native Unicode regex on small inputs: %s", (pattern) => {
    const inputs = ["", "a", "b", "aa", "aab", "ab", "abab", "bbb", "word", " word ",
      "😀", "😀😀", "𐐀", "é", "K", "a\n", "a\r\n", "\n", "\u0001", "\0", "[", "]",
      "Daily-2026-09", "weekly-2026-10"];
    for (let length = 0; length < 5; length += 1) {
      for (let bits = 0; bits < 2 ** length; bits += 1) {
        inputs.push(Array.from({ length }, (_, index) => bits & (1 << index) ? "a" : "b").join(""));
      }
    }
    for (const flags of ["u", "iu"]) {
      const expected = new RegExp(pattern, flags);
      const actual = compileBoundedRegex(pattern, flags);
      for (const input of inputs) expect(actual.test(input), `${flags}: ${JSON.stringify(input)}`)
        .toBe(expected.test(input));
    }
  });

  it.each(["^(a+)+$", "^((a|aa))+$", "^a+a+a+a+a+$", "a*a*a*a*a*b"])(
    "finishes adversarial input without backtracking: %s", (pattern) => {
      const expression = compileBoundedRegex(pattern, "u");
      expect(expression.test(`${"a".repeat(20_000)}!`)).toBe(false);
      expect(expression.test("aaab")).toBe(pattern.endsWith("b"));
    },
  );

  it.each(["(a)\\1", "(?<name>a)\\k<name>", "(?=a)", "(?<=a)", "a{513}",
    "(a{512}){512}", "[", "a".repeat(4097)])("rejects unsupported or oversized patterns", (pattern) => {
    expect(() => compileBoundedRegex(pattern, "u")).toThrow();
  });

  it("rejects stateful flags and retains state across repeated calls only through the pattern", () => {
    expect(() => compileBoundedRegex("a", "g")).toThrow();
    expect(() => compileBoundedRegex("a", "ii")).toThrow();
    const pattern = compileBoundedRegex("^a+$", "");
    expect(["aa", "b", "a"].map((value) => pattern.test(value))).toEqual([true, false, true]);
  });
});
