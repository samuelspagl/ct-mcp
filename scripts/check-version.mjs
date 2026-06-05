#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const localOnly = args.has("--local");
const errors = [];

const version = readTextFile("VERSION").trim();
const packageJson = readJsonFile("package.json");
const packageLock = readJsonFile("package-lock.json");
const packageVersion = packageJson.version;
const packageLockVersion = packageLock.packages?.[""]?.version;
const tag = `v${version}`;

if (!isSemverWithoutBuildMetadata(version)) {
  errors.push(`VERSION must be valid SemVer without build metadata. Received: ${version || "(empty)"}`);
}

if (packageVersion !== version) {
  errors.push(`VERSION (${version}) must match package.json version (${packageVersion ?? "missing"}).`);
}

if (packageLockVersion !== version) {
  errors.push(`VERSION (${version}) must match package-lock.json root package version (${packageLockVersion ?? "missing"}).`);
}

if (!localOnly) {
  if (remoteTagExists(tag)) {
    errors.push(`Release tag ${tag} already exists. Bump VERSION before opening or merging this PR.`);
  }

  if (isPullRequest()) {
    const baseVersion = readBaseVersion();
    if (baseVersion && baseVersion.trim() === version) {
      errors.push(`VERSION must be changed from the base branch value (${baseVersion.trim()}).`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`::error::${error}`);
  }
  process.exit(1);
}

console.log(`Version check passed for ${version} (${tag}).`);

function readTextFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${path}: ${error.message}`);
  }
}

function readJsonFile(path) {
  try {
    return JSON.parse(readTextFile(path));
  } catch (error) {
    throw new Error(`Unable to parse ${path}: ${error.message}`);
  }
}

function isSemverWithoutBuildMetadata(input) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/.test(input);
}

function isPullRequest() {
  return process.env.GITHUB_EVENT_NAME === "pull_request" && Boolean(process.env.GITHUB_BASE_REF);
}

function remoteTagExists(tagName) {
  const result = spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tagName}`], {
    encoding: "utf8"
  });

  if (result.status === 0) {
    return true;
  }

  if (result.status === 2) {
    return false;
  }

  const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  errors.push(`Unable to check remote tag ${tagName}.${details ? ` ${details}` : ""}`);
  return false;
}

function readBaseVersion() {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (!baseRef) {
    return undefined;
  }

  ensureBaseRefFetched(baseRef);

  const result = spawnSync("git", ["show", `refs/remotes/origin/${baseRef}:VERSION`], {
    encoding: "utf8"
  });

  if (result.status === 0) {
    return result.stdout;
  }

  return undefined;
}

function ensureBaseRefFetched(baseRef) {
  try {
    execFileSync("git", ["fetch", "--no-tags", "origin", `${baseRef}:refs/remotes/origin/${baseRef}`], {
      stdio: "pipe"
    });
  } catch (error) {
    const message = error.stderr?.toString().trim() || error.message;
    errors.push(`Unable to fetch base branch ${baseRef}.${message ? ` ${message}` : ""}`);
  }
}
