import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { daemonJson } from "../lib/api";
import { getFlag, getSocket } from "../lib/args";
import { colors, info, success } from "../lib/format";

const PID_FILE = path.join(os.homedir(), ".codepiper", "daemon.pid");

function readPid(): number | null {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const pid = Number.parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startDaemon(args: string[]): Promise<void> {
  const daemonScript = path.resolve(__dirname, "../../../daemon/src/main.ts");
  const detach = getFlag(args, "detach");

  // Pass through all args to the daemon process
  const daemonArgs = ["run", daemonScript, ...args];

  if (detach) {
    // In detach mode, the daemon main.ts handles backgrounding itself
    console.log("Starting CodePiper daemon (detached)...");
  } else {
    console.log("Starting CodePiper daemon...");
  }

  const proc = Bun.spawn(["bun", ...daemonArgs], {
    stdio: detach ? ["ignore", "inherit", "inherit"] : ["inherit", "inherit", "inherit"],
    env: process.env,
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}

async function stopDaemon(): Promise<void> {
  const pid = readPid();

  if (!pid) {
    throw new Error(`No PID file found at ${PID_FILE}. Is the daemon running?`);
  }

  if (!isProcessRunning(pid)) {
    // Process already dead, clean up PID file
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    console.log(`Daemon (PID: ${pid}) is not running. Cleaned up stale PID file.`);
    return;
  }

  console.log(`Stopping daemon (PID: ${pid})...`);
  process.kill(pid, "SIGTERM");

  // Wait for process to exit (up to 10 seconds)
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      // Clean up PID file if daemon didn't
      try {
        fs.unlinkSync(PID_FILE);
      } catch {
        /* ignore */
      }
      success("Daemon stopped");
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Force kill if still running
  console.log("Daemon did not stop gracefully, sending SIGKILL...");
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already dead
  }
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
  success("Daemon killed");
}

async function showStatus(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const pid = readPid();

  console.log(`${colors.bold}Daemon Status${colors.reset}\n`);
  info("PID file", PID_FILE);
  info("Socket", socket);

  if (!pid) {
    info("Status", `${colors.red}not running${colors.reset} (no PID file)`);
    return;
  }

  info("PID", String(pid));

  if (!isProcessRunning(pid)) {
    info("Status", `${colors.red}not running${colors.reset} (stale PID file)`);
    return;
  }

  info("Process", `${colors.green}running${colors.reset}`);

  // Try to reach the health endpoint
  try {
    const health = await daemonJson<{
      status: string;
      uptime?: number;
      zombieSessionCount?: number;
    }>("/health", { socket });
    info("Health", `${colors.green}${health.status}${colors.reset}`);
    if (typeof health.zombieSessionCount === "number") {
      const zombieColor = health.zombieSessionCount > 0 ? colors.yellow : colors.green;
      info("Zombie sessions", `${zombieColor}${health.zombieSessionCount}${colors.reset}`);
    }
    if (health.uptime !== undefined) {
      const hours = Math.floor(health.uptime / 3600);
      const mins = Math.floor((health.uptime % 3600) / 60);
      info("Uptime", `${hours}h ${mins}m`);
    }
  } catch {
    info("Health", `${colors.yellow}unreachable${colors.reset} (socket may not be ready)`);
  }
}

export async function runDaemonCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "stop":
      return stopDaemon();
    case "status":
      return showStatus(args.slice(1));
    case "start":
      return startDaemon(args.slice(1));
    default:
      // No subcommand or unknown — treat as start (backward compatible)
      return startDaemon(args);
  }
}
