import { readJson } from "../lib/api";
import { getRequiredValue } from "../lib/args";

export interface DoctorOptions {
  socket: string;
}

export interface ClaudeCheckResult {
  installed: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface CodexCheckResult {
  installed: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface TmuxCheckResult {
  installed: boolean;
  path?: string;
  version?: string;
  versionOk?: boolean;
  error?: string;
}

export interface DaemonCheckResult {
  running: boolean;
  version?: string;
  error?: string;
}

export interface PlatformCheckResult {
  platform: string;
  arch: string;
  supported: boolean;
}

const SUPPORTED_PLATFORMS = new Set(["linux", "darwin"]);
const SUPPORTED_ARCHITECTURES = new Set(["x64", "arm64"]);

export function parseDoctorOptions(args: string[]): DoctorOptions {
  let socket = "/tmp/codepiper.sock";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    }
  }

  return { socket };
}

async function readStream(stream: ReadableStream): Promise<string> {
  const buffer = await new Response(stream).arrayBuffer();
  return Buffer.from(buffer).toString("utf-8").trim();
}

/**
 * Check whether a command exists in PATH and retrieve its version.
 * Returns { path, version } on success, or { error } on failure.
 */
async function checkCommand(
  name: string,
  versionArgs: string[]
): Promise<
  { installed: true; path: string; version: string } | { installed: false; error: string }
