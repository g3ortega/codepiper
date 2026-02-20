/**
 * Analytics API routes for web dashboard
 *
 * Shows token consumption, cache efficiency, activity patterns,
 * and estimated equivalent API cost (useful for Max plan users
 * to understand the value of their subscription).
 */

import type { EventBus } from "@codepiper/core";
import { calculateCost, getPricingForModel } from "../config/pricing";
import type { Database } from "../db/db";
import type { AuditLogger } from "../sessions/auditLogger";
import type { PolicyEngine } from "../sessions/policyEngine";
import type { SessionManager } from "../sessions/sessionManager";

export interface RouteContext {
  sessionManager: SessionManager;
  db: Database;
  eventBus: EventBus;
  policyEngine: PolicyEngine;
  auditLogger: AuditLogger;
}

interface TimeRange {
  start: number;
  end: number;
}

function parseTimeRange(url: URL): TimeRange {
  const range = url.searchParams.get("range") || "7d";
  const now = Date.now();

  switch (range) {
    case "today":
      return {
        start: new Date(new Date().setHours(0, 0, 0, 0)).getTime(),
        end: now,
      };
    case "7d":
      return { start: now - 7 * 24 * 60 * 60 * 1000, end: now };
    case "30d":
      return { start: now - 30 * 24 * 60 * 60 * 1000, end: now };
    case "all":
      return { start: 0, end: now };
    default:
      return { start: now - 7 * 24 * 60 * 60 * 1000, end: now };
  }
}

/**
 * GET /analytics/overview
 */
export async function handleAnalyticsOverview(req: Request, ctx: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const { start, end } = parseTimeRange(url);

  const sessionsCount = ctx.db.db
    .prepare("SELECT COUNT(*) as count FROM sessions WHERE created_at >= ? AND created_at <= ?")
    .get(start, end) as { count: number };

  const activeSessions = ctx.db.db
    .prepare(
      "SELECT COUNT(*) as count FROM sessions WHERE status IN ('RUNNING','STARTING','NEEDS_INPUT','NEEDS_PERMISSION')"
    )
    .get() as { count: number };

  const totalTokens = ctx.db.db
    .prepare(
      "SELECT COALESCE(SUM(total_tokens), 0) as tokens FROM token_usage WHERE timestamp >= ? AND timestamp <= ?"
    )
    .get(start, end) as { tokens: number };

  const tokenBreakdown = ctx.db.db
    .prepare(
      `SELECT
        COALESCE(SUM(prompt_tokens), 0) as inputTokens,
        COALESCE(SUM(completion_tokens), 0) as outputTokens,
        COALESCE(SUM(cache_read_input_tokens), 0) as cacheReadTokens,
        COALESCE(SUM(cache_creation_input_tokens), 0) as cacheCreationTokens
      FROM token_usage WHERE timestamp >= ? AND timestamp <= ?`
    )
    .get(start, end) as {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };

  // Total messages (user + assistant transcript events)
  const totalMessages = ctx.db.db
    .prepare(
      `SELECT COUNT(*) as count FROM events
       WHERE source = 'transcript' AND type IN ('user', 'assistant')
       AND ts >= ? AND ts <= ?`
    )
    .get(start, end) as { count: number };

  // Cache hit rate
  const cacheStats = ctx.db.db
    .prepare(
      `SELECT
        COALESCE(SUM(cache_read_input_tokens), 0) as cache_hits,
        COALESCE(SUM(prompt_tokens + cache_creation_input_tokens + cache_read_input_tokens), 0) as total_input
      FROM token_usage
      WHERE timestamp >= ? AND timestamp <= ?`
    )
    .get(start, end) as { cache_hits: number; total_input: number };

  const cacheHitRate =
    cacheStats.total_input > 0 ? (cacheStats.cache_hits / cacheStats.total_input) * 100 : 0;

  // Compute estimated equivalent API cost
  const costRows = ctx.db.db
    .prepare(
      `SELECT model,
        COALESCE(SUM(prompt_tokens), 0) as prompt,
        COALESCE(SUM(completion_tokens), 0) as completion,
        COALESCE(SUM(cache_creation_input_tokens), 0) as cache_creation,
        COALESCE(SUM(cache_read_input_tokens), 0) as cache_read
      FROM token_usage
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY model`
    )
    .all(start, end) as Array<{
    model: string;
    prompt: number;
    completion: number;
    cache_creation: number;
    cache_read: number;
  }>;

  let costEstimate = 0;
  for (const row of costRows) {
    const pricing = getPricingForModel(row.model);
    costEstimate += calculateCost(
      row.prompt,
      row.completion,
      row.cache_creation,
      row.cache_read,
      pricing
    );
  }

  return Response.json({
    sessionsCount: sessionsCount.count,
    activeSessions: activeSessions.count,
    totalTokens: totalTokens.tokens,
    inputTokens: tokenBreakdown.inputTokens,
    outputTokens: tokenBreakdown.outputTokens,
    cacheReadTokens: tokenBreakdown.cacheReadTokens,
    cacheCreationTokens: tokenBreakdown.cacheCreationTokens,
    totalMessages: totalMessages.count,
    cacheHitRate: Math.round(cacheHitRate * 10) / 10,
    costEstimate: Math.round(costEstimate * 100) / 100,
  });
}

