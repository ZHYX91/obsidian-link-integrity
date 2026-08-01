import { spawnSync } from "node:child_process";

import { RELEASE_VERSION_PATTERN } from "./release-contract.mjs";

const [mode, releaseTag] = process.argv.slice(2);
if (!new Set(["preflight", "release"]).has(mode) || !RELEASE_VERSION_PATTERN.test(releaseTag ?? "")) {
  throw new Error("Usage: verify-release-source.mjs <preflight|release> <x.y.z>");
}

const expectedCommit = resolveCommit(requiredEnvironment("GITHUB_SHA"));
const checkoutCommit = resolveCommit("HEAD");
if (checkoutCommit !== expectedCommit) {
  throw new Error("The checked-out commit does not match the workflow event commit");
}

const defaultBranch = requiredEnvironment("GITHUB_DEFAULT_BRANCH");
git(["check-ref-format", `refs/heads/${defaultBranch}`]);
const remoteDefaultRef = `refs/heads/${defaultBranch}`;
const localDefaultRef = `refs/remotes/origin/${defaultBranch}`;
const defaultBeforeFetch = resolveSingleRemoteRef(remoteDefaultRef);
remoteGit(["fetch", "--no-tags", "origin", `+${remoteDefaultRef}:${localDefaultRef}`], "default branch fetch");
const fetchedDefaultCommit = resolveCommit(localDefaultRef);
const defaultAfterFetch = resolveSingleRemoteRef(remoteDefaultRef);
if (defaultBeforeFetch !== defaultAfterFetch || fetchedDefaultCommit !== defaultAfterFetch) {
  throw new Error("The remote default branch changed while the release source was being verified");
}

if (mode === "preflight") {
  if (requiredEnvironment("GITHUB_REF") !== `refs/heads/${defaultBranch}`) {
    throw new Error("Release preflight must be dispatched from the repository default branch");
  }
  if (expectedCommit !== fetchedDefaultCommit) {
    throw new Error("Release preflight must run against the current remote default-branch head");
  }
  const tagRef = `refs/tags/${releaseTag}`;
  const existingTag = remoteGit(
    ["ls-remote", "origin", tagRef, `${tagRef}^{}`],
    "unused release tag query",
  );
  if (existingTag.length > 0) {
    throw new Error(`Release preflight requires an unused tag: ${releaseTag}`);
  }
  console.log(
    `Release preflight source verified at ${expectedCommit}: ${defaultBranch}, unused tag ${releaseTag}`,
  );
} else {
  const tagRef = `refs/tags/${releaseTag}`;
  if (requiredEnvironment("GITHUB_REF") !== tagRef) {
    throw new Error(`Release workflow must run from ${tagRef}`);
  }
  const remoteTagCommit = resolveRemoteTagCommit(tagRef);
  if (remoteTagCommit !== expectedCommit) {
    throw new Error("The remote release tag does not point to the workflow event commit");
  }
  const ancestry = gitResult(["merge-base", "--is-ancestor", expectedCommit, fetchedDefaultCommit]);
  if (ancestry.status === 1) {
    throw new Error("The release commit is not reachable from the current remote default branch");
  }
  requireSuccess(ancestry, "git merge-base --is-ancestor");
  console.log(
    `Release source verified at ${expectedCommit}: ${tagRef} is reachable from the default branch`,
  );
}

function resolveCommit(revision) {
  return git(["rev-parse", `${revision}^{commit}`]);
}

function resolveSingleRemoteRef(reference) {
  const output = remoteGit(
    ["ls-remote", "--exit-code", "origin", reference],
    `remote reference query ${reference}`,
  );
  const matches = parseRemoteRefs(output).filter(({ ref }) => ref === reference);
  if (matches.length !== 1) {
    throw new Error(`Remote reference did not resolve exactly once: ${reference}`);
  }
  return matches[0].object;
}

function resolveRemoteTagCommit(tagRef) {
  const output = remoteGit(
    ["ls-remote", "--exit-code", "origin", tagRef, `${tagRef}^{}`],
    `release tag query ${tagRef}`,
  );
  const references = parseRemoteRefs(output);
  const tagObjects = references.filter(({ ref }) => ref === tagRef);
  const peeledCommits = references.filter(({ ref }) => ref === `${tagRef}^{}`);
  if (tagObjects.length !== 1 || peeledCommits.length > 1) {
    throw new Error("The remote release tag did not resolve to one unambiguous object");
  }
  return peeledCommits[0]?.object ?? tagObjects[0].object;
}

function parseRemoteRefs(output) {
  if (!output) return [];
  return output.split(/\r?\n/u).map((line) => {
    const [object, ref, ...extra] = line.split("\t");
    if (!/^[0-9a-f]{40}$/u.test(object ?? "") || !ref || extra.length > 0) {
      throw new Error(`Invalid git ls-remote output: ${line}`);
    }
    return { object, ref };
  });
}

function git(arguments_) {
  const result = gitResult(arguments_);
  requireSuccess(result, `git ${arguments_.join(" ")}`);
  return result.stdout.trim();
}

function remoteGit(arguments_, label) {
  let lastResult;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = gitResult(arguments_);
    if (result.status === 0) return result.stdout.trim();
    lastResult = result;
    if (attempt < 4) console.log(`${label} failed transiently; retrying (${attempt}/4)`);
  }
  requireSuccess(lastResult, label);
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

function requireSuccess(result, label) {
  if (result?.status !== 0) {
    const diagnostic = result?.stderr?.trim() || result?.stdout?.trim() || `exit ${String(result?.status)}`;
    throw new Error(`${label} failed: ${diagnostic}`);
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
