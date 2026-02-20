/**
 * PTY (Pseudo-Terminal) process wrapper for Bun
 */

import type { Subprocess } from "bun";

export interface PTYProcessOptions {
  command: string[];
  cwd: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  onData?: (data: string) => void;
  onExit?: (exitCode: number, signal: string | null) => void;
  onDrain?: () => void;
}

export class PTYProcess {
  private proc: Subprocess;
  public pid: number;
  public cols: number;
  public rows: number;
  public closed: boolean = false;

  constructor(options: PTYProcessOptions) {
    const { command, cwd, env, cols = 80, rows = 24, onData, onExit, onDrain } = options;

    this.cols = cols;
    this.rows = rows;

    try {
      this.proc = Bun.spawn(command, {
        cwd,
        env: env || process.env,
        terminal: {
          cols,
          rows,
          data: (_terminal, data) => {
            if (onData) {
              const text = new TextDecoder().decode(data);
              onData(text);
            }
          },
          exit: (_terminal, exitCode, signal) => {
            this.closed = true;
            if (onExit) {
              onExit(exitCode, signal);
            }
          },
          drain: (_terminal) => {
            if (onDrain) {
              onDrain();
            }
          },
        },
      });

      if (!this.proc.terminal) {
        throw new Error("Failed to create PTY - terminal object is undefined");
      }

      this.pid = this.proc.pid;
    } catch (error) {
      throw new Error(`Failed to spawn process: ${error}`);
    }
  }

  write(data: string): void {
    if (this.closed) {
      throw new Error("Cannot write to closed PTY");
    }

    if (!this.proc.terminal) {
      throw new Error("PTY terminal is not available");
    }

    this.proc.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.closed) {
      throw new Error("Cannot resize closed PTY");
    }

    if (!this.proc.terminal) {
      throw new Error("PTY terminal is not available");
    }

    this.cols = cols;
    this.rows = rows;
    this.proc.terminal.resize(cols, rows);
  }

  setRawMode(enabled: boolean): void {
    if (this.closed) {
      throw new Error("Cannot set raw mode on closed PTY");
    }

    if (!this.proc.terminal) {
      throw new Error("PTY terminal is not available");
    }

    this.proc.terminal.setRawMode(enabled);
  }

  async kill(signal?: string): Promise<void> {
    if (this.closed) {
      return;
    }

    try {
      // Close terminal first to trigger clean shutdown
      if (this.proc.terminal && !this.proc.terminal.closed) {
        this.proc.terminal.close();
      }

      // Then kill the process
      this.proc.kill(signal as any);

      // Wait for process to exit with timeout
      await Promise.race([this.proc.exited, new Promise((resolve) => setTimeout(resolve, 1000))]);

      this.closed = true;
    } catch (_error) {
      // Process might already be dead
      this.closed = true;
    }
  }

  ref(): void {
    if (this.proc.terminal) {
      this.proc.terminal.ref();
    }
  }

  unref(): void {
    if (this.proc.terminal) {
      this.proc.terminal.unref();
    }
  }
}
