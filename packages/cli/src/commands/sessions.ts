import type { ProviderId, SessionHandle, SessionStatus } from "@codepiper/core";
import { readErrorJson, readJson, responseErrorMessage } from "../lib/api";
import { getRequiredValue } from "../lib/args";

export interface SessionsOptions {
  socket: string;
  format: "table" | "json";
  provider?: ProviderId;
  status?: SessionStatus;
}

const VALID_FORMATS = ["table", "json"];

export function parseSessionsOptions(args: string[]): SessionsOptions {
  let socket = "/tmp/codepiper.sock";
  let format: "table" | "json" = "table";
  let provider: ProviderId | undefined;
  let status: SessionStatus | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--format" || arg === "-f") {
      const formatValue = getRequiredValue(args, i, arg);
      i++;
      if (!VALID_FORMATS.includes(formatValue)) {
        throw new Error(
          `Invalid format: ${formatValue}. Valid options: ${VALID_FORMATS.join(", ")}`
        );
      }
      format = formatValue as "table" | "json";
    } else if (arg === "--provider" || arg === "-p") {
      provider = getRequiredValue(args, i, arg) as ProviderId;
      i++;
    } else if (arg === "--status") {
      status = getRequiredValue(args, i, arg) as SessionStatus;
      i++;
    }
  }

  const options: SessionsOptions = {
    socket,
    format,
  };
  if (provider !== undefined) {
    options.provider = provider;
  }
  if (status !== undefined) {
    options.status = status;
  }

  return options;
}

export async function listSessions(options: SessionsOptions): Promise<SessionHandle[]> {
  const params = new URLSearchParams();
  if (options.provider) {
    params.append("provider", options.provider);
  }
  if (options.status) {
    params.append("status", options.status);
  }

  const queryString = params.toString();
  const url = `http://localhost/sessions${queryString ? `?${queryString}` : ""}`;

  try {
    const response = await fetch(url, {
      unix: options.socket,
      method: "GET",
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }

    const data = await readJson<{ sessions?: any[] }>(response);
    const sessions = data.sessions || [];

    return sessions.map((s: any) => ({
      id: s.id,
      provider: s.provider,
      cwd: s.cwd,
      status: s.status,
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
      pid: s.pid,
      transcriptPath: s.transcriptPath,
      metadata: s.metadata,
    }));
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  // Status colors
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function getStatusColor(status: SessionStatus): string {
  switch (status) {
    case "RUNNING":
      return colors.green;
    case "STARTING":
      return colors.yellow;
    case "STOPPED":
      return colors.gray;
    case "CRASHED":
      return colors.red;
    case "NEEDS_PERMISSION":
      return colors.blue;
    case "NEEDS_INPUT":
      return colors.cyan;
    default:
      return colors.reset;
  }
}

function formatTable(sessions: SessionHandle[]): void {
  if (sessions.length === 0) {
    console.log(`${colors.dim}No sessions found.${colors.reset}`);
    return;
  }

  // Calculate column widths
  const idWidth = Math.max(8, ...sessions.map((s) => s.id.slice(0, 8).length));
  const providerWidth = Math.max(12, ...sessions.map((s) => s.provider.length));
  const statusWidth = Math.max(8, ...sessions.map((s) => s.status.length));

  // Print header with bold
  console.log(
    `${colors.bold}${"ID".padEnd(idWidth)}  ${"PROVIDER".padEnd(providerWidth)}  ${"STATUS".padEnd(statusWidth)}  ${"DIRECTORY".padEnd(35)}  ${"CREATED"}${colors.reset}`
  );
  console.log(
    colors.dim +
      "─".repeat(idWidth + 2 + providerWidth + 2 + statusWidth + 2 + 35 + 2 + 25) +
      colors.reset
  );

  // Print rows with colored status
  for (const session of sessions) {
    const shortId = session.id.slice(0, 8);
    const cwd = session.cwd.length > 35 ? `...${session.cwd.slice(-32)}` : session.cwd;
    const created = session.createdAt.toLocaleString();
    const statusColor = getStatusColor(session.status);

    console.log(
      `${colors.cyan}${shortId.padEnd(idWidth)}${colors.reset}  ${session.provider.padEnd(providerWidth)}  ${statusColor}${session.status.padEnd(statusWidth)}${colors.reset}  ${colors.dim}${cwd.padEnd(35)}${colors.reset}  ${colors.dim}${created}${colors.reset}`
    );
  }

  // Summary with counts by status
  const statusCounts = sessions.reduce(
    (acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const statusSummary = Object.entries(statusCounts)
    .map(([status, count]) => {
      const color = getStatusColor(status as SessionStatus);
      return `${color}${count} ${status.toLowerCase()}${colors.reset}`;
    })
    .join(", ");

  console.log(
    `\n${colors.bold}Total:${colors.reset} ${sessions.length} session(s) (${statusSummary})`
  );
}

export async function runSessionsCommand(args: string[]): Promise<void> {
  const options = parseSessionsOptions(args);
  const sessions = await listSessions(options);

  if (options.format === "json") {
    console.log(JSON.stringify(sessions, null, 2));
  } else {
    formatTable(sessions);
  }
}