> {
  try {
    const whichProc = Bun.spawn(["which", name], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await whichProc.exited;

    if ((await whichProc.exitCode) !== 0) {
      return { installed: false, error: `${name} command not found in PATH` };
    }

    const cmdPath = await readStream(whichProc.stdout);

    const versionProc = Bun.spawn(versionArgs, {
      stdout: "pipe",
      stderr: "pipe",
    });
    await versionProc.exited;
    const version = await readStream(versionProc.stdout);

    return { installed: true, path: cmdPath, version };
  } catch (error: any) {
    return { installed: false, error: error.message };
  }
}

export async function checkClaudeInstallation(): Promise<ClaudeCheckResult> {
  return checkCommand("claude", ["claude", "-v"]);
}

export async function checkCodexInstallation(): Promise<CodexCheckResult> {
  return checkCommand("codex", ["codex", "--version"]);
}

export async function checkTmux(): Promise<TmuxCheckResult> {
  const result = await checkCommand("tmux", ["tmux", "-V"]);
  if (!result.installed) return result;

  // Parse version from "tmux 3.4" or "tmux 3.3a"
  const match = result.version.match(/tmux\s+(\d+)\.(\d+)/);
  const majorVersion = match?.[1];
  const versionOk = majorVersion ? Number.parseInt(majorVersion, 10) >= 3 : false;

  return { ...result, versionOk };
}

export async function checkDaemon(socket: string): Promise<DaemonCheckResult> {
  try {
    const response = await fetch("http://localhost/health", {
      unix: socket,
      method: "GET",
    });

    if (!response.ok) {
      return {
        running: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await readJson<{ version?: string }>(response);

    const result: DaemonCheckResult = { running: true };
    if (typeof data.version === "string" && data.version.length > 0) {
      result.version = data.version;
    }

    return result;
  } catch (error: any) {
    return {
      running: false,
      error: error.message,
    };
  }
}

export function evaluatePlatform(platform: string, arch: string): PlatformCheckResult {
  return {
    platform,
    arch,
    supported: SUPPORTED_PLATFORMS.has(platform) && SUPPORTED_ARCHITECTURES.has(arch),
  };
}

export function checkPlatform(): PlatformCheckResult {
  return evaluatePlatform(process.platform, process.arch);
}

function checkEnvironment(): {
  apiKeySet: boolean;
  info: string;
} {
  const apiKeySet = !!process.env.ANTHROPIC_API_KEY;

  if (apiKeySet) {
    return {
      apiKeySet: true,
      info: 'ANTHROPIC_API_KEY detected. Sessions with billingMode "api" will use API billing. Default sessions will scrub this key and use subscription billing.',
    };
  }

  return {
    apiKeySet: false,
    info: "ANTHROPIC_API_KEY not set. All sessions use subscription billing. Set it if you need API billing for automated use.",
  };
}

function printCheckResult(
  name: string,
  status: "ok" | "warning" | "error",
  message?: string
): void {
  const symbols = {
    ok: "✓",
    warning: "⚠",
    error: "✗",
  };

  const colors = {
    ok: "\x1b[32m", // green
    warning: "\x1b[33m", // yellow
    error: "\x1b[31m", // red
    reset: "\x1b[0m",
  };

  const symbol = symbols[status];
  const color = colors[status];

  console.log(`${color}${symbol}${colors.reset} ${name}${message ? `: ${message}` : ""}`);
}

export async function runDoctorCommand(args: string[]): Promise<void> {
  const options = parseDoctorOptions(args);

  console.log("Running codepiper diagnostics...\n");

  // Check platform
  console.log("Checking platform...");
  const platformCheck = checkPlatform();
  const platformStatus = platformCheck.supported ? "ok" : "warning";
  printCheckResult("Platform", platformStatus, `${platformCheck.platform}/${platformCheck.arch}`);
  if (!platformCheck.supported) {
    console.log(
      "  CodePiper is tested on linux/darwin with x64/arm64 architectures.\n" +
        "  Other platforms may work but are not currently in the supported target matrix."
    );
  }

  // Check provider installations
  console.log("Checking provider binaries...");
  const claudeCheck = await checkClaudeInstallation();
  const codexCheck = await checkCodexInstallation();
  const hasAnyProvider = claudeCheck.installed || codexCheck.installed;

  if (claudeCheck.installed) {
    printCheckResult("Claude Code installed", "ok", `Found at ${claudeCheck.path}`);
    if (claudeCheck.version) {
      printCheckResult("Claude Code version", "ok", claudeCheck.version);
    }
  } else {
    printCheckResult("Claude Code check", hasAnyProvider ? "warning" : "error", claudeCheck.error);
    console.log("  Install Claude Code: https://code.claude.com/docs/en/installation");
  }

  if (codexCheck.installed) {
    printCheckResult("Codex CLI installed", "ok", `Found at ${codexCheck.path}`);
    if (codexCheck.version) {
      printCheckResult("Codex CLI version", "ok", codexCheck.version);
    }
  } else {
    printCheckResult("Codex CLI check", hasAnyProvider ? "warning" : "error", codexCheck.error);
    console.log("  Install Codex CLI: https://developers.openai.com/codex");
  }

  if (!hasAnyProvider) {
    console.log("\n  At least one provider binary is required to start sessions.\n");
  } else {
    console.log("");
  }

  // Check tmux
  console.log("\nChecking tmux...");
  const tmuxCheck = await checkTmux();

  if (tmuxCheck.installed) {
    printCheckResult("tmux installed", "ok", `Found at ${tmuxCheck.path}`);
    if (tmuxCheck.version) {
      const versionStatus = tmuxCheck.versionOk ? "ok" : "warning";
      printCheckResult("tmux version", versionStatus, tmuxCheck.version);
      if (!tmuxCheck.versionOk) {
        console.log("\n  tmux 3.0+ is recommended for CodePiper sessions.\n");
      }
    }
  } else {
    printCheckResult("tmux check", "warning", tmuxCheck.error);
    console.log("\n  Install tmux: https://github.com/tmux/tmux/wiki/Installing\n");
  }

  // Check environment
  console.log("\nChecking environment...");
  const envCheck = checkEnvironment();

  printCheckResult("API key check", "ok", envCheck.info);

  // Check daemon
  console.log("\nChecking daemon...");
  const daemonCheck = await checkDaemon(options.socket);

  if (daemonCheck.running) {
    printCheckResult("Daemon status", "ok", "Daemon is running");
    if (daemonCheck.version) {
      printCheckResult("Daemon version", "ok", daemonCheck.version);
    }
  } else {
    printCheckResult("Daemon status", "error", "Daemon is not running");
    console.log("\n  Start the daemon with:");
    console.log("    codepiper daemon\n");
  }

  console.log("\nDiagnostics complete.");

  // Exit with error code if critical checks failed
  if (!(hasAnyProvider && daemonCheck.running)) {
    process.exit(1);
  }
}
