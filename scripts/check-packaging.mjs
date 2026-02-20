#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const fromPrepack = args.has("--prepack");

const MAX_PACK_SIZE_BYTES = 6 * 1024 * 1024; // 6MB
const MAX_ENTRY_COUNT = 240;

const REQUIRED_PATHS = [
  "packages/cli/src/main.ts",
  "packages/core/src/index.ts",
  "packages/daemon/src/main.ts",
  "packages/daemon/src/db/schema.sql",
  "packages/providers/claude-code/src/index.ts",
  "packages/web/dist/index.html",
];

const FORBIDDEN_PATTERNS = [
  { regex: /^docs\//, reason: "documentation should not ship in runtime package" },
  { regex: /^test\//, reason: "test fixtures should not ship in runtime package" },
  { regex: /^scripts\/tests\//, reason: "test scripts should not ship in runtime package" },
  { regex: /^scripts\/bench\//, reason: "benchmark scripts should not ship in runtime package" },
  {
    regex: /(^|\/)\.explorations\//,
    reason: "exploration notes should not ship in runtime package",
  },
  { regex: /^\.github\//, reason: "CI metadata should not ship in runtime package" },
  { regex: /^\.vscode\//, reason: "editor metadata should not ship in runtime package" },
  { regex: /^assets\//, reason: "design-source assets should not ship in runtime package" },
  { regex: /^logo\.png$/, reason: "design-source assets should not ship in runtime package" },
  { regex: /\.test\.[cm]?[jt]sx?$/, reason: "test files should not ship in runtime package" },
  {
    regex: /\.example\.[cm]?[jt]sx?$/,
    reason: "example source files should not ship in runtime package",
  },
  {
    regex: /(^|\/)(example|demo)\.[cm]?[jt]sx?$/,
    reason: "demo/example helper files should not ship in runtime package",
  },
];

function fail(message) {
  console.error(`\n[pack:check] ERROR: ${message}\n`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });

  if (result.error) {
    fail(`failed to run '${command} ${commandArgs.join(" ")}': ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stdout = result.stdout?.trim();
    const stderr = result.stderr?.trim();
    fail(
      [
        `command failed (${result.status}): ${command} ${commandArgs.join(" ")}`,
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    );
  }

  return result;
}

function assertNoStaleTarballs() {
  const staleTarballs = readdirSync(ROOT_DIR).filter((entry) => /^codepiper-.*\.tgz$/u.test(entry));
  if (staleTarballs.length > 0) {
    fail(
      `found existing release tarball(s) in repo root: ${staleTarballs.join(
        ", "
      )}\nRemove them before packing to avoid recursive artifact inclusion.`
    );
  }
}

function buildWebIfNeeded() {
  if (skipBuild) return;
  console.log("[pack:check] building web assets (packages/web/dist)...");
  const result = run("bun", ["run", "build:web"], { stdio: "inherit" });
  if (result.status !== 0) {
    fail("bun run build:web failed");
  }
}

function assertWebDistExists() {
  const webIndexPath = join(ROOT_DIR, "packages/web/dist/index.html");
  if (!existsSync(webIndexPath)) {
    fail(
      `missing required web asset: ${webIndexPath}\n` +
        "Run 'bun run build:web' and ensure dist artifacts are generated before publishing."
    );
  }
}

function runPackDryRun() {
  const packDir = mkdtempSync(join(tmpdir(), "codepiper-pack-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "codepiper-npm-cache-"));

  try {
    const result = run("npm", [
      "pack",
      "--json",
      "--ignore-scripts",
      "--cache",
      cacheDir,
      "--pack-destination",
      packDir,
    ]);

    let metadata;
    try {
      const parsed = JSON.parse(result.stdout);
      metadata = Array.isArray(parsed) ? parsed[0] : parsed;
    } catch (error) {
      fail(
        `could not parse npm pack JSON output: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!(metadata && Array.isArray(metadata.files))) {
      fail("npm pack JSON did not include file metadata");
    }

    return metadata;
  } finally {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

function assertRequiredPaths(filePaths) {
  for (const requiredPath of REQUIRED_PATHS) {
    if (!filePaths.includes(requiredPath)) {
      fail(`required runtime path missing from package: ${requiredPath}`);
    }
  }
}

function assertForbiddenPaths(filePaths) {
  const violations = [];
  for (const filePath of filePaths) {
    for (const { regex, reason } of FORBIDDEN_PATTERNS) {
      if (regex.test(filePath)) {
        violations.push(`${filePath} (${reason})`);
        break;
      }
    }
  }

  if (violations.length > 0) {
    const preview = violations.slice(0, 15).join("\n  - ");
    const remainder = violations.length > 15 ? `\n  ...and ${violations.length - 15} more` : "";
    fail(`forbidden files were included in package:\n  - ${preview}${remainder}`);
  }
}

function assertSizeAndEntryCount(metadata) {
  if (typeof metadata.size === "number" && metadata.size > MAX_PACK_SIZE_BYTES) {
    fail(
      `package tarball is too large (${metadata.size} bytes > ${MAX_PACK_SIZE_BYTES} bytes threshold)\n` +
        "Review package.json 'files' allowlist and packaged assets."
    );
  }

  if (typeof metadata.entryCount === "number" && metadata.entryCount > MAX_ENTRY_COUNT) {
    fail(
      `package contains too many files (${metadata.entryCount} > ${MAX_ENTRY_COUNT})\n` +
        "Review package.json 'files' allowlist and packaged assets."
    );
  }
}

function main() {
  console.log(
    `[pack:check] starting (${fromPrepack ? "prepack mode" : "manual mode"}${skipBuild ? ", skip build" : ""})`
  );

  assertNoStaleTarballs();
  buildWebIfNeeded();
  assertWebDistExists();

  const metadata = runPackDryRun();
  const filePaths = metadata.files.map((file) => file.path);

  assertRequiredPaths(filePaths);
  assertForbiddenPaths(filePaths);
  assertSizeAndEntryCount(metadata);

  console.log(
    `[pack:check] ok: ${metadata.filename} (${metadata.size} bytes, ${metadata.entryCount} files, ${metadata.unpackedSize} bytes unpacked)`
  );
}

main();
