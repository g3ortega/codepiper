/**
 * Tests for WaitConditionPoller
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "../db/db.ts";
import { WaitConditionPoller } from "./waitConditionPoller.ts";
import type { WaitCondition } from "./workflowTypes.ts";

describe("WaitConditionPoller", () => {
  let db: Database;
  let poller: WaitConditionPoller;
  let sessionId: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    await db.init();
    poller = new WaitConditionPoller(db, 50); // 50ms poll interval for faster tests
    sessionId = "test-session-123";

    // Create a test session
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

  describe("idle_prompt condition", () => {
    test("should resolve when idle_prompt notification exists", async () => {
      const condition: WaitCondition = { type: "idle_prompt" };

      // Insert idle_prompt event
      setTimeout(() => {
        db.insertEvent({
          sessionId,
          source: "hook",
          type: "Notification",
          payload: { type: "idle_prompt" },
        });
      }, 100);

      await poller.wait(sessionId, [condition]);
      // Test passes if it resolves without throwing
    });

    test("should timeout if idle_prompt never arrives", async () => {
      const condition: WaitCondition = {
        type: "idle_prompt",
        timeout: 200,
      };

      await expect(poller.wait(sessionId, [condition])).rejects.toThrow(/timeout/i);
    });

    test("should not match wrong notification type", async () => {
      const condition: WaitCondition = {
        type: "idle_prompt",
        timeout: 200,
      };

      // Insert wrong notification type
      db.insertEvent({
        sessionId,
        source: "hook",
        type: "Notification",
        payload: { type: "auth_success" },
      });

      await expect(poller.wait(sessionId, [condition])).rejects.toThrow(/timeout/i);
    });
  });

  describe("permission_prompt condition", () => {
    test("should resolve when permission_prompt notification exists", async () => {
      const condition: WaitCondition = { type: "permission_prompt" };

      // Insert permission_prompt event
      setTimeout(() => {
        db.insertEvent({
          sessionId,
          source: "hook",
          type: "Notification",
          payload: { type: "permission_prompt" },
        });
      }, 100);

      await poller.wait(sessionId, [condition]);
    });

    test("should timeout if permission_prompt never arrives", async () => {
      const condition: WaitCondition = {
        type: "permission_prompt",
        timeout: 200,
      };

      await expect(poller.wait(sessionId, [condition])).rejects.toThrow(/timeout/i);
    });
  });

  describe("stop condition", () => {
    test("should resolve when Stop event exists", async () => {
      const condition: WaitCondition = { type: "stop" };

      // Insert Stop event
      setTimeout(() => {
        db.insertEvent({
          sessionId,
          source: "hook",
          type: "Stop",
          payload: {},
        });
      }, 100);

      await poller.wait(sessionId, [condition]);
    });

    test("should timeout if Stop never arrives", async () => {
      const condition: WaitCondition = {
        type: "stop",
        timeout: 200,
      };

      await expect(poller.wait(sessionId, [condition])).rejects.toThrow(/timeout/i);
    });
  });

  describe("event condition", () => {
    test("should resolve when custom event exists", async () => {
      const condition: WaitCondition = {
        type: "event",
        eventType: "CustomEvent",
      };

      // Insert custom event
      setTimeout(() => {
        db.insertEvent({
          sessionId,
          source: "hook",
          type: "CustomEvent",
          payload: { data: "test" },
        });
      }, 100);

      await poller.wait(sessionId, [condition]);
    });

    test("should timeout if custom event never arrives", async () => {
      const condition: WaitCondition = {
        type: "event",
        eventType: "CustomEvent",
        timeout: 200,
      };

      await expect(poller.wait(sessionId, [condition])).rejects.toThrow(/timeout/i);
    });
  });

  describe("multiple conditions", () => {
    test("should resolve when any condition is met", async () => {
      const conditions: WaitCondition[] = [{ type: "idle_prompt" }, { type: "stop" }];

      // Insert stop event (first to arrive)
      setTimeout(() => {
        db.insertEvent({
          sessionId,
          source: "hook",
          type: "Stop",
          payload: {},
        });
      }, 100);

      await poller.wait(sessionId, conditions);
    });

    test("should use minimum timeout when multiple conditions have timeouts", async () => {
      const conditions: WaitCondition[] = [
        { type: "idle_prompt", timeout: 1000 },
        { type: "stop", timeout: 200 }, // This timeout should apply
      ];

      await expect(poller.wait(sessionId, conditions)).rejects.toThrow(/timeout/i);
    });
  });

  describe("edge cases", () => {
    test("should handle empty conditions array", async () => {
      await expect(poller.wait(sessionId, [])).rejects.toThrow();
    });

    test("should handle non-existent session", async () => {
      const condition: WaitCondition = {
        type: "stop",
        timeout: 200,
      };

      await expect(poller.wait("non-existent", [condition])).rejects.toThrow(/timeout/i);
    });

    test("should resolve immediately if condition already met", async () => {
      // Insert event before waiting
      db.insertEvent({
        sessionId,
        source: "hook",
        type: "Stop",
        payload: {},
      });

      const condition: WaitCondition = { type: "stop" };
      await poller.wait(sessionId, [condition]);
    });

    test("should handle condition with no timeout (infinite wait)", async () => {
      const condition: WaitCondition = { type: "stop" };

      // Insert event after some time
      setTimeout(() => {
        db.insertEvent({
          sessionId,
          source: "hook",
          type: "Stop",
          payload: {},
        });
      }, 100);

      await poller.wait(sessionId, [condition]);
    });
  });

  describe("performance", () => {
    test("should poll efficiently without blocking", async () => {
      const condition: WaitCondition = { type: "stop" };
      const startTime = Date.now();

      // Insert event after 300ms
      setTimeout(() => {
        db.insertEvent({
          sessionId,
          source: "hook",
          type: "Stop",
          payload: {},
        });
      }, 300);

      await poller.wait(sessionId, [condition]);
      const duration = Date.now() - startTime;

      // Should complete shortly after event is inserted
      expect(duration).toBeGreaterThanOrEqual(300);
      expect(duration).toBeLessThan(500); // Allowing some overhead
    });
  });
});
