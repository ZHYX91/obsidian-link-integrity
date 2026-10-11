import type { LinkIndex } from "../core/link-index";
import { createOccurrenceIgnoreContext, IgnoreService } from "../shared/ignore-rules";
import type { LinkIntegritySettings } from "../shared/settings";
import type { BrokenLinkDiagnostic } from "../features/queries/broken-links";

/** One visibility policy for the sidebar and confirmed body diagnostics. */
export function isBrokenDiagnosticVisible(diagnostic: BrokenLinkDiagnostic, index: LinkIndex,
  settings: LinkIntegritySettings, ignore = new IgnoreService(settings.ignoreRules)): boolean {
  const enabled = diagnostic.reason === "missing-file" ? settings.brokenLinks.diagnostics.missingFiles
    : diagnostic.reason === "missing-heading" ? settings.brokenLinks.diagnostics.missingHeadings
    : diagnostic.reason === "missing-block" ? settings.brokenLinks.diagnostics.missingBlocks
    : settings.brokenLinks.diagnostics.invalidLinks;
  return enabled && (settings.brokenLinks.showIgnored || !ignore.shouldHideBrokenResult(createOccurrenceIgnoreContext(
    diagnostic.occurrence, index.getFile(diagnostic.sourcePath)?.extension ?? null,
  )));
}