/**
 * GET /analytics/activity-timeline
 * Messages per day (user + assistant)
 */
export async function handleActivityTimeline(req: Request, ctx: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const { start, end } = parseTimeRange(url);

  const data = ctx.db.db
    .prepare(
      `SELECT
        DATE(ts / 1000, 'unixepoch') as date,
        SUM(CASE WHEN type = 'user' THEN 1 ELSE 0 END) as user_messages,
        SUM(CASE WHEN type = 'assistant' THEN 1 ELSE 0 END) as assistant_messages,
        COUNT(*) as total
      FROM events
      WHERE source = 'transcript' AND type IN ('user', 'assistant')
      AND ts >= ? AND ts <= ?
      GROUP BY date
      ORDER BY date`
    )
    .all(start, end);

  return Response.json(data);
}

/**
 * GET /analytics/tokens-by-model
 * Token distribution by model
 */
export async function handleTokensByModel(req: Request, ctx: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const { start, end } = parseTimeRange(url);

  const rows = ctx.db.db
    .prepare(
      `SELECT
        model,
        SUM(total_tokens) as tokens,
        SUM(prompt_tokens) as prompt_tokens,
        SUM(completion_tokens) as completion_tokens,
        SUM(cache_read_input_tokens) as cache_read,
        SUM(cache_creation_input_tokens) as cache_creation,
        COUNT(*) as requests
      FROM token_usage
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY model
      ORDER BY tokens DESC`
    )
    .all(start, end) as Array<{
    model: string;
    tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    cache_read: number;
    cache_creation: number;
    requests: number;
  }>;

  const data = rows.map((row) => {
    const pricing = getPricingForModel(row.model);
    const cost = calculateCost(
      row.prompt_tokens,
      row.completion_tokens,
      row.cache_creation,
      row.cache_read,
      pricing
    );
    return { ...row, costEstimate: Math.round(cost * 100) / 100 };
  });

  return Response.json(data);
}

/**
 * GET /analytics/token-usage
 * Token usage breakdown over time
 */
export async function handleTokenUsage(req: Request, ctx: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const { start, end } = parseTimeRange(url);

  const data = ctx.db.db
    .prepare(
      `SELECT
        DATE(timestamp / 1000, 'unixepoch') as date,
        COALESCE(SUM(prompt_tokens), 0) as prompt,
        COALESCE(SUM(completion_tokens), 0) as completion,
        COALESCE(SUM(cache_creation_input_tokens), 0) as cacheCreation,
        COALESCE(SUM(cache_read_input_tokens), 0) as cacheRead
      FROM token_usage
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY date
      ORDER BY date`
    )
    .all(start, end);

  return Response.json(data);
}

/**
 * GET /analytics/sessions-by-provider
 */
export async function handleSessionsByProvider(req: Request, ctx: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const { start, end } = parseTimeRange(url);

  const data = ctx.db.db
    .prepare(
      `SELECT provider, COUNT(*) as count
      FROM sessions
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY provider
      ORDER BY count DESC`
    )
    .all(start, end);

  return Response.json(data);
}

/**
 * GET /analytics/tool-usage
 * Top tools used across sessions
 */
export async function handleToolUsage(req: Request, ctx: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const { start, end } = parseTimeRange(url);

  // Tool uses are stored as assistant events with content arrays containing tool_use blocks.
  // We extract tool names from the payload JSON.
  const rows = ctx.db.db
    .prepare(
      `SELECT payload_json FROM events
       WHERE source = 'transcript' AND type = 'assistant'
       AND ts >= ? AND ts <= ?`
    )
    .all(start, end) as Array<{ payload_json: string }>;

  const toolCounts: Record<string, number> = {};

  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload_json);
      const content = parsed.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_use" && block.name) {
            toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
          }
        }
      }
    } catch {
      // skip
    }
  }

  const data = Object.entries(toolCounts)
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return Response.json(data);
}

/**
 * GET /analytics/policy-decisions
 */
export async function handlePolicyDecisions(req: Request, ctx: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const { start, end } = parseTimeRange(url);

  const data = ctx.db.db
    .prepare(
      `SELECT
        DATE(timestamp / 1000, 'unixepoch') as date,
        decision,
        COUNT(*) as count
      FROM policy_decisions
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY date, decision
      ORDER BY date`
    )
    .all(start, end);

  return Response.json(data);
}
