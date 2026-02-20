import { beforeEach, describe, expect, test } from "bun:test";
import type {
  InsertModelSwitchParams,
  InsertTokenUsageParams,
  InsertTranscriptContentParams,
} from "./db";
import { Database } from "./db";

describe("Database - Token Usage", () => {
  let db: Database;

  beforeEach(async () => {
    db = new Database(":memory:");
    await db.init();

    // Create a test session
    db.createSession({
      id: "test-session-1",
      provider: "claude-code",
      cwd: "/tmp/test",
      status: "RUNNING",
    });
  });

  describe("Token Usage Operations", () => {
    test("inserts and retrieves token usage", () => {
      const params: InsertTokenUsageParams = {
        sessionId: "test-session-1",
        model: "claude-sonnet-4-5",
        promptTokens: 1000,
        completionTokens: 500,
        cacheCreationInputTokens: 200,
        cacheReadInputTokens: 100,
        totalTokens: 1600,
        estimatedCostUsd: 0.05,
        actualCostUsd: 0.048,
        costDifferenceUsd: -0.002,
      };

      const id = db.insertTokenUsage(params);
      expect(id).toBeGreaterThan(0);

      const records = db.getTokenUsageBySessionId("test-session-1");
      expect(records.length).toBe(1);
      expect(records[0].model).toBe("claude-sonnet-4-5");
      expect(records[0].promptTokens).toBe(1000);
      expect(records[0].completionTokens).toBe(500);
      expect(records[0].cacheCreationInputTokens).toBe(200);
      expect(records[0].cacheReadInputTokens).toBe(100);
      expect(records[0].totalTokens).toBe(1600);
      expect(records[0].estimatedCostUsd).toBe(0.05);
      expect(records[0].actualCostUsd).toBe(0.048);
      expect(records[0].costDifferenceUsd).toBe(-0.002);
    });

    test("filters token usage by model", () => {
      db.insertTokenUsage({
        sessionId: "test-session-1",
        model: "claude-sonnet-4-5",
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });

      db.insertTokenUsage({
        sessionId: "test-session-1",
        model: "claude-opus-4-6",
        promptTokens: 2000,
        completionTokens: 800,
        totalTokens: 2800,
      });

      db.insertTokenUsage({
        sessionId: "test-session-1",
        model: "claude-sonnet-4-5",
        promptTokens: 500,
        completionTokens: 300,
        totalTokens: 800,
      });

      const sonnetRecords = db.getTokenUsageBySessionId("test-session-1", {
        model: "claude-sonnet-4-5",
      });
      expect(sonnetRecords.length).toBe(2);

      const opusRecords = db.getTokenUsageBySessionId("test-session-1", {
        model: "claude-opus-4-6",
      });
      expect(opusRecords.length).toBe(1);
    });

    test("filters token usage by timestamp", () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      db.insertTokenUsage({
        sessionId: "test-session-1",
        timestamp: twoHoursAgo,
        model: "claude-sonnet-4-5",
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });

      db.insertTokenUsage({
        sessionId: "test-session-1",
        timestamp: oneHourAgo,
        model: "claude-sonnet-4-5",
        promptTokens: 2000,
        completionTokens: 800,
        totalTokens: 2800,
      });

      db.insertTokenUsage({
        sessionId: "test-session-1",
        timestamp: now,
        model: "claude-sonnet-4-5",
        promptTokens: 500,
        completionTokens: 300,
        totalTokens: 800,
      });

      const recentRecords = db.getTokenUsageBySessionId("test-session-1", {
        since: oneHourAgo,
      });
      expect(recentRecords.length).toBe(2);

      const oldRecords = db.getTokenUsageBySessionId("test-session-1", {
        until: oneHourAgo,
      });
      expect(oldRecords.length).toBe(2);
    });

    test("calculates total tokens and cost by session", () => {
      db.insertTokenUsage({
        sessionId: "test-session-1",
        model: "claude-sonnet-4-5",
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        actualCostUsd: 0.05,
      });

      db.insertTokenUsage({
        sessionId: "test-session-1",
        model: "claude-opus-4-6",
        promptTokens: 2000,
        completionTokens: 800,
        totalTokens: 2800,
        actualCostUsd: 0.15,
      });

      db.insertTokenUsage({
        sessionId: "test-session-1",
        model: "claude-sonnet-4-5",
        promptTokens: 500,
        completionTokens: 300,
        totalTokens: 800,
        actualCostUsd: 0.03,
      });

      const totals = db.getTotalTokensBySessionId("test-session-1");

      expect(totals.totalTokens).toBe(5100); // 1500 + 2800 + 800
      expect(totals.totalCost).toBeCloseTo(0.23, 2); // 0.05 + 0.15 + 0.03

      expect(totals.byModel["claude-sonnet-4-5"].tokens).toBe(2300); // 1500 + 800
      expect(totals.byModel["claude-sonnet-4-5"].cost).toBeCloseTo(0.08, 2); // 0.05 + 0.03

      expect(totals.byModel["claude-opus-4-6"].tokens).toBe(2800);
      expect(totals.byModel["claude-opus-4-6"].cost).toBeCloseTo(0.15, 2);
    });

    test("handles missing cost data gracefully", () => {
      db.insertTokenUsage({
        sessionId: "test-session-1",
        model: "claude-sonnet-4-5",
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        // No cost data
      });

      const totals = db.getTotalTokensBySessionId("test-session-1");
      expect(totals.totalTokens).toBe(1500);
      expect(totals.totalCost).toBe(0);
    });

    test("uses estimated cost when actual cost is missing", () => {
      db.insertTokenUsage({
        sessionId: "test-session-1",
        model: "claude-sonnet-4-5",
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        estimatedCostUsd: 0.05,
        // No actual cost
      });

      const totals = db.getTotalTokensBySessionId("test-session-1");
      expect(totals.totalCost).toBeCloseTo(0.05, 2);
    });
  });

  describe("Model Switch Operations", () => {
    test("inserts and retrieves model switches", () => {
      const params: InsertModelSwitchParams = {
        sessionId: "test-session-1",
        fromModel: "claude-sonnet-4-5",
        toModel: "claude-opus-4-6",
        reason: "User requested higher quality",
      };

      const id = db.insertModelSwitch(params);
      expect(id).toBeGreaterThan(0);

      const switches = db.getModelSwitchesBySessionId("test-session-1");
      expect(switches.length).toBe(1);
      expect(switches[0].fromModel).toBe("claude-sonnet-4-5");
      expect(switches[0].toModel).toBe("claude-opus-4-6");
      expect(switches[0].reason).toBe("User requested higher quality");
    });

    test("handles initial model (no fromModel)", () => {
      db.insertModelSwitch({
        sessionId: "test-session-1",
        toModel: "claude-sonnet-4-5",
        reason: "Session start",
      });

      const switches = db.getModelSwitchesBySessionId("test-session-1");
      expect(switches.length).toBe(1);
      expect(switches[0].fromModel).toBeUndefined();
      expect(switches[0].toModel).toBe("claude-sonnet-4-5");
    });

    test("tracks multiple model switches in order", () => {
      db.insertModelSwitch({
        sessionId: "test-session-1",
        toModel: "claude-sonnet-4-5",
        reason: "Session start",
      });

      db.insertModelSwitch({
        sessionId: "test-session-1",
        fromModel: "claude-sonnet-4-5",
        toModel: "claude-opus-4-6",
        reason: "User requested higher quality",
      });

      db.insertModelSwitch({
        sessionId: "test-session-1",
        fromModel: "claude-opus-4-6",
        toModel: "claude-haiku-4-5",
        reason: "User requested faster responses",
      });

      const switches = db.getModelSwitchesBySessionId("test-session-1");
      expect(switches.length).toBe(3);
      expect(switches[0].toModel).toBe("claude-sonnet-4-5");
      expect(switches[1].toModel).toBe("claude-opus-4-6");
      expect(switches[2].toModel).toBe("claude-haiku-4-5");
    });
  });

  describe("Transcript Content Operations", () => {
    test("inserts and retrieves transcript content", () => {
      const params: InsertTranscriptContentParams = {
        sessionId: "test-session-1",
        role: "user",
        content: "What is 2+2?",
      };

      const id = db.insertTranscriptContent(params);
      expect(id).toBeGreaterThan(0);

      const content = db.getTranscriptContentBySessionId("test-session-1");
      expect(content.length).toBe(1);
      expect(content[0].role).toBe("user");
      expect(content[0].content).toBe("What is 2+2?");
    });

    test("filters transcript content by role", () => {
      db.insertTranscriptContent({
        sessionId: "test-session-1",
        role: "user",
        content: "What is 2+2?",
      });

      db.insertTranscriptContent({
        sessionId: "test-session-1",
        role: "assistant",
        content: "2+2 equals 4",
      });

      db.insertTranscriptContent({
        sessionId: "test-session-1",
        role: "system",
        content: "System message",
      });

      const userContent = db.getTranscriptContentBySessionId("test-session-1", {
        role: "user",
      });
      expect(userContent.length).toBe(1);
      expect(userContent[0].content).toBe("What is 2+2?");

      const assistantContent = db.getTranscriptContentBySessionId("test-session-1", {
        role: "assistant",
      });
      expect(assistantContent.length).toBe(1);
      expect(assistantContent[0].content).toBe("2+2 equals 4");
    });

    test("maintains conversation order", () => {
      const messages = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
        { role: "user" as const, content: "How are you?" },
        { role: "assistant" as const, content: "I'm doing well, thanks!" },
      ];

      for (const msg of messages) {
        db.insertTranscriptContent({
          sessionId: "test-session-1",
          ...msg,
        });
      }

      const content = db.getTranscriptContentBySessionId("test-session-1");
      expect(content.length).toBe(4);
      expect(content[0].content).toBe("Hello");
      expect(content[1].content).toBe("Hi there!");
      expect(content[2].content).toBe("How are you?");
      expect(content[3].content).toBe("I'm doing well, thanks!");
    });

    test("filters transcript content by timestamp", () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      db.insertTranscriptContent({
        sessionId: "test-session-1",
        timestamp: twoHoursAgo,
        role: "user",
        content: "Old message",
      });

      db.insertTranscriptContent({
        sessionId: "test-session-1",
        timestamp: oneHourAgo,
        role: "user",
        content: "Recent message 1",
      });

      db.insertTranscriptContent({
        sessionId: "test-session-1",
        timestamp: now,
        role: "user",
        content: "Recent message 2",
      });

      const recentContent = db.getTranscriptContentBySessionId("test-session-1", {
        since: oneHourAgo,
      });
      expect(recentContent.length).toBe(2);
      expect(recentContent[0].content).toBe("Recent message 1");
    });

    test("limits transcript content results", () => {
      for (let i = 0; i < 10; i++) {
        db.insertTranscriptContent({
          sessionId: "test-session-1",
          role: "user",
          content: `Message ${i}`,
        });
      }

      const limitedContent = db.getTranscriptContentBySessionId("test-session-1", {
        limit: 5,
      });
      expect(limitedContent.length).toBe(5);
    });
  });

  describe("Foreign Key Constraints", () => {
    test("cascades delete from sessions to token_usage", () => {
      db.insertTokenUsage({
        sessionId: "test-session-1",
        model: "claude-sonnet-4-5",
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });

      expect(db.getTokenUsageBySessionId("test-session-1").length).toBe(1);

      db.deleteSession("test-session-1");

      expect(db.getTokenUsageBySessionId("test-session-1").length).toBe(0);
    });

    test("cascades delete from sessions to model_switches", () => {
      db.insertModelSwitch({
        sessionId: "test-session-1",
        toModel: "claude-sonnet-4-5",
      });

      expect(db.getModelSwitchesBySessionId("test-session-1").length).toBe(1);

      db.deleteSession("test-session-1");

      expect(db.getModelSwitchesBySessionId("test-session-1").length).toBe(0);
    });

    test("cascades delete from sessions to transcript_content", () => {
      db.insertTranscriptContent({
        sessionId: "test-session-1",
        role: "user",
        content: "Test",
      });

      expect(db.getTranscriptContentBySessionId("test-session-1").length).toBe(1);

      db.deleteSession("test-session-1");

      expect(db.getTranscriptContentBySessionId("test-session-1").length).toBe(0);
    });
  });
});
