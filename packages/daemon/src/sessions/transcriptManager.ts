/**
 * TranscriptManager - manages transcript tailers for multiple sessions
 * with batched offset persistence.
 */

import { TranscriptTailer } from "./transcriptTailer";

export interface TranscriptOffsetStore {
  getOffset(sessionId: string): Promise<number>;
  setOffset(sessionId: string, offset: number): Promise<void>;
}

export interface TranscriptManagerOptions {
  offsetStore: TranscriptOffsetStore;
  onLine: (sessionId: string, line: string, offset: number) => void;
  onError?: (sessionId: string, error: Error) => void;
}

export class TranscriptManager {
  private readonly tailers = new Map<string, TranscriptTailer>();
  private readonly offsetStore: TranscriptOffsetStore;
  private readonly onLine: (sessionId: string, line: string, offset: number) => void;
  private readonly onError: ((sessionId: string, error: Error) => void) | undefined;
  private readonly batchedOffsets = new Map<string, number>();
  private flushInterval: Timer | null = null;

  constructor(options: TranscriptManagerOptions) {
    this.offsetStore = options.offsetStore;
    this.onLine = options.onLine;
    this.onError = options.onError;

    this.flushInterval = setInterval(() => {
      this.flushOffsets();
    }, 1000);
  }

  async startTailing(sessionId: string, transcriptPath: string): Promise<void> {
    if (this.tailers.has(sessionId)) {
      throw new Error(`Already tailing transcript for session ${sessionId}`);
    }

    const initialOffset = await this.offsetStore.getOffset(sessionId);

    const tailer = new TranscriptTailer({
      sessionId,
      transcriptPath,
      initialOffset,
      onLine: (line: string, offset: number) => {
        this.onLine(sessionId, line, offset);
        this.batchedOffsets.set(sessionId, offset);
      },
      onError: (error: Error) => {
        this.onError?.(sessionId, error);
      },
    });

    await tailer.start();
    this.tailers.set(sessionId, tailer);
  }

  async stopTailing(sessionId: string): Promise<void> {
    const tailer = this.tailers.get(sessionId);
    if (!tailer) {
      return;
    }

    await tailer.stop();
    await this.offsetStore.setOffset(sessionId, tailer.getCurrentOffset());

    this.tailers.delete(sessionId);
    this.batchedOffsets.delete(sessionId);
  }

  async stopAll(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    const sessionIds = Array.from(this.tailers.keys());
    await Promise.all(sessionIds.map((id) => this.stopTailing(id)));
  }

  getCurrentOffset(sessionId: string): number | undefined {
    return this.tailers.get(sessionId)?.getCurrentOffset();
  }

  isTailing(sessionId: string): boolean {
    return this.tailers.has(sessionId);
  }

  getSessions(): string[] {
    return Array.from(this.tailers.keys());
  }

  private async flushOffsets(): Promise<void> {
    if (this.batchedOffsets.size === 0) {
      return;
    }

    const offsets = new Map(this.batchedOffsets);
    this.batchedOffsets.clear();

    const promises: Promise<void>[] = [];
    for (const [sessionId, offset] of offsets) {
      promises.push(this.offsetStore.setOffset(sessionId, offset));
    }
    await Promise.all(promises);
  }
}
