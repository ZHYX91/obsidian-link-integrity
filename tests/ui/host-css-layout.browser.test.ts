import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const LAYOUT_RESULT_PATTERN = /<pre id="layout-results">([^<]+)<\/pre>/u;

interface LayoutMeasurements {
  readonly checkbox: {
    readonly height: number;
    readonly targetHeight: number;
    readonly targetWidth: number;
    readonly width: number;
  };
  readonly narrow: {
    readonly clientWidth: number;
    readonly scrollWidth: number;
  };
  readonly result: {
    readonly badgeWidth: number;
    readonly clientHeight: number;
    readonly lineOverlap: boolean;
    readonly mainWidth: number;
    readonly rowClientWidth: number;
    readonly rowScrollWidth: number;
    readonly scrollHeight: number;
  };
  readonly rtl: {
    readonly paddingInlineEnd: number;
    readonly paddingInlineStart: number;
  };
  readonly rule: {
    readonly clientWidth: number;
    readonly scrollWidth: number;
  };
  readonly summaryDisplay: string;
  readonly surfaces: {
    readonly resultBackground: string;
    readonly resultShadow: string;
    readonly tabBackground: string;
    readonly tabShadow: string;
  };
}

describe("Obsidian host CSS layout contract", () => {
  let measurements: LayoutMeasurements;

  beforeAll(async () => {
    measurements = await renderLayoutMeasurements();
  }, 30_000);

  it("keeps multi-line result content inside its row", () => {
    expect(measurements.result.lineOverlap).toBe(false);
    expect(measurements.result.scrollHeight).toBeLessThanOrEqual(
      measurements.result.clientHeight,
    );
    expect(measurements.result.rowScrollWidth).toBeLessThanOrEqual(
      measurements.result.rowClientWidth,
    );
    expect(measurements.result.badgeWidth).toBeLessThanOrEqual(
      measurements.result.mainWidth,
    );
  });

  it("preserves square host checkboxes and disclosure markers", () => {
    expect(Math.abs(
      measurements.checkbox.width - measurements.checkbox.height,
    )).toBeLessThanOrEqual(1);
    expect(measurements.checkbox.width).toBeLessThanOrEqual(24);
    expect(measurements.checkbox.targetHeight).toBeGreaterThanOrEqual(34);
    expect(measurements.checkbox.targetWidth).toBeGreaterThanOrEqual(34);
    expect(measurements.summaryDisplay).toBe("list-item");
  });

  it("keeps flat plugin surfaces above the host button defaults", () => {
    expect(measurements.surfaces.resultBackground).toBe("rgba(0, 0, 0, 0)");
    expect(measurements.surfaces.resultShadow).toBe("none");
    expect(measurements.surfaces.tabBackground).toBe("rgba(0, 0, 0, 0)");
    expect(measurements.surfaces.tabShadow).toBe("none");
  });

  it("contains narrow sidebar and rule editor content", () => {
    expect(measurements.narrow.scrollWidth).toBeLessThanOrEqual(
      measurements.narrow.clientWidth,
    );
    expect(measurements.rule.scrollWidth).toBeLessThanOrEqual(
      measurements.rule.clientWidth,
    );
  });

  it("uses logical indentation for RTL file formats", () => {
    expect(measurements.rtl.paddingInlineStart).toBeGreaterThan(
      measurements.rtl.paddingInlineEnd,
    );
  });
});

