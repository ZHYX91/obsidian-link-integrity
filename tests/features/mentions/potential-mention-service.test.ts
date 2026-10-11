import { describe, expect, it, vi } from "vitest";

import { createFileRecord, LinkIndex } from "../../../src/core";
import { PotentialMentionService, MentionRequestCancelledError } from "../../../src/features/mentions/potential-mention-service";
import type { PotentialMentionPort } from "../../../src/features/mentions/ports";
import { extractMarkdownMentionExclusions } from "../../../src/adapters/obsidian/mention-body";
import { createIsolatedFileProjection } from "../../../src/features/queries";
import { occurrence, snapshot } from "../../core/test-helpers";

function setup() {
  const index = new LinkIndex(["Source.md", "Other.md", "白云山.md", "Connected.md"].map((path) => createFileRecord(path)));
  index.replaceSourceSnapshot("Source.md", snapshot("Source.md", [occurrence("real", "Source.md", { targetPath: "Connected.md" })]));
  const content: Record<string, string> = {
    "Source.md": "白云山 [[白云山]] `白云山`", "Other.md": "白云山", "白云山.md": "白云山", "Connected.md": "No mention",
  };
  const port: PotentialMentionPort = {
    collectNames: vi.fn(async () => [{ text: "白云山", targetPath: "白云山.md", kind: "title" as const }]),
    readSource: vi.fn(async (path) => content[path] ?? null),
    excludedRanges: extractMarkdownMentionExclusions,
  };
  const service = new PotentialMentionService(() => index, port);
  return { index, content, port, service };
}

describe("potential mention requests", () => {
  it("does no work before a request and uses supplied unsaved text for the current document", async () => {
    const { service, port } = setup();
    expect(port.collectNames).not.toHaveBeenCalled();
    expect(port.readSource).not.toHaveBeenCalled();
    const result = await service.matchSource("Source.md", "Unsaved 白云山");
    expect(result.matches.map(({ from, text }) => [from, text])).toEqual([[8, "白云山"]]);
    expect(port.readSource).not.toHaveBeenCalled();
    await service.matchSource("Source.md", "白云山\n\n白云山", { from: 5, to: 8 });
    expect(port.collectNames).toHaveBeenCalledTimes(1);
    service.invalidateTargets();
    await service.matchSource("Source.md", "白云山");
    expect(port.collectNames).toHaveBeenCalledTimes(2);
  });

  it("retains the real graph and isolated projection across current matching, reverse scans and source edits", async () => {
    const { service, index, content } = setup();
    const graph = index.toCanonicalState();
    const isolated = createIsolatedFileProjection(index);
    const current = await service.matchSource("Source.md", content["Source.md"] ?? "");
    expect(current.matches).toHaveLength(1);
    const result = await service.reverseLookup("白云山.md");
    expect(result.state).toBe("complete");
    expect(result.sources.map(({ sourcePath }) => sourcePath)).toEqual(["Source.md", "Other.md"]);
    content["Other.md"] = "白云山 白云山";
    service.invalidateSources();
    expect((await service.reverseLookup("白云山.md")).sources[1]?.matches).toHaveLength(2);
    expect(index.toCanonicalState()).toEqual(graph);
    expect(createIsolatedFileProjection(index)).toEqual(isolated);
  });

  it("returns honest partial results on cancellation and retains failed/unknown boundaries", async () => {
    const { service, port } = setup();
    const controller = new AbortController();
    const partial = await service.reverseLookup("白云山.md", {
      signal: controller.signal,
      onProgress: (progress) => { if (progress.checked === 1) controller.abort(); },
    });
    expect(partial).toMatchObject({ state: "cancelled", checked: 1, total: 4 });
    vi.mocked(port.readSource).mockRejectedValueOnce(new Error("read failed"));
    expect((await service.reverseLookup("白云山.md")).state).toBe("failed");
    vi.mocked(port.readSource).mockResolvedValueOnce(null);
    expect((await service.reverseLookup("白云山.md")).state).toBe("stale");
  });

  it("marks alias changes stale and supports independent views with caller cancellation", async () => {
    const { service, port } = setup();
    const reverse = await service.reverseLookup("白云山.md", {
      onProgress: ({ checked }) => { if (checked === 1) service.invalidateTargets(); },
    });
    expect(reverse.state).toBe("stale");
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(port.collectNames).mockImplementationOnce(async () => {
      await waiting;
      return [{ text: "白云山", targetPath: "白云山.md", kind: "alias" }];
    });
    const abort = new AbortController();
    const old = service.matchSource("Source.md", "白云山", undefined, abort.signal);
    const assertion = expect(old).rejects.toBeInstanceOf(MentionRequestCancelledError);
    const latest = service.matchSource("Source.md", "new 白云山");
    const otherView = service.matchSource("Other.md", "白云山");
    abort.abort();
    release();
    await assertion;
    expect((await latest).matches[0]?.from).toBe(4);
    expect((await otherView).matches).toHaveLength(1);
    expect((await service.reverseLookup("白云山.md")).sources.every((source) => source.sourceText === undefined)).toBe(true);
  });
});
