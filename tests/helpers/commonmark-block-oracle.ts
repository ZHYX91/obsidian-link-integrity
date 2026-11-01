import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface BlockOracle {
  readonly oracle: { readonly implementation: string; readonly version: string; readonly sourceSha256: string };
  readonly matrix: {
    readonly preamble: string;
    readonly pair: string;
    readonly prefixes: readonly string[];
    readonly blankLines: readonly number[];
    readonly quotePrefixes: readonly string[];
    readonly indents: readonly number[];
    readonly expectedByPrefix: readonly string[];
  };
  readonly examples: readonly { readonly id: string; readonly markdown: string; readonly count: number; readonly html: string }[];
}

/** Frozen official results; normal tests neither download nor execute another parser. */
export const commonmarkBlockOracle = JSON.parse(readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/commonmark-block-oracle.json"), "utf8",
)) as BlockOracle;

export function* commonmarkBlockCases(): Generator<{ readonly source: string; readonly count: number }> {
  const matrix = commonmarkBlockOracle.matrix;
  const width = matrix.blankLines.length * matrix.quotePrefixes.length * matrix.indents.length;
  if (matrix.expectedByPrefix.length !== matrix.prefixes.length) throw new Error("Incomplete block oracle rows");
  for (const [index, prefix] of matrix.prefixes.entries()) {
    const row = matrix.expectedByPrefix[index]!;
    if (row.length !== width || /[^02]/u.test(row)) throw new Error("Invalid block oracle row");
    let column = 0;
    for (const blank of matrix.blankLines) for (const quote of matrix.quotePrefixes) for (const indent of matrix.indents) {
      yield {
        source: matrix.preamble + prefix + "\n" + "\n".repeat(blank) + quote + " ".repeat(indent) + matrix.pair,
        count: Number(row[column++]),
      };
    }
  }
}
