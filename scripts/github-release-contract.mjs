import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assertReleaseVersion } from "./release-contract.mjs";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";
const PUBLISHED_STABLE_PATTERN = /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

export function compareStableVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart.length !== rightPart.length) return Math.sign(leftPart.length - rightPart.length);
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function selectReleaseHistory(releases, candidateTag, { allowSameTag = false } = {}) {
  assertReleaseVersion(candidateTag, "Candidate version");
  if (!Array.isArray(releases)) throw new Error("GitHub Releases response must be an array");
  const candidateConflicts = releases.filter((release) => {
    const tag = release?.tag_name ?? "";
    if (!PUBLISHED_STABLE_PATTERN.test(tag) || tag.replace(/^v/u, "") !== candidateTag) {
      return false;
    }
    return (
      release?.draft !== false ||
      release?.prerelease !== false ||
      typeof release?.published_at !== "string" ||
      release.published_at.length === 0
    );
  });
  if (candidateConflicts.length > 0) {
    const conflicts = candidateConflicts
      .map((release) => release.tag_name)
      .sort()
      .join(", ");
    throw new Error(
      `Candidate ${candidateTag} conflicts with non-published Releases: ${conflicts}`,
    );
  }
  const stable = releases.flatMap((release) => {
    if (
      release?.draft !== false ||
      release?.prerelease !== false ||
      typeof release?.published_at !== "string" ||
      release.published_at.length === 0 ||
      !PUBLISHED_STABLE_PATTERN.test(release?.tag_name ?? "")
    ) {
      return [];
    }
    return [{ release, version: release.tag_name.replace(/^v/u, "") }];
  });
  const seen = new Set();
  for (const { version } of stable) {
    if (seen.has(version)) throw new Error(`Duplicate published stable Release: ${version}`);
    seen.add(version);
  }
  const newer = stable.filter(({ version }) => compareStableVersions(version, candidateTag) > 0);
  const equivalent = stable.filter(({ version }) => version === candidateTag);
  const exactSame = equivalent.filter(({ release }) => release.tag_name === candidateTag);
  const nonCanonicalSame = equivalent.filter(({ release }) => release.tag_name !== candidateTag);
  if (
    newer.length > 0 ||
    nonCanonicalSame.length > 0 ||
    (!allowSameTag && exactSame.length > 0) ||
    exactSame.length > 1
  ) {
    const conflicts = [...newer, ...equivalent]
      .map(({ release }) => release.tag_name)
      .sort()
      .join(", ");
    throw new Error(`Candidate ${candidateTag} is not newer than published stable Releases: ${conflicts}`);
  }
  const lower = stable
    .filter(({ version }) => compareStableVersions(version, candidateTag) < 0)
    .sort((left, right) => compareStableVersions(right.version, left.version));
  return {
    baseline: lower[0]?.release ?? null,
    sameTagRelease: exactSame[0]?.release ?? null,
  };
}

async function main() {
  const [mode, repository, candidateTag] = process.argv.slice(2);
  if (!new Set(["preflight", "release"]).has(mode)) {
    throw new Error("Usage: github-release-contract.mjs <preflight|release> <owner/repo> <x.y.z>");
  }
  assertRepository(repository);
  assertReleaseVersion(candidateTag, "Candidate version");
  const token = requiredEnvironment("GH_TOKEN");
  const releases = await fetchAllReleases(repository, token);
  const history = selectReleaseHistory(releases, candidateTag, {
    allowSameTag: mode === "release",
  });
  if (history.baseline) {
    verifyBaselineAncestry(history.baseline.tag_name, requiredEnvironment("GITHUB_SHA"));
  }
  writeOutput("start_tag", history.baseline?.tag_name ?? "");
  writeOutput("same_tag_release_id", history.sameTagRelease?.id ?? "");
  console.log(
    history.baseline
      ? `Release history verified: ${candidateTag} follows ancestor ${history.baseline.tag_name}`
      : `Release history verified: ${candidateTag} is the first published stable Release`,
  );
}

async function fetchAllReleases(repository, token) {
  const releases = [];
  for (let page = 1; page <= 100; page += 1) {
    const route = `/repos/${repository}/releases?per_page=100&page=${page}`;
    const batch = await fetchJsonWithRetry(route, token, Array.isArray);
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
  throw new Error("GitHub Releases pagination exceeded the fail-closed limit");
}

async function fetchJsonWithRetry(route, token, ready) {
  let lastError = new Error("GitHub API request did not run");
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`${API_ROOT}${route}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "link-integrity-release-history",
          "X-GitHub-Api-Version": API_VERSION,
        },
      });
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 404 &&
        response.status !== 408 &&
        response.status !== 429
      ) {
        throw new DeterministicHttpError(`GitHub API request failed (${response.status}): ${route}`);
      }
      if (!response.ok) throw new Error(`GitHub API request failed (${response.status}): ${route}`);
      const payload = await response.json();
      if (!ready(payload)) throw new Error(`GitHub API returned an unready 200 response: ${route}`);
      return payload;
    } catch (error) {
      if (error instanceof DeterministicHttpError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 5) await delay(attempt * 1_000);
    }
  }
  throw new Error(`GitHub API request did not become ready: ${lastError.message}`);
}

function verifyBaselineAncestry(tag, candidateCommit) {
  if (!PUBLISHED_STABLE_PATTERN.test(tag)) throw new Error(`Invalid baseline tag: ${tag}`);
  if (!/^[0-9a-f]{40}$/u.test(candidateCommit)) {
    throw new Error(`Invalid candidate commit: ${candidateCommit}`);
  }
  const remoteRef = `refs/tags/${tag}`;
  const localRef = `refs/remotes/release-baseline/${tag}`;
  runGitWithRetry(["fetch", "--no-tags", "origin", `+${remoteRef}:${localRef}`], `fetch baseline ${tag}`);
  const baselineCommit = runGit(["rev-parse", `${localRef}^{commit}`]);
  const ancestry = gitResult(["merge-base", "--is-ancestor", baselineCommit, candidateCommit]);
  if (ancestry.status === 1) {
    throw new Error(`Release notes baseline ${tag} is not an ancestor of ${candidateCommit}`);
  }
  requireGitSuccess(ancestry, "verify Release notes baseline ancestry");
}

function runGit(arguments_) {
  const result = gitResult(arguments_);
  requireGitSuccess(result, `git ${arguments_.join(" ")}`);
  return result.stdout.trim();
}

function runGitWithRetry(arguments_, label) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = gitResult(arguments_);
    if (result.status === 0) return result.stdout.trim();
    last = result;
  }
  requireGitSuccess(last, label);
}

function gitResult(arguments_) {
  const result = spawnSync("git", arguments_, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}

function requireGitSuccess(result, label) {
  if (result?.status !== 0) {
    const diagnostic = result?.stderr?.trim() || result?.stdout?.trim() || `exit ${String(result?.status)}`;
    throw new Error(`${label} failed: ${diagnostic}`);
  }
}

function parseVersion(value) {
  assertReleaseVersion(value);
  return value.split(".");
}

function assertRepository(repository) {
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${String(repository ?? "")}`);
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

class DeterministicHttpError extends Error {}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (import.meta.url === entryPoint) await main();
