/**
 * Tests for ResultExtractor
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "../db/db.ts";
import { ResultExtractor } from "./resultExtractor.ts";
import type { ExtractConfig } from "./workflowTypes.ts";

describe("ResultExtractor", () => {
  let db: Database;
  let extractor: ResultExtractor;
  let sessionId: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    await db.init();
    extractor = new ResultExtractor(db);
    sessionId = "test-session-123";

    // Create test session
    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: "/test",
      status: "RUNNING",
    });
  });

  afterEach(() => {
    db.close();
  });

  describe("regex extraction", () => {
    test("should extract using regex pattern with capture group", async () => {
      // Insert transcript events
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: {
          content: "I created file: /path/to/app.ts",
        },
      });

      const config: ExtractConfig = {
        type: "regex",
        pattern: "created file: (.+)",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toBe("/path/to/app.ts");
    });

    test("should extract using regex pattern with multiple capture groups", async () => {
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: {
          content: "Tests: 42 passing, 3 failing",
        },
      });

      const config: ExtractConfig = {
        type: "regex",
        pattern: "Tests: (\\d+) passing, (\\d+) failing",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toEqual(["42", "3"]);
    });

    test("should return null if regex does not match", async () => {
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: {
          content: "No match here",
        },
      });

      const config: ExtractConfig = {
        type: "regex",
        pattern: "created file: (.+)",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toBeNull();
    });

    test("should extract from concatenated transcript events", async () => {
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: { content: "First part " },
      });

      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: { content: "created file: test.ts" },
      });

      const config: ExtractConfig = {
        type: "regex",
        pattern: "created file: (.+)",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toBe("test.ts");
    });
  });

  describe("jsonpath extraction", () => {
    test("should extract using JSONPath from single event", async () => {
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: {
          content: JSON.stringify({
            result: { status: "success", code: 200 },
          }),
        },
      });

      const config: ExtractConfig = {
        type: "jsonpath",
        path: "$.result.status",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toBe("success");
    });

    test("should extract array using JSONPath", async () => {
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: {
          content: JSON.stringify({
            files: ["app.ts", "test.ts", "config.ts"],
          }),
        },
      });

      const config: ExtractConfig = {
        type: "jsonpath",
        path: "$.files[*]",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toEqual(["app.ts", "test.ts", "config.ts"]);
    });

    test("should extract nested object using JSONPath", async () => {
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: {
          content: JSON.stringify({
            data: {
              user: { name: "Alice", age: 30 },
            },
          }),
        },
      });

      const config: ExtractConfig = {
        type: "jsonpath",
        path: "$.data.user",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toEqual({ name: "Alice", age: 30 });
    });

    test("should return null if JSONPath does not match", async () => {
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: {
          content: JSON.stringify({ data: "test" }),
        },
      });

      const config: ExtractConfig = {
        type: "jsonpath",
        path: "$.nonexistent",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toBeNull();
    });

    test("should throw error if content is not valid JSON", async () => {
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: {
          content: "Not valid JSON",
        },
      });

      const config: ExtractConfig = {
        type: "jsonpath",
        path: "$.data",
      };

      await expect(extractor.extract(sessionId, config)).rejects.toThrow();
    });
  });

  describe("edge cases", () => {
    test("should handle session with no events", async () => {
      const config: ExtractConfig = {
        type: "regex",
        pattern: "test",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toBeNull();
    });

    test("should handle events with null content", async () => {
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: { content: null },
      });

      const config: ExtractConfig = {
        type: "regex",
        pattern: "test",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toBeNull();
    });

    test("should handle events with undefined content", async () => {
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: {},
      });

      const config: ExtractConfig = {
        type: "regex",
        pattern: "test",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toBeNull();
    });

    test("should throw error for unknown extract type", async () => {
      const config = {
        type: "unknown" as any,
        pattern: "test",
      };

      await expect(extractor.extract(sessionId, config)).rejects.toThrow(/unknown extract type/i);
    });

    test("should handle large transcript content", async () => {
      // Insert many events
      for (let i = 0; i < 100; i++) {
        db.insertEvent({
          sessionId,
          source: "transcript",
          type: "AssistantMessage",
          payload: { content: `Line ${i}\n` },
        });
      }

      // Insert target content
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: { content: "Found: target-value" },
      });

      const config: ExtractConfig = {
        type: "regex",
        pattern: "Found: (.+)",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toBe("target-value");
    });
  });

  describe("transcript event filtering", () => {
    test("should only extract from transcript events", async () => {
      // Insert non-transcript event
      db.insertEvent({
        sessionId,
        source: "hook",
        type: "Notification",
        payload: { content: "Should not be included: hook-value" },
      });

      // Insert transcript event
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: { content: "Should be included: transcript-value" },
      });

      const config: ExtractConfig = {
        type: "regex",
        pattern: "Should be included: (.+)",
      };

      const result = await extractor.extract(sessionId, config);
      expect(result).toBe("transcript-value");
    });
  });
});
