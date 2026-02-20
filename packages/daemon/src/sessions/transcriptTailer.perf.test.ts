/**
 * Performance tests for TranscriptTailer
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TranscriptTailer } from "./transcriptTailer";

const TEST_DIR = path.join(import.meta.dir, "../../../../test/fixtures/perf-test");

describe("TranscriptTailer - Performance Tests", () => {
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

  describe("parsing speed", () => {
    test("should parse 1000 lines in <100ms", async () => {
      const transcriptPath = path.join(TEST_DIR, "perf-1000.jsonl");

      // Generate 1000 lines
      const lines: string[] = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(JSON.stringify({ line: i, data: `test data ${i}` }));
      }
      fs.writeFileSync(transcriptPath, `${lines.join("\n")}\n`);

      let lineCount = 0;
      const onLine = () => {
        lineCount++;
      };

      const tailer = new TranscriptTailer({
        sessionId: "perf-test",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      const startTime = performance.now();
      await tailer.start();

      // Wait for all lines to be processed
      while (lineCount < 1000 && performance.now() - startTime < 500) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const endTime = performance.now();
      await tailer.stop();

      const duration = endTime - startTime;

      expect(lineCount).toBe(1000);
      expect(duration).toBeLessThan(100);

      console.log(`Parsed 1000 lines in ${duration.toFixed(2)}ms`);
    });

    test("should parse 10,000 lines in <1000ms", async () => {
      const transcriptPath = path.join(TEST_DIR, "perf-10000.jsonl");

      // Generate 10,000 lines
      const lines: string[] = [];
      for (let i = 0; i < 10000; i++) {
        lines.push(JSON.stringify({ line: i, data: `test data ${i}` }));
      }
      fs.writeFileSync(transcriptPath, `${lines.join("\n")}\n`);

      let lineCount = 0;
      const onLine = () => {
        lineCount++;
      };

      const tailer = new TranscriptTailer({
        sessionId: "perf-test",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      const startTime = performance.now();
      await tailer.start();

      // Wait for all lines to be processed
      while (lineCount < 10000 && performance.now() - startTime < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const endTime = performance.now();
      await tailer.stop();

      const duration = endTime - startTime;

      expect(lineCount).toBe(10000);
      expect(duration).toBeLessThan(1000);

      console.log(`Parsed 10,000 lines in ${duration.toFixed(2)}ms`);
    });
  });

  describe("memory usage", () => {
    test("should maintain <50MB memory regardless of file size", async () => {
      const transcriptPath = path.join(TEST_DIR, "perf-large.jsonl");

      // Generate a large file (100,000 lines)
      const lines: string[] = [];
      for (let i = 0; i < 100000; i++) {
        lines.push(JSON.stringify({ line: i, data: `test data ${i}` }));
      }
      fs.writeFileSync(transcriptPath, `${lines.join("\n")}\n`);

      const fileSize = fs.statSync(transcriptPath).size;
      console.log(`Generated file size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

      let lineCount = 0;
      const onLine = () => {
        lineCount++;
      };

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const memBefore = process.memoryUsage().heapUsed;

      const tailer = new TranscriptTailer({
        sessionId: "perf-test",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();

      // Wait for all lines to be processed
      while (lineCount < 100000 && performance.now() < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const memDuring = process.memoryUsage().heapUsed;
      await tailer.stop();

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const memIncrease = (memDuring - memBefore) / 1024 / 1024;

      console.log(`Memory increase: ${memIncrease.toFixed(2)} MB`);
      console.log(`Lines processed: ${lineCount}`);

      // Memory increase should be reasonable (not proportional to file size)
      expect(memIncrease).toBeLessThan(50);
    });

    test("should not accumulate memory across multiple files", async () => {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const memBefore = process.memoryUsage().heapUsed;

      // Process 10 files sequentially
      for (let fileNum = 0; fileNum < 10; fileNum++) {
        const transcriptPath = path.join(TEST_DIR, `perf-multi-${fileNum}.jsonl`);

        // Generate 1000 lines per file
        const lines: string[] = [];
        for (let i = 0; i < 1000; i++) {
          lines.push(JSON.stringify({ file: fileNum, line: i, data: `test data ${i}` }));
        }
        fs.writeFileSync(transcriptPath, `${lines.join("\n")}\n`);

        let lineCount = 0;
        const onLine = () => {
          lineCount++;
        };

        const tailer = new TranscriptTailer({
          sessionId: `perf-test-${fileNum}`,
          transcriptPath,
          initialOffset: 0,
          onLine,
        });

        await tailer.start();

        // Wait for all lines
        while (lineCount < 1000) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        await tailer.stop();
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const memAfter = process.memoryUsage().heapUsed;
      const memIncrease = (memAfter - memBefore) / 1024 / 1024;

      console.log(`Memory increase after 10 files: ${memIncrease.toFixed(2)} MB`);

      // Should not accumulate significant memory
      expect(memIncrease).toBeLessThan(50);
    });
  });

  describe("latency", () => {
    test("should have P95 latency <10ms from file write to callback", async () => {
      const transcriptPath = path.join(TEST_DIR, "perf-latency.jsonl");
      fs.writeFileSync(transcriptPath, "");

      const latencies: number[] = [];
      const writeTimes: Map<string, number> = new Map();

      const onLine = (line: string) => {
        const writeTime = writeTimes.get(line);
        if (writeTime !== undefined) {
          const latency = performance.now() - writeTime;
          latencies.push(latency);
        }
      };

      const tailer = new TranscriptTailer({
        sessionId: "perf-test",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Write 100 lines with timing
      for (let i = 0; i < 100; i++) {
        const line = JSON.stringify({ line: i, timestamp: Date.now() });
        const writeTime = performance.now();
        writeTimes.set(line, writeTime);

        fs.appendFileSync(transcriptPath, `${line}\n`);

        // Small delay between writes to avoid overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      // Wait for all lines to be processed
      await new Promise((resolve) => setTimeout(resolve, 500));
      await tailer.stop();

      // Calculate P95 latency
      latencies.sort((a, b) => a - b);
      const p95Index = Math.floor(latencies.length * 0.95);
      const p95Latency = latencies[p95Index];

      console.log(`P95 latency: ${p95Latency?.toFixed(2)}ms`);
      console.log(`Min latency: ${latencies[0]?.toFixed(2)}ms`);
      console.log(`Max latency: ${latencies[latencies.length - 1]?.toFixed(2)}ms`);
      console.log(`Median latency: ${latencies[Math.floor(latencies.length / 2)]?.toFixed(2)}ms`);
      console.log(`Sample size: ${latencies.length}`);

      expect(latencies.length).toBeGreaterThan(50); // Should have captured most writes
      expect(p95Latency).toBeLessThan(10);
    });

    test("should maintain low latency under concurrent load", async () => {
      const files = [
        path.join(TEST_DIR, "concurrent-1.jsonl"),
        path.join(TEST_DIR, "concurrent-2.jsonl"),
        path.join(TEST_DIR, "concurrent-3.jsonl"),
      ];

      // Initialize files
      for (const file of files) {
        fs.writeFileSync(file, "");
      }

      const allLatencies: number[] = [];
      const tailers: TranscriptTailer[] = [];

      // Create tailers for each file
      for (let i = 0; i < files.length; i++) {
        const writeTimes: Map<string, number> = new Map();

        const onLine = (line: string) => {
          const writeTime = writeTimes.get(line);
          if (writeTime !== undefined) {
            const latency = performance.now() - writeTime;
            allLatencies.push(latency);
          }
        };

        const tailer = new TranscriptTailer({
          sessionId: `concurrent-${i}`,
          transcriptPath: files[i],
          initialOffset: 0,
          onLine,
        });

        await tailer.start();
        tailers.push(tailer);

        // Start writing to this file concurrently
        (async () => {
          for (let j = 0; j < 30; j++) {
            const line = JSON.stringify({ file: i, line: j });
            const writeTime = performance.now();
            writeTimes.set(line, writeTime);
            fs.appendFileSync(files[i], `${line}\n`);
            await new Promise((resolve) => setTimeout(resolve, 15));
          }
        })();
      }

      // Wait for all writes to complete
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Stop all tailers
      for (const tailer of tailers) {
        await tailer.stop();
      }

      // Calculate P95 latency
      allLatencies.sort((a, b) => a - b);
      const p95Index = Math.floor(allLatencies.length * 0.95);
      const p95Latency = allLatencies[p95Index];

      console.log(`Concurrent P95 latency: ${p95Latency?.toFixed(2)}ms`);
      console.log(`Total samples: ${allLatencies.length}`);

      expect(allLatencies.length).toBeGreaterThan(50);
      expect(p95Latency).toBeLessThan(10);
    });
  });

  describe("throughput", () => {
    test("should handle rapid incremental writes", async () => {
      const transcriptPath = path.join(TEST_DIR, "perf-throughput.jsonl");
      fs.writeFileSync(transcriptPath, "");

      let lineCount = 0;
      const onLine = () => {
        lineCount++;
      };

      const tailer = new TranscriptTailer({
        sessionId: "perf-test",
        transcriptPath,
        initialOffset: 0,
        onLine,
      });

      await tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const startTime = performance.now();

      // Write 500 lines rapidly
      for (let i = 0; i < 500; i++) {
        fs.appendFileSync(transcriptPath, `${JSON.stringify({ line: i })}\n`);
      }

      // Force at least one post-burst file change event without adding a complete line.
      // This makes the test deterministic on platforms where fs.watch can coalesce
      // burst writes and delay/skip intermediate callbacks.
      fs.appendFileSync(transcriptPath, " ");

      // Wait for processing
      while (lineCount < 500 && performance.now() - startTime < 4000) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const endTime = performance.now();
      await tailer.stop();

      const duration = endTime - startTime;
      const throughput = lineCount / (duration / 1000);

      console.log(`Throughput: ${throughput.toFixed(0)} lines/second`);
      console.log(`Processed ${lineCount} lines in ${duration.toFixed(2)}ms`);

      expect(lineCount).toBe(500);
      expect(throughput).toBeGreaterThan(100); // At least 100 lines/second
    });
  });
});
