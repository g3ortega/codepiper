import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "../db/db";
import {
  handleActivityTimeline,
  handleAnalyticsOverview,
  handleSessionsByProvider,
  handleTokensByModel,
  handleTokenUsage,
  handleToolUsage,
  type RouteContext,
} from "./analyticsRoutes";

describe("Analytics API Routes", () => {
  let db: Database;
  let ctx: RouteContext;
  let now: number;

  const makeRequest = (path: string) => new Request(`http://localhost${path}`);

  beforeEach(async () => {
    db = new Database(":memory:");
    await db.init();
    // Keep timestamps away from midnight boundaries to avoid date-grouping flakes
    // while still staying within the active range window relative to real "now".
    const stableNow = new Date();
    stableNow.setHours(15, 0, 0, 0);
    if (stableNow.getTime() > Date.now()) {
      stableNow.setDate(stableNow.getDate() - 1);
    }
    now = stableNow.getTime();

    db.createSession({
      id: "s-claude",
      provider: "claude-code",
      cwd: process.cwd(),
      status: "RUNNING",
    });
    db.createSession({
      id: "s-codex",
      provider: "codex",
      cwd: process.cwd(),
      status: "NEEDS_INPUT",
    });
    db.createSession({
      id: "s-old",
      provider: "codex",
      cwd: process.cwd(),
      status: "STOPPED",
    });

    const oldTs = now - 40 * 24 * 60 * 60 * 1000;
    db.db
      .prepare("UPDATE sessions SET created_at = ?, updated_at = ? WHERE id = ?")
      .run(oldTs, oldTs, "s-old");

    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);

    db.insertEvent({
      sessionId: "s-claude",
      source: "transcript",
      type: "user",
      payload: { message: { content: "hi" } },
      timestamp: twoHoursAgo,
    });
    db.insertEvent({
      sessionId: "s-claude",
      source: "transcript",
      type: "assistant",
      payload: { message: { content: "hello" } },
      timestamp: twoHoursAgo,
    });
    db.insertEvent({
      sessionId: "s-codex",
      source: "transcript",
      type: "user",
      payload: { message: { content: "status?" } },
      timestamp: twoDaysAgo,
    });
    db.insertEvent({
      sessionId: "s-codex",
      source: "transcript",
      type: "assistant",
      payload: {
        message: {
          content: [
            { type: "text", text: "done" },
            { type: "tool_use", name: "Read" },
            { type: "tool_use", name: "Read" },
          ],
        },
      },
      timestamp: twoDaysAgo,
    });
    db.insertEvent({
      sessionId: "s-codex",
      source: "transcript",
      type: "assistant",
      payload: {
        message: {
          content: [
            { type: "tool_use", name: "Edit" },
            { type: "tool_use", name: "Read" },
          ],
        },
      },
      timestamp: twoHoursAgo,
    });

    db.db
      .prepare(
        "INSERT INTO events (session_id, ts, source, type, payload_json) VALUES (?, ?, ?, ?, ?)"
      )
      .run("s-codex", now, "transcript", "assistant", "{bad-json");
    db.db
      .prepare(
        "INSERT INTO events (session_id, ts, source, type, payload_json) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "s-old",
        oldTs,
        "transcript",
        "assistant",
        JSON.stringify({ message: { content: [{ type: "tool_use", name: "Delete" }] } })
      );

    db.insertTokenUsage({
      sessionId: "s-claude",
      model: "claude-sonnet-4-5",
      promptTokens: 1_000_000,
      completionTokens: 500_000,
      cacheCreationInputTokens: 100_000,
      cacheReadInputTokens: 250_000,
      totalTokens: 1_850_000,
      timestamp: twoHoursAgo,
    });
    db.insertTokenUsage({
      sessionId: "s-codex",
      model: "claude-opus-4-1",
      promptTokens: 2_000_000,
      completionTokens: 1_000_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 3_000_000,
      timestamp: twoDaysAgo,
    });
    db.insertTokenUsage({
      sessionId: "s-old",
      model: "claude-sonnet-4",
      promptTokens: 9_000_000,
      completionTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 9_000_000,
      timestamp: new Date(oldTs),
    });

    ctx = {
      db,
      sessionManager: {} as any,
      eventBus: {} as any,
      policyEngine: {} as any,
      auditLogger: {} as any,
    };
  });

  afterEach(() => {
    db.close();
  });

  test("GET /analytics/overview returns aggregated metrics within selected range", async () => {
    const response = await handleAnalyticsOverview(
      makeRequest("/analytics/overview?range=7d"),
      ctx
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      sessionsCount: 2,
      activeSessions: 2,
      totalTokens: 4_850_000,
      inputTokens: 3_000_000,
      outputTokens: 1_500_000,
      cacheReadTokens: 250_000,
      cacheCreationTokens: 100_000,
      totalMessages: 6,
      cacheHitRate: 7.5,
      costEstimate: 115.95,
    });
  });

  test("GET /analytics/activity-timeline groups transcript activity by date", async () => {
    const response = await handleActivityTimeline(
      makeRequest("/analytics/activity-timeline?range=7d"),
      ctx
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<{
      date: string;
      user_messages: number;
      assistant_messages: number;
      total: number;
    }>;
    expect(body.length).toBe(2);
    expect(
      body.every((entry) => entry.total === entry.user_messages + entry.assistant_messages)
    ).toBe(true);
    expect(body.map((entry) => entry.total)).toEqual([2, 4]);
  });

  test("GET /analytics/tokens-by-model computes per-model totals and cost estimate", async () => {
    const response = await handleTokensByModel(
      makeRequest("/analytics/tokens-by-model?range=7d"),
      ctx
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<{
      model: string;
      tokens: number;
      requests: number;
      costEstimate: number;
    }>;
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      model: "claude-opus-4-1",
      tokens: 3_000_000,
      requests: 1,
      costEstimate: 105,
    });
    expect(body[1]).toMatchObject({
      model: "claude-sonnet-4-5",
      tokens: 1_850_000,
      requests: 1,
      costEstimate: 10.95,
    });
  });

  test("GET /analytics/token-usage aggregates token metrics by day", async () => {
    const response = await handleTokenUsage(makeRequest("/analytics/token-usage?range=7d"), ctx);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<{
      date: string;
      prompt: number;
      completion: number;
      cacheCreation: number;
      cacheRead: number;
    }>;
    expect(body).toHaveLength(2);
    expect(body.map((entry) => entry.prompt)).toEqual([2_000_000, 1_000_000]);
    expect(body.map((entry) => entry.completion)).toEqual([1_000_000, 500_000]);
  });

  test("GET /analytics/sessions-by-provider returns provider distribution in range", async () => {
    const response = await handleSessionsByProvider(
      makeRequest("/analytics/sessions-by-provider?range=7d"),
      ctx
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<{ provider: string; count: number }>;
    expect(body).toHaveLength(2);
    expect(body).toEqual(
      expect.arrayContaining([
        { provider: "claude-code", count: 1 },
        { provider: "codex", count: 1 },
      ])
    );
  });

  test("GET /analytics/tool-usage extracts tool_use blocks and ignores malformed payloads", async () => {
    const response = await handleToolUsage(makeRequest("/analytics/tool-usage?range=7d"), ctx);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<{ tool: string; count: number }>;
    expect(body).toEqual([
      { tool: "Read", count: 3 },
      { tool: "Edit", count: 1 },
    ]);
  });

  test("invalid range falls back to default 7d behavior", async () => {
    const response = await handleAnalyticsOverview(
      makeRequest("/analytics/overview?range=not-valid"),
      ctx
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.totalTokens).toBe(4_850_000);
  });
});
