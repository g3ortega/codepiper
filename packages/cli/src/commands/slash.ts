import { readErrorJson, responseErrorMessage } from "../lib/api";
import { getRequiredValue } from "../lib/args";

export interface SlashOptions {
  sessionId: string;
  command: string;
  args?: string[];
  socket: string;
}

export function parseSlashOptions(args: string[]): SlashOptions {
  let sessionId: string | undefined;
  let command: string | undefined;
  let socket = "/tmp/codepiper.sock";
  const commandArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    } else if (!arg.startsWith("-")) {
      if (!sessionId) {
        sessionId = arg;
      } else if (!command) {
        command = arg;
      } else {
        commandArgs.push(arg);
      }
    }
  }

  if (!sessionId) {
    throw new Error("session-id is required");
  }

  if (!command) {
    throw new Error("command is required");
  }

  const options: SlashOptions = {
    sessionId,
    command,
    socket,
  };
  if (commandArgs.length > 0) {
    options.args = commandArgs;
  }

  return options;
}

export async function sendSlashCommand(options: SlashOptions): Promise<void> {
  const payload = {
    command: options.command,
    args: options.args,
  };

  try {
    const response = await fetch(`http://localhost/sessions/${options.sessionId}/slash`, {
      unix: options.socket,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

export async function runSlashCommand(args: string[]): Promise<void> {
  const options = parseSlashOptions(args);

  await sendSlashCommand(options);

  const argsStr = options.args ? ` ${options.args.join(" ")}` : "";
  console.log(`Slash command sent to session ${options.sessionId}: /${options.command}${argsStr}`);
}
