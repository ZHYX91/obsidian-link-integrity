import { describe, expect, it } from "vitest";

import {
  LinkIntegritySidebarView,
  createInitialSidebarState,
  reconcileSidebarState,
} from "../../src/app/sidebar-view";
import { createDefaultSettings, normalizeSettings } from "../../src/shared/settings";

describe("sidebar host state composition", () => {
  it("preserves the host ItemView.open lifecycle method", () => {
    const settings = createDefaultSettings();
    const view = new LinkIntegritySidebarView({} as never, {
      query: {
        getSnapshot: () => ({}) as never,
        subscribe: () => () => undefined,
      },
      navigation: {} as never,
      getSettings: () => settings,
      ensureIndex: () => undefined,
      onViewStateChange: () => undefined,
      onActionError: () => undefined,
    });

    expect(typeof (view as unknown as { open: unknown }).open).toBe("function");
  });

  it("uses product defaults until a concrete UI preference exists", () => {
    const defaults = createDefaultSettings();
    const settings = normalizeSettings({
      ...defaults,
      general: { ...defaults.general, defaultSidebarTab: "isolated-files" },
      brokenLinks: {
        ...defaults.brokenLinks,
        defaultView: "list",
        defaultGrouping: "source",
        defaultSort: "count",
      },
      isolatedFiles: {
        ...defaults.isolatedFiles,
        defaultView: "tree",
        defaultSort: "modified",
      },
    });

    expect(createInitialSidebarState(settings)).toMatchObject({
      activeTab: "isolated-files",
      brokenView: "list",
      brokenGrouping: "source",
      brokenSort: "count",
      isolatedView: "tree",
      isolatedSort: "modified",
    });
  });

  it("prefers an explicit last-used UI choice over a changed default", () => {
    const defaults = createDefaultSettings();
    const settings = normalizeSettings({
      ...defaults,
      general: { ...defaults.general, defaultSidebarTab: "isolated-files" },
      ui: { ...defaults.ui, activeSidebarTab: "broken-links", isolatedSort: "name" },
    });

    expect(createInitialSidebarState(settings)).toMatchObject({
      activeTab: "broken-links",
      isolatedSort: "name",
    });
  });

  it("follows changed defaults and leaves no-incoming mode when the capability is disabled", () => {
    const previous = createDefaultSettings();
    const state = {
      ...createInitialSidebarState(previous),
      isolatedMode: "no-incoming" as const,
    };
    const settings = normalizeSettings({
      ...previous,
      general: { ...previous.general, defaultSidebarTab: "isolated-files" },
      brokenLinks: { ...previous.brokenLinks, defaultSort: "count" },
      isolatedFiles: {
        ...previous.isolatedFiles,
        candidateFormatFamilyIds: ["markdown"],
        allowNoIncomingFilter: false,
        showExpectedIsolatedFiles: true,
      },
    });

    const reconciled = reconcileSidebarState(state, previous, settings);
    expect(reconciled.activeTab).toBe("isolated-files");
    expect(reconciled.brokenSort).toBe("count");
    expect(reconciled.isolatedMode).toBe("isolated");
    expect(reconciled.showExpectedIsolated).toBe(true);
    expect(reconciled.selectedFormatFamilyIds).toEqual(new Set(["markdown"]));
  });

  it("preserves temporary filters that intentionally diverged from their configured defaults", () => {
    const previous = createDefaultSettings();
    const state = {
      ...createInitialSidebarState(previous),
      showExpectedIsolated: true,
      selectedFormatFamilyIds: new Set(["markdown"]),
    };
    const settings = normalizeSettings({
      ...previous,
      isolatedFiles: {
        ...previous.isolatedFiles,
        candidateFormatFamilyIds: ["markdown", "canvas"],
      },
    });

    const reconciled = reconcileSidebarState(state, previous, settings);
    expect(reconciled.showExpectedIsolated).toBe(true);
    expect(reconciled.selectedFormatFamilyIds).toEqual(new Set(["markdown"]));
  });
});
