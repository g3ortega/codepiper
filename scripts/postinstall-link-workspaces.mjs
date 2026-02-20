#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");

const WORKSPACE_LINKS = [
  {
    packageName: "@codepiper/core",
    targetDir: join(ROOT_DIR, "packages/core"),
  },
  {
    packageName: "@codepiper/daemon",
    targetDir: join(ROOT_DIR, "packages/daemon"),
  },
  {
    packageName: "@codepiper/provider-claude-code",
    targetDir: join(ROOT_DIR, "packages/providers/claude-code"),
  },
];

const SCOPE_DIR = join(ROOT_DIR, "node_modules", "@codepiper");
const SYMLINK_TYPE = process.platform === "win32" ? "junction" : "dir";

function ensureWorkspaceLink(packageName, targetDir) {
  if (!existsSync(targetDir)) {
    return;
  }

  const packageBasename = packageName.split("/").at(-1);
  if (!packageBasename) {
    return;
  }

  const linkPath = join(SCOPE_DIR, packageBasename);
  if (existsSync(linkPath)) {
    try {
      // Preserve existing installs (real dirs or existing links).
      lstatSync(linkPath);
      return;
    } catch {
      // Ignore transient race states and continue linking.
    }
  }

  mkdirSync(SCOPE_DIR, { recursive: true });
  const relativeTarget = relative(dirname(linkPath), targetDir);
  symlinkSync(relativeTarget, linkPath, SYMLINK_TYPE);
}

for (const workspaceLink of WORKSPACE_LINKS) {
  ensureWorkspaceLink(workspaceLink.packageName, workspaceLink.targetDir);
}
