#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "../..");
const BUNFIG_PATH = resolve(ROOT_DIR, "bunfig.toml");
const AUDIT_LEVEL = process.env.SECURITY_AUDIT_LEVEL ?? "high";

const NETWORK_ERROR_PATTERNS = [
  /connectionrefused/iu,
  /enotfound/iu,
  /eai_again/iu,
  /timed? ?out/iu,
  /network/iu,
  /audit request failed/iu,
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: "pipe",
  });

  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  return {
    ...result,
    stdout,
    stderr,
    combined,
  };
}

function hasScannerConfigured() {
  if (!existsSync(BUNFIG_PATH)) return false;
  const bunfig = readFileSync(BUNFIG_PATH, "utf8");
  return /\[\s*install\.security\s*\][\s\S]*?^\s*scanner\s*=\s*["'][^"']+["']/mu.test(bunfig);
}

function fail(message, details) {
  const suffix = details ? `\n\n${details}\n` : "\n";
  console.error(`[security:deps] ERROR: ${message}${suffix}`);
  process.exit(1);
}

function printResult(command, args, result) {
  const cmd = `${command} ${args.join(" ")}`;
  const chunks = [result.stdout, result.stderr].filter(Boolean);
  const details = chunks.length > 0 ? chunks.join("\n") : "(no output)";
  console.log(`[security:deps] ${cmd}\n${details}\n`);
}

function isLikelyNetworkFailure(output) {
  return NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(output));
}

function runScanner() {
  const command = "bun";
  const args = ["pm", "scan"];
  const result = run(command, args);

  if (result.error) {
    fail(`failed to execute '${command}': ${result.error.message}`);
  }

  printResult(command, args, result);
  if (result.status !== 0) {
    fail("bun scanner reported dependency vulnerabilities or failed to run");
  }
}

function runAuditFallback() {
  const command = "bun";
  const args = ["audit", `--audit-level=${AUDIT_LEVEL}`];
  const result = run(command, args);

  if (result.error) {
    fail(`failed to execute '${command}': ${result.error.message}`);
  }

  printResult(command, args, result);
  if (result.status === 0) return;

  if (!process.env.CI && isLikelyNetworkFailure(result.combined)) {
    console.warn(
      "[security:deps] WARN: audit could not reach vulnerability service in local environment; skipping failure"
    );
    return;
  }

  fail(
    "dependency vulnerability scan failed",
    "If this is an offline local run, retry with network access. CI always enforces this check."
  );
}

function main() {
  if (hasScannerConfigured()) {
    console.log("[security:deps] scanner configured in bunfig.toml; using 'bun pm scan'");
    runScanner();
    return;
  }

  console.log(
    `[security:deps] no scanner configured in bunfig.toml; falling back to 'bun audit --audit-level=${AUDIT_LEVEL}'`
  );
  runAuditFallback();
}

main();
