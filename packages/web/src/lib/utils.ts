import { type ClassValue, clsx } from "clsx";
import type { Session } from "../types/api";

/**
 * Utility for merging Tailwind CSS classes
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Session statuses that indicate an active (non-terminal) session.
 */
const ACTIVE_STATUSES = new Set(["RUNNING", "STARTING", "NEEDS_PERMISSION", "NEEDS_INPUT"]);

/**
 * Returns true if the session is in an active (non-terminal) state.
 */
export function isActiveSession(session: Session): boolean {
  return ACTIVE_STATUSES.has(session.status);
}

/**
 * Returns true if the session needs user attention (permission or input).
 */
export function needsAttention(session: Session): boolean {
  return session.status === "NEEDS_PERMISSION" || session.status === "NEEDS_INPUT";
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return then.toLocaleDateString();
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return `${str.slice(0, length)}...`;
}

/**
 * Get status color for session status
 */
export function getStatusColor(
  status: string
): "green" | "yellow" | "red" | "gray" | "blue" | "cyan" {
  switch (status) {
    case "RUNNING":
      return "green";
    case "STARTING":
      return "yellow";
    case "CRASHED":
      return "red";
    case "STOPPED":
      return "gray";
    case "NEEDS_PERMISSION":
      return "blue";
    case "NEEDS_INPUT":
      return "cyan";
    default:
      return "gray";
  }
}

/**
 * Get status emoji for session status
 */
export function getStatusEmoji(status: string): string {
  switch (status) {
    case "RUNNING":
      return "🟢";
    case "STARTING":
      return "🟡";
    case "CRASHED":
      return "🔴";
    case "STOPPED":
      return "⚫";
    case "NEEDS_PERMISSION":
      return "🔔";
    case "NEEDS_INPUT":
      return "❓";
    default:
      return "⚪";
  }
}
