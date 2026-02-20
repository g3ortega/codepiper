/**
 * Daemon entry point
 */

import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { EventBusAdapter, SQLiteEventBus } from "@codepiper/core";
import { createServer, type DaemonServer } from "./api/server";
import { Database } from "./db/db";
import { SessionManager } from "./sessions/sessionManager";

const DEFAULT_SOCKET_PATH = "/tmp/codepiper.sock";
const DEFAULT_DB_PATH = path.join(os.homedir(), ".codepiper", "codepiper.db");
const DEFAULT_WEB_DIR = path.resolve(__dirname, "../../web/dist");
const DETACHED_STARTUP_GRACE_MS = 1500;

const PID_FILE = path.join(os.homedir(), ".codepiper", "daemon.pid");

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let web = false;
  let port: number | undefined;
  let webDir: string | undefined;
  let socketPath: string | undefined;
  let detach = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--web") {
      web = true;
    } else if (arg === "--port" && next) {
      port = Number.parseInt(next, 10);
      i++;
    } else if (arg === "--web-dir" && next) {
      webDir = next;
      i++;
    } else if (arg === "--socket" && next) {
      socketPath = next;
      i++;
    } else if (arg === "--detach") {
      detach = true;
    }
  }

  return { web, port, webDir, socketPath, detach };
}

function cleanupPidFile(expectedPid?: number) {
  try {
    if (!fs.existsSync(PID_FILE)) {
      return;
    }

    if (expectedPid !== undefined) {
      const filePid = Number.parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
      if (!Number.isFinite(filePid) || filePid !== expectedPid) {
        return;
      }
    }

    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore cleanup errors
  }
}

function writePidFile(pid: number) {
  const dir = path.dirname(PID_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  // Write PID file with restrictive permissions (owner-only)
  const fd = fs.openSync(PID_FILE, "w", 0o600);
  fs.writeSync(fd, String(pid));
  fs.closeSync(fd);
}

async function isSocketActive(socketPath: string): Promise<boolean> {
  return await new Promise((resolve) => {
    let settled = false;
    const finalize = (isActive: boolean) => {
      if (settled) return;
      settled = true;
      resolve(isActive);
    };

    const client = net.createConnection(socketPath);
    const timeout = setTimeout(() => {
      client.destroy();
      finalize(false);
    }, 250);

    client.once("connect", () => {
      clearTimeout(timeout);
      client.end();
      finalize(true);
    });

    client.once("error", () => {
      clearTimeout(timeout);
      finalize(false);
    });
  });
}

async function ensureSocketPathAvailable(socketPath: string): Promise<void> {
  if (!fs.existsSync(socketPath)) return;

  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(socketPath);
  } catch {
    return;
  }

  if (!stats.isSocket()) {
    throw new Error(`Refusing to use non-socket path: ${socketPath}`);
  }

  if (await isSocketActive(socketPath)) {
    throw new Error(
      `Socket ${socketPath} is already in use. Another daemon may be running.\n` +
        "  Stop it with: codepiper daemon stop"
    );
  }

  console.log(`Removing stale socket: ${socketPath}`);
  fs.unlinkSync(socketPath);
}

async function waitForDetachedStartup(child: ReturnType<typeof Bun.spawn>): Promise<number | null> {
  return await Promise.race([
    child.exited,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), DETACHED_STARTUP_GRACE_MS);
    }),
  ]);
}

/**
 * Reconcile DB session states against actual tmux sessions on startup.
 * - RUNNING/STARTING sessions with a live tmux → re-adopt into SessionManager
 * - RUNNING/STARTING sessions without a tmux session → mark STOPPED
 * - Orphaned tmux sessions (no matching RUNNING DB record) → kill them
 */