async function renderLayoutMeasurements(): Promise<LayoutMeasurements> {
  const chromePath = await findChromeExecutable();
  if (chromePath === null) {
    throw new Error(
      "Chrome or Chromium is required for the host CSS layout contract. " +
      "Set LINK_INTEGRITY_CHROME_PATH to its executable.",
    );
  }
  const pluginCss = await readFile(path.join(PROJECT_ROOT, "styles.css"), "utf8");
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "link-integrity-layout-"));
  const htmlPath = path.join(tempDirectory, "layout.html");
  const profilePath = path.join(tempDirectory, "profile");
  try {
    await writeFile(htmlPath, createLayoutDocument(pluginCss), "utf8");
    const { stdout } = await execFileAsync(chromePath, [
      "--headless=new",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-gpu",
      "--no-first-run",
      "--no-sandbox",
      `--user-data-dir=${profilePath}`,
      "--dump-dom",
      pathToFileURL(htmlPath).href,
    ], { maxBuffer: 4 * 1024 * 1024, timeout: 20_000 });
    const match = LAYOUT_RESULT_PATTERN.exec(stdout);
    if (match?.[1] === undefined) {
      throw new Error(`Chromium did not emit layout measurements:\n${stdout.slice(0, 1_000)}`);
    }
    return JSON.parse(match[1]) as LayoutMeasurements;
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

async function findChromeExecutable(): Promise<string | null> {
  const candidates = [
    process.env.LINK_INTEGRITY_CHROME_PATH,
    process.env.CHROME_PATH,
    process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : undefined,
    process.platform === "win32"
      ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      : undefined,
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined,
    process.platform === "darwin"
      ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      : undefined,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.length === 0) continue;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next supported browser location.
    }
  }
  return null;
}

function createLayoutDocument(pluginCss: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
:root {
  --background-modifier-border: #3d444d;
  --background-modifier-border-hover: #4b535d;
  --background-modifier-hover: #343b44;
  --background-primary: #171b21;
  --button-radius: 5px;
  --checkbox-border-color: #888;
  --checkbox-radius: 3px;
  --checkbox-size: 18px;
  --color-cyan: #53c9d8;
  --color-orange: #f0a54a;
  --font-monospace: monospace;
  --font-ui-medium: 16px;
  --font-ui-small: 14px;
  --font-ui-smaller: 12px;
  --input-font-weight: 400;
  --input-height: 30px;
  --input-shadow: 0 1px 2px #0008;
  --input-shadow-hover: 0 1px 3px #000a;
  --interactive-accent: #6d8cff;
  --interactive-hover: #3a424d;
  --interactive-normal: #303741;
  --line-height-tight: 1.25;
  --radius-s: 4px;
  --size-2-1: 2px;
  --size-2-2: 4px;
  --size-2-3: 6px;
  --size-4-1: 4px;
  --size-4-2: 8px;
  --size-4-3: 12px;
  --size-4-4: 16px;
  --size-4-6: 24px;
  --size-4-8: 32px;
  --text-faint: #7f8792;
  --text-muted: #a5aeb9;
  --text-normal: #e6e9ed;
  --text-on-accent: white;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--background-primary); color: var(--text-normal); }
button {
  display: inline-flex;
  height: var(--input-height);
  align-items: center;
  justify-content: center;
  padding: var(--size-4-1) var(--size-4-3);
  border: 0;
  border-radius: var(--button-radius);
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: nowrap;
}
button:not(.clickable-icon) {
  background-color: var(--interactive-normal);
  box-shadow: var(--input-shadow);
}
input[type="checkbox"] {
  width: var(--checkbox-size);
  height: var(--checkbox-size);
  padding: 0;
  margin: 0 6px 0 0;
  border: 1px solid var(--checkbox-border-color);
  border-radius: var(--checkbox-radius);
  appearance: none;
}
select, input[type="text"], input[type="search"] { height: var(--input-height); }
${pluginCss.replaceAll("</style", "<\\/style")}
</style>
</head>
<body>
<section class="link-integrity-sidebar" id="result-fixture" style="width: 250px">
  <ul class="link-integrity-result-list">
    <li class="link-integrity-result-row" id="result-row">
      <button class="link-integrity-result-main" id="result-main" type="button">
        <span class="link-integrity-result-path" id="result-path">Очень/длинный/путь/к/изолированному/файлу.md</span>
        <span class="link-integrity-confidence is-low" id="result-badge">Ожидаемо изолирован · содержит неработающих ссылок: 123</span>
      </button>
      <button class="link-integrity-more-button" type="button">…</button>
    </li>
  </ul>
