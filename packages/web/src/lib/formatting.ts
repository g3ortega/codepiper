import type { Event } from "../types/api";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  tokens?: { prompt: number; completion: number };
}

export function extractMessages(events: Event[]): Message[] {
  return events
    .filter(
      (e) =>
        e.source === "transcript" &&
        (e.type === "user" || e.type === "assistant" || e.type === "system")
    )
    .map((e) => {
      const payload = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload;

      // Extract content from message payload
      let content = "";
      if (payload.message?.content) {
        content = formatContent(payload.message.content);
      } else if (payload.content) {
        content = formatContent(payload.content);
      } else if (payload.text) {
        content = payload.text;
      }

      // Extract tokens from usage data
      let tokens: { prompt: number; completion: number } | undefined;
      if (payload.message?.usage) {
        tokens = {
          prompt: payload.message.usage.input_tokens || 0,
          completion: payload.message.usage.output_tokens || 0,
        };
      }

      return {
        role: (e.type as "user" | "assistant" | "system") || "system",
        content,
        timestamp: new Date(e.timestamp),
        tokens,
      };
    })
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function formatContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item.type === "text") return item.text;
        if (item.type === "tool_use") return `[Tool: ${item.name}]`;
        return JSON.stringify(item);
      })
      .join("\n");
  }

  return JSON.stringify(content, null, 2);
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}
