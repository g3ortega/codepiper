/**
 * Tests for TranscriptManager
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TranscriptManager, type TranscriptOffsetStore } from "./transcriptManager";

const TEST_DIR = path.join(import.meta.dir, "../../../../test/fixtures/manager-test");

// Mock offset store
class MockOffsetStore implements TranscriptOffsetStore {
  private offsets = new Map<string, number>();

  async getOffset(sessionId: string): Promise<number> {
    return this.offsets.get(sessionId) ?? 0;
  }

  async setOffset(sessionId: string, offset: number): Promise<void> {
    this.offsets.set(sessionId, offset);
  }

  // Test helper
  getAll(): Map<string, number> {
    return new Map(this.offsets);
  }

  clear(): void {
    this.offsets.clear();
  }
}

describe("TranscriptManager", () => {
  let offsetStore: MockOffsetStore;

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });

    offsetStore = new MockOffsetStore();
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("initialization", () => {
    test("should create manager with offset store", () => {
      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      expect(manager).toBeDefined();
      expect(manager.getSessions()).toEqual([]);
    });

    test("should accept error handler", () => {
      const onLine = mock(() => {});
      const onError = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
        onError,
      });

      expect(manager).toBeDefined();
    });
  });

  describe("starting and stopping tailers", () => {
    test("should start tailing a transcript", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"line":1}\n');

      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      await manager.startTailing("session1", transcriptPath);

      expect(manager.isTailing("session1")).toBe(true);
      expect(manager.getSessions()).toEqual(["session1"]);

      await manager.stopAll();
    });

    test("should load initial offset from store", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const line1 = '{"line":1}\n';
      const line2 = '{"line":2}\n';
      fs.writeFileSync(transcriptPath, line1 + line2);

      // Set initial offset to skip first line
      await offsetStore.setOffset("session1", Buffer.byteLength(line1));

      const receivedLines: string[] = [];
      const onLine = mock((sessionId: string, line: string) => {
        receivedLines.push(line);
      });

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      await manager.startTailing("session1", transcriptPath);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should only receive second line
      expect(receivedLines).toEqual(['{"line":2}']);

      await manager.stopAll();
    });

    test("should stop tailing a transcript", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"line":1}\n');

      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      await manager.startTailing("session1", transcriptPath);
      expect(manager.isTailing("session1")).toBe(true);

      await manager.stopTailing("session1");
      expect(manager.isTailing("session1")).toBe(false);
      expect(manager.getSessions()).toEqual([]);

      await manager.stopAll();
    });

    test("should handle stop on non-existent session", async () => {
      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      // Should not throw
      await manager.stopTailing("nonexistent");

      await manager.stopAll();
    });

    test("should throw if already tailing same session", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"line":1}\n');

      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      await manager.startTailing("session1", transcriptPath);

      // Should throw
      await expect(manager.startTailing("session1", transcriptPath)).rejects.toThrow(
        /Already tailing/
      );

      await manager.stopAll();
    });

    test("should stop all tailers", async () => {
      const file1 = path.join(TEST_DIR, "transcript1.jsonl");
      const file2 = path.join(TEST_DIR, "transcript2.jsonl");
      fs.writeFileSync(file1, '{"line":1}\n');
      fs.writeFileSync(file2, '{"line":2}\n');

      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      await manager.startTailing("session1", file1);
      await manager.startTailing("session2", file2);

      expect(manager.getSessions()).toHaveLength(2);

      await manager.stopAll();

      expect(manager.getSessions()).toEqual([]);
    });
  });

  describe("multiple concurrent tailers", () => {
    test("should handle multiple sessions", async () => {
      const file1 = path.join(TEST_DIR, "transcript1.jsonl");
      const file2 = path.join(TEST_DIR, "transcript2.jsonl");
      fs.writeFileSync(file1, '{"session":1}\n');
      fs.writeFileSync(file2, '{"session":2}\n');

      const lines: Array<{ sessionId: string; line: string }> = [];
      const onLine = mock((sessionId: string, line: string) => {
        lines.push({ sessionId, line });
      });

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      await manager.startTailing("session1", file1);
      await manager.startTailing("session2", file2);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.sessionId === "session1")).toBeDefined();
      expect(lines.find((l) => l.sessionId === "session2")).toBeDefined();

      await manager.stopAll();
    });

    test("should track offsets independently", async () => {
      const file1 = path.join(TEST_DIR, "transcript1.jsonl");
      const file2 = path.join(TEST_DIR, "transcript2.jsonl");
      fs.writeFileSync(file1, '{"line":1}\n{"line":2}\n');
      fs.writeFileSync(file2, '{"line":3}\n');

      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      await manager.startTailing("session1", file1);
      await manager.startTailing("session2", file2);

      await new Promise((resolve) => setTimeout(resolve, 200));

      const offset1 = manager.getCurrentOffset("session1");
      const offset2 = manager.getCurrentOffset("session2");

      expect(offset1).toBeDefined();
      expect(offset2).toBeDefined();
      expect(offset1).toBeGreaterThan(offset2 as number);

      await manager.stopAll();
    });
  });

  describe("offset persistence", () => {
    test("should save offset when stopping", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const content = '{"line":1}\n{"line":2}\n{"line":3}\n';
      fs.writeFileSync(transcriptPath, content);

      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      await manager.startTailing("session1", transcriptPath);
      await new Promise((resolve) => setTimeout(resolve, 100));

      await manager.stopTailing("session1");

      // Offset should be saved
      const savedOffset = await offsetStore.getOffset("session1");
      expect(savedOffset).toBe(Buffer.byteLength(content));
    });

    test("should flush offsets periodically", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"line":1}\n');

      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      await manager.startTailing("session1", transcriptPath);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append more data
      fs.appendFileSync(transcriptPath, '{"line":2}\n');

      // Wait for flush interval (1 second + buffer)
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Offset should be flushed
      const savedOffset = await offsetStore.getOffset("session1");
      expect(savedOffset).toBeGreaterThan(0);

      await manager.stopAll();
    });

    test("should batch offset updates", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");

      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      await manager.startTailing("session1", transcriptPath);

      // Track number of setOffset calls
      const originalSetOffset = offsetStore.setOffset.bind(offsetStore);
      let setOffsetCalls = 0;
      offsetStore.setOffset = async (sessionId: string, offset: number) => {
        setOffsetCalls++;
        return originalSetOffset(sessionId, offset);
      };

      // Write many lines quickly
      fs.writeFileSync(transcriptPath, "");
      for (let i = 0; i < 100; i++) {
        fs.appendFileSync(transcriptPath, `{"line":${i}}\n`);
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Should have batched updates (not 100 calls)
      expect(setOffsetCalls).toBeLessThan(10);

      await manager.stopAll();
    });
  });

  describe("error handling", () => {
    test("should call onError for file errors", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"line":1}\n');

      const onLine = mock(() => {});
      const errors: Array<{ sessionId: string; error: Error }> = [];
      const onError = mock((sessionId: string, error: Error) => {
        errors.push({ sessionId, error });
      });

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
        onError,
      });

      await manager.startTailing("session1", transcriptPath);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Delete file to trigger error
      fs.unlinkSync(transcriptPath);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].sessionId).toBe("session1");

      await manager.stopAll();
    });

    test("should handle errors without crashing", async () => {
      const file1 = path.join(TEST_DIR, "transcript1.jsonl");
      const file2 = path.join(TEST_DIR, "transcript2.jsonl");
      fs.writeFileSync(file1, '{"line":1}\n');
      fs.writeFileSync(file2, '{"line":2}\n');

      const lines: Array<{ sessionId: string; line: string }> = [];
      const onLine = mock((sessionId: string, line: string) => {
        lines.push({ sessionId, line });
      });

      const errors: string[] = [];
      const onError = mock((sessionId: string) => {
        errors.push(sessionId);
      });

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
        onError,
      });

      await manager.startTailing("session1", file1);
      await manager.startTailing("session2", file2);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have received initial lines from both sessions
      expect(
        lines.find((l) => l.sessionId === "session1" && l.line === '{"line":1}')
      ).toBeDefined();
      expect(
        lines.find((l) => l.sessionId === "session2" && l.line === '{"line":2}')
      ).toBeDefined();

      // Delete file1 to trigger error
      fs.unlinkSync(file1);
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Manager should still be running
      expect(manager.isTailing("session1")).toBe(true);
      expect(manager.isTailing("session2")).toBe(true);

      await manager.stopAll();
    });
  });

  describe("getCurrentOffset", () => {
    test("should return current offset for session", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const content = '{"line":1}\n';
      fs.writeFileSync(transcriptPath, content);

      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      await manager.startTailing("session1", transcriptPath);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const offset = manager.getCurrentOffset("session1");
      expect(offset).toBe(Buffer.byteLength(content));

      await manager.stopAll();
    });

    test("should return undefined for non-existent session", () => {
      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      const offset = manager.getCurrentOffset("nonexistent");
      expect(offset).toBeUndefined();
    });
  });

  describe("getSessions", () => {
    test("should return list of active sessions", async () => {
      const file1 = path.join(TEST_DIR, "transcript1.jsonl");
      const file2 = path.join(TEST_DIR, "transcript2.jsonl");
      fs.writeFileSync(file1, "");
      fs.writeFileSync(file2, "");

      const onLine = mock(() => {});

      const manager = new TranscriptManager({
        offsetStore,
        onLine,
      });

      expect(manager.getSessions()).toEqual([]);

      await manager.startTailing("session1", file1);
      expect(manager.getSessions()).toEqual(["session1"]);

      await manager.startTailing("session2", file2);
      expect(manager.getSessions()).toHaveLength(2);
      expect(manager.getSessions()).toContain("session1");
      expect(manager.getSessions()).toContain("session2");

      await manager.stopTailing("session1");
      expect(manager.getSessions()).toEqual(["session2"]);

      await manager.stopAll();
      expect(manager.getSessions()).toEqual([]);
    });
  });
});