</section>
<section class="link-integrity-sidebar" id="narrow-fixture" style="width: 220px">
  <div class="link-integrity-sidebar-root" style="container: none">
  <div class="link-integrity-tabs">
    <button class="link-integrity-tab" id="inactive-tab" type="button">Неработающие ссылки</button>
  </div>
  <div class="link-integrity-panel">
    <div class="link-integrity-status-row is-stale">
      <div class="link-integrity-status">Результаты могут быть устаревшими</div>
      <button type="button">Повторить перестроение</button>
    </div>
    <label class="link-integrity-advanced-toggle">
      <input id="square-checkbox" type="checkbox">
      <span>Показывать ожидаемо изолированные файлы</span>
      <span class="link-integrity-count">123</span>
    </label>
    <div class="link-integrity-file-types-actions">
      <button type="button">Выбрать все</button>
      <button type="button">Очистить</button>
      <button type="button">Восстановить значения по умолчанию</button>
    </div>
    <details class="link-integrity-file-type-category">
      <summary id="category-summary">
        <label class="link-integrity-checkbox-target" id="category-checkbox-target">
          <input type="checkbox">
        </label>
        Изображения
      </summary>
    </details>
    <ul class="link-integrity-isolated-tree">
      <li><details><summary>FolderNameWithoutAnyPossibleNaturalBreak012345678901234567890123456789</summary></details></li>
    </ul>
  </div>
  </div>
</section>
<section class="link-integrity-settings-custom-body" id="rule-fixture" style="width: 450px">
  <div class="link-integrity-rule-pattern">
    <select><option>Регулярное выражение</option></select>
    <select><option>Полный путь</option></select>
    <input type="text" value="^(a-very-long-pattern)$">
    <input class="link-integrity-regex-flags" type="text" value="iu">
    <button type="button">Удалить</button>
  </div>
</section>
<section class="link-integrity-sidebar" dir="rtl" id="rtl-fixture" style="width: 250px">
  <div class="link-integrity-file-format-list" id="rtl-format-list">
    <label class="link-integrity-file-format"><input type="checkbox"><span>JPEG</span></label>
  </div>
</section>
<pre id="layout-results"></pre>
<script>
  const resultMain = document.getElementById("result-main");
  const resultRow = document.getElementById("result-row");
  const resultBadge = document.getElementById("result-badge");
  const resultPath = document.getElementById("result-path");
  const checkbox = document.getElementById("square-checkbox").getBoundingClientRect();
  const checkboxTarget = document.getElementById("category-checkbox-target").getBoundingClientRect();
  const narrow = document.getElementById("narrow-fixture");
  const rule = document.getElementById("rule-fixture");
  const rtlStyle = getComputedStyle(document.getElementById("rtl-format-list"));
  const resultStyle = getComputedStyle(resultMain);
  const tabStyle = getComputedStyle(document.getElementById("inactive-tab"));
  const measurements = {
    checkbox: {
      height: checkbox.height,
      targetHeight: checkboxTarget.height,
      targetWidth: checkboxTarget.width,
      width: checkbox.width,
    },
    narrow: { clientWidth: narrow.clientWidth, scrollWidth: narrow.scrollWidth },
    result: {
      badgeWidth: resultBadge.getBoundingClientRect().width,
      clientHeight: resultMain.clientHeight,
      lineOverlap: resultPath.getBoundingClientRect().bottom > resultBadge.getBoundingClientRect().top,
      mainWidth: resultMain.getBoundingClientRect().width,
      rowClientWidth: resultRow.clientWidth,
      rowScrollWidth: resultRow.scrollWidth,
      scrollHeight: resultMain.scrollHeight,
    },
    rtl: {
      paddingInlineEnd: Number.parseFloat(rtlStyle.paddingInlineEnd),
      paddingInlineStart: Number.parseFloat(rtlStyle.paddingInlineStart),
    },
    rule: { clientWidth: rule.clientWidth, scrollWidth: rule.scrollWidth },
    summaryDisplay: getComputedStyle(document.getElementById("category-summary")).display,
    surfaces: {
      resultBackground: resultStyle.backgroundColor,
      resultShadow: resultStyle.boxShadow,
      tabBackground: tabStyle.backgroundColor,
      tabShadow: tabStyle.boxShadow,
    },
  };
  document.getElementById("layout-results").textContent = JSON.stringify(measurements);
</script>
</body>
</html>`;
}
