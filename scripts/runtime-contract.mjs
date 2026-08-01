const EXACT_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

export function parseNpmVersion(userAgent) {
  const match = /^npm\/([^\s]+)/u.exec(userAgent ?? "");
  if (match?.[1] == null) {
    throw new Error("npm_config_user_agent must identify the running npm version");
  }
  return match[1];
}
export function assertRuntimeContract({
  configuredNodeVersion,
  currentNodeVersion,
  currentNpmVersion,
  packageJson,
}) {
  if (!EXACT_SEMVER.test(configuredNodeVersion)) {
    throw new Error(".node-version must contain an exact x.y.z version");
  }
  if (packageJson?.engines?.node !== configuredNodeVersion) {
    throw new Error("package.json engines.node must match .node-version exactly");
  }
  if (currentNodeVersion !== configuredNodeVersion) {
    throw new Error(
      `Expected Node.js ${configuredNodeVersion}, received ${currentNodeVersion}`,
    );
  }
  const expectedNpmVersion = String(packageJson?.packageManager ?? "").replace(/^npm@/u, "");
  if (!EXACT_SEMVER.test(expectedNpmVersion)) {
    throw new Error("packageManager must pin npm using npm@x.y.z");
  }
  if (currentNpmVersion !== expectedNpmVersion) {
    throw new Error(`Expected npm ${expectedNpmVersion}, received ${currentNpmVersion}`);
  }
}
