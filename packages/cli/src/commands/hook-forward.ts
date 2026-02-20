/**
 * Hook forwarding command for Claude Code hooks
 *
 * This command is called by Claude Code hooks to forward events to the daemon.
 * It reads JSON from stdin, POSTs to the daemon's hooks endpoint, and handles
 * PermissionRequest responses.
 *
 * Environment variables:
 * - CODEPIPER_UNIX_SOCK: Path to daemon socket
 * - CODEPIPER_SESSION: Session ID for metadata
 * - CODEPIPER_SECRET: Authentication token
 *
 * Exit codes:
 * - 0: Success
 * - 2: Block action (for PermissionRequest deny)
 * - 1: Error
 */

import { readErrorJson, readJson, responseErrorMessage } from "../lib/api";

interface HookEvent {
  event?: string; // Legacy format
  hook_event_name?: string; // Claude Code 2.1.42+ format
  session_id?: string;
  [key: string]: unknown;
}

interface PermissionResponse {
  decision?: "allow" | "deny" | "ask";
  allow?: boolean; // Backward compatibility with older daemon responses
  denialMessage?: string;
  message?: string;
  updatedInput?: unknown;
  updatedPermissions?: unknown;
}

interface ClaudePermissionDecision {
  decision: "allow" | "deny";
  denialMessage?: string;
  updatedInput?: unknown;
  updatedPermissions?: unknown;
}

/**
 * Read all data from stdin
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    process.stdin.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    process.stdin.on("end", () => {
      const data = Buffer.concat(chunks).toString("utf-8");
      resolve(data);
    });

    process.stdin.on("error", (error) => {
      reject(error);
    });

    // Resume stdin to start reading
    process.stdin.resume();
  });
}

/**
 * Validate required environment variables
 */
function validateEnvironment(): {
  socketPath: string;
  sessionId: string;
  secret: string;
} {
  const socketPath = process.env.CODEPIPER_UNIX_SOCK;
  const sessionId = process.env.CODEPIPER_SESSION;
  const secret = process.env.CODEPIPER_SECRET;

  if (!socketPath) {
    throw new Error(
      "CODEPIPER_UNIX_SOCK environment variable is required. " +
        "This should be set by the daemon when spawning the session."
    );
  }

  if (!sessionId) {
    throw new Error(
      "CODEPIPER_SESSION environment variable is required. " +
        "This should be set by the daemon when spawning the session."
    );
  }

  if (!secret) {
    throw new Error(
      "CODEPIPER_SECRET environment variable is required. " +
        "This should be set by the daemon when spawning the session."
    );
  }

  return { socketPath, sessionId, secret };
}

function resolveEnvironment(options?: {
  socketPath?: string;
  sessionId?: string;
  secret?: string;
}): {
  socketPath: string;
  sessionId: string;
  secret: string;
} {
  if (!options) {
    return validateEnvironment();
  }

  const socketPath = options.socketPath ?? process.env.CODEPIPER_UNIX_SOCK;
  const sessionId = options.sessionId ?? process.env.CODEPIPER_SESSION;
  const secret = options.secret ?? process.env.CODEPIPER_SECRET;

  if (!(socketPath && sessionId && secret)) {
    throw new Error(
      "Missing hook-forward environment values. " +
        "Required: socketPath, sessionId, secret (or CODEPIPER_* env vars)."
    );
  }

  return { socketPath, sessionId, secret };
}

interface ForwardHookResult {
  exitCode: number;
  output?: string;
}

/**
 * Forward hook event to daemon
 */
export async function forwardHook(
  input?: string,
  options?: {
    socketPath?: string;
    sessionId?: string;
    secret?: string;
  }
): Promise<ForwardHookResult> {
  // Validate/resolve environment from options + process env.
  const { socketPath, sessionId, secret } = resolveEnvironment(options);

  // Read hook event from stdin or use provided input
  const eventInput = input ?? (await readStdin());

  if (!eventInput || eventInput.trim() === "") {
    throw new Error("No input received from stdin");
  }

  // Parse JSON
  let hookEvent: HookEvent;
  try {
    hookEvent = JSON.parse(eventInput);
  } catch (error: any) {
    throw new Error(`Invalid JSON input: ${error.message}`);
  }

  // Build request payload in format expected by daemon
  // Daemon expects: { sessionId, event, data }
  // Claude Code sends either 'event' (legacy) or 'hook_event_name' (new format)
  const eventName = hookEvent.event || hookEvent.hook_event_name;

  if (!eventName) {
    throw new Error("Missing required field: event or hook_event_name");
  }

  const payload = {
    sessionId,
    event: eventName,
    data: hookEvent,
  };

  // Send to daemon
  let response: Response;
  try {
    response = await fetch("http://localhost/hooks/claude", {
      unix: socketPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CodePiper-Secret": secret,
      },
      body: JSON.stringify(payload),
    });
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${socketPath}. Is the daemon running?`);
    }
    throw error;
  }

  // Handle response
  if (!response.ok) {
    const errorData = await readErrorJson(response);
    throw new Error(responseErrorMessage(response, errorData));
  }

  // Parse response
  const responseData = await readJson<PermissionResponse>(response);

  // Handle PermissionRequest response
  const isPermissionRequest = eventName === "PermissionRequest";
  if (isPermissionRequest) {
    const decision = responseData as PermissionResponse;

    // Normalize decision across daemon versions.
    const normalizedDecision =
      decision.decision ??
      (decision.allow === false ? "deny" : decision.allow === true ? "allow" : "ask");

    // For "ask", emit no output and let Claude Code show interactive prompt.
    if (normalizedDecision === "ask") {
      return { exitCode: 0 };
    }

    const outputPayload: ClaudePermissionDecision = {
      decision: normalizedDecision,
    };

    if (decision.updatedInput !== undefined) {
      outputPayload.updatedInput = decision.updatedInput;
    }
    if (decision.updatedPermissions !== undefined) {
      outputPayload.updatedPermissions = decision.updatedPermissions;
    }
    if (normalizedDecision === "deny") {
      const denialMessage = decision.denialMessage ?? decision.message;
      if (typeof denialMessage === "string") {
        outputPayload.denialMessage = denialMessage;
      }
    }

    // Output decision JSON to stdout for Claude Code to read
    const output = JSON.stringify(outputPayload);

    // Exit with appropriate code
    const exitCode = normalizedDecision === "deny" ? 2 : 0;

    return { exitCode, output };
  }

  // For other events, exit successfully without output
  // (Per CLAUDE.md: hook stdout can inject context, so we output nothing)
  return { exitCode: 0 };
}

/**
 * Run hook-forward command
 */
export async function runHookForwardCommand(): Promise<void> {
  const result = await forwardHook();

  // Output to stdout if needed (PermissionRequest)
  if (result.output) {
    console.log(result.output);
  }

  // Exit with appropriate code
  process.exit(result.exitCode);
}
