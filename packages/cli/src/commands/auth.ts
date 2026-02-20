import { readErrorJson, readJson, responseErrorMessage } from "../lib/api";
import { getRequiredValue } from "../lib/args";

interface AuthOptions {
  socket: string;
  subcommand: string;
  args: string[];
}

function parseAuthOptions(args: string[]): AuthOptions {
  let socket = "/tmp/codepiper.sock";
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    } else {
      positional.push(arg);
    }
  }

  return {
    socket,
    subcommand: positional[0] || "status",
    args: positional.slice(1),
  };
}

async function daemonRequest<T>(socket: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`http://localhost${path}`, {
    unix: socket,
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const errorData = await readErrorJson(response);
    throw new Error(responseErrorMessage(response, errorData));
  }

  return readJson<T>(response);
}

async function handleStatus(socket: string): Promise<void> {
  const status = await daemonRequest<{ setupRequired: boolean; mfaEnabled: boolean }>(
    socket,
    "/auth/status"
  );

  console.log("Auth Configuration:");
  if (status.setupRequired) {
    console.log("  Password:  \x1b[33mNot set\x1b[0m (setup required)");
  } else {
    console.log("  Password:  \x1b[32mConfigured\x1b[0m");
  }

  if (status.mfaEnabled) {
    console.log("  MFA:       \x1b[32mEnabled\x1b[0m");
  } else {
    console.log("  MFA:       \x1b[33mDisabled\x1b[0m");
  }
}

async function handleResetPassword(socket: string): Promise<void> {
  process.stdout.write("New password: ");
  const password = await readPasswordFromStdin();

  if (password.length < 8) {
    console.error("Error: Password must be at least 8 characters");
    process.exit(1);
  }

  process.stdout.write("Confirm password: ");
  const confirm = await readPasswordFromStdin();

  if (password !== confirm) {
    console.error("Error: Passwords do not match");
    process.exit(1);
  }

  await daemonRequest(socket, "/auth/cli/reset-password", {
    method: "POST",
    body: JSON.stringify({ password }),
  });

  console.log("\x1b[32m✓\x1b[0m Password reset successfully");
  console.log("  All existing sessions have been invalidated.");
}

async function handleResetMfa(socket: string): Promise<void> {
  process.stdout.write("Are you sure you want to disable MFA? (yes/no): ");
  const answer = await readLineFromStdin();

  if (answer.toLowerCase() !== "yes") {
    console.log("Cancelled.");
    return;
  }

  await daemonRequest(socket, "/auth/cli/reset-mfa", {
    method: "POST",
  });

  console.log("\x1b[32m✓\x1b[0m MFA has been disabled");
}

async function handleSessions(socket: string): Promise<void> {
  const data = await daemonRequest<{
    sessions: Array<{
      createdAt: string | number;
      lastUsedAt: string | number;
      ipAddress: string | null;
      userAgent: string | null;
    }>;
  }>(socket, "/auth/sessions");
  const sessions = data.sessions;

  if (sessions.length === 0) {
    console.log("No active sessions.");
    return;
  }

  console.log(`Active sessions (${sessions.length}):\n`);

  for (const session of sessions) {
    const created = new Date(session.createdAt).toLocaleString();
    const lastUsed = new Date(session.lastUsedAt).toLocaleString();
    const ip = session.ipAddress || "unknown";
    const ua = parseUserAgent(session.userAgent);

    console.log(`  ${ua}`);
    console.log(`    IP: ${ip}  |  Created: ${created}  |  Last active: ${lastUsed}`);
    console.log();
  }
}

async function handleRevokeAll(socket: string): Promise<void> {
  process.stdout.write("Revoke all active sessions? (yes/no): ");
  const answer = await readLineFromStdin();

  if (answer.toLowerCase() !== "yes") {
    console.log("Cancelled.");
    return;
  }

  await daemonRequest(socket, "/auth/sessions/revoke-all", {
    method: "POST",
  });

  console.log("\x1b[32m✓\x1b[0m All sessions have been revoked");
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Safari")) return "Safari";
  if (ua.includes("curl")) return "curl";
  return "Browser";
}

async function readLineFromStdin(): Promise<string> {
  const buf = Buffer.alloc(1024);
  const n = await new Promise<number>((resolve) => {
    process.stdin.once("readable", () => {
      const chunk = process.stdin.read();
      if (chunk) {
        chunk.copy(buf);
        resolve(chunk.length);
      } else {
        resolve(0);
      }
    });
  });
  return buf.subarray(0, n).toString("utf-8").trim();
}

async function readPasswordFromStdin(): Promise<string> {
  // Disable echo for password input
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  const chars: string[] = [];

  return new Promise((resolve) => {
    const onData = (data: Buffer) => {
      const char = data.toString("utf-8");

      for (const c of char) {
        if (c === "\r" || c === "\n") {
          // Enter pressed
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(chars.join(""));
          return;
        }
        if (c === "\x03") {
          // Ctrl+C
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          process.stdout.write("\n");
          process.exit(1);
        }
        if (c === "\x7f" || c === "\b") {
          // Backspace
          if (chars.length > 0) {
            chars.pop();
            process.stdout.write("\b \b");
          }
        } else {
          chars.push(c);
          process.stdout.write("*");
        }
      }
    };

    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

export async function runAuthCommand(args: string[]): Promise<void> {
  const options = parseAuthOptions(args);

  switch (options.subcommand) {
    case "status":
      await handleStatus(options.socket);
      break;
    case "reset-password":
      await handleResetPassword(options.socket);
      break;
    case "reset-mfa":
      await handleResetMfa(options.socket);
      break;
    case "sessions":
      await handleSessions(options.socket);
      break;
    case "revoke-all":
      await handleRevokeAll(options.socket);
      break;
    default:
      console.error(`Unknown auth subcommand: ${options.subcommand}`);
      console.error(
        "Available subcommands: status, reset-password, reset-mfa, sessions, revoke-all"
      );
      process.exit(1);
  }
}
