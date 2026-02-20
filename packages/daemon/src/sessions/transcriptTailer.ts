/**
 * TranscriptTailer - reads Claude Code JSONL transcripts line-by-line
 * with byte offset tracking for crash-safe resumption.
 */

import * as fs from "node:fs";

export interface TranscriptTailerOptions {
  sessionId: string;
  transcriptPath: string;
  initialOffset: number;
  onLine: (line: string, offset: number) => void;
  onError?: (error: Error) => void;
}

export class TranscriptTailer {
  private readonly transcriptPath: string;
  private readonly onLine: (line: string, offset: number) => void;
  private readonly onError: ((error: Error) => void) | undefined;

  private watcher: fs.FSWatcher | null = null;
  private pollInterval: Timer | null = null;
  private isRunning = false;
  private isReading = false;
  private readPending = false;
  private buffer = "";
  private currentOffset: number;
  private lastFileSize = 0;

  constructor(options: TranscriptTailerOptions) {
    this.transcriptPath = options.transcriptPath;
    this.currentOffset = options.initialOffset;
    this.onLine = options.onLine;
    this.onError = options.onError;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.buffer = "";

    await this.scheduleRead();
    this.setupWatcher();
    this.setupPolling();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.closeWatcher();
    this.clearPollInterval();
    this.buffer = "";
  }

  getCurrentOffset(): number {
    return this.currentOffset;
  }

  private closeWatcher(): void {
    if (!this.watcher) {
      return;
    }

    try {
      this.watcher.close();
    } catch {
      // Ignore errors during cleanup
    }
    this.watcher = null;
  }

  private clearPollInterval(): void {
    if (!this.pollInterval) {
      return;
    }

    clearInterval(this.pollInterval);
    this.pollInterval = null;
  }

  private setupWatcher(): void {
    try {
      if (!fs.existsSync(this.transcriptPath)) {
        return;
      }

      this.watcher = fs.watch(this.transcriptPath, (eventType) => {
        if (!this.isRunning) {
          return;
        }

        if (eventType === "change" || eventType === "rename") {
          void this.scheduleRead();
        }
      });

      this.watcher.on("error", () => {
        this.closeWatcher();
      });
    } catch {
      // Polling remains enabled as a fallback.
    }
  }

  private setupPolling(): void {
    if (this.pollInterval) {
      return;
    }

    this.pollInterval = setInterval(async () => {
      if (!this.isRunning) {
        return;
      }

      void this.scheduleRead();
    }, 100);
  }

  /**
   * Serialize reads to avoid concurrent read/parse races between fs.watch and polling callbacks.
   */
  private async scheduleRead(): Promise<void> {
    if (this.isReading) {
      this.readPending = true;
      return;
    }

    this.isReading = true;
    try {
      do {
        this.readPending = false;
        await this.readNewLines();
      } while (this.readPending && this.isRunning);
    } finally {
      this.isReading = false;
    }
  }

  private async readNewLines(): Promise<void> {
    try {
      if (!fs.existsSync(this.transcriptPath)) {
        if (this.lastFileSize > 0 || this.currentOffset > 0) {
          throw new Error(`Transcript file was deleted: ${this.transcriptPath}`);
        }
        return;
      }

      const fileSize = fs.statSync(this.transcriptPath).size;

      // Detect file rotation (size decreased)
      if (fileSize < this.lastFileSize || fileSize < this.currentOffset) {
        this.currentOffset = 0;
        this.buffer = "";
      }

      this.lastFileSize = fileSize;

      if (fileSize === this.currentOffset) {
        return;
      }

      const fd = fs.openSync(this.transcriptPath, "r");
      try {
        const bytesToRead = fileSize - this.currentOffset;
        const readBuffer = Buffer.allocUnsafe(bytesToRead);
        const bytesRead = fs.readSync(fd, readBuffer, 0, bytesToRead, this.currentOffset);

        if (bytesRead === 0) {
          return;
        }

        const newData = readBuffer.slice(0, bytesRead).toString("utf-8");
        const data = this.buffer + newData;

        this.parseLines(data, this.currentOffset - Buffer.byteLength(this.buffer, "utf-8"));
        this.currentOffset += bytesRead;
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      if (this.onError && this.isRunning) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Parse complete lines from data, buffering any trailing incomplete line.
   */
  private parseLines(data: string, baseOffset: number): void {
    const parts = data.split("\n");
    let offset = baseOffset;

    for (let i = 0; i < parts.length - 1; i++) {
      const line = parts[i];
      if (line === undefined) {
        continue;
      }
      const lineWithNewline = `${line}\n`;
      const lineBytes = Buffer.byteLength(lineWithNewline, "utf-8");
      offset += lineBytes;
      this.onLine(line, offset);
    }

    // Buffer the trailing incomplete segment for the next read
    this.buffer = parts[parts.length - 1] ?? "";
  }
}
