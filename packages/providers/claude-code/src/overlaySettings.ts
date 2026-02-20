/**
 * Overlay settings generator for Claude Code sessions
 *
 * Generates a per-session settings file that configures hooks and statusline
 * to forward events to the codepiper daemon.
 */

import * as fs from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface OverlaySettingsOptions {
  sessionId: string;
  socketPath: string;
  secret: string;
  outputDir?: string;
  enableStatusline?: boolean;
}

export interface ClaudeCodeSettings {
  hooks?: {
    SessionStart?: HookEntry[];
    Notification?: HookEntry[];
    PermissionRequest?: HookEntry[];
    Stop?: HookEntry[];
  };
  statusline?: {
    command: string;
    stdin?: string;
  };
}

interface HookEntry {
  matcher?: Record<string, unknown>;
  hooks: Hook[];
}

interface Hook {
  type: "command";
  command: string;
  stdin?: string;
  stdout?: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function writeExecutableScript(filePath: string, content: string): void {
  const fd = fs.openSync(filePath, "w", 0o700);
  try {
    fs.writeSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(filePath, 0o700);
  } catch {
    // best-effort on non-POSIX filesystems
  }
}

/**
 * Generate overlay settings file for a Claude Code session
 *
 * The overlay configures:
 * - Hooks to forward events to codepiper daemon
 * - Environment variables for socket path, session ID, and auth secret
 * - Optional statusline for session state tracking
 *
 * @param options Configuration for overlay generation
 * @returns Path to generated settings file
 */
export async function generateOverlaySettings(options: OverlaySettingsOptions): Promise<string> {
  const {
    sessionId,
    socketPath,
    secret,
    outputDir = join(tmpdir(), "codepiper", "settings"),
    enableStatusline = false,
  } = options;

  // Ensure output directory exists with restrictive permissions (contains session secret)
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(outputDir, 0o700);
  } catch {
    // best-effort on non-POSIX filesystems
  }

  // Generate settings file path
  const settingsPath = join(outputDir, `${sessionId}.json`);

  // Build hook command using full path to CLI (not relying on PATH)
  // Get project root: packages/providers/claude-code/src/overlaySettings.ts -> ../../../..
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const projectRoot = join(currentDir, "..", "..", "..", "..");
  const cliPath = join(projectRoot, "packages", "cli", "src", "main.ts");
  const hookScriptPath = join(outputDir, `${sessionId}.hook-forward.sh`);
  const hookCommand = `sh ${shellQuote(hookScriptPath)}`;
  const hookScript = [
    "#!/usr/bin/env sh",
    "set -eu",
    `export CODEPIPER_UNIX_SOCK=${shellQuote(socketPath)}`,
    `export CODEPIPER_SESSION=${shellQuote(sessionId)}`,
    `export CODEPIPER_SECRET=${shellQuote(secret)}`,
    `exec bun run ${shellQuote(cliPath)} hook-forward`,
    "",
  ].join("\n");
  writeExecutableScript(hookScriptPath, hookScript);

  // Build settings object using new hooks format (array with matchers)
  const settings: ClaudeCodeSettings = {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: hookCommand,
              stdin: "event",
            },
          ],
        },
      ],
      Notification: [
        {
          hooks: [
            {
              type: "command",
              command: hookCommand,
              stdin: "event",
            },
          ],
        },
      ],
      PermissionRequest: [
        {
          hooks: [
            {
              type: "command",
              command: hookCommand,
              stdin: "event",
              stdout: "context", // Claude Code reads decision from stdout
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: hookCommand,
              stdin: "event",
            },
          ],
        },
      ],
    },
  };

  // Add statusline if enabled
  if (enableStatusline) {
    const statuslineScriptPath = join(outputDir, `${sessionId}.statusline-forward.sh`);
    const statuslineCommand = `sh ${shellQuote(statuslineScriptPath)}`;
    const statuslineScript = [
      "#!/usr/bin/env sh",
      "set -eu",
      `export CODEPIPER_UNIX_SOCK=${shellQuote(socketPath)}`,
      `export CODEPIPER_SESSION=${shellQuote(sessionId)}`,
      `export CODEPIPER_SECRET=${shellQuote(secret)}`,
      "exec codepiper statusline-forward",
      "",
    ].join("\n");
    writeExecutableScript(statuslineScriptPath, statuslineScript);

    settings.statusline = {
      command: statuslineCommand,
      stdin: "event",
    };
  }

  // Write settings file with restrictive permissions (contains session secret)
  const fd = fs.openSync(settingsPath, "w", 0o600);
  fs.writeSync(fd, JSON.stringify(settings, null, 2));
  fs.closeSync(fd);
  try {
    fs.chmodSync(settingsPath, 0o600);
  } catch {
    // best-effort on non-POSIX filesystems
  }

  return settingsPath;
}
