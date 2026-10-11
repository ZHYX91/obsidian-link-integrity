import { TFile, type App } from "obsidian";
import { vi } from "vitest";
import { createFileRecord, LinkIndex, makeOccurrenceLookupKey, type LinkOccurrence } from "../../src/core";
import { extractMarkdownExplicitReferences } from "../../src/adapters/obsidian/explicit-link-parser";
import { bodyLineStarts, bodyUnresolvedKey, ObsidianBodyLinkPort } from "../../src/adapters/obsidian/body-link-port";
import { BodyLinkService } from "../../src/features/body-links/body-link-service";
import { isBrokenDiagnosticVisible } from "../../src/app/broken-link-visibility";
import { IgnoreService } from "../../src/shared/ignore-rules";
import { createDefaultSettings } from "../../src/shared/settings";

export function bodySetup(text = "[[Missing|Label]]", path = "Source.md") {
  const files = new Map([[path, new (TFile as unknown as new(path: string) => TFile)(path)], ["Target.md", new (TFile as unknown as new(path: string) => TFile)("Target.md")]]);
  const bodies = new Map([[path, text], ["Target.md", "# Existing\n"]]);
  const caches = new Map<string, object>([...files.keys()].map((name) => [name, {}]));
  const pending = new Set<string>();
  const starts = bodyLineStarts(text);
  const lineAt = (offset: number): number => {
    let low = 0; let high = starts.length;
    while (low < high) { const middle = (low + high) >>> 1; if (starts[middle]! <= offset) low = middle + 1; else high = middle; }
    return low - 1;
  };
  const occurrences: LinkOccurrence[] = extractMarkdownExplicitReferences(text).map((reference, id) => {
    const marker = reference.linktext.indexOf("#");
    const linkpath = marker < 0 ? reference.linktext : reference.linktext.slice(0, marker);
    const subpath = marker < 0 ? null : reference.linktext.slice(marker);
    const resolved = linkpath === "Target";
    const line = lineAt(reference.startOffset);
    const endLine = lineAt(reference.endOffset);
    return { id: String(id), sourcePath: path, raw: reference.raw, linkpath, subpath, lookupKey: makeOccurrenceLookupKey(linkpath, path),
      kind: reference.embedded ? "markdown-embed" : "markdown-link", destinationKind: "internal", targetPath: resolved ? "Target.md" : null,
      fileStatus: resolved ? "resolved" : "missing", subpathStatus: resolved && subpath !== null ? subpath.startsWith("#^") ? "missing-block" : "missing-heading" : "none",
      position: { line, column: reference.startOffset - starts[line]!, endLine, endColumn: reference.endOffset - starts[endLine]!, property: null, canvasNodeId: null },
    };
  });
  const app = { vault: { getFileByPath: (name: string) => files.get(name) ?? null, cachedRead: vi.fn(async (file: TFile) => bodies.get(file.path) ?? "") },
    metadataCache: { getFileCache: (file: TFile) => caches.get(file.path) ?? null, getFirstLinkpathDest: (name: string) => files.get(`${name}.md`) ?? null,
      unresolvedLinks: { [path]: Object.fromEntries(occurrences.filter((occurrence) => occurrence.fileStatus === "missing")
        .map((occurrence) => [bodyUnresolvedKey(occurrence.linkpath + (occurrence.subpath ?? "")), 1])) } },
  } as unknown as App;
  const index = new LinkIndex([...files.keys()].map((name) => createFileRecord(name)));
  index.replaceSourceSnapshot(path, { sourcePath: path, occurrences });
  const settings = createDefaultSettings();
  let ready = true;
  const port = new ObsidianBodyLinkPort(app, (name) => !pending.has(name));
  const service = new BodyLinkService(() => index, () => ready, port, (current) => { const ignore = new IgnoreService(settings.ignoreRules); return (diagnostic) => isBrokenDiagnosticVisible(diagnostic, current, settings, ignore); });
  return { app, path, text, bodies, files, caches, pending, index, settings, port, service, setReady: (value: boolean) => { ready = value; } };
}
