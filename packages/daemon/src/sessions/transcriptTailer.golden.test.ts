/**
 * Golden file tests for TranscriptTailer
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TranscriptTailer } from "./transcriptTailer";

const TEST_DIR = path.join(import.meta.dir, "../../../../test/fixtures");
const GOLDEN_DIR = path.join(TEST_DIR, "golden");

describe("TranscriptTailer - Golden File Tests", () => {
  beforeEach(() => {
    // Create golden directory if it doesn't exist
    if (!fs.existsSync(GOLDEN_DIR)) {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up temporary test files (not the golden fixtures)
  });

  describe("sample transcript 1 - small valid transcript", () => {
    const SAMPLE_1 = path.join(GOLDEN_DIR, "transcript-sample-1.jsonl");

    beforeEach(() => {
      // Create sample file if it doesn't exist
      if (!fs.existsSync(SAMPLE_1)) {
        const lines = [
          '{"role":"user","content":"Hello"}',
          '{"role":"assistant","content":"Hi there!"}',
          '{"role":"user","content":"How are you?"}',
          '{"role":"assistant","content":"I\'m doing well, thank you!"}',
          '{"role":"user","content":"Great!"}',
        ];
        fs.writeFileSync(SAMPLE_1, `${lines.join("\n")}\n`);
      }
    });

    test("should parse all lines from offset 0", async () => {
      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "golden-test",
        transcriptPath: SAMPLE_1,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await tailer.stop();

      expect(receivedLines.length).toBe(5);
      expect(receivedLines[0]).toBe('{"role":"user","content":"Hello"}');
      expect(receivedLines[4]).toBe('{"role":"user","content":"Great!"}');
    });

    test("should resume from middle offset", async () => {
      // Calculate offset after first 2 lines
      const firstTwoLines =
        '{"role":"user","content":"Hello"}\n{"role":"assistant","content":"Hi there!"}\n';
      const offset = Buffer.byteLength(firstTwoLines);

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "golden-test",
        transcriptPath: SAMPLE_1,
        initialOffset: offset,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await tailer.stop();

      expect(receivedLines.length).toBe(3);
      expect(receivedLines[0]).toBe('{"role":"user","content":"How are you?"}');
    });

    test("should verify line count matches file", async () => {
      const fileContent = fs.readFileSync(SAMPLE_1, "utf-8");
      const expectedLineCount = fileContent.trim().split("\n").length;

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "golden-test",
        transcriptPath: SAMPLE_1,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await tailer.stop();

      expect(receivedLines.length).toBe(expectedLineCount);
    });

    test("should verify offset progression", async () => {
      const offsets: number[] = [];
      const onLine = mock((_line: string, offset: number) => {
        offsets.push(offset);
      });

      const tailer = new TranscriptTailer({
        sessionId: "golden-test",
        transcriptPath: SAMPLE_1,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await tailer.stop();

      // Offsets should be monotonically increasing
      for (let i = 1; i < offsets.length; i++) {
        expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
      }

      // Final offset should match file size
      const fileSize = fs.statSync(SAMPLE_1).size;
      expect(offsets[offsets.length - 1]).toBe(fileSize);
    });
  });

  describe("sample transcript 2 - large transcript", () => {
    const SAMPLE_2 = path.join(GOLDEN_DIR, "transcript-sample-2.jsonl");

    beforeEach(() => {
      // Create large sample file if it doesn't exist
      if (!fs.existsSync(SAMPLE_2)) {
        const lines: string[] = [];
        for (let i = 0; i < 1000; i++) {
          lines.push(
            JSON.stringify({
              line: i,
              timestamp: new Date().toISOString(),
              data: `Sample data for line ${i}`,
            })
          );
        }
        fs.writeFileSync(SAMPLE_2, `${lines.join("\n")}\n`);
      }
    });

    test("should parse all 1000+ lines", async () => {
      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "golden-test",
        transcriptPath: SAMPLE_2,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await tailer.stop();

      expect(receivedLines.length).toBeGreaterThanOrEqual(1000);
    });

    test("should handle resuming from various offsets", async () => {
      const fileContent = fs.readFileSync(SAMPLE_2, "utf-8");
      const allLines = fileContent.trim().split("\n");

      // Test resuming from 25%, 50%, 75% marks
      for (const percentage of [0.25, 0.5, 0.75]) {
        const targetLineIndex = Math.floor(allLines.length * percentage);

        // Calculate byte offset
        let offset = 0;
        for (let i = 0; i < targetLineIndex; i++) {
          offset += Buffer.byteLength(`${allLines[i]}\n`);
        }

        const receivedLines: string[] = [];
        const onLine = mock((line: string) => {
          receivedLines.push(line);
        });

        const tailer = new TranscriptTailer({
          sessionId: "golden-test",
          transcriptPath: SAMPLE_2,
          initialOffset: offset,
          onLine,
        });

        await tailer.start();
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tailer.stop();

        const expectedRemainingLines = allLines.length - targetLineIndex;
        expect(receivedLines.length).toBe(expectedRemainingLines);
      }
    });

    test("should verify exact line content at boundaries", async () => {
      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "golden-test",
        transcriptPath: SAMPLE_2,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await tailer.stop();

      // Verify first line
      const firstLine = JSON.parse(receivedLines[0]);
      expect(firstLine.line).toBe(0);

      // Verify last line
      const lastLine = JSON.parse(receivedLines[receivedLines.length - 1]);
      expect(lastLine.line).toBe(999);
    });
  });

  describe("invalid JSON handling", () => {
    const INVALID_SAMPLE = path.join(GOLDEN_DIR, "transcript-invalid.jsonl");

    beforeEach(() => {
      // Create sample with some invalid JSON lines
      if (!fs.existsSync(INVALID_SAMPLE)) {
        const lines = [
          '{"valid":1}',
          "{invalid json",
          '{"valid":2}',
          "not even close to json",
          '{"valid":3}',
          '{"incomplete":',
          '{"valid":4}',
        ];
        fs.writeFileSync(INVALID_SAMPLE, `${lines.join("\n")}\n`);
      }
    });

    test("should handle invalid JSON lines gracefully", async () => {
      const receivedLines: string[] = [];
      const errors: Error[] = [];

      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const onError = mock((err: Error) => {
        errors.push(err);
      });

      const tailer = new TranscriptTailer({
        sessionId: "golden-test",
        transcriptPath: INVALID_SAMPLE,
        initialOffset: 0,
        onLine,
        onError,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await tailer.stop();

      // Should receive all lines (invalid ones are passed as-is to onLine)
      // It's up to the consumer to validate JSON
      expect(receivedLines.length).toBeGreaterThan(0);
      expect(receivedLines).toContain('{"valid":1}');
      expect(receivedLines).toContain('{"valid":2}');
      expect(receivedLines).toContain('{"valid":3}');
      expect(receivedLines).toContain('{"valid":4}');
    });

    test("should pass through all lines regardless of JSON validity", async () => {
      const fileContent = fs.readFileSync(INVALID_SAMPLE, "utf-8");
      const expectedLines = fileContent.trim().split("\n");

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "golden-test",
        transcriptPath: INVALID_SAMPLE,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await tailer.stop();

      expect(receivedLines.length).toBe(expectedLines.length);

      // All lines should be passed through unchanged
      for (let i = 0; i < expectedLines.length; i++) {
        expect(receivedLines[i]).toBe(expectedLines[i]);
      }
    });
  });

  describe("edge cases", () => {
    test("should handle empty file", async () => {
      const emptyFile = path.join(GOLDEN_DIR, "transcript-empty.jsonl");
      fs.writeFileSync(emptyFile, "");

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "golden-test",
        transcriptPath: emptyFile,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tailer.stop();

      expect(receivedLines.length).toBe(0);
    });

    test("should handle file with only newlines", async () => {
      const newlinesFile = path.join(GOLDEN_DIR, "transcript-newlines.jsonl");
      fs.writeFileSync(newlinesFile, "\n\n\n\n\n");

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "golden-test",
        transcriptPath: newlinesFile,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tailer.stop();

      // Empty lines should be passed through
      expect(receivedLines.length).toBe(5);
      expect(receivedLines.every((line) => line === "")).toBe(true);
    });

    test("should handle very long lines", async () => {
      const longLineFile = path.join(GOLDEN_DIR, "transcript-longlines.jsonl");
      const veryLongContent = JSON.stringify({ data: "x".repeat(10000) });
      fs.writeFileSync(longLineFile, `${veryLongContent}\n`);

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "golden-test",
        transcriptPath: longLineFile,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await tailer.stop();

      expect(receivedLines.length).toBe(1);
      expect(receivedLines[0]).toBe(veryLongContent);
    });

    test("should handle unicode characters correctly", async () => {
      const unicodeFile = path.join(GOLDEN_DIR, "transcript-unicode.jsonl");
      const unicodeLines = [
        '{"emoji":"😀🎉🚀"}',
        '{"chinese":"你好世界"}',
        '{"arabic":"مرحبا بالعالم"}',
        '{"mixed":"Hello 世界 🌍"}',
      ];
      fs.writeFileSync(unicodeFile, `${unicodeLines.join("\n")}\n`);

      const receivedLines: string[] = [];
      const onLine = mock((line: string) => {
        receivedLines.push(line);
      });

      const tailer = new TranscriptTailer({
        sessionId: "golden-test",
        transcriptPath: unicodeFile,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await tailer.stop();

      expect(receivedLines.length).toBe(4);
      expect(receivedLines[0]).toBe('{"emoji":"😀🎉🚀"}');
      expect(receivedLines[1]).toBe('{"chinese":"你好世界"}');
      expect(receivedLines[2]).toBe('{"arabic":"مرحبا بالعالم"}');
      expect(receivedLines[3]).toBe('{"mixed":"Hello 世界 🌍"}');

      // Verify offset calculation works correctly with unicode
      const fileSize = fs.statSync(unicodeFile).size;
      expect(tailer.getCurrentOffset()).toBe(fileSize);
    });
  });
});
