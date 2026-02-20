#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");

function fail(message) {
  console.error(`\n[pack:smoke] ERROR: ${message}\n`);
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

function main() {
  console.log(`[pack:smoke] starting${skipBuild ? " (skip build)" : ""}`);

  run("bun", ["--version"]);
  run("npm", ["--version"]);

  if (!skipBuild) {
    console.log("[pack:smoke] building web assets...");
    run("bun", ["run", "build:web"], { stdio: "inherit" });
  }

  console.log("[pack:smoke] running packaging allowlist guard...");
  run("bun", ["run", "pack:check:fast"], { stdio: "inherit" });

  const tempRoot = mkdtempSync(join(tmpdir(), "codepiper-pack-smoke-"));
  const packDir = join(tempRoot, "pack");
  const prefixDir = join(tempRoot, "prefix");
  const cacheDir = join(tempRoot, "npm-cache");
  mkdirSync(packDir, { recursive: true });
  mkdirSync(prefixDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });

  try {
    console.log("[pack:smoke] creating npm tarball...");
    const packResult = run("npm", [
      "pack",
      "--silent",
      "--ignore-scripts",
      "--cache",
      cacheDir,
      "--pack-destination",
      packDir,
    ]);
    const packageFile = packResult.stdout.trim().split("\n").filter(Boolean).at(-1);
    if (!packageFile) {
      fail("npm pack did not return a package filename");
    }
    const packagePath = join(packDir, packageFile);
    if (!existsSync(packagePath)) {
      fail(`npm pack reported package file that does not exist: ${packagePath}`);
    }

    console.log("[pack:smoke] installing tarball in isolated global prefix...");
    const npmInstallEnv = {
      ...process.env,
      npm_config_fetch_retries: "1",
      npm_config_fetch_retry_mintimeout: "2000",
      npm_config_fetch_retry_maxtimeout: "5000",
      npm_config_fetch_timeout: "30000",
    };
    run(
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        prefixDir,
        "--cache",
        cacheDir,
        "--no-audit",
        "--no-fund",
        packagePath,
      ],
      {
        stdio: "inherit",
        env: npmInstallEnv,
        timeout: 240000,
      }
    );

    const npmRootResult = run("npm", ["root", "-g", "--prefix", prefixDir]);
    const nodeModulesRoot = npmRootResult.stdout.trim();
    if (!nodeModulesRoot) {
      fail("npm root -g returned an empty path");
    }

    const installedPackageRoot = join(nodeModulesRoot, "codepiper");
    const installedWebIndex = join(installedPackageRoot, "packages/web/dist/index.html");
    if (!existsSync(installedWebIndex)) {
      fail(`installed package is missing web dist asset: ${installedWebIndex}`);
    }

    const binDir =
      process.platform === "win32" ? join(prefixDir, "Scripts") : join(prefixDir, "bin");
    const cliCommand = process.platform === "win32" ? "codepiper.cmd" : "codepiper";
    const cliPath = join(binDir, cliCommand);
    if (!existsSync(cliPath)) {
      fail(`installed CLI binary not found: ${cliPath}`);
    }

    const pathDelimiter = process.platform === "win32" ? ";" : ":";
    const commandEnv = {
      ...process.env,
      PATH: `${binDir}${pathDelimiter}${process.env.PATH ?? ""}`,
    };

    console.log("[pack:smoke] verifying installed CLI entrypoint...");
    run(cliCommand, ["--help"], { env: commandEnv });
    run(cliCommand, ["daemon", "--help"], { env: commandEnv });
    run(cliCommand, ["providers", "--help"], { env: commandEnv });

    console.log("[pack:smoke] ok: tarball install + CLI runtime smoke passed");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
