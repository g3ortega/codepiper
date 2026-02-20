/**
 * TmuxSession - manages a tmux session for true TTY support
 *
 * Provides real terminal for applications like Claude Code that rely on
 * physical keyboard input vs programmatic PTY input (Ink library limitation).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type TerminalMode = "interactive" | "scroll" | "search";

const SAFE_FALLBACK_ENV_KEYS = [
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
];
const SAFE_ENV_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export interface TerminalInfo {
  mode: TerminalMode;
  cols: number;
  rows: number;
  scrollPosition?: number;
  historySize?: number;
}

export interface TerminalCursor {
  x: number;
  y: number;
  visible: boolean;
}

export interface TmuxSessionOptions {
  sessionName: string;
  command: string[];
  cwd: string;
  env: Record<string, string>;
  cols?: number;
  rows?: number;
  historyLimit?: number;
  onData?: (data: string, cursor?: TerminalCursor) => void;
  onExit?: (exitCode: number, signal: string | null) => void;
  onModeChange?: (mode: TerminalMode) => void;
  outputLogPath?: string; // Path to log all session output
}

interface PaneSnapshot {
  content: string;
  cursor: TerminalCursor | null;
}

export class TmuxSession {
  private sessionName: string;
  private command: string[];
  private cwd: string;
  private env: Record<string, string>;
  private cols: number;
  private rows: number;
  private historyLimit: number;
  private onDataCallback?: (data: string, cursor?: TerminalCursor) => void;
  private onExitCallback?: (exitCode: number, signal: string | null) => void;
  private pollTimeout?: Timer;
  private monitorInterval?: Timer;
  private lastContent = "";
  private consecutiveUnchanged = 0;
  private consecutiveErrors = 0;
  private outputLogPath?: string;
  private writeBuffer = "";
  private writeTimer?: Timer;
  private _closed = false;
  private _exitCallbackFired = false;
  private _pid?: number;
  private _mode: TerminalMode = "interactive";
  private onModeChangeCallback?: (mode: TerminalMode) => void;
  private pollCount = 0;
  private lastPollTime = 0;
  private lastCursor: TerminalCursor | null = null;
  private cursorMarkerSeq = 0;

  constructor(options: TmuxSessionOptions) {
    this.sessionName = options.sessionName;
    this.command = options.command;
    this.cwd = options.cwd;
    this.env = options.env;
    this.cols = options.cols ?? 120;
    this.rows = options.rows ?? 30;
    this.historyLimit = options.historyLimit ?? 50000;
    this.onDataCallback = options.onData;
    this.onExitCallback = options.onExit;
    this.onModeChangeCallback = options.onModeChange;
    this.outputLogPath = options.outputLogPath;

    // Ensure output log directory exists with restrictive permissions
    if (this.outputLogPath) {
      const dir = path.dirname(this.outputLogPath);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      try {
        fs.chmodSync(dir, 0o700);
      } catch {
        // best-effort on non-POSIX filesystems
      }

      // Pre-create log file with owner-only permissions.
      const fd = fs.openSync(this.outputLogPath, "a", 0o600);
      fs.closeSync(fd);
      try {
        fs.chmodSync(this.outputLogPath, 0o600);
      } catch {
        // best-effort on non-POSIX filesystems
      }
    }
  }

  get closed(): boolean {
    return this._closed;
  }

  get pid(): number | undefined {
    return this._pid;
  }

  get mode(): TerminalMode {
    return this._mode;
  }

  /**
   * Create and start the tmux session
   */
  async create(): Promise<void> {
    // Build tmux command arguments
    const args = [
      "new-session",
      "-d", // detached
      "-s",
      this.sessionName,
      "-x",
      this.cols.toString(),
      "-y",
      this.rows.toString(),
      "-c",
      this.cwd, // working directory
    ];

    // Execute command under a clean environment to avoid inheriting
    // potentially sensitive variables from the tmux server process.
    // Include safe fallbacks so direct TmuxSession usage (tests, tools)
    // still has PATH/HOME/etc. when not provided explicitly.
    const commandEnv: Record<string, string> = {};
    for (const key of SAFE_FALLBACK_ENV_KEYS) {
      const value = this.env[key] ?? process.env[key];
      if (value !== undefined) {
        commandEnv[key] = value;
      }
    }
    for (const [key, value] of Object.entries(this.env)) {
      commandEnv[key] = value;
    }

    const envArgs: string[] = [];
    for (const [key, value] of Object.entries(commandEnv)) {
      if (!SAFE_ENV_NAME.test(key)) {
        throw new Error(`Invalid environment variable name: ${key}`);
      }
      envArgs.push(`${key}=${value}`);
    }

    // Use env -i so only explicitly provided vars are visible to the session process.
    args.push("env", "-i", ...envArgs, ...this.command);

    // Create tmux session
    await this.runTmux(args);

    // Wait for session to be responsive
    await this.waitForSession();

    // Configure session options (best-effort — don't fail create on these)
    try {
      await this.runTmux([
        "set-option",
        "-t",
        this.sessionName,
        "history-limit",
        this.historyLimit.toString(),
      ]);
    } catch {
      // history-limit is best-effort
    }

    // Keep session alive after process exits so we can read the real exit code
    // via #{pane_dead_status} before cleaning up
    try {
      await this.runTmux(["set-option", "-t", this.sessionName, "remain-on-exit", "on"]);
    } catch {
      // remain-on-exit is best-effort
    }

    // Get the PID of the process running in tmux
    try {
      const pidOutput = await this.runTmux([
        "list-panes",
        "-t",
        this.sessionName,
        "-F",
        "#{pane_pid}",
      ]);
      this._pid = Number.parseInt(pidOutput.trim(), 10);
    } catch {
      // PID retrieval is best-effort
    }

    // Start streaming output if callback provided
    if (this.onDataCallback) {
      await this.startOutputStreaming();
    }

    // Monitor session for exit
    this.monitorSessionExit();
  }

  /**
   * Adopt an existing tmux session (skip creation).
   * Used to re-attach to orphaned sessions after daemon restart.
   * Starts output polling and exit monitoring without creating a new tmux session.
   */
  async adopt(): Promise<void> {
    // Verify session exists
    await this.waitForSession();

    // Ensure remain-on-exit is set for adopted sessions too
    try {
      await this.runTmux(["set-option", "-t", this.sessionName, "remain-on-exit", "on"]);
    } catch {
      // best-effort
    }

    // Get the PID of the process running in tmux
    try {
      const pidOutput = await this.runTmux([
        "list-panes",
        "-t",
        this.sessionName,
        "-F",
        "#{pane_pid}",
      ]);
      this._pid = Number.parseInt(pidOutput.trim(), 10);
    } catch {
      // PID retrieval is best-effort
    }

    // Start streaming output if callback provided
    if (this.onDataCallback) {
      await this.startOutputStreaming();
    }

    // Monitor session for exit
    this.monitorSessionExit();
  }

  /**
   * Detach from the tmux session without killing it.
   * Stops output polling and exit monitoring, allowing the daemon to
   * shut down while the tmux session continues running.
   */
  detach(): void {
    this.stopOutputStreaming();

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }

    this.flush();
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }

    this._closed = true;
  }

  /**
   * Wait for tmux session to be responsive
   */
  private async waitForSession(timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const proc = Bun.spawn(["tmux", "has-session", "-t", this.sessionName], {
        stdout: "ignore",
        stderr: "ignore",
      });

      if ((await proc.exited) === 0) {
        return; // Session exists and is responsive
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Session ${this.sessionName} did not become ready within ${timeoutMs}ms`);
  }

  /**
   * Stream output from tmux session using adaptive polling.
   * Uses recursive setTimeout instead of setInterval so the poll rate
   * can slow down when idle and speed up during active output.
   */
  private async startOutputStreaming(): Promise<void> {
    this.consecutiveUnchanged = 0;
    this.consecutiveErrors = 0;
    this.schedulePoll();
  }

  private schedulePoll(): void {
    if (this._closed) return;

    let delay: number;
    if (this.consecutiveErrors > 0) {
      // Error backoff: 1s, 2s, 4s, 8s, max 30s
      delay = Math.min(1000 * 2 ** (this.consecutiveErrors - 1), 30000);
    } else if (this.consecutiveUnchanged >= 20) {
      delay = 500; // Idle (2+ seconds unchanged) — save CPU
    } else if (this.consecutiveUnchanged >= 5) {
      delay = 200; // Settling — moderate
    } else {
      delay = 100; // Active — responsive
    }

    this.pollTimeout = setTimeout(() => this.pollOutput(), delay);
  }

  private async pollOutput(): Promise<void> {
    if (this._closed) return;
    this.lastPollTime = Date.now();

    try {
      const { content, cursor } = await this.capturePaneSnapshot();
      if (this._closed) return; // Session killed during capture

      this.consecutiveErrors = 0; // Reset on success
      this.pollCount++;

      // Periodically sync mode state with tmux reality (every 10th poll)
      if (this._mode !== "interactive" && this.pollCount % 10 === 0) {
        try {
          const modeInfo = await this.runTmux([
            "display-message",
            "-t",
            this.sessionName,
            "-p",
            "#{pane_in_mode}",
          ]);
          if (modeInfo.trim() === "0") {
            this._mode = "interactive";
            this.onModeChangeCallback?.("interactive");
          }
        } catch {
          // mode sync is best-effort
        }
      }

      // Track both content and cursor changes.
      // Some TUIs move the cursor without mutating visible text.
      const contentChanged = content !== this.lastContent;
      const cursorChanged = !this.isSameCursor(cursor, this.lastCursor);

      if (contentChanged || cursorChanged) {
        this.consecutiveUnchanged = 0;
        if (contentChanged) {
          this.lastContent = content;
        }
        this.lastCursor = cursor;

        if (this.outputLogPath && contentChanged) {
          await fs.promises.writeFile(this.outputLogPath, content, {
            encoding: "utf-8",
            mode: 0o600,
          });
        }

        this.onDataCallback?.(content, cursor ?? undefined);
      } else {
        this.consecutiveUnchanged++;
      }
    } catch (err) {
      if (!this._closed) {
        this.consecutiveErrors++;
        console.error(
          `Output polling error for ${this.sessionName} (${this.consecutiveErrors} consecutive):`,
          err
        );

        // After 2+ consecutive errors, session is likely gone — check immediately
        if (this.consecutiveErrors >= 2) {
          this.checkSessionAlive();
        }
      }
    }

    this.schedulePoll();
  }

  private parseCursorParts(
    xRaw: string | undefined,
    yRaw: string | undefined,
    visibleRaw: string | undefined
  ): TerminalCursor | null {
    const x = Number.parseInt(xRaw ?? "", 10);
    const y = Number.parseInt(yRaw ?? "", 10);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      return null;
    }
    return {
      x: Math.max(0, x),
      y: Math.max(0, y),
      visible: visibleRaw !== "0",
    };
  }

  private isSameCursor(a: TerminalCursor | null, b: TerminalCursor | null): boolean {
    if (a === b) return true;
    if (!(a && b)) return false;
    return a.x === b.x && a.y === b.y && a.visible === b.visible;
  }

  /**
   * Stop output streaming
   */
  private stopOutputStreaming(): void {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = undefined;
    }
  }

  /**
   * Ensure the polling loop is running. Restarts it if it appears to have stopped.
   * Called from scroll/output endpoints as a self-healing mechanism.
   */
  ensurePolling(): void {
    if (this._closed || !this.onDataCallback) return;

    // If no poll has fired in the last 5 seconds, the loop has likely died
    const staleMs = Date.now() - this.lastPollTime;
    if (staleMs > 5000 && !this.pollTimeout) {
      console.warn(
        `[TmuxSession] Polling stale for ${this.sessionName} (${staleMs}ms) — restarting`
      );
      this.consecutiveUnchanged = 0;
      this.consecutiveErrors = 0;
      this.schedulePoll();
    }
  }

  /**
   * Quick check if session is still alive. Triggers exit handling if not.
   * Called from polling error path for faster detection of externally killed sessions.
   */
  private checkSessionAlive(): void {
    const proc = Bun.spawn(["tmux", "has-session", "-t", this.sessionName], {
      stdout: "ignore",
      stderr: "ignore",
    });
    proc.exited.then((code) => {
      if (code !== 0 && !this._closed) {
        this.handleSessionExit(1, null);
      }
    });
  }

  /**
   * Monitor tmux session and detect when it exits.
   * Uses pane_dead + pane_dead_status to capture real exit codes.
   * Requires remain-on-exit=on (set in create/adopt) so the session
   * persists after the process dies, giving us time to read the status.
   */
  private monitorSessionExit(): void {
    this.monitorInterval = setInterval(async () => {
      try {
        // Check if the pane process is dead (more precise than session gone)
        const info = await this.runTmux([
          "display-message",
          "-t",
          this.sessionName,
          "-p",
          "#{pane_dead}:#{pane_dead_status}",
        ]);
        const [dead, status] = info.trim().split(":");
        if (dead === "1") {
          const exitCode = Number.parseInt(status ?? "1", 10);
          // Kill the dead session (remain-on-exit keeps it alive)
          this.killTmuxSession().catch(() => {
            // best-effort cleanup of dead session
          });
          this.handleSessionExit(Number.isNaN(exitCode) ? 1 : exitCode, null);
        }
        return;
      } catch {
        // display-message failed — session may be gone entirely
      }

      // Fallback: check if session exists at all
      const proc = Bun.spawn(["tmux", "has-session", "-t", this.sessionName], {
        stdout: "ignore",
        stderr: "ignore",
      });

      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        // Session no longer exists — assume non-zero exit
        this.handleSessionExit(1, null);
      }
    }, 500); // Check twice per second for responsive exit detection
  }

  /**
   * Handle session exit and cleanup
   */
  private handleSessionExit(exitCode: number, signal: string | null): void {
    if (this._closed) return;

    this._closed = true;

    // Clean up all timers and processes
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }

    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }

    this.stopOutputStreaming();

    this.fireExitCallback(exitCode, signal);
  }

  /**
   * Fire the exit callback exactly once (guard against double-fire in kill + monitor race)
   */
  private fireExitCallback(exitCode: number, signal: string | null): void {
    if (this._exitCallbackFired) return;
    this._exitCallbackFired = true;

    if (this.onExitCallback) {
      this.onExitCallback(exitCode, signal);
    }
  }

  /**
   * Send text input to the tmux session
   * Batches rapid writes with 10ms debounce for better performance
   */
  write(data: string): void {
    if (this._closed) {
      throw new Error("Cannot write to closed tmux session");
    }

    // Add to buffer
    this.writeBuffer += data;

    // Clear existing timer
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }

    // Schedule flush with debounce
    this.writeTimer = setTimeout(() => this.flushWrites(), 10);
  }

  /**
   * Flush batched writes to tmux
   */
  private flushWrites(): void {
    if (!this.writeBuffer) return;

    const data = this.writeBuffer;
    this.writeBuffer = "";
    this.writeTimer = undefined;

    // Send batched data
    const proc = Bun.spawn(["tmux", "send-keys", "-t", this.sessionName, "-l", data], {
      stdout: "ignore",
      stderr: "pipe",
    });

    // Check for errors asynchronously (don't block)
    proc.exited
      .then((exitCode) => {
        if (exitCode !== 0) {
          console.error(
            `tmux send-keys failed with exit code ${exitCode} for session ${this.sessionName}`
          );
        }
      })
      .catch((err) => {
        console.error(`tmux send-keys error for session ${this.sessionName}:`, err);
      });
  }

  /**
   * Flush any pending writes immediately (synchronous — fire-and-forget)
   */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    this.flushWrites();
  }

  /**
   * Send a key sequence (like Enter, Ctrl+C, etc.)
   */
  async sendKey(key: string): Promise<void> {
    if (this._closed) {
      throw new Error("Cannot send key to closed tmux session");
    }

    // tmux send-keys without -l interprets special keys
    await this.runTmux(["send-keys", "-t", this.sessionName, key]);
  }

  /**
   * Send a key sequence bypassing the _closed check.
   * Used internally during kill() for graceful shutdown (Ctrl+C).
   */
  private async sendKeyUnsafe(key: string): Promise<void> {
    await this.runTmux(["send-keys", "-t", this.sessionName, key]);
  }

  /**
   * Resize the tmux session window (and pane).
   * Must use resize-window (not resize-pane) because detached sessions
   * constrain pane size to window size, and the window won't grow with resize-pane alone.
   */
  async resize(cols: number, rows: number): Promise<void> {
    if (this._closed) {
      throw new Error("Cannot resize closed tmux session");
    }

    this.cols = cols;
    this.rows = rows;

    // Defer resize while in copy-mode — resize-window resets scroll position to 0
    if (this._mode !== "interactive") {
      return;
    }

    await this.runTmux([
      "resize-window",
      "-t",
      this.sessionName,
      "-x",
      cols.toString(),
      "-y",
      rows.toString(),
    ]);
  }

  /**
   * Kill the tmux session.
   * Flushes pending writes, attempts graceful shutdown, then kills.
   */
  async kill(signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<void> {
    if (this._closed) {
      return;
    }

    // Flush pending writes BEFORE stopping anything
    this.flush();

    // Stop polling to prevent race conditions
    this.stopOutputStreaming();

    // Clean up monitor interval
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }

    // Mark closed once — never reset
    this._closed = true;

    try {
      if (signal === "SIGTERM") {
        // Send Ctrl+C first for graceful exit
        try {
          await this.sendKeyUnsafe("C-c");
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (err) {
          console.warn(`Graceful shutdown failed for ${this.sessionName}:`, err);
        }
      }

      // Kill the tmux session
      const exitCode = await this.killTmuxSession();

      // Escalate if graceful kill failed
      if (exitCode !== 0 && signal === "SIGTERM") {
        console.warn(`SIGTERM failed for ${this.sessionName}, escalating to SIGKILL`);
        await this.killTmuxSession();
      }
    } catch (err) {
      console.error(`Failed to kill session ${this.sessionName}:`, err);
      throw err;
    } finally {
      this.fireExitCallback(signal === "SIGKILL" ? 137 : 0, signal);
    }
  }

  /**
   * Internal: kill the tmux session and return exit code
   */
  private async killTmuxSession(): Promise<number> {
    const proc = Bun.spawn(["tmux", "kill-session", "-t", this.sessionName], {
      stdout: "ignore",
      stderr: "pipe",
    });

    try {
      return await Promise.race([
        proc.exited,
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error("Kill timeout")), 5000)
        ),
      ]);
    } catch {
      return 1; // Timeout or other error
    }
  }

  /**
   * Public method to capture visible pane content with ANSI colors.
   * Used by the REST API for initial terminal state fetch.
   */
  async captureVisiblePane(): Promise<string> {
    return this.capturePaneVisible();
  }

  /**
   * Capture visible pane content with ANSI escape sequences for web streaming.
   * Strips trailing blank lines to avoid massive empty space in web view.
   *
   * In copy-mode (scroll/search), tmux capture-pane without -S/-E returns
   * the LIVE viewport, ignoring scroll position. We must explicitly calculate
   * the capture range from the scroll position to get the scrolled content.
   */
  private async capturePaneVisible(): Promise<string> {
    if (this._closed) {
      throw new Error("Cannot capture from closed tmux session");
    }

    const raw = await this.runTmux(await this.buildCapturePaneArgs());
    return this.normalizeCapturedContent(raw);
  }

  /**
   * Capture pane content and cursor position in a single tmux invocation.
   * This avoids race conditions where separate capture + cursor reads can
   * observe different UI frames during rapid TUI redraws (for example Codex).
   */
  private async capturePaneSnapshot(): Promise<PaneSnapshot> {
    if (this._closed) {
      throw new Error("Cannot capture from closed tmux session");
    }

    const marker = `__CODEPIPER_CURSOR_MARKER__${this.sessionName}__${this.cursorMarkerSeq++}`;
    const raw = await this.runTmux([
      ...(await this.buildCapturePaneArgs()),
      ";",
      "display-message",
      "-t",
      this.sessionName,
      "-p",
      `${marker}:#{cursor_x}:#{cursor_y}:#{cursor_flag}`,
    ]);

    let cursor: TerminalCursor | null = null;
    const lines = raw.split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = (lines[i] ?? "").replace(/\r$/, "");
      if (!line.startsWith(`${marker}:`)) {
        continue;
      }
      const [xRaw, yRaw, visibleRaw] = line.slice(marker.length + 1).split(":");
      const parsedCursor = this.parseCursorParts(xRaw, yRaw, visibleRaw);
      if (!parsedCursor) {
        continue;
      }
      cursor = parsedCursor;
      lines.splice(i, 1); // Remove only validated marker metadata line
      break;
    }

    return {
      content: this.normalizeCapturedContent(lines.join("\n")),
      cursor,
    };
  }

  private normalizeCapturedContent(raw: string): string {
    // Strip trailing blank lines. tmux capture-pane outputs all rows
    // including empty ones, which creates a large gap in the web view.
    const lines = raw.split("\n");
    while (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      if (lastLine === undefined || lastLine.trim() !== "") {
        break;
      }
      lines.pop();
    }
    return `${lines.join("\n")}\n`;
  }

  private async buildCapturePaneArgs(): Promise<string[]> {
    const args = [
      "capture-pane",
      "-t",
      this.sessionName,
      "-p", // Print to stdout
      "-e", // Include escape sequences (colors)
      // Join wrapped lines so historical output isn't "stuck" to an older
      // pane width (for example, after switching between mobile and desktop).
      "-J",
    ];

    // In scroll/search mode, capture the scrolled region instead of live viewport
    if (this._mode !== "interactive") {
      try {
        const info = await this.runTmux([
          "display-message",
          "-t",
          this.sessionName,
          "-p",
          "#{scroll_position}:#{pane_height}",
        ]);
        const parts = info.trim().split(":");
        const scrollPos = Number(parts[0] ?? "0");
        const paneHeight = Number(parts[1] ?? "0");
        if (scrollPos > 0 && paneHeight > 0) {
          const startLine = -scrollPos;
          const endLine = startLine + paneHeight - 1;
          args.push("-S", String(startLine), "-E", String(endLine));
        }
      } catch {
        // Fall through to default capture if mode query fails
      }
    }

    return args;
  }

  /**
   * Get current pane content (for debugging/testing)
   * Includes scrollback history for complete output
   */
  async capturePane(): Promise<string> {
    if (this._closed) {
      throw new Error("Cannot capture from closed tmux session");
    }

    return await this.runTmux([
      "capture-pane",
      "-t",
      this.sessionName,
      "-p", // Print to stdout
      "-S",
      "-", // Start from beginning of scrollback
      "-e", // Include escape sequences (preserves colors)
      "-J", // Join wrapped lines for width-independent replay/debug output
    ]);
  }

  // --- Terminal mode methods (scroll / search via tmux copy-mode) ---

  /**
   * Enter scroll mode (tmux copy-mode).
   * In copy-mode, capture-pane automatically reflects the scrolled position.
   */
  async enterScrollMode(): Promise<void> {
    if (this._closed) throw new Error("Cannot enter scroll mode on closed session");
    if (this._mode !== "interactive") return; // Already in a non-interactive mode

    // Set mode BEFORE entering copy-mode to block concurrent resize calls.
    // resize-window resets scroll position, so we must block it before copy-mode.
    this._mode = "scroll";
    try {
      await this.runTmux(["copy-mode", "-t", this.sessionName]);
    } catch (e) {
      this._mode = "interactive"; // Revert on failure
      throw e;
    }
    this.onModeChangeCallback?.("scroll");
  }

  /**
   * Exit scroll/search mode and return to interactive.
   */
  async exitScrollMode(): Promise<void> {
    if (this._closed) throw new Error("Cannot exit scroll mode on closed session");
    if (this._mode === "interactive") return;

    await this.runTmux(["send-keys", "-t", this.sessionName, "-X", "cancel"]);
    this._mode = "interactive";
    this.onModeChangeCallback?.("interactive");

    // Apply any deferred resize (resize-window is skipped during copy-mode).
    // resize() is a no-op when dims haven't changed, otherwise sends resize-window.
    await this.resize(this.cols, this.rows);
  }

  /**
   * Scroll up or down by a number of lines.
   * Auto-enters scroll mode if currently interactive.
   */
  async scroll(direction: "up" | "down", lines = 1): Promise<void> {
    if (this._closed) throw new Error("Cannot scroll closed session");

    if (this._mode === "interactive") {
      await this.enterScrollMode();
    }

    const cmd = direction === "up" ? "scroll-up" : "scroll-down";
    await this.runTmux(["send-keys", "-t", this.sessionName, "-X", "-N", String(lines), cmd]);
  }

  /**
   * Scroll up or down by one page.
   * Auto-enters scroll mode if currently interactive.
   */
  async scrollPage(direction: "up" | "down"): Promise<void> {
    if (this._closed) throw new Error("Cannot scroll closed session");

    if (this._mode === "interactive") {
      await this.enterScrollMode();
    }

    const cmd = direction === "up" ? "page-up" : "page-down";
    await this.runTmux(["send-keys", "-t", this.sessionName, "-X", cmd]);
  }

  /**
   * Scroll to top or bottom of history.
   * Scrolling to bottom also exits scroll mode.
   */
  async scrollToEdge(edge: "top" | "bottom"): Promise<void> {
    if (this._closed) throw new Error("Cannot scroll closed session");

    if (edge === "top") {
      if (this._mode === "interactive") {
        await this.enterScrollMode();
      }
      await this.runTmux(["send-keys", "-t", this.sessionName, "-X", "history-top"]);
    } else {
      if (this._mode !== "interactive") {
        await this.exitScrollMode();
      }
    }
  }

  /**
   * Search backward through terminal history.
   * Auto-enters copy-mode and sets mode to "search".
   */
  async searchBackward(query: string): Promise<void> {
    if (this._closed) throw new Error("Cannot search closed session");
    if (!query) throw new Error("Search query cannot be empty");

    if (this._mode === "interactive") {
      await this.runTmux(["copy-mode", "-t", this.sessionName]);
    }

    // Escape regex metacharacters for tmux search-backward (regex by default)
    const escaped = query.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&");
    await this.runTmux(["send-keys", "-t", this.sessionName, "-X", "search-backward", escaped]);
    this._mode = "search";
    this.onModeChangeCallback?.("search");
  }

  /**
   * Jump to next search match (forward in time / down).
   */
  async searchNext(): Promise<void> {
    if (this._closed) throw new Error("Cannot search closed session");
    if (this._mode !== "search") throw new Error("Not in search mode");

    await this.runTmux(["send-keys", "-t", this.sessionName, "-X", "search-again"]);
  }

  /**
   * Jump to previous search match (backward in time / up).
   */
  async searchPrevious(): Promise<void> {
    if (this._closed) throw new Error("Cannot search closed session");
    if (this._mode !== "search") throw new Error("Not in search mode");

    await this.runTmux(["send-keys", "-t", this.sessionName, "-X", "search-reverse"]);
  }

  /**
   * Get terminal info including mode, dimensions, and scroll position.
   * Syncs internal mode state with tmux reality.
   */
  async getTerminalInfo(): Promise<TerminalInfo> {
    if (this._closed) throw new Error("Cannot get info from closed session");

    const raw = await this.runTmux([
      "display-message",
      "-t",
      this.sessionName,
      "-p",
      "#{pane_in_mode}:#{scroll_position}:#{history_size}:#{pane_width}:#{pane_height}",
    ]);

    const [inMode, scrollPos, histSize, width, height] = raw.trim().split(":");
    const cols = Number.parseInt(width ?? "", 10);
    const rows = Number.parseInt(height ?? "", 10);
    const scrollPosition = Number.parseInt(scrollPos ?? "", 10);
    const historySize = Number.parseInt(histSize ?? "", 10);

    // Sync mode state: if tmux says we're not in copy-mode but we think we are
    if (inMode === "0" && this._mode !== "interactive") {
      this._mode = "interactive";
      this.onModeChangeCallback?.("interactive");
    } else if (inMode === "1" && this._mode === "interactive") {
      this._mode = "scroll";
      this.onModeChangeCallback?.("scroll");
    }

    return {
      mode: this._mode,
      cols: cols || this.cols,
      rows: rows || this.rows,
      scrollPosition: scrollPosition || 0,
      historySize: historySize || 0,
    };
  }

  /**
   * Run a tmux command, check exit code, return stdout.
   * Centralizes error handling for all tmux subprocess calls.
   */
  private async runTmux(args: string[]): Promise<string> {
    const proc = Bun.spawn(["tmux", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    if (exitCode !== 0) {
      throw new Error(`tmux ${args[0]} failed (exit ${exitCode}): ${stderr.trim()}`);
    }

    return stdout;
  }
}
