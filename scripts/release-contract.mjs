export const RELEASE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

export function assertReleaseVersion(value, label = "Release version") {
  if (typeof value !== "string" || !RELEASE_VERSION_PATTERN.test(value)) {
    throw new Error(`${label} must use x.y.z without a v prefix or leading zeroes`);
  }
  return value;
}

export function assertPackageVersionContract(manifest, packageJson, versions) {
  const version = assertReleaseVersion(manifest?.version, "manifest version");
  if (packageJson?.version !== version) {
    throw new Error("package.json and manifest.json versions must match");
  }
  if (versions?.[version] !== manifest?.minAppVersion) {
    throw new Error("versions.json must map the current version to minAppVersion");
  }
  if (manifest?.id !== "link-integrity") {
    throw new Error("manifest id must be link-integrity");
  }
  if (manifest?.name !== "Link Integrity") {
    throw new Error("manifest name must be Link Integrity");
  }
  if (manifest?.isDesktopOnly !== false) {
    throw new Error("Link Integrity must preserve its desktop and mobile boundary");
  }
  return version;
}

export function assertPackageLockContract(packageJson, packageLock) {
  if (packageLock?.name !== packageJson?.name || packageLock?.version !== packageJson?.version) {
    throw new Error("package-lock root identity must match package.json");
  }
  const root = packageLock?.packages?.[""];
  if (root?.name !== packageJson?.name || root?.version !== packageJson?.version) {
    throw new Error("package-lock root package must match package.json");
  }
  if (root?.engines?.node !== packageJson?.engines?.node) {
    throw new Error("package-lock must preserve the exact Node.js engine");
  }
}

export function assertReleaseTag(releaseTag, packageVersion) {
  assertReleaseVersion(releaseTag, "Release tag");
  if (releaseTag !== packageVersion) {
    throw new Error(
      `Release tag ${releaseTag} does not match package version ${String(packageVersion)}`,
    );
  }
}
