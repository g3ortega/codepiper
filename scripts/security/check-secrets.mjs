#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "../..");

const MAX_FILE_SIZE_BYTES = 1_500_000;
const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tgz",
  ".ttf",
  ".woff",
  ".woff2",
  ".mp3",
  ".wav",
  ".ogg",
]);

const SKIP_PREFIXES = [".local-exclude/", ".explorations/"];

const RULES = [
  {
    name: "AWS Access Key",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: "GitHub token",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{20,255}\b/g,
  },
  {
    name: "Anthropic API key",
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,255}\b/g,
  },
  {
    name: "OpenAI API key",
    regex: /\bsk-(?:proj|live|test)?[A-Za-z0-9_-]{32,255}\b/g,
  },
  {
    name: "Google API key",
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  },
  {
    name: "Private key block",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: "Slack token",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
];

const PLACEHOLDER_MARKERS = [
  "example",
  "placeholder",
  "replace-me",
  "replace_me",
  "your_",
  "<your",
  "redacted",
  "dummy",
  "sample",
];

function fail(message) {
  console.error(`\n[security:secrets] ERROR: ${message}\n`);
  process.exit(1);
}

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  return output.split("\u0000").filter(Boolean);
}

function isSkippablePath(filePath) {
  if (SKIP_PREFIXES.some((prefix) => filePath.startsWith(prefix))) return true;
  return SKIP_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function isLikelyPlaceholder(line) {
  const normalized = line.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
}

function maskSensitive(text) {
  if (text.length <= 10) return "***";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function main() {
  const findings = [];
  const trackedFiles = listTrackedFiles();

  for (const filePath of trackedFiles) {
    if (isSkippablePath(filePath)) continue;
    const absPath = resolve(ROOT_DIR, filePath);

    let stats;
    try {
      stats = statSync(absPath);
    } catch {
      continue;
    }

    if (!stats.isFile() || stats.size > MAX_FILE_SIZE_BYTES) continue;

    let content = "";
    try {
      content = readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/u);
    for (const [lineIndex, line] of lines.entries()) {
      if (!line.trim()) continue;

      for (const rule of RULES) {
        rule.regex.lastIndex = 0;
        for (const match of line.matchAll(rule.regex)) {
          if (isLikelyPlaceholder(line)) continue;
          findings.push({
            filePath,
            line: lineIndex + 1,
            rule: rule.name,
            match: maskSensitive(match[0]),
          });
        }
      }
    }
  }

  if (findings.length > 0) {
    const preview = findings
      .slice(0, 20)
      .map((item) => `${item.filePath}:${item.line} ${item.rule} (${item.match})`)
      .join("\n");
    const overflow =
      findings.length > 20
        ? `\n...and ${findings.length - 20} more potential secret exposures`
        : "";
    fail(`potential secrets detected:\n${preview}${overflow}`);
  }

  console.log(
    `[security:secrets] ok: scanned ${trackedFiles.length} tracked files, no leaked secrets found`
  );
}

main();
