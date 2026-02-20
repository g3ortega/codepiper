import { daemonJson } from "../lib/api";
import { getOption, getSocket } from "../lib/args";
import { colors, info, table } from "../lib/format";

function daysToRange(days: string): string {
  switch (days) {
    case "1":
      return "today";
    case "30":
      return "30d";
    case "0":
      return "all";
    default:
      return "7d";
  }
}

async function showOverview(socket: string, range: string): Promise<void> {
  const data = await daemonJson<{
    sessionsCount: number;
    activeSessions: number;
    totalTokens: number;
    totalMessages: number;
    cacheHitRate: number;
    costEstimate: number;
  }>(`/analytics/overview?range=${range}`, { socket });

  console.log(`${colors.bold}Analytics Overview${colors.reset} (range: ${range})\n`);
  info("Total sessions", String(data.sessionsCount ?? 0));
  info("Active sessions", String(data.activeSessions ?? 0));
  info("Total tokens", (data.totalTokens ?? 0).toLocaleString());
  info("Total messages", String(data.totalMessages ?? 0));
  info("Cache hit rate", `${data.cacheHitRate ?? 0}%`);
  if (data.costEstimate !== undefined) {
    info("Estimated cost", `$${data.costEstimate.toFixed(2)}`);
  }
}

async function showTokens(socket: string, range: string): Promise<void> {
  const data = await daemonJson<
    Array<{
      model: string;
      tokens: number;
      prompt_tokens: number;
      completion_tokens: number;
      cache_read: number;
      cache_creation: number;
      requests: number;
      costEstimate: number;
    }>
  >(`/analytics/tokens-by-model?range=${range}`, { socket });

  console.log(`${colors.bold}Tokens by Model${colors.reset} (range: ${range})\n`);

  if (!data || data.length === 0) {
    console.log("No token data available.");
    return;
  }

  const rows = data.map((m) => [
    m.model || "unknown",
    (m.tokens ?? 0).toLocaleString(),
    (m.prompt_tokens ?? 0).toLocaleString(),
    (m.completion_tokens ?? 0).toLocaleString(),
    String(m.requests ?? 0),
    m.costEstimate !== undefined ? `$${m.costEstimate.toFixed(2)}` : "-",
  ]);

  console.log(table(["MODEL", "TOTAL", "PROMPT", "COMPLETION", "REQUESTS", "COST"], rows));
}

async function showTools(socket: string, range: string): Promise<void> {
  const data = await daemonJson<Array<{ tool: string; count: number }>>(
    `/analytics/tool-usage?range=${range}`,
    { socket }
  );

  console.log(`${colors.bold}Tool Usage${colors.reset} (range: ${range})\n`);

  if (!data || data.length === 0) {
    console.log("No tool usage data available.");
    return;
  }

  const rows = data.map((t) => [t.tool || "-", String(t.count ?? 0)]);

  console.log(table(["TOOL", "USES"], rows));
}

async function showActivity(socket: string, range: string): Promise<void> {
  const data = await daemonJson<
    Array<{
      date: string;
      user_messages: number;
      assistant_messages: number;
      total: number;
    }>
  >(`/analytics/activity-timeline?range=${range}`, { socket });

  console.log(`${colors.bold}Activity Timeline${colors.reset} (range: ${range})\n`);

  if (!data || data.length === 0) {
    console.log("No activity data available.");
    return;
  }

  const rows = data.map((a) => [
    a.date || "-",
    String(a.user_messages ?? 0),
    String(a.assistant_messages ?? 0),
    String(a.total ?? 0),
  ]);

  console.log(table(["DATE", "USER", "ASSISTANT", "TOTAL"], rows));
}

async function showSessions(socket: string, range: string): Promise<void> {
  const data = await daemonJson<Array<{ provider: string; count: number }>>(
    `/analytics/sessions-by-provider?range=${range}`,
    { socket }
  );

  console.log(`${colors.bold}Sessions by Provider${colors.reset} (range: ${range})\n`);

  if (!data || data.length === 0) {
    console.log("No session data available.");
    return;
  }

  const rows = data.map((s) => [s.provider || "-", String(s.count ?? 0)]);

  console.log(table(["PROVIDER", "SESSIONS"], rows));
}

export async function runAnalyticsCommand(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const days = getOption(args, "days") || "7";
  const range = daysToRange(days);
  const subcommand = args.find((a) => !a.startsWith("-")) || "overview";

  switch (subcommand) {
    case "overview":
      return showOverview(socket, range);
    case "tokens":
      return showTokens(socket, range);
    case "tools":
      return showTools(socket, range);
    case "activity":
      return showActivity(socket, range);
    case "sessions":
      return showSessions(socket, range);
    default:
      throw new Error(
        `Unknown analytics subcommand: ${subcommand}. Use: overview, tokens, tools, activity, sessions`
      );
  }
}
