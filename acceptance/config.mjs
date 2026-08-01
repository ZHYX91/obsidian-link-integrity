import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));

function git(...arguments_) {
  return execFileSync("git", arguments_, {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

if (git("status", "--porcelain").length > 0) {
  throw new Error("Isolated-host acceptance requires a clean committed candidate.");
}

export default {
  pluginId: "link-integrity",
  fixturesDirectory: "./fixtures",
  hostProfile: {
    profileId: "windows-desktop-1.12.7-isolated",
    platform: "windows",
    obsidianVersion: "1.12.7",
  },
  candidate: {
    version: manifest.version,
    commit: git("rev-parse", "HEAD^{commit}"),
    tree: git("rev-parse", "HEAD^{tree}"),
    assets: {
      "main.js": "../dist/main.js",
      "manifest.json": "../dist/manifest.json",
      "styles.css": "../dist/styles.css",
    },
  },
};
