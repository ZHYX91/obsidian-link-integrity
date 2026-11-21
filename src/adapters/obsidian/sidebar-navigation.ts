import type { EditorPosition } from "obsidian";
import { isScalar, isSeq } from "yaml";
import { WorkScheduler, yieldBrowserTask } from "../../scheduling/work-scheduler";
import type { SourcePosition } from "../../core/model";
import { normalizedBodyText } from "./body-link-port";
import { parseMarkdownSourceAsync } from "./explicit-link-parser";
import { findFrontmatterProperty } from "./frontmatter-navigation";

interface MarkdownResult {
  readonly rawText: string;
  readonly location: Pick<SourcePosition, "line" | "column" | "property"> & { readonly inFrontmatter?: boolean };
}

/** The caller owns the editor and must recheck this exact snapshot after awaiting. */
export async function findCurrentMarkdownResultPosition(
  source: string, result: MarkdownResult, signal?: AbortSignal,
): Promise<EditorPosition | null> {
  const raw = normalizedBodyText(result.rawText);
  if (!raw || signal?.aborted) return null;
  const scheduler = new WorkScheduler({ yieldControl: async () => {
    await yieldBrowserTask();
    signal?.throwIfAborted();
  } });
  try {
    const { line, column, property } = result.location;
    if (property !== null) {
      const selected = await findFrontmatterProperty(source, property, scheduler);
      if (selected === null || signal?.aborted) return null;
      // Never give a mapping's child, a different array entry, or a YAML
      // comment ownership of this diagnostic. Decode quoted/folded scalars.
      const values = isSeq(selected.node) ? selected.node.items : [selected.node];
      for (const value of values) {
        const pause = scheduler.checkpoint();
        if (pause !== null) await pause;
        if (!isScalar(value) || typeof value.value !== "string") continue;
        const scalar = normalizedBodyText(value.value);
        if (scalar.includes(raw) && await containsCurrentReference(scalar, raw, scheduler)) {
          return signal?.aborted ? null : { line: selected.line, ch: 0 };
        }
      }
      return null;
    }
    if (line === null || !Number.isInteger(line) || line < 0 ||
      (column !== null && (!Number.isInteger(column) || column < 0))) return null;
    const confirmed = await containsCurrentReference(source, raw, scheduler, {
      line, column, inFrontmatter: result.location.inFrontmatter === true,
    });
    return confirmed && !signal?.aborted ? { line, ch: column ?? 0 } : null;
  } catch (error) {
    if (signal?.aborted) return null;
    throw error;
  }
}

async function containsCurrentReference(source: string, raw: string, scheduler: WorkScheduler,
  position?: { line: number; column: number | null; inFrontmatter: boolean }): Promise<boolean> {
  const accepts = (start: number, lines: readonly { start: number; contentEnd: number }[]): boolean => {
    if (!position) return true;
    const line = lines[position.line];
    return line !== undefined && start >= line.start && start <= line.contentEnd &&
      (position.column === null || start === line.start + position.column);
  };
  let native = false;
  // The host owns reference-style destinations. Witness their complete span
  // and active definition without adding fallback graph edges.
  const properties = position?.inFrontmatter ? "include" : "skip";
  const { references, lines, frontmatterEnd } = await parseMarkdownSourceAsync(source, scheduler, properties, (start, end, lines) => {
    if (!native && accepts(start, lines) && normalizedBodyText(source.slice(start, end)) === raw) native = true;
  });
  if (native && !position?.inFrontmatter) return true;
  for (const reference of references) {
    if ((!position || (reference.startOffset < frontmatterEnd) === position.inFrontmatter) &&
      accepts(reference.startOffset, lines) && normalizedBodyText(reference.raw) === raw) return true;
    const pause = scheduler.checkpoint();
    if (pause !== null) await pause;
  }
  return false;
}
