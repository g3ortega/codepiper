/**
 * SessionManager - manages lifecycle of all sessions
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stripVTControlCharacters } from "node:util";
import type {
  BillingMode,
  EventBus,
  ProviderId,
  SessionHandle,
  SessionStatus,
} from "@codepiper/core";
import { SessionNotFoundError } from "@codepiper/core";
import type { WebSocketManager } from "../api/ws";
import type { Database } from "../db/db";
import { GitUtils } from "../git/gitUtils";
import { resolveCodexAppServerSpikeState } from "../providers/codexAppServerScaffold";
import { getProviderDefinition } from "../providers/registry";
import type { ProviderCapabilities, ProviderResumeTarget } from "../providers/types";
import { PTYProcess } from "./ptyProcess";
import {
  type TerminalCursor,
  type TerminalInfo,
  type TerminalMode,
  TmuxSession,
} from "./tmuxSession";
import { TranscriptTailer } from "./transcriptTailer";

export interface CreateSessionOptions {
  provider: ProviderId;
  cwd: string;
  env?: Record<string, string>;
  args?: string[];
  billingMode?: BillingMode;
  dangerousMode?: boolean;
  envSetIds?: string[];
  providerResume?: ProviderResumeTarget;
  /**
   * Internal: preserve a stable CodePiper session id (used by /sessions/:id/resume).
   */
  sessionIdOverride?: string;
  /**
   * Internal: when true, update existing DB row instead of inserting a new one.
   */
  reuseExistingRecord?: boolean;
  worktree?: {
    branch: string;
    createBranch: boolean;
    startPoint?: string;
  };
}

interface LaunchMetadata {
  args: string[];
  billingMode: BillingMode;
  envSetIds: string[];
}

interface SessionMetadataShape extends Record<string, unknown> {
  launch?: LaunchMetadata;
  providerSession?: {
    id?: string;
    mode?: "resume" | "fork";
    source?: string;
  };
  ui?: Record<string, unknown>;
  security?: {
    dangerousMode?: boolean;
    codexHostAccessProfileEnabled?: boolean;
  };
  experimental?: Record<string, unknown>;
  worktree?: Record<string, unknown>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// Union type for session processes (PTY or Tmux)
type SessionProcess = PTYProcess | TmuxSession;

interface ManagedSession extends SessionHandle {
  process: SessionProcess;
}

interface TailerContext {
  db: Database;
  transcriptPath: string;
}

const PTY_SPECIAL_KEY_SEQUENCES: Record<string, string> = {
  enter: "\r",
  escape: "\x1b",
  esc: "\x1b",
  tab: "\t",
  "shift+tab": "\x1b[Z",
  backspace: "\x7f",
  delete: "\x1b[3~",
  insert: "\x1b[2~",
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  f1: "\x1bOP",
  f2: "\x1bOQ",
  f3: "\x1bOR",
  f4: "\x1bOS",
  f5: "\x1b[15~",
  f6: "\x1b[17~",
  f7: "\x1b[18~",
  f8: "\x1b[19~",
  f9: "\x1b[20~",
  f10: "\x1b[21~",
  f11: "\x1b[23~",
  f12: "\x1b[24~",
};

const TMUX_SPECIAL_KEY_MAP: Record<string, string> = {
  enter: "Enter",
  escape: "Escape",
  esc: "Escape",
  tab: "Tab",
  "shift+tab": "BTab",
  backspace: "BSpace",
  delete: "DC",
  insert: "IC",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  f1: "F1",
  f2: "F2",
  f3: "F3",
  f4: "F4",
  f5: "F5",
  f6: "F6",
  f7: "F7",
  f8: "F8",
  f9: "F9",
  f10: "F10",
  f11: "F11",
  f12: "F12",
};

function resolveCtrlSequence(token: string): string | null {
  if (/^[a-z]$/.test(token)) {
    return String.fromCharCode(token.charCodeAt(0) - 96);
  }

  const ctrlSymbolMap: Record<string, string> = {
    "@": "\x00",
    space: "\x00",
    "2": "\x00",
    "[": "\x1b",
    "3": "\x1b",
    "\\": "\x1c",
    "4": "\x1c",
    "]": "\x1d",
    "5": "\x1d",
    "^": "\x1e",
    "6": "\x1e",
    _: "\x1f",
    "-": "\x1f",
    "/": "\x1f",
    "7": "\x1f",
    "?": "\x7f",
    "8": "\x7f",
  };

  return ctrlSymbolMap[token] ?? null;
}

function resolveAltSequence(token: string): string | null {
  if (token === "space") {
    return " ";
  }
  if (token.length === 1) {
    return token;
  }
  return null;
}

/** Maximum number of concurrent active sessions to prevent resource exhaustion */
const MAX_CONCURRENT_SESSIONS = 50;

/**
 * Safe subset of daemon environment keys to forward to sessions.
 * Only basic system variables are included to prevent leaking secrets
 * (e.g. AWS keys, DB URLs) from the daemon process to Claude Code.
 */
const SAFE_INHERITED_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TZ",
  "EDITOR",
  "VISUAL",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_CACHE_HOME",
]);

const CODEX_SESSION_BANNER_REGEX =
  /\bcodex session\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
const CODEX_SESSION_BANNER_BUFFER_BYTES = 512;

function generateEphemeralHookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function ensurePrivateDirectory(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // best-effort on non-POSIX filesystems
  }
}

function getHomeDir(): string {
  return process.env.HOME || os.homedir();
}

