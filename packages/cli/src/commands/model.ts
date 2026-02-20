/**
 * Model command - switch model for an active session or get current model
 */

import { readJson } from "../lib/api";
import { getRequiredValue } from "../lib/args";

/**
 * Available Claude models
 */
const AVAILABLE_MODELS = [
  "sonnet",
  "opus",
  "haiku",
  "opusplan",
  "claude-sonnet-4-5",
  "claude-opus-4-6",
  "claude-haiku-4-5",
] as const;

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): {
  sessionId?: string;
  model?: string;
  socketPath: string;
  action: "get" | "set";
} {
  const result: {
    sessionId?: string;
    model?: string;
    socketPath: string;
    action: "get" | "set";
  } = {
    socketPath:
      process.env.CODEPIPER_SOCKET || process.env.CODEPIPER_UNIX_SOCK || "/tmp/codepiper.sock",
    action: "get",
  };

  let i = 0;

  // First positional arg: session ID
  const sessionIdArg = args[i];
  if (sessionIdArg !== undefined && !sessionIdArg.startsWith("-")) {
    result.sessionId = sessionIdArg;
    i++;
  }

  // Second positional arg (if present): model name
  const modelArg = args[i];
  if (modelArg !== undefined && !modelArg.startsWith("-")) {
    result.model = modelArg;
    result.action = "set";
    i++;
  }

  // Parse flags
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) {
      i++;
      continue;
    }

    if (arg === "-s" || arg === "--socket") {
      result.socketPath = getRequiredValue(args, i, arg);
      i += 2;
    } else {
      i++;
    }
  }

  return result;
}

/**
 * Model command entry point
 */
export async function runModelCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (!parsed.sessionId) {
    console.error("Error: Missing required argument: <session-id>");
    console.error("\nUsage: codepiper model <session-id> [model]");
    console.error(`\nAvailable models: ${AVAILABLE_MODELS.join(", ")}`);
    console.error("\nExamples:");
    console.error("  codepiper model abc123def                  # Get current model");
    console.error("  codepiper model abc123def sonnet           # Switch to sonnet");
    console.error("  codepiper model abc123def claude-opus-4-6  # Switch to opus");
    process.exit(1);
  }

  if (parsed.action === "get") {
    await getModel(parsed.sessionId, parsed.socketPath);
  } else {
    if (!parsed.model) {
      console.error("Error: Missing required argument: <model>");
      console.error(`\nAvailable models: ${AVAILABLE_MODELS.join(", ")}`);
      process.exit(1);
    }

    // Keep guidance for Claude defaults while allowing provider-specific model IDs.
    if (!AVAILABLE_MODELS.includes(parsed.model as any)) {
      console.warn(
        `Warning: '${parsed.model}' is not in the default Claude model list; sending as-is.`
      );
    }

    await switchModel(parsed.sessionId, parsed.model, parsed.socketPath);
  }
}

/**
 * Get current model for a session
 */
async function getModel(sessionId: string, socketPath: string): Promise<void> {
  try {
    const response = await fetch(`http://localhost/sessions/${sessionId}/model`, {
      method: "GET",
      unix: socketPath,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to get model: ${error}`);
      process.exit(1);
    }

    const data = await readJson<{
      model?: string;
      provider?: string;
      supportsModelSwitch?: boolean;
    }>(response);
    console.log(`Current model: ${data.model || "unknown"}`);
    if (data.supportsModelSwitch === false) {
      console.log(
        `Model switching is not supported for provider ${data.provider ?? "unknown"} in this session.`
      );
    }
  } catch (error: any) {
    console.error(`Error getting model: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Switch model for a session
 */
async function switchModel(sessionId: string, model: string, socketPath: string): Promise<void> {
  try {
    const response = await fetch(`http://localhost/sessions/${sessionId}/model`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model }),
      unix: socketPath,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to switch model: ${error}`);
      process.exit(1);
    }

    console.log(`✓ Switched model to ${model} for session ${sessionId}`);
  } catch (error: any) {
    console.error(`Error switching model: ${error.message}`);
    process.exit(1);
  }
}
