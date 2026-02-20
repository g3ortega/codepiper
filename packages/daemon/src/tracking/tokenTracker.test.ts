import { beforeEach, describe, expect, test } from "bun:test";
import type { Event } from "@codepiper/core";
import { Database } from "../db/db";
import { TokenTracker } from "./tokenTracker";

describe("TokenTracker", () => {
  let db: Database;
  let tracker: TokenTracker;

  beforeEach(async () => {
    db = new Database(":memory:");
    await db.init();
    tracker = new TokenTracker(db);

    // Create test session
    db.createSession({
      id: "test-session-1",
      provider: "claude-code",
      cwd: "/tmp/test",
      status: "RUNNING",
    });
  });

  describe("Token Usage Extraction", () => {
    test("extracts token usage from assistant message", async () => {
      const event: Event = {
        id: "event-1",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 100,
          },
          cost: {
            estimated: 0.05,
            actual: 0.048,
          },
        },
      };

      await tracker.processTranscriptEvent(event);

      const usage = db.getTokenUsageBySessionId("test-session-1");
      expect(usage.length).toBe(1);
      expect(usage[0].model).toBe("claude-sonnet-4-5");
      expect(usage[0].promptTokens).toBe(1000);
      expect(usage[0].completionTokens).toBe(500);
      expect(usage[0].cacheCreationInputTokens).toBe(200);
      expect(usage[0].cacheReadInputTokens).toBe(100);
      expect(usage[0].totalTokens).toBe(1800); // 1000 + 500 + 200 + 100
      expect(usage[0].estimatedCostUsd).toBe(0.05);
      expect(usage[0].actualCostUsd).toBe(0.048);
      expect(usage[0].costDifferenceUsd).toBeCloseTo(-0.002, 4);
    });

    test("handles missing cache metrics", async () => {
      const event: Event = {
        id: "event-1",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
        },
      };

      await tracker.processTranscriptEvent(event);

      const usage = db.getTokenUsageBySessionId("test-session-1");
      expect(usage.length).toBe(1);
      expect(usage[0].cacheCreationInputTokens).toBe(0);
      expect(usage[0].cacheReadInputTokens).toBe(0);
      expect(usage[0].totalTokens).toBe(1500); // 1000 + 500
    });

    test("handles missing cost data", async () => {
      const event: Event = {
        id: "event-1",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
        },
      };

      await tracker.processTranscriptEvent(event);

      const usage = db.getTokenUsageBySessionId("test-session-1");
      expect(usage.length).toBe(1);
      expect(usage[0].estimatedCostUsd).toBeUndefined();
      expect(usage[0].actualCostUsd).toBeUndefined();
      expect(usage[0].costDifferenceUsd).toBeUndefined();
    });

    test("ignores non-transcript events", async () => {
      const event: Event = {
        id: "event-1",
        timestamp: Date.now(),
        source: "hook",
        sessionId: "test-session-1",
        type: "hook:notification",
        payload: { some: "data" },
      };

      await tracker.processTranscriptEvent(event);

      const usage = db.getTokenUsageBySessionId("test-session-1");
      expect(usage.length).toBe(0);
    });

    test("ignores user messages", async () => {
      const event: Event = {
        id: "event-1",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "user",
          content: "Hello",
        },
      };

      await tracker.processTranscriptEvent(event);

      const usage = db.getTokenUsageBySessionId("test-session-1");
      expect(usage.length).toBe(0);
    });
  });

  describe("Model Switch Detection", () => {
    test("detects model switch", async () => {
      // First message with sonnet
      await tracker.processTranscriptEvent({
        id: "event-1",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      // Second message with opus
      await tracker.processTranscriptEvent({
        id: "event-2",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-opus-4-6",
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      });

      const switches = db.getModelSwitchesBySessionId("test-session-1");
      expect(switches.length).toBe(1);
      expect(switches[0].fromModel).toBe("claude-sonnet-4-5");
      expect(switches[0].toModel).toBe("claude-opus-4-6");
    });

    test("does not record switch for first message", async () => {
      await tracker.processTranscriptEvent({
        id: "event-1",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const switches = db.getModelSwitchesBySessionId("test-session-1");
      expect(switches.length).toBe(0);
    });

    test("does not record switch when model stays the same", async () => {
      await tracker.processTranscriptEvent({
        id: "event-1",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      await tracker.processTranscriptEvent({
        id: "event-2",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      });

      const switches = db.getModelSwitchesBySessionId("test-session-1");
      expect(switches.length).toBe(0);
    });

    test("tracks multiple model switches", async () => {
      const models = ["claude-sonnet-4-5", "claude-opus-4-6", "claude-haiku-4-5"];

      for (const model of models) {
        await tracker.processTranscriptEvent({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          source: "transcript",
          sessionId: "test-session-1",
          type: "transcript:line",
          payload: {
            role: "assistant",
            model,
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        });
      }

      const switches = db.getModelSwitchesBySessionId("test-session-1");
      expect(switches.length).toBe(2);
      expect(switches[0].fromModel).toBe("claude-sonnet-4-5");
      expect(switches[0].toModel).toBe("claude-opus-4-6");
      expect(switches[1].fromModel).toBe("claude-opus-4-6");
      expect(switches[1].toModel).toBe("claude-haiku-4-5");
    });
  });

  describe("Statistics", () => {
    test("gets session stats", async () => {
      await tracker.processTranscriptEvent({
        id: "event-1",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 1000, output_tokens: 500 },
          cost: { actual: 0.05 },
        },
      });

      await tracker.processTranscriptEvent({
        id: "event-2",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 500, output_tokens: 300 },
          cost: { actual: 0.03 },
        },
      });

      const stats = tracker.getSessionStats("test-session-1");
      expect(stats.totalTokens).toBe(2300); // 1500 + 800
      expect(stats.totalCost).toBeCloseTo(0.08, 2);
      expect(stats.byModel["claude-sonnet-4-5"].tokens).toBe(2300);
      expect(stats.byModel["claude-sonnet-4-5"].cost).toBeCloseTo(0.08, 2);
    });

    test("gets recent usage", async () => {
      for (let i = 0; i < 15; i++) {
        await tracker.processTranscriptEvent({
          id: `event-${i}`,
          timestamp: Date.now(),
          source: "transcript",
          sessionId: "test-session-1",
          type: "transcript:line",
          payload: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        });
      }

      const recent = tracker.getRecentUsage("test-session-1", 10);
      expect(recent.length).toBe(10);
    });

    test("gets model switches", async () => {
      await tracker.processTranscriptEvent({
        id: "event-1",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      await tracker.processTranscriptEvent({
        id: "event-2",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-opus-4-6",
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      });

      const switches = tracker.getModelSwitches("test-session-1");
      expect(switches.length).toBe(1);
      expect(switches[0].fromModel).toBe("claude-sonnet-4-5");
      expect(switches[0].toModel).toBe("claude-opus-4-6");
    });
  });

  describe("Session State Management", () => {
    test("clears session state", async () => {
      await tracker.processTranscriptEvent({
        id: "event-1",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      tracker.clearSessionState("test-session-1");

      // Next message should not trigger model switch
      await tracker.processTranscriptEvent({
        id: "event-2",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-opus-4-6",
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      });

      const switches = db.getModelSwitchesBySessionId("test-session-1");
      expect(switches.length).toBe(0);
    });
  });

  describe("Multiple Sessions", () => {
    beforeEach(() => {
      db.createSession({
        id: "test-session-2",
        provider: "claude-code",
        cwd: "/tmp/test",
        status: "RUNNING",
      });
    });

    test("tracks tokens separately per session", async () => {
      await tracker.processTranscriptEvent({
        id: "event-1",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 1000, output_tokens: 500 },
        },
      });

      await tracker.processTranscriptEvent({
        id: "event-2",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-2",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-opus-4-6",
          usage: { input_tokens: 2000, output_tokens: 800 },
        },
      });

      const stats1 = tracker.getSessionStats("test-session-1");
      const stats2 = tracker.getSessionStats("test-session-2");

      expect(stats1.totalTokens).toBe(1500);
      expect(stats2.totalTokens).toBe(2800);
    });

    test("tracks model switches separately per session", async () => {
      await tracker.processTranscriptEvent({
        id: "event-1",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      await tracker.processTranscriptEvent({
        id: "event-2",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-1",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-opus-4-6",
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      });

      await tracker.processTranscriptEvent({
        id: "event-3",
        timestamp: Date.now(),
        source: "transcript",
        sessionId: "test-session-2",
        type: "transcript:line",
        payload: {
          role: "assistant",
          model: "claude-haiku-4-5",
          usage: { input_tokens: 300, output_tokens: 150 },
        },
      });

      const switches1 = tracker.getModelSwitches("test-session-1");
      const switches2 = tracker.getModelSwitches("test-session-2");

      expect(switches1.length).toBe(1);
      expect(switches1[0].toModel).toBe("claude-opus-4-6");

      expect(switches2.length).toBe(0);
    });
  });

  describe("Defensive logging", () => {
    test("does not log transcript payload when sessionId is missing", async () => {
      const originalWarn = console.warn;
      const warnCalls: unknown[][] = [];
      console.warn = (...args: unknown[]) => {
        warnCalls.push(args);
      };

      try {
        await tracker.processTranscriptEvent({
          id: "event-missing-session",
          timestamp: Date.now(),
          source: "transcript",
          sessionId: undefined,
          type: "transcript:line",
          payload: {
            role: "assistant",
            usage: { input_tokens: 1, output_tokens: 1 },
            sensitiveToken: "secret-value-123",
          },
        });
      } finally {
        console.warn = originalWarn;
      }

      expect(warnCalls).toHaveLength(1);
      expect(String(warnCalls[0][0])).toContain("without sessionId");
      expect(JSON.stringify(warnCalls[0])).not.toContain("secret-value-123");
      expect(db.getTokenUsageBySessionId("test-session-1")).toHaveLength(0);
    });

    test("logs only error message when transcript payload processing fails", async () => {
      const originalError = console.error;
      const errorCalls: unknown[][] = [];
      console.error = (...args: unknown[]) => {
        errorCalls.push(args);
      };

      try {
        await tracker.processTranscriptEvent({
          id: "event-bad-payload",
          timestamp: Date.now(),
          source: "transcript",
          sessionId: "test-session-1",
          type: "transcript:line",
          payload: {
            get role() {
              throw new Error("boom");
            },
            sensitiveToken: "secret-value-456",
          } as unknown as Record<string, unknown>,
        });
      } finally {
        console.error = originalError;
      }

      expect(errorCalls).toHaveLength(1);
      expect(errorCalls[0]).toHaveLength(1);
      expect(String(errorCalls[0][0])).toContain("Error processing transcript event: boom");
      expect(String(errorCalls[0][0])).not.toContain("secret-value-456");
    });
  });
});