export function isDangerousModeMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }

  const security = (metadata as Record<string, unknown>).security;
  if (!security || typeof security !== "object" || Array.isArray(security)) {
    return false;
  }

  return (security as Record<string, unknown>).dangerousMode === true;
}

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private tailers = new Map<string, TranscriptTailer>();
  private saveOffsetIntervals = new Map<string, Timer>();
  private tailerContexts = new Map<string, TailerContext>();
  private inputQueueBySession = new Map<string, Promise<void>>();
  private codexBannerBufferBySession = new Map<string, string>();
  private db: Database;
  private eventBus: EventBus;
  private wsManager?: WebSocketManager;

  /**
   * Root directory for per-session runtime files.
   */
  getSessionsRootDir(): string {
    return `${getHomeDir()}/.codepiper/sessions`;
  }

  /**
   * Get the image upload directory for a session.
   * Images uploaded via the web dashboard are saved here and referenced by file path.
   */
  getSessionRuntimeDir(sessionId: string): string {
    return `${this.getSessionsRootDir()}/${sessionId}`;
  }

  /**
   * Get the image upload directory for a session.
   * Images uploaded via the web dashboard are saved here and referenced by file path.
   */
  getImageDir(sessionId: string): string {
    return `${this.getSessionRuntimeDir(sessionId)}/images`;
  }

  constructor(db: Database, eventBus: EventBus) {
    this.db = db;
    this.eventBus = eventBus;
  }

  /**
   * Set WebSocketManager for PTY output broadcasting.
   * Called after daemon initialization to wire up WebSocket streaming.
   */
  setWebSocketManager(wsManager: WebSocketManager): void {
    this.wsManager = wsManager;
  }

  getProviderCapabilities(providerId: ProviderId): ProviderCapabilities {
    return getProviderDefinition(providerId).capabilities;
  }

  isSessionDangerousMode(sessionId: string): boolean {
    const session = this.getSession(sessionId);
    return isDangerousModeMetadata(session?.metadata);
  }

  async createSession(options: CreateSessionOptions): Promise<SessionHandle> {
    const {
      provider,
      cwd,
      env = {},
      args = [],
      providerResume,
      sessionIdOverride,
      reuseExistingRecord,
    } = options;
    const dangerousMode = options.dangerousMode === true;
    const providerDefinition = getProviderDefinition(provider);

    // Guard against resource exhaustion
    if (this.sessions.size >= MAX_CONCURRENT_SESSIONS) {
      throw new Error(
        `Maximum concurrent sessions (${MAX_CONCURRENT_SESSIONS}) reached. Stop an existing session first.`
      );
    }

    if (!fs.existsSync(cwd)) {
      throw new Error(`Working directory does not exist: ${cwd}`);
    }

    const sessionId = sessionIdOverride ?? crypto.randomUUID();
    const existingDbSession = reuseExistingRecord ? this.db.getSession(sessionId) : undefined;
    if (reuseExistingRecord && !existingDbSession) {
      throw new SessionNotFoundError(sessionId);
    }

    const billingMode = options.billingMode ?? "subscription";
    const daemonSettings = this.db.getDaemonSettings();
    const codexAppServerSpike =
      provider === "codex"
        ? resolveCodexAppServerSpikeState({
            terminalFeatures: daemonSettings.terminalFeatures,
          })
        : undefined;

    // Start with safe subset of process.env, then merge user-provided env
    const sessionEnv: Record<string, string> = {};
    for (const key of SAFE_INHERITED_ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) {
        sessionEnv[key] = value;
      }
    }

    // Optional SSH agent forwarding for git operations inside tmux sessions.
    if (daemonSettings.forwardSshAuthSock) {
      const sshAuthSock = process.env.SSH_AUTH_SOCK;
      if (sshAuthSock) {
        sessionEnv.SSH_AUTH_SOCK = sshAuthSock;
      }
      const sshAgentPid = process.env.SSH_AGENT_PID;
      if (sshAgentPid) {
        sessionEnv.SSH_AGENT_PID = sshAgentPid;
      }
    }

    // Merge user-provided env (overrides safe defaults)
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        sessionEnv[key] = value;
      }
    }

    // Merge env sets if provided (later sets override on key collision)
    // NOTE: This must happen BEFORE billing-mode scrubbing so env sets
    // cannot re-inject ANTHROPIC_API_KEY in subscription mode.
    if (options.envSetIds && options.envSetIds.length > 0) {
      for (const envSetId of options.envSetIds) {
        const vars = this.db.decryptEnvSetVars(envSetId);
        Object.assign(sessionEnv, vars);
      }
    }

    // Handle API key based on billing mode (after env set merge)
    if (billingMode === "api") {
      // In API mode, preserve ANTHROPIC_API_KEY (from user env or process.env)
      if (!sessionEnv.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY) {
        sessionEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
      }
      if (!sessionEnv.ANTHROPIC_API_KEY) {
        console.warn(
          `[Session ${sessionId}] billingMode is "api" but ANTHROPIC_API_KEY is not set`
        );
      }
    } else {
      // In subscription mode, scrub API key (env sets cannot override this)
      delete sessionEnv.ANTHROPIC_API_KEY;
    }

    // Always scrub — controls session nesting, not billing
    delete sessionEnv.CLAUDECODE;

    if (codexAppServerSpike?.enrolled) {
      // Scaffold marker for future app-server adapter wiring.
      sessionEnv.CODEPIPER_CODEX_APP_SERVER_SPIKE = "1";
    }

    // Handle worktree creation if requested
    let effectiveCwd = cwd;
    let worktreeMetadata: Record<string, any> | undefined;

    if (options.worktree) {
      const { branch, createBranch, startPoint } = options.worktree;

      const isRepo = await GitUtils.isGitRepo(cwd);
      if (!isRepo) {
        throw new Error(`Not a git repository: ${cwd}`);
      }

      const repoRoot = await GitUtils.getRepoRoot(cwd);
      const worktreePath = GitUtils.getWorktreePath(repoRoot, sessionId);

      // Check if branch is already checked out elsewhere
      if (!createBranch) {
        const branchCheck = await GitUtils.isBranchCheckedOut(repoRoot, branch);
        if (branchCheck.checkedOut) {
          throw new Error(
            `Branch '${branch}' is already checked out${branchCheck.worktreePath ? ` in ${branchCheck.worktreePath}` : ""}`
          );
        }
      }

      await GitUtils.createWorktree({
        repoPath: repoRoot,
        worktreePath,
        branch,
        createBranch,
        startPoint,
      });

      effectiveCwd = worktreePath;
      worktreeMetadata = {
        repoRoot,
        worktreePath,
        branch,
        createdBranch: createBranch,
        originalCwd: cwd,
      };

      if (provider === "claude-code") {
        // Pre-create Claude project directory so the workspace trust prompt is skipped.
        // Claude Code checks ~/.claude/projects/<encoded-path>/ to determine trust.
        const encodedPath = worktreePath.replace(/\//g, "-");
        const projectDir = `${process.env.HOME}/.claude/projects/${encodedPath}`;
        if (!fs.existsSync(projectDir)) {
          fs.mkdirSync(projectDir, { recursive: true });
        }
      }
    }

    // Create image upload directory for this session
    ensurePrivateDirectory(this.getSessionsRootDir());
    const runtimeDir = this.getSessionRuntimeDir(sessionId);
    const imageDir = this.getImageDir(sessionId);
    ensurePrivateDirectory(runtimeDir);
    ensurePrivateDirectory(imageDir);

    let settingsPath: string | undefined;
    if (providerDefinition.prepareSession) {
      const socketPath = process.env.CODEPIPER_UNIX_SOCK || "/tmp/codepiper.sock";
      let secret = process.env.CODEPIPER_SECRET;
      if (!secret) {
        secret = generateEphemeralHookSecret();
        process.env.CODEPIPER_SECRET = secret;
        if (!(process.env.NODE_ENV === "test" || process.env.BUN_TEST === "1")) {
          console.warn(
            "[security] CODEPIPER_SECRET was missing during session creation. Generated an ephemeral secret for this daemon process."
          );
        }
      }

      const preparation = await providerDefinition.prepareSession({
        sessionId,
        runtimeDir,
        socketPath,
        secret,
      });
      settingsPath = preparation.settingsPath;
    }

    const command = providerDefinition.buildCommand({
      sessionId,
      settingsPath,
      providerArgs: args,
      dangerousMode,
      providerResume,
      codexHostAccessProfileEnabled: daemonSettings.codexHostAccessProfileEnabled,
      terminalFeatures: daemonSettings.terminalFeatures,
    });

    // Use provider-configured runtime process.
    let sessionProcess: SessionProcess;

    if (providerDefinition.runtime === "tmux") {
      const outputLogPath = `${runtimeDir}/output.log`;

      sessionProcess = new TmuxSession({
        sessionName: `codepiper-${sessionId}`,
        command,
        cwd: effectiveCwd,
        env: sessionEnv,
        cols: 120,
        rows: 30,
        outputLogPath,
        onData: (data, cursor) => this.handlePtyData(sessionId, data, cursor),
        onExit: (exitCode, signal) => this.handlePtyExit(sessionId, exitCode, signal),
        onModeChange: (mode) => this.handleModeChange(sessionId, mode),
      });
      await sessionProcess.create();

      // Auto-accept workspace trust prompt for worktree sessions.
      // New worktree directories trigger Claude Code's "Do you trust this folder?" prompt.
      // Since we created the worktree ourselves, auto-accept by sending Enter after a delay.
      if (worktreeMetadata) {
        setTimeout(async () => {
          try {
            await (sessionProcess as TmuxSession).sendKey("Enter");
          } catch {
            // Session may have already exited
          }
        }, 2000);
      }
    } else {
      sessionProcess = new PTYProcess({
        command,
        cwd: effectiveCwd,
        env: sessionEnv,
        cols: 120,
        rows: 30,
        onData: (data) => this.handlePtyData(sessionId, data),
        onExit: (exitCode, signal) => this.handlePtyExit(sessionId, exitCode, signal),
      });
    }

    const metadata: SessionMetadataShape = {};
    metadata.launch = {
      args,
      billingMode,
      envSetIds: options.envSetIds ?? [],
    };
    if (providerResume) {
      metadata.providerSession = {
        id: providerResume.providerSessionId,
        mode: providerResume.mode ?? "resume",
        source: "user-supplied",
      };
    } else if (provider === "claude-code") {
      metadata.providerSession = {
        id: sessionId,
        mode: "resume",
        source: "codepiper-session-id",
      };
    } else if (provider === "codex") {
      metadata.providerSession = {
        mode: "resume",
        source: "codex-auto-detect-pending",
      };
    }
    if (worktreeMetadata) {
      metadata.worktree = worktreeMetadata;
    }
    if (dangerousMode) {
      metadata.security = { dangerousMode: true };
    }
    if (provider === "codex" && daemonSettings.codexHostAccessProfileEnabled) {
      metadata.security = {
        ...(metadata.security ?? {}),
        codexHostAccessProfileEnabled: true,
      };
    }
    if (codexAppServerSpike?.configured) {
      metadata.experimental = {
        codexAppServerSpike: {
          configured: codexAppServerSpike.configured,
          enrolled: codexAppServerSpike.enrolled,
          mode: codexAppServerSpike.mode,
        },
      };
    }
    const sessionMetadata = Object.keys(metadata).length > 0 ? metadata : undefined;

    const session: ManagedSession = {
      id: sessionId,
      provider,
      cwd: effectiveCwd,
      status: "STARTING" as SessionStatus,
      createdAt: existingDbSession?.createdAt ?? new Date(),
      updatedAt: new Date(),
      pid: sessionProcess.pid,
      process: sessionProcess,
      metadata: sessionMetadata,
    };

    this.sessions.set(sessionId, session);

    // Persist session to database
    if (reuseExistingRecord) {
      this.db.updateSession(sessionId, {
        status: "STARTING",
        pid: sessionProcess.pid,
        metadata: sessionMetadata,
      });
    } else {
      this.db.createSession({
        id: sessionId,
        provider,
        cwd: effectiveCwd,
        status: "STARTING",
        pid: sessionProcess.pid,
        metadata: sessionMetadata,
      });

      // Auto-apply default policy set if one exists
      const defaultSet = this.db.getDefaultPolicySet();
      if (defaultSet) {
        this.db.applyPolicySetToSession(sessionId, defaultSet.id);
      }
    }

    // Broadcast session state change to WebSocket subscribers
    const handle = this.toHandle(session);
    if (this.wsManager) {
      this.wsManager.broadcastSessionChange(
        reuseExistingRecord
          ? ({
              type: "session_updated",
              session: handle,
            } as any)
          : ({
              type: "session_created",
              session: handle,
            } as any)
      );
    }

    return handle;
  }

  getSession(sessionId: string): SessionHandle | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    return this.toHandle(session);
  }

  /**
   * Register a session for testing or external session management.
   */
  registerSession(handle: SessionHandle, process: SessionProcess): void {
    this.sessions.set(handle.id, { ...handle, process });
  }

  /**
   * Re-adopt an orphaned session whose tmux is still alive but not tracked in memory.
   * Used on daemon restart and via the POST /sessions/:id/recover endpoint.
   */
  async recoverSession(sessionId: string): Promise<SessionHandle> {
    return this.adoptSession(sessionId);
  }

  /**
   * Reopen a closed session by delegating to provider-native resume behavior.
   * This requires a persisted provider session id in metadata.
   */
  async resumeSession(sessionId: string): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return this.toHandle(existing);
    }

    const dbSession = this.db.getSession(sessionId);
    if (!dbSession) {
      throw new SessionNotFoundError(sessionId);
    }

    const tmuxName = `codepiper-${sessionId}`;
    const check = Bun.spawnSync(["tmux", "has-session", "-t", tmuxName], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if (check.exitCode === 0) {
      throw new Error(
        `Session ${sessionId} still has a live tmux runtime. Use recover to re-adopt it.`
      );
    }

    const metadata = (dbSession.metadata ?? {}) as SessionMetadataShape;
    const launch = metadata.launch;

    let providerSessionId = metadata.providerSession?.id;
    if (!(providerSessionId && providerSessionId.trim().length > 0)) {
      if (dbSession.provider === "claude-code") {
        providerSessionId = sessionId;
      } else if (dbSession.provider === "codex") {
        providerSessionId = await this.detectCodexProviderSessionId(dbSession.cwd, {
          timeoutMs: 1500,
          cwdTimestampFloor: dbSession.updatedAt.getTime(),
        });
      }
    }

    if (!(providerSessionId && providerSessionId.trim().length > 0)) {
      throw new Error(
        `Provider session id is unavailable for ${dbSession.provider}. Start a new session and set "Resume by Provider Session ID" manually.`
      );
    }

    return await this.createSession({
      provider: dbSession.provider,
      cwd: dbSession.cwd,
      args: launch?.args ?? [],
      billingMode: launch?.billingMode ?? "subscription",
      dangerousMode: isDangerousModeMetadata(metadata),
      envSetIds: launch?.envSetIds ?? [],
      providerResume: {
        providerSessionId,
        mode: "resume",
      },
      sessionIdOverride: sessionId,
      reuseExistingRecord: true,
    });
  }

  async adoptSession(sessionId: string): Promise<SessionHandle> {
    // Already managed — return existing handle
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return this.toHandle(existing);
    }

    // Load from DB
    const dbSession = this.db.getSession(sessionId);
    if (!dbSession) {
      throw new SessionNotFoundError(sessionId);
    }

    const providerDefinition = getProviderDefinition(dbSession.provider);
    if (
      providerDefinition.runtime !== "tmux" ||
      !providerDefinition.capabilities.supportsTmuxAdoption
    ) {
      throw new Error(
        `Cannot adopt provider ${dbSession.provider} (runtime: ${providerDefinition.runtime})`
      );
    }

    // Verify tmux session actually exists
    const tmuxName = `codepiper-${sessionId}`;
    const check = Bun.spawnSync(["tmux", "has-session", "-t", tmuxName], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if (check.exitCode !== 0) {
      // Tmux is gone — mark STOPPED and throw
      this.db.updateSession(sessionId, { status: "STOPPED" });
      throw new Error(`Tmux session ${tmuxName} is no longer running`);
    }

    // Create TmuxSession that attaches to the existing tmux
    const sessionProcess = new TmuxSession({
      sessionName: tmuxName,
      command: [], // Not needed — session already running
      cwd: dbSession.cwd,
      env: {},
      cols: dbSession.ptyCols || 120,
      rows: dbSession.ptyRows || 30,
      onData: (data, cursor) => this.handlePtyData(sessionId, data, cursor),
      onExit: (exitCode, signal) => this.handlePtyExit(sessionId, exitCode, signal),
      onModeChange: (mode) => this.handleModeChange(sessionId, mode),
    });

    // Adopt: start polling + exit monitoring without creating new tmux session
    await sessionProcess.adopt();

    const session: ManagedSession = {
      id: sessionId,
      provider: dbSession.provider,
      cwd: dbSession.cwd,
      status: "RUNNING" as SessionStatus,
      createdAt: dbSession.createdAt,
      updatedAt: new Date(),
      pid: sessionProcess.pid,
      process: sessionProcess,
      transcriptPath: dbSession.transcriptPath,
      metadata: dbSession.metadata,
    };

    this.sessions.set(sessionId, session);
    this.db.updateSession(sessionId, { status: "RUNNING" });

    // Broadcast status update
    if (this.wsManager) {
      this.wsManager.broadcastSessionChange({
        type: "session_updated",
        session: this.toHandle(session),
      } as any);
    }

    // Resume transcript tailer if path is known
    if (dbSession.transcriptPath) {
      try {
        await this.startTranscriptTailer(
          sessionId,
          dbSession.transcriptPath,
          this.db,
          this.eventBus
        );
      } catch {
        // Transcript resumption is best-effort
      }
    }

    console.log(`Adopted orphaned session ${sessionId} (tmux: ${tmuxName})`);
    return this.toHandle(session);
  }

  listSessions(): SessionHandle[] {
    return Array.from(this.sessions.values()).map((s) => this.toHandle(s));
  }

  async getSessionOutput(sessionId: string): Promise<string> {
    const session = this.requireSession(sessionId);
    if (session.process instanceof TmuxSession) {
      session.process.ensurePolling();
      return await session.process.captureVisiblePane();
    }
    return "";
  }

  async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.requireSession(sessionId);
    if ("resize" in session.process && typeof session.process.resize === "function") {
      await session.process.resize(cols, rows);
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);

    await this.stopTranscriptTailer(sessionId);

    if (!session.process.closed) {
      try {
        session.process.write("\x04"); // Ctrl+D for graceful exit
        await session.process.kill("SIGTERM");
      } catch (err) {
        console.error(`Error stopping session ${sessionId}:`, err);
        // Try to force kill if graceful stop fails
        try {
          await session.process.kill("SIGKILL");
        } catch (killErr) {
          console.error(`Force kill also failed for ${sessionId}:`, killErr);
        }
      }
    }

    session.status = "STOPPED";
    session.updatedAt = new Date();

    // Worktree cleanup (graceful: stash + remove without force)
    const worktreeInfo = session.metadata?.worktree as
      | { repoRoot: string; worktreePath: string }
      | undefined;
    if (worktreeInfo) {
      try {
        await GitUtils.stashChanges(worktreeInfo.worktreePath, sessionId);
        await GitUtils.removeWorktree(worktreeInfo.repoRoot, worktreeInfo.worktreePath, false);
      } catch (err) {
        console.warn(`Worktree cleanup failed for session ${sessionId}:`, err);
        // Don't fail the stop — worktree can be cleaned up manually
      }
    }

    // Clean up image upload directory
    this.cleanupSessionSecretFiles(sessionId);
    this.cleanupImageDir(sessionId);

    // Persist status change to database
    this.db.updateSession(sessionId, {
      status: "STOPPED",
    });

    this.wsManager?.clearPtySequence(sessionId);
    this.inputQueueBySession.delete(sessionId);
    this.codexBannerBufferBySession.delete(sessionId);

    // Remove from in-memory map to prevent memory leak
    this.sessions.delete(sessionId);
  }

  async killSession(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);

    await this.stopTranscriptTailer(sessionId);

    if (!session.process.closed) {
      try {
        await session.process.kill("SIGKILL");
      } catch (err) {
        console.error(`Error killing session ${sessionId}:`, err);
        throw err; // Propagate error for force kill failures
      }
    }

    session.status = "STOPPED";
    session.updatedAt = new Date();

    // Worktree cleanup (force: remove without stashing)
    const worktreeInfo = session.metadata?.worktree as
      | { repoRoot: string; worktreePath: string }
      | undefined;
    if (worktreeInfo) {
      try {
        await GitUtils.removeWorktree(worktreeInfo.repoRoot, worktreeInfo.worktreePath, true);
      } catch (err) {
        console.error(`Force worktree removal failed for session ${sessionId}:`, err);
      }
    }

    // Clean up image upload directory
    this.cleanupSessionSecretFiles(sessionId);
    this.cleanupImageDir(sessionId);

    // Persist status change to database
    this.db.updateSession(sessionId, {
      status: "STOPPED",
    });

    // Broadcast session update to WebSocket subscribers
    if (this.wsManager) {
      this.wsManager.broadcastSessionChange({
        type: "session_updated",
        session: { ...this.toHandle(session), status: "STOPPED" },
      } as any);
    }

    this.wsManager?.clearPtySequence(sessionId);
    this.inputQueueBySession.delete(sessionId);
    this.codexBannerBufferBySession.delete(sessionId);

    // Remove from in-memory map to prevent memory leak
    this.sessions.delete(sessionId);
  }

  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.sessions.keys()).map(async (sessionId) => {
      try {
        await this.stopTranscriptTailer(sessionId);
        await this.stopSession(sessionId);
      } catch {
        // Ignore errors, continue stopping others
      }
    });

    await Promise.all(stopPromises);
  }

  /**
   * Detach from all managed sessions without killing them.
   * Stops tailers and saves transcript offsets, clears in-memory state,
   * but leaves tmux sessions alive and DB status as RUNNING.
   * Used for graceful daemon restart with session preservation.
   */
  async detachAll(): Promise<void> {
    const detachPromises = Array.from(this.sessions.keys()).map(async (sessionId) => {
      try {
        await this.stopTranscriptTailer(sessionId);

        const session = this.sessions.get(sessionId);
        if (session?.process instanceof TmuxSession) {
          session.process.detach();
        }
      } catch {
        // Ignore errors, continue detaching others
      }
    });

    await Promise.all(detachPromises);
    if (this.wsManager) {
      for (const sessionId of this.sessions.keys()) {
        this.wsManager.clearPtySequence(sessionId);
      }
    }
    this.inputQueueBySession.clear();
    this.sessions.clear();
  }

  async sendText(sessionId: string, text: string): Promise<void> {
    await this.enqueueInputOperation(sessionId, async () => {
      const session = this.requireSession(sessionId);

      if (session.process.closed) {
        throw new Error(`Session ${sessionId} is closed`);
      }

      // Auto-exit scroll/search mode so typing goes to the live session
      await this.autoExitScrollMode(session);

      try {
        session.process.write(text);
        session.updatedAt = new Date();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to send text to session ${sessionId}: ${errorMsg}`);
      }
    });
  }

  flushWrites(sessionId: string): void {
    const session = this.requireSession(sessionId);

    // Flush pending writes if the session supports it (TmuxSession)
    if ("flush" in session.process && typeof session.process.flush === "function") {
      session.process.flush();
    }
  }

  async sendKeys(sessionId: string, keys: string[]): Promise<void> {
    await this.enqueueInputOperation(sessionId, async () => {
      const session = this.requireSession(sessionId);

      if (session.process.closed) {
        throw new Error(`Session ${sessionId} is closed`);
      }

      // Auto-exit scroll/search mode so keys go to the live session
      await this.autoExitScrollMode(session);

      try {
        // For TmuxSession, use sendKey() for special keys
        if ("sendKey" in session.process && typeof session.process.sendKey === "function") {
          for (const key of keys) {
            const normalized = key.trim().toLowerCase();
            // Map common key names to tmux key names
            const tmuxKey = this.mapToTmuxKey(normalized);
            await session.process.sendKey(tmuxKey);
          }
        } else {
          // For PTYProcess, use write() with control sequences
          for (const key of keys) {
            const normalized = key.trim().toLowerCase();
            session.process.write(this.mapToPtyKeySequence(normalized));
          }
        }
        session.updatedAt = new Date();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to send keys to session ${sessionId}: ${errorMsg}`);
      }
    });
  }

  private enqueueInputOperation(sessionId: string, operation: () => Promise<void>): Promise<void> {
    const current = this.inputQueueBySession.get(sessionId) ?? Promise.resolve();
    const next = current.catch(() => undefined).then(operation);

    const tracked = next.finally(() => {
      if (this.inputQueueBySession.get(sessionId) === tracked) {
        this.inputQueueBySession.delete(sessionId);
      }
    });

    this.inputQueueBySession.set(sessionId, tracked);
    return tracked;
  }

  private mapToTmuxKey(key: string): string {
    const special = TMUX_SPECIAL_KEY_MAP[key];
    if (special) {
      return special;
    }

    if (key.startsWith("ctrl+")) {
      return this.mapModifierToTmuxKey("C", key.slice(5));
    }
    if (key.startsWith("alt+")) {
      return this.mapModifierToTmuxKey("M", key.slice(4));
    }

    return key;
  }

  private mapModifierToTmuxKey(prefix: "C" | "M", rawToken: string): string {
    const token = rawToken.trim().toLowerCase();
    if (!token) {
      return `${prefix}-${rawToken}`;
    }

    if (token === "space") {
      return `${prefix}-Space`;
    }
    if (token.length === 1) {
      return `${prefix}-${token}`;
    }

    const named = TMUX_SPECIAL_KEY_MAP[token];
    if (named) {
      return `${prefix}-${named}`;
    }

    return `${prefix}-${rawToken}`;
  }

  private mapToPtyKeySequence(key: string): string {
    const special = PTY_SPECIAL_KEY_SEQUENCES[key];
    if (special) {
      return special;
    }

    if (key.startsWith("ctrl+")) {
      const ctrlToken = key.slice(5).trim().toLowerCase();
      const ctrlSequence = resolveCtrlSequence(ctrlToken);
      if (ctrlSequence) {
        return ctrlSequence;
      }
    }

    if (key.startsWith("alt+")) {
      const altToken = key.slice(4).trim().toLowerCase();
      const altSequence = resolveAltSequence(altToken);
      if (altSequence) {
        return `\x1b${altSequence}`;
      }
    }

    return key;
  }

  // --- Terminal mode methods (delegated to TmuxSession) ---

  private requireTmuxSession(sessionId: string): TmuxSession {
    const session = this.requireSession(sessionId);
    if (!(session.process instanceof TmuxSession)) {
      throw new Error("Terminal modes are only supported for tmux sessions");
    }
    return session.process;
  }

  private async autoExitScrollMode(session: ManagedSession): Promise<void> {
    if (session.process instanceof TmuxSession && session.process.mode !== "interactive") {
      await session.process.exitScrollMode();
    }
  }

  getTerminalMode(sessionId: string): TerminalMode {
    return this.requireTmuxSession(sessionId).mode;
  }

  async getTerminalInfo(sessionId: string): Promise<TerminalInfo> {
    return this.requireTmuxSession(sessionId).getTerminalInfo();
  }

  async enterScrollMode(sessionId: string): Promise<void> {
    await this.requireTmuxSession(sessionId).enterScrollMode();
  }

  async exitScrollMode(sessionId: string): Promise<void> {
    await this.requireTmuxSession(sessionId).exitScrollMode();
  }

  async scrollTerminal(
    sessionId: string,
    direction: "up" | "down",
    options?: { lines?: number; page?: boolean }
  ): Promise<void> {
    const tmux = this.requireTmuxSession(sessionId);
    if (options?.page) {
      await tmux.scrollPage(direction);
    } else {
      await tmux.scroll(direction, options?.lines ?? 1);
    }
  }

  async scrollToEdge(sessionId: string, edge: "top" | "bottom"): Promise<void> {
    await this.requireTmuxSession(sessionId).scrollToEdge(edge);
  }

  async searchTerminal(sessionId: string, query: string): Promise<void> {
    await this.requireTmuxSession(sessionId).searchBackward(query);
  }

  async searchNext(sessionId: string): Promise<void> {
    await this.requireTmuxSession(sessionId).searchNext();
  }

  async searchPrevious(sessionId: string): Promise<void> {
    await this.requireTmuxSession(sessionId).searchPrevious();
  }

  /**
   * Switch model for a session (claude-code only)
   * Uses the /model slash command
   */
  async switchModel(sessionId: string, model: string): Promise<void> {
    const session = this.requireSession(sessionId);

    const capabilities = getProviderDefinition(session.provider).capabilities;
    if (!capabilities.supportsModelSwitch) {
      throw new Error(`Model switching is not supported for provider ${session.provider}`);
    }

    if (session.process.closed) {
      throw new Error(`Session ${sessionId} is closed`);
    }

    try {
      // Send /model command
      const command = `/model ${model}\r`;
      session.process.write(command);

      // Update metadata to track current model
      session.metadata = {
        ...session.metadata,
        currentModel: model,
      };
      session.updatedAt = new Date();

      // Update database
      this.db.updateSession(sessionId, {
        metadata: session.metadata,
      });

      // Record model switch in database
      this.db.insertModelSwitch({
        sessionId,
        fromModel: session.metadata?.previousModel as string | undefined,
        toModel: model,
        reason: "Manual model switch via API",
      });

      // Update previous model for next switch
      session.metadata.previousModel = model;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to switch model for session ${sessionId}: ${errorMsg}`);
    }
  }

  /**
   * Get current model for a session
   */
  getCurrentModel(sessionId: string): string | undefined {
    const session = this.requireSession(sessionId);
    return session.metadata?.currentModel as string | undefined;
  }

  updateSessionStatus(sessionId: string, status: SessionStatus): void {
    const session = this.requireSession(sessionId);
    session.status = status;
    session.updatedAt = new Date();
  }

  updateSessionMetadata(
    sessionId: string,
    updates: { transcriptPath?: string; [key: string]: any }
  ): void {
    const session = this.requireSession(sessionId);

    if (updates.transcriptPath !== undefined) {
      session.transcriptPath = updates.transcriptPath;
    }

    const { transcriptPath, ...metadataUpdates } = updates;
    if (Object.keys(metadataUpdates).length > 0) {
      session.metadata = { ...session.metadata, ...metadataUpdates };
    }

    session.updatedAt = new Date();
  }

  setSessionCustomName(sessionId: string, customName: string | null): SessionHandle {
    const session = this.requireSession(sessionId);
    const currentMetadata = (session.metadata ?? {}) as SessionMetadataShape;
    const currentUi = isObjectRecord(currentMetadata.ui) ? currentMetadata.ui : {};
    const nextUi = { ...currentUi };

    if (customName) {
      nextUi.customName = customName;
    } else {
      delete nextUi.customName;
    }

    const nextMetadata: SessionMetadataShape = { ...currentMetadata };
    if (Object.keys(nextUi).length > 0) {
      nextMetadata.ui = nextUi;
    } else {
      delete nextMetadata.ui;
    }

    const persistedMetadata = Object.keys(nextMetadata).length > 0 ? nextMetadata : {};
    session.metadata = persistedMetadata;
    session.updatedAt = new Date();
    this.db.updateSession(sessionId, { metadata: persistedMetadata });

    if (this.wsManager) {
      this.wsManager.broadcastSessionChange({
        type: "session_updated",
        session: this.toHandle(session),
      } as any);
    }

    return this.toHandle(session);
  }

  private async detectCodexProviderSessionId(
    cwd: string,
    opts?: { timeoutMs?: number; cwdTimestampFloor?: number }
  ): Promise<string | undefined> {
    const timeoutMs = opts?.timeoutMs ?? 6000;
    const cwdTimestampFloor = opts?.cwdTimestampFloor ?? Date.now() - 30_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const candidate = this.findCodexProviderSessionId(cwd, cwdTimestampFloor);
      if (candidate) {
        return candidate;
      }
      await Bun.sleep(250);
    }

    return undefined;
  }

  private findCodexProviderSessionId(cwd: string, cwdTimestampFloor: number): string | undefined {
    const codexSessionsRoot = path.join(getHomeDir(), ".codex", "sessions");
    if (!fs.existsSync(codexSessionsRoot)) {
      return undefined;
    }

    const targetCwd = path.resolve(cwd);
    const filePaths: string[] = [];
    const stack = [codexSessionsRoot];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (!dir) {
        continue;
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }
        if (entry.isFile() && /^rollout-.*\.jsonl$/i.test(entry.name)) {
          filePaths.push(entryPath);
        }
      }
    }

    const fileMtime = (filePath: string): number => {
      try {
        return fs.statSync(filePath).mtimeMs;
      } catch {
        return 0;
      }
    };
    filePaths.sort((a, b) => fileMtime(b) - fileMtime(a));

    for (const filePath of filePaths) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (stat.mtimeMs < cwdTimestampFloor) {
        continue;
      }

      let firstLine = "";
      try {
        const content = fs.readFileSync(filePath, "utf8");
        firstLine = content.split("\n", 1)[0] ?? "";
      } catch {
        continue;
      }
      if (!firstLine) {
        continue;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(firstLine);
      } catch {
        continue;
      }

      const payload = parsed?.payload;
      const providerSessionId = payload?.id;
      const payloadCwd = payload?.cwd;
      if (
        typeof providerSessionId === "string" &&
        providerSessionId.length > 0 &&
        typeof payloadCwd === "string"
      ) {
        try {
          if (path.resolve(payloadCwd) === targetCwd) {
            return providerSessionId;
          }
        } catch {
          // Ignore malformed path segments and continue scanning.
        }
      }
    }

    return undefined;
  }

  async setTranscriptPath(
    sessionId: string,
    transcriptPath: string,
    db: Database,
    eventBus: EventBus
  ): Promise<void> {
    const session = this.requireSession(sessionId);

    session.transcriptPath = transcriptPath;
    session.updatedAt = new Date();

    await this.startTranscriptTailer(sessionId, transcriptPath, db, eventBus);
  }

  hasActiveTailer(sessionId: string): boolean {
    return this.tailers.has(sessionId);
  }

  // --- Private helpers ---

  private requireSession(sessionId: string): ManagedSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    return session;
  }

  private toHandle(session: ManagedSession): SessionHandle {
    const { process: _, ...handle } = session;
    return handle;
  }

  private async startTranscriptTailer(
    sessionId: string,
    transcriptPath: string,
    db: Database,
    eventBus: EventBus
  ): Promise<void> {
    await this.stopTranscriptTailer(sessionId);

    const { byteOffset } = db.getTranscriptOffset(sessionId, transcriptPath);

    const tailer = new TranscriptTailer({
      sessionId,
      transcriptPath,
      initialOffset: byteOffset,
      onLine: (line, offset) => {
        this.handleTranscriptLine(sessionId, line, offset, db, eventBus);
      },
      onError: (err) => {
        console.error(`Transcript tailer error for session ${sessionId}:`, err);
      },
    });

    await tailer.start();

    this.tailers.set(sessionId, tailer);
    this.tailerContexts.set(sessionId, { db, transcriptPath });

    this.saveOffsetIntervals.set(
      sessionId,
      setInterval(() => this.saveTranscriptOffset(sessionId), 1000)
    );
  }

  async stopTranscriptTailer(sessionId: string): Promise<void> {
    this.saveTranscriptOffset(sessionId);

    const tailer = this.tailers.get(sessionId);
    if (tailer) {
      await tailer.stop();
      this.tailers.delete(sessionId);
    }

    const interval = this.saveOffsetIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.saveOffsetIntervals.delete(sessionId);
    }

    this.tailerContexts.delete(sessionId);
  }

  private handleTranscriptLine(
    sessionId: string,
    line: string,
    _offset: number,
    db: Database,
    eventBus: EventBus
  ): void {
    try {
      const parsed = JSON.parse(line);
      const type = parsed.type || "unknown";

      const eventId = db.insertEvent({
        sessionId,
        source: "transcript",
        type,
        payload: parsed,
      });

      // Extract token usage from assistant messages
      if (type === "assistant" && parsed.message?.usage) {
        const usage = parsed.message.usage;
        const promptTokens = usage.input_tokens || 0;
        const completionTokens = usage.output_tokens || 0;
        const cacheCreation = usage.cache_creation_input_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;

        db.insertTokenUsage({
          sessionId,
          eventId,
          model: parsed.message.model || "unknown",
          promptTokens,
          completionTokens,
          cacheCreationInputTokens: cacheCreation,
          cacheReadInputTokens: cacheRead,
          totalTokens: promptTokens + completionTokens + cacheCreation + cacheRead,
        });
      }

      eventBus.emit("session:event", {
        id: eventId,
        sessionId,
        type,
        source: "transcript",
        timestamp: new Date(),
        payload: parsed,
      });
    } catch (error) {
      console.error(`Failed to parse transcript line for session ${sessionId}:`, error);
    }
  }

  private saveTranscriptOffset(sessionId: string): void {
    const tailer = this.tailers.get(sessionId);
    const context = this.tailerContexts.get(sessionId);
    if (!(tailer && context)) {
      return;
    }

    context.db.updateTranscriptOffset(sessionId, context.transcriptPath, {
      byteOffset: tailer.getCurrentOffset(),
      lastLineHash: null,
    });
  }

  private cleanupImageDir(sessionId: string): void {
    const imageDir = this.getImageDir(sessionId);
    try {
      if (fs.existsSync(imageDir)) {
        fs.rmSync(imageDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn(`Image dir cleanup failed for session ${sessionId}:`, err);
    }
  }

  private cleanupSessionSecretFiles(sessionId: string): void {
    const runtimeDir = this.getSessionRuntimeDir(sessionId);
    const filesToRemove = [
      `${sessionId}.json`,
      `${sessionId}.hook-forward.sh`,
      `${sessionId}.statusline-forward.sh`,
    ];

    for (const fileName of filesToRemove) {
      const filePath = path.join(runtimeDir, fileName);
      try {
        if (fs.existsSync(filePath)) {
          fs.rmSync(filePath, { force: true });
        }
      } catch (err) {
        console.warn(`Overlay cleanup failed for session ${sessionId} (${fileName}):`, err);
      }
    }
  }

  private isExpectedClosedDbError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return error.message.toLowerCase().includes("closed database");
  }

  private handlePtyData(sessionId: string, data: string, cursor?: TerminalCursor): void {
    const session = this.sessions.get(sessionId);

    // Update session status on first output
    if (session && session.status === "STARTING") {
      session.status = "RUNNING";
      session.updatedAt = new Date();
      try {
        this.db.updateSession(sessionId, { status: "RUNNING" });
      } catch (error) {
        // Session callbacks may race with daemon shutdown/db close.
        if (!this.isExpectedClosedDbError(error)) {
          console.warn(`Failed to persist RUNNING status for session ${sessionId}:`, error);
        }
      }

      // Broadcast status change to WebSocket subscribers
      if (this.wsManager) {
        this.wsManager.broadcastSessionChange({
          type: "session_updated",
          session: this.toHandle(session),
        } as any);
      }
    }

    this.maybeCaptureCodexProviderSessionIdFromOutput(sessionId, data);

    // Broadcast PTY/Tmux output to WebSocket subscribers
    if (this.wsManager) {
      if (cursor) {
        this.wsManager.broadcastPtyData(sessionId, data, cursor);
      } else {
        this.wsManager.broadcastPtyData(sessionId, data);
      }
    }
  }

  private handleModeChange(sessionId: string, mode: TerminalMode): void {
    if (this.wsManager) {
      this.wsManager.broadcastSessionEvent(sessionId, {
        type: "terminal_mode_change",
        sessionId,
        mode,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private handlePtyExit(sessionId: string, exitCode: number, _signal: string | null): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const newStatus = exitCode === 0 ? "STOPPED" : "CRASHED";
    session.status = newStatus;
    session.updatedAt = new Date();
    try {
      this.db.updateSession(sessionId, { status: newStatus });
    } catch (error) {
      if (!this.isExpectedClosedDbError(error)) {
        console.warn(`Failed to persist exit status for session ${sessionId}:`, error);
      }
    }

    // Broadcast status change to WebSocket subscribers
    if (this.wsManager) {
      this.wsManager.broadcastSessionChange({
        type: "session_updated",
        session: this.toHandle(session),
      } as any);
    }

    // Natural exits can happen outside explicit stop/kill paths.
    // Ensure per-session resources are cleaned up and in-memory state is released.
    void this.cleanupExitedSession(sessionId).catch((error) => {
      console.warn(`Session exit cleanup failed for ${sessionId}:`, error);
    });
  }

  private async cleanupExitedSession(sessionId: string): Promise<void> {
    // Session may already be cleaned up by stop/kill concurrent path.
    if (!this.sessions.has(sessionId)) {
      return;
    }

    await this.stopTranscriptTailer(sessionId);
    this.cleanupSessionSecretFiles(sessionId);
    this.cleanupImageDir(sessionId);
    this.wsManager?.clearPtySequence(sessionId);
    this.inputQueueBySession.delete(sessionId);
    this.codexBannerBufferBySession.delete(sessionId);
    this.sessions.delete(sessionId);
  }

  private maybeCaptureCodexProviderSessionIdFromOutput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.provider !== "codex") {
      return;
    }

    const currentMetadata = (session.metadata ?? {}) as SessionMetadataShape;
    if (
      typeof currentMetadata.providerSession?.id === "string" &&
      currentMetadata.providerSession.id.trim().length > 0
    ) {
      this.codexBannerBufferBySession.delete(sessionId);
      return;
    }

    const stripped = stripVTControlCharacters(data);
    const prior = this.codexBannerBufferBySession.get(sessionId) ?? "";
    const combined = `${prior}${stripped}`;
    const match = combined.match(CODEX_SESSION_BANNER_REGEX);
    if (!match) {
      this.codexBannerBufferBySession.set(
        sessionId,
        combined.slice(-CODEX_SESSION_BANNER_BUFFER_BYTES)
      );
      return;
    }

    const providerSessionId = match[1];
    const nextMetadata: SessionMetadataShape = {
      ...currentMetadata,
      providerSession: {
        ...(currentMetadata.providerSession ?? {}),
        id: providerSessionId,
        mode: currentMetadata.providerSession?.mode ?? "resume",
        source: "codex-session-configured-banner",
      },
    };

    session.metadata = nextMetadata;
    session.updatedAt = new Date();
    this.codexBannerBufferBySession.delete(sessionId);

    try {
      this.db.updateSession(sessionId, { metadata: nextMetadata });
    } catch (error) {
      if (!this.isExpectedClosedDbError(error)) {
        console.warn(`Failed to persist codex provider session id for ${sessionId}:`, error);
      }
    }

    if (this.wsManager) {
      this.wsManager.broadcastSessionChange({
        type: "session_updated",
        session: this.toHandle(session),
      } as any);
    }
  }
}
