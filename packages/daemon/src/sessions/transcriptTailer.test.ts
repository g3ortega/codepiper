/**
 * Unit tests for TranscriptTailer
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TranscriptTailer } from "./transcriptTailer";

const TEST_DIR = path.join(import.meta.dir, "../../../../test/fixtures/tailer-test");

describe("TranscriptTailer", () => {
  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("initialization", () => {
    test("should create tailer with valid options", () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const onLine = mock(() => {});

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      expect(tailer).toBeDefined();
      expect(tailer.getCurrentOffset()).toBe(0);
    });

    test("should accept initial offset", () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const onLine = mock(() => {});

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 100,
        onLine,
      });

      expect(tailer.getCurrentOffset()).toBe(100);
    });

    test("should accept error handler", () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const onLine = mock(() => {});
      const onError = mock(() => {});

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
        onError,
      });

      expect(tailer).toBeDefined();
    });
  });

  describe("start/stop", () => {
    test("should start tailing", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"type":"test"}\n');

      const onLine = mock(() => {});

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();

      // Give it a moment to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onLine).toHaveBeenCalled();
      await tailer.stop();
    });

    test("should stop tailing cleanly", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"type":"test"}\n');

      const onLine = mock(() => {});

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await tailer.stop();

      // Should not throw
      expect(true).toBe(true);
    });

    test("should handle stop before start", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const onLine = mock(() => {});

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.stop();
      // Should not throw
      expect(true).toBe(true);
    });

    test("should handle multiple stops", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, "");

      const onLine = mock(() => {});

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await tailer.stop();
      await tailer.stop();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("reading from offset", () => {
    test("should read from offset 0", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const lines = ['{"line":1}\n', '{"line":2}\n', '{"line":3}\n'];
      fs.writeFileSync(transcriptPath, lines.join(""));

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tailer.stop();

      expect(receivedLines).toEqual(['{"line":1}', '{"line":2}', '{"line":3}']);
    });

    test("should read from middle offset", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const line1 = '{"line":1}\n';
      const line2 = '{"line":2}\n';
      const line3 = '{"line":3}\n';
      fs.writeFileSync(transcriptPath, line1 + line2 + line3);

      const offsetAfterLine1 = Buffer.byteLength(line1);

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: offsetAfterLine1,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tailer.stop();

      expect(receivedLines).toEqual(['{"line":2}', '{"line":3}']);
    });

    test("should skip already processed lines", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const content = '{"line":1}\n{"line":2}\n{"line":3}\n';
      fs.writeFileSync(transcriptPath, content);

      const fullLength = Buffer.byteLength(content);

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: fullLength,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tailer.stop();

      expect(receivedLines).toEqual([]);
    });
  });

  describe("line-by-line parsing", () => {
    test("should parse complete lines only", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      // Write incomplete line (no trailing newline)
      fs.writeFileSync(transcriptPath, '{"incomplete":true}');

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not have received the incomplete line
      expect(receivedLines).toEqual([]);

      await tailer.stop();
    });

    test("should buffer partial lines", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"partial":');

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // No complete lines yet
      expect(receivedLines).toEqual([]);

      // Complete the line
      fs.appendFileSync(transcriptPath, "true}\n");
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should now have the complete line
      expect(receivedLines).toEqual(['{"partial":true}']);

      await tailer.stop();
    });

    test("should handle multiple lines in one write", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, "");

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Write multiple lines at once
      fs.writeFileSync(transcriptPath, '{"line":1}\n{"line":2}\n{"line":3}\n');
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(receivedLines).toEqual(['{"line":1}', '{"line":2}', '{"line":3}']);

      await tailer.stop();
    });
  });

  describe("offset updates", () => {
    test("should update offset after each line", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const line1 = '{"line":1}\n';
      const line2 = '{"line":2}\n';
      fs.writeFileSync(transcriptPath, line1 + line2);

      const offsets: number[] = [];
      const onLine = mock((_line: string, offset: number) => {
        offsets.push(offset);
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tailer.stop();

      const expectedOffset1 = Buffer.byteLength(line1);
      const expectedOffset2 = Buffer.byteLength(line1 + line2);

      expect(offsets).toEqual([expectedOffset1, expectedOffset2]);
      expect(tailer.getCurrentOffset()).toBe(expectedOffset2);
    });

    test("should maintain accurate byte offsets", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const lines = ['{"a":1}\n', '{"b":2}\n', '{"c":3}\n'];
      fs.writeFileSync(transcriptPath, lines.join(""));

      let lastOffset = 0;
      const onLine = mock((_line: string, offset: number) => {
        lastOffset = offset;
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tailer.stop();

      const expectedFinalOffset = Buffer.byteLength(lines.join(""));
      expect(lastOffset).toBe(expectedFinalOffset);
      expect(tailer.getCurrentOffset()).toBe(expectedFinalOffset);
    });
  });

  describe("file growth detection", () => {
    test("should detect new lines appended to file", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"line":1}\n');

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(receivedLines).toEqual(['{"line":1}']);

      // Append new line
      fs.appendFileSync(transcriptPath, '{"line":2}\n');
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(receivedLines).toEqual(['{"line":1}', '{"line":2}']);

      // Append another line
      fs.appendFileSync(transcriptPath, '{"line":3}\n');
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(receivedLines).toEqual(['{"line":1}', '{"line":2}', '{"line":3}']);

      await tailer.stop();
    });

    test("should handle rapid file growth", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, "");

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Rapidly append lines
      for (let i = 1; i <= 10; i++) {
        fs.appendFileSync(transcriptPath, `{"line":${i}}\n`);
      }

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(receivedLines.length).toBe(10);
      expect(receivedLines[0]).toBe('{"line":1}');
      expect(receivedLines[9]).toBe('{"line":10}');

      await tailer.stop();
    });
  });

  describe("file rotation detection", () => {
    test("should detect file rotation (size decrease)", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"line":1}\n{"line":2}\n{"line":3}\n');

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Simulate rotation by replacing file with smaller content
      fs.writeFileSync(transcriptPath, '{"new":1}\n');
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should reset and read from beginning of new file
      expect(receivedLines).toContain('{"new":1}');

      await tailer.stop();
    });

    test("should reset offset on rotation", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      const longContent = '{"line":1}\n'.repeat(100);
      fs.writeFileSync(transcriptPath, longContent);

      const onLine = mock(() => {});

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const offsetBefore = tailer.getCurrentOffset();
      expect(offsetBefore).toBeGreaterThan(0);

      // Rotate file
      fs.writeFileSync(transcriptPath, '{"new":1}\n');
      await new Promise((resolve) => setTimeout(resolve, 200));

      const offsetAfter = tailer.getCurrentOffset();
      expect(offsetAfter).toBeLessThan(offsetBefore);

      await tailer.stop();
    });
  });

  describe("multiple concurrent tailers", () => {
    test("should support multiple tailers on different files", async () => {
      const file1 = path.join(TEST_DIR, "transcript1.jsonl");
      const file2 = path.join(TEST_DIR, "transcript2.jsonl");

      fs.writeFileSync(file1, '{"file":1}\n');
      fs.writeFileSync(file2, '{"file":2}\n');

      const lines1: string[] = [];
      const lines2: string[] = [];

      const tailer1 = new TranscriptTailer({
        sessionId: "session1",
        transcriptPath: file1,
        initialOffset: 0,
        onLine: (line) => lines1.push(line),
      });

      const tailer2 = new TranscriptTailer({
        sessionId: "session2",
        transcriptPath: file2,
        initialOffset: 0,
        onLine: (line) => lines2.push(line),
      });

      await tailer1.start();
      await tailer2.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(lines1).toEqual(['{"file":1}']);
      expect(lines2).toEqual(['{"file":2}']);

      await tailer1.stop();
      await tailer2.stop();
    });

    test("should not interfere with each other", async () => {
      const file1 = path.join(TEST_DIR, "transcript1.jsonl");
      const file2 = path.join(TEST_DIR, "transcript2.jsonl");

      fs.writeFileSync(file1, "");
      fs.writeFileSync(file2, "");

      const lines1: string[] = [];
      const lines2: string[] = [];

      const tailer1 = new TranscriptTailer({
        sessionId: "session1",
        transcriptPath: file1,
        initialOffset: 0,
        onLine: (line) => lines1.push(line),
      });

      const tailer2 = new TranscriptTailer({
        sessionId: "session2",
        transcriptPath: file2,
        initialOffset: 0,
        onLine: (line) => lines2.push(line),
      });

      await tailer1.start();
      await tailer2.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Append to file1 only
      fs.appendFileSync(file1, '{"file":1}\n');
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(lines1).toEqual(['{"file":1}']);
      expect(lines2).toEqual([]);

      // Append to file2 only
      fs.appendFileSync(file2, '{"file":2}\n');
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(lines1).toEqual(['{"file":1}']);
      expect(lines2).toEqual(['{"file":2}']);

      await tailer1.stop();
      await tailer2.stop();
    });
  });

  describe("error handling", () => {
    test("should handle file not found initially", async () => {
      const transcriptPath = path.join(TEST_DIR, "nonexistent.jsonl");

      const onLine = mock(() => {});
      const onError = mock(() => {});

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
        onError,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create the file now
      fs.writeFileSync(transcriptPath, '{"late":true}\n');
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should eventually read the file
      expect(onLine).toHaveBeenCalled();

      await tailer.stop();
    });

    test("should call onError for read errors", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"test":1}\n');

      const onLine = mock(() => {});
      const errors: Error[] = [];
      const onError = mock((err: Error) => {
        errors.push(err);
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
        onError,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Delete file while tailing to trigger error
      fs.unlinkSync(transcriptPath);
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should have called onError
      expect(errors.length).toBeGreaterThan(0);

      await tailer.stop();
    });

    test("should handle permission errors gracefully", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"test":1}\n');

      // Make file unreadable (on Unix systems)
      try {
        fs.chmodSync(transcriptPath, 0o000);
      } catch {
        // Skip test on systems that don't support chmod
        return;
      }

      const onLine = mock(() => {});
      const errors: Error[] = [];
      const onError = mock((err: Error) => {
        errors.push(err);
      });

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
        onError,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should have encountered permission error
      expect(errors.length).toBeGreaterThan(0);

      await tailer.stop();

      // Restore permissions for cleanup
      try {
        fs.chmodSync(transcriptPath, 0o644);
      } catch {
        // Ignore
      }
    });
  });

  describe("cleanup on stop", () => {
    test("should clean up watchers on stop", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"test":1}\n');

      const onLine = mock(() => {});

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const callsBefore = onLine.mock.calls.length;

      await tailer.stop();

      // Append more data after stop
      fs.appendFileSync(transcriptPath, '{"test":2}\n');
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should not have received new data
      const callsAfter = onLine.mock.calls.length;
      expect(callsAfter).toBe(callsBefore);
    });

    test("should not leak resources with multiple start/stop cycles", async () => {
      const transcriptPath = path.join(TEST_DIR, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, '{"test":1}\n');

      const onLine = mock(() => {});

      const tailer = new TranscriptTailer({
        sessionId: "test-session",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      // Multiple start/stop cycles
      for (let i = 0; i < 5; i++) {
        await tailer.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await tailer.stop();
      }

      // Should complete without errors
      expect(true).toBe(true);
    });
  });
});
