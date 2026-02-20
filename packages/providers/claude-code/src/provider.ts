/**
 * Claude Code provider implementation
 *
 * Spawns and manages Claude Code sessions via PTY, configuring hooks
 * for event forwarding to the CodePiper daemon.
 */

import { randomBytes } from "node:crypto";
import type {
  Provider,
  ProviderEvent,
  ProviderId,
  SessionHandle,
  StartSessionOptions,
} from "@codepiper/core";
import { PTYProcess } from "@codepiper/daemon";
import { generateOverlaySettings } from "./overlaySettings";

interface ActiveSession {
  handle: SessionHandle;
  pty: PTYProcess;
  settingsPath: string;
  currentModel?: string;
}

/**
 * Key name to escape sequence mapping
 */
const KEY_SEQUENCES: Record<string, string> = {
  // Basic keys
  enter: "\r",
  return: "\r",
  tab: "\t",
  "shift+tab": "\x1b[Z",
  escape: "\x1b",
  esc: "\x1b",
  space: " ",
  backspace: "\x7f",
  delete: "\x1b[3~",

  // Control keys
  "ctrl+a": "\x01",
  "ctrl+b": "\x02",
  "ctrl+c": "\x03",
  "ctrl+d": "\x04",
  "ctrl+e": "\x05",
  "ctrl+f": "\x06",
  "ctrl+g": "\x07",
  "ctrl+h": "\x08",
  "ctrl+i": "\x09",
  "ctrl+j": "\x0a",
  "ctrl+k": "\x0b",
  "ctrl+l": "\x0c",
  "ctrl+m": "\x0d",
  "ctrl+n": "\x0e",
  "ctrl+o": "\x0f",
  "ctrl+p": "\x10",
  "ctrl+q": "\x11",
  "ctrl+r": "\x12",
  "ctrl+s": "\x13",
  "ctrl+t": "\x14",
  "ctrl+u": "\x15",
  "ctrl+v": "\x16",
  "ctrl+w": "\x17",
  "ctrl+x": "\x18",
  "ctrl+y": "\x19",
  "ctrl+z": "\x1a",

  // Arrow keys
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",

  // Function keys
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

  // Special
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  insert: "\x1b[2~",
};

export class ClaudeCodeProvider implements Provider {
  public readonly id: ProviderId = "claude-code";

  private sessions: Map<string, ActiveSession> = new Map();
  private eventCallbacks: Array<(evt: ProviderEvent) => void> = [];
  private socketPath: string;
  private enableStatusline: boolean;

  constructor(options?: {
    socketPath?: string;
    enableStatusline?: boolean;
  }) {
    this.socketPath = options?.socketPath || "/tmp/codepiper.sock";
    this.enableStatusline = options?.enableStatusline ?? false;
  }

  async startSession(opts: StartSessionOptions): Promise<SessionHandle> {
    const { id: sessionId, cwd, env, args = [], model, billingMode } = opts;

    // Conditionally scrub ANTHROPIC_API_KEY based on billing mode
    const cleanEnv = { ...env };
    if ((billingMode ?? "subscription") === "subscription") {
      delete cleanEnv.ANTHROPIC_API_KEY;
    }

    // Generate per-session secret for hook authentication
    const secret = randomBytes(32).toString("hex");

    // Generate overlay settings file
    const settingsPath = await generateOverlaySettings({
      sessionId,
      socketPath: this.socketPath,
      secret,
      enableStatusline: this.enableStatusline,
    });

    // Build command arguments
    const command = ["claude", "--session-id", sessionId, "--settings", settingsPath];

    // Add model flag if specified
    if (model) {
      command.push("--model", model);
    }

    command.push(...args);

    // Create session handle
    const handle: SessionHandle = {
      id: sessionId,
      provider: this.id,
      cwd,
      status: "STARTING",
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        settingsPath,
        secret,
      },
    };

    // Spawn PTY process
    const pty = new PTYProcess({
      command,
      cwd,
      env: cleanEnv,
      cols: 120,
      rows: 30,
      onData: (data) => {
        this.emitEvent({
          sessionId,
          type: "pty_output",
          timestamp: new Date(),
          payload: { data },
        });
      },
      onExit: (exitCode, signal) => {
        this.emitEvent({
          sessionId,
          type: "pty_exit",
          timestamp: new Date(),
          payload: { exitCode, signal },
        });

        // Update handle and clean up
        const session = this.sessions.get(sessionId);
        if (session) {
          session.handle.status = exitCode === 0 ? "STOPPED" : "CRASHED";
          session.handle.updatedAt = new Date();
          this.sessions.delete(sessionId);
        }
      },
    });

    // Update handle with PID
    handle.pid = pty.pid;

    // Store session
    const activeSession: ActiveSession = {
      handle,
      pty,
      settingsPath,
    };
    if (model !== undefined) {
      activeSession.currentModel = model;
    }
    this.sessions.set(sessionId, activeSession);

    return handle;
  }

  async sendText(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.pty.write(text);
    session.handle.updatedAt = new Date();
  }

  async sendKeys(sessionId: string, keys: string[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    for (const key of keys) {
      const sequence = KEY_SEQUENCES[key.toLowerCase()];
      if (sequence) {
        session.pty.write(sequence);
      } else {
        // If not a special key, write it directly
        session.pty.write(key);
      }
    }

    session.handle.updatedAt = new Date();
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    await session.pty.kill();
    session.handle.status = "STOPPED";
    session.handle.updatedAt = new Date();

    this.sessions.delete(sessionId);
  }

  /**
   * Switch the model for an active session
   *
   * Uses the /model slash command to change the model in Claude Code
   *
   * @param sessionId - Session ID
   * @param model - Model name (e.g., "sonnet", "opus", "haiku", "opusplan")
   */
  async switchModel(sessionId: string, model: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Send /model slash command
    const command = `/model ${model}\r`;
    session.pty.write(command);

    // Update current model
    session.currentModel = model;
    session.handle.updatedAt = new Date();

    // Emit model switch event
    this.emitEvent({
      sessionId,
      type: "model_switch",
      timestamp: new Date(),
      payload: { model },
    });
  }

  /**
   * Get the current model for a session
   */
  getCurrentModel(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    return session?.currentModel;
  }

  onEvent(cb: (evt: ProviderEvent) => void): void {
    this.eventCallbacks.push(cb);
  }

  /**
   * Get list of active session IDs (useful for testing)
   */
  getSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Emit event to all registered callbacks
   */
  private emitEvent(evt: ProviderEvent): void {
    for (const cb of this.eventCallbacks) {
      try {
        cb(evt);
      } catch (error) {
        console.error("Error in event callback:", error);
      }
    }
  }
}