async function reconcileOrphanedSessions(
  db: Database,
  sessionManager?: SessionManager
): Promise<void> {
  // 1. Find DB sessions that claim to be active
  const activeSessions = [
    ...db.listSessions({ status: "RUNNING" }),
    ...db.listSessions({ status: "STARTING" }),
  ];

  // 2. Get actual tmux codepiper sessions
  const tmuxResult = Bun.spawnSync(["tmux", "list-sessions", "-F", "#{session_name}"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const tmuxSessionNames = new Set(
    (tmuxResult.stdout?.toString() || "")
      .split("\n")
      .filter((name) => name.startsWith("codepiper-"))
  );

  // 3. Reconcile each DB session
  let reconciled = 0;
  let adopted = 0;
  for (const session of activeSessions) {
    const tmuxName = `codepiper-${session.id}`;
    if (!tmuxSessionNames.has(tmuxName)) {
      // Tmux is gone — mark STOPPED
      db.updateSession(session.id, { status: "STOPPED" });
      reconciled++;
    } else if (sessionManager) {
      // Tmux is alive — re-adopt into SessionManager
      try {
        await sessionManager.adoptSession(session.id);
        adopted++;
      } catch (err) {
        console.warn(`Failed to adopt session ${session.id}:`, err);
        db.updateSession(session.id, { status: "STOPPED" });
        reconciled++;
      }
    }
  }
  if (reconciled > 0) {
    console.log(`Reconciled ${reconciled} orphaned session(s) → STOPPED (no tmux session)`);
  }
  if (adopted > 0) {
    console.log(`Re-adopted ${adopted} live session(s) from previous daemon run`);
  }

  // 4. Kill orphaned tmux sessions that have no matching active DB record
  const activeIds = new Set(activeSessions.map((s) => `codepiper-${s.id}`));
  let killedTmux = 0;
  for (const tmuxName of tmuxSessionNames) {
    if (!activeIds.has(tmuxName)) {
      try {
        Bun.spawnSync(["tmux", "kill-session", "-t", tmuxName], {
          stdout: "ignore",
          stderr: "ignore",
        });
        killedTmux++;
      } catch {
        // ignore kill errors
      }
    }
  }
  if (killedTmux > 0) {
    console.log(`Killed ${killedTmux} orphaned tmux session(s)`);
  }
}

async function main() {
  const cliArgs = parseArgs(process.argv);

  // Handle --detach: re-spawn self in background without --detach flag
  if (cliArgs.detach) {
    const runtimeBin = process.argv[0];
    const entryScript = process.argv[1];
    if (!(runtimeBin && entryScript)) {
      throw new Error("Unable to determine daemon runtime entrypoint");
    }

    const filteredArgs = process.argv.slice(2).filter((a) => a !== "--detach");
    const child = Bun.spawn([runtimeBin, entryScript, ...filteredArgs], {
      stdio: ["ignore", "ignore", "ignore"],
      env: process.env,
    });
    const earlyExitCode = await waitForDetachedStartup(child);
    if (earlyExitCode !== null) {
      console.error(`Failed to start daemon in background (exit code: ${earlyExitCode})`);
      process.exit(earlyExitCode === 0 ? 1 : earlyExitCode);
    }

    child.unref();
    console.log(`Daemon started in background (PID: ${child.pid})`);
    console.log("Use `codepiper daemon status` to confirm readiness.");
    process.exit(0);
  }

  // Get socket path from environment or use default
  const socketPath = cliArgs.socketPath || process.env.CODEPIPER_SOCKET || DEFAULT_SOCKET_PATH;
  const dbPath = process.env.CODEPIPER_DB_PATH || DEFAULT_DB_PATH;

  // Create .codepiper directory if it doesn't exist (for persistent DB)
  // Use restrictive permissions (owner-only) to protect session data and credentials
  if (dbPath !== ":memory:") {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
      console.log(`Created directory: ${dbDir}`);
    }
  }

  // Clean up stale socket files, but never unlink an active daemon socket.
  await ensureSocketPathAvailable(socketPath);

  // Check tmux availability (warn only — daemon can serve API/web without it)
  const tmuxCheck = Bun.spawnSync(["tmux", "-V"], { stdout: "pipe", stderr: "pipe" });
  if (tmuxCheck.exitCode !== 0) {
    console.warn(
      "Warning: tmux not found. Session management requires tmux 3.0+.\n" +
        "  Install tmux: https://github.com/tmux/tmux/wiki/Installing"
    );
  }

  // Initialize database
  const db = new Database(dbPath);
  await db.init();

  // Lock down DB file permissions (contains auth hashes and session data)
  if (dbPath !== ":memory:") {
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = dbPath + suffix;
      try {
        if (fs.existsSync(p)) {
          fs.chmodSync(p, 0o600);
        }
      } catch (err) {
        console.warn(
          `Warning: Failed to set permissions on ${p}: ${err instanceof Error ? err.message : err}\n` +
            "  The database may be readable by other users."
        );
      }
    }
  }

  console.log(`Database initialized: ${dbPath === ":memory:" ? "in-memory" : dbPath}`);

  // Clean up old STOPPED/CRASHED sessions on startup (older than 24 hours)
  const cleanupAgeMs = 24 * 60 * 60 * 1000; // 24 hours
  const cleaned = db.cleanupOldSessions(cleanupAgeMs);
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} old session(s) from database`);
  }

  // Backfill token_usage from existing transcript assistant events
  const backfillRows = db.query(`
    SELECT e.id, e.session_id, e.payload_json FROM events e
    WHERE e.source = 'transcript' AND e.type = 'assistant'
    AND e.id NOT IN (SELECT event_id FROM token_usage WHERE event_id IS NOT NULL)
  `) as Array<{ id: number; session_id: string; payload_json: string }>;

  let backfilled = 0;
  for (const row of backfillRows) {
    try {
      const parsed = JSON.parse(row.payload_json);
      if (parsed.message?.usage) {
        const usage = parsed.message.usage;
        const promptTokens = usage.input_tokens || 0;
        const completionTokens = usage.output_tokens || 0;
        const cacheCreation = usage.cache_creation_input_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;
        db.insertTokenUsage({
          sessionId: row.session_id,
          eventId: row.id,
          model: parsed.message.model || "unknown",
          promptTokens,
          completionTokens,
          cacheCreationInputTokens: cacheCreation,
          cacheReadInputTokens: cacheRead,
          totalTokens: promptTokens + completionTokens + cacheCreation + cacheRead,
        });
        backfilled++;
      }
    } catch {
      // Skip unparseable events
    }
  }
  if (backfilled > 0) {
    console.log(`Backfilled ${backfilled} token usage record(s) from existing events`);
  }

  // Create SQLite event bus (shares same database file for zero dependencies)
  const sqliteEventBus = new SQLiteEventBus({
    dbPath,
    consumerGroup: "codepiper-daemon",
    consumerName: "daemon-main",
    pollingIntervalMs: 100,
  });

  // Wrap with adapter to provide synchronous emit/on API
  const eventBus = new EventBusAdapter<Record<string, any>>(sqliteEventBus);
  console.log(`EventBus initialized: SQLite-based (polling interval: 100ms)`);

  // Create session manager
  const sessionManager = new SessionManager(db, eventBus);

  // Reconcile DB sessions against actual tmux sessions (re-adopt live ones)
  await reconcileOrphanedSessions(db, sessionManager);

  // Resolve web directory
  let webDir: string | undefined;
  if (cliArgs.web) {
    webDir = cliArgs.webDir || DEFAULT_WEB_DIR;
    if (!fs.existsSync(webDir)) {
      console.warn(
        `Warning: Web assets not found at ${webDir}\n` +
          "  The --web flag was set but no dashboard will be served.\n" +
          "  Build web assets with: bun run build:web\n" +
          "  Then restart the daemon."
      );
      webDir = undefined;
    }
  }

  // Initialize authentication
  const { AuthService } = await import("./auth/authService");
  const { RateLimiter } = await import("./auth/rateLimiter");
  const { getOrCreateEncryptionKey, getOrCreateHookSecret } = await import("./crypto/encryption");

  const encryptionKey = getOrCreateEncryptionKey();
  const hookSecret = process.env.CODEPIPER_SECRET || getOrCreateHookSecret();
  process.env.CODEPIPER_SECRET = hookSecret;
  const authService = new AuthService(db, encryptionKey);
  const rateLimiter = new RateLimiter();

  // Clean up expired auth sessions
  const expiredSessions = db.cleanupExpiredAuthSessions();
  if (expiredSessions > 0) {
    console.log(`Cleaned up ${expiredSessions} expired auth session(s)`);
  }

  if (authService.isSetupRequired()) {
    console.log("Auth: No password configured. Web dashboard will show setup page.");
  } else {
    console.log("Auth: Password configured. Web dashboard requires login.");
  }

  // Handle graceful shutdown/restart (guard against concurrent calls)
  let shutdownInProgress = false;
  let restartRequested = false;
  let server: DaemonServer | null = null;

  const spawnReplacementDaemon = (): boolean => {
    const runtimeBin = process.argv[0];
    const entryScript = process.argv[1];
    if (!(runtimeBin && entryScript)) {
      console.error("[daemon] Unable to determine runtime entrypoint for restart");
      return false;
    }

    const args = process.argv.slice(2).filter((arg) => arg !== "--detach");
    try {
      const child = Bun.spawn([runtimeBin, entryScript, ...args], {
        stdio: ["ignore", "ignore", "ignore"],
        env: process.env,
      });
      child.unref();
      console.log(`[daemon] Spawned replacement process (PID: ${child.pid})`);
      return true;
    } catch (err) {
      console.error("[daemon] Failed to spawn replacement process:", err);
      return false;
    }
  };

  const shutdown = async (mode: "stop" | "restart" = "stop") => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    console.log(`\n${mode === "restart" ? "Restarting daemon..." : "Shutting down..."}`);
    let restartSpawned = false;
    try {
      const settings = db.getDaemonSettings();
      if (settings.preserveSessions) {
        const activeCount = sessionManager.listSessions().length;
        if (activeCount > 0) {
          console.log(
            `Preserving ${activeCount} active session(s) for re-adoption on next startup`
          );
        }
        await sessionManager.detachAll();
      } else {
        await sessionManager.stopAll();
      }
      await eventBus.close();
      if (server) {
        await server.stop();
      }
      cleanupPidFile(process.pid);

      if (mode === "restart") {
        restartSpawned = spawnReplacementDaemon();
        if (!restartSpawned) {
          console.error("[daemon] Restart failed: replacement process was not spawned");
        }
      }

      console.log(mode === "restart" ? "Daemon restart complete" : "Daemon stopped");
    } catch (err) {
      console.error("Error during shutdown:", err);
    }
    process.exit(mode === "restart" && !restartSpawned ? 1 : 0);
  };

  const requestRestart = () => {
    if (shutdownInProgress || restartRequested) {
      return;
    }
    restartRequested = true;
    console.log("[daemon] Restart requested via API");
    setTimeout(() => {
      void shutdown("restart");
    }, 25);
  };

  // Start server
  console.log(`Starting CodePiper daemon on ${socketPath}...`);
  server = await createServer(socketPath, sessionManager, db, eventBus, {
    webDir,
    httpPort: cliArgs.port,
    authService,
    rateLimiter,
    onRestartRequested: requestRestart,
  });

  // Wire WebSocket manager to session manager for PTY streaming
  sessionManager.setWebSocketManager(server.wsManager);

  // Write PID only after startup succeeds to avoid stale/clobbered pid files.
  writePidFile(process.pid);

  const bannerLines = [
    "",
    "============================================================",
    "  CodePiper daemon is ready",
    "============================================================",
    `  Socket:    ${socketPath}`,
    `  WebSocket: ws://127.0.0.1:${server.wsPort}/ws`,
  ];
  if (server.httpPort > 0) {
    bannerLines.push(`  Dashboard: http://127.0.0.1:${server.httpPort}`);
  }
  if (process.env.CODEPIPER_ALLOWED_ORIGINS) {
    bannerLines.push(`  Origins:   ${process.env.CODEPIPER_ALLOWED_ORIGINS}`);
  }
  bannerLines.push(
    "",
    "  Press Ctrl+C to stop",
    "============================================================"
  );
  console.log(bannerLines.join("\n"));

  process.on("SIGINT", () => {
    void shutdown("stop");
  });
  process.on("SIGTERM", () => {
    void shutdown("stop");
  });
}

main().catch((error) => {
  cleanupPidFile(process.pid);
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFailed to start daemon: ${message}`);
  process.exit(1);
});
