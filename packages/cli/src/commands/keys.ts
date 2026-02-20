import { readErrorJson, responseErrorMessage } from "../lib/api";
import { getRequiredValue } from "../lib/args";

export interface KeysOptions {
  sessionId: string;
  keys: string[];
  socket: string;
}

export function parseKeysOptions(args: string[]): KeysOptions {
  let sessionId: string | undefined;
  let socket = "/tmp/codepiper.sock";
  const keys: string[] = [];

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
      } else {
        keys.push(arg);
      }
    }
  }

  if (!sessionId) {
    throw new Error("session-id is required");
  }

  if (keys.length === 0) {
    throw new Error("at least one key is required");
  }

  return { sessionId, keys, socket };
}

export async function sendKeys(options: KeysOptions): Promise<void> {
  const payload = {
    keys: options.keys,
  };

  try {
    const response = await fetch(`http://localhost/sessions/${options.sessionId}/keys`, {
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

export async function runKeysCommand(args: string[]): Promise<void> {
  const options = parseKeysOptions(args);

  await sendKeys(options);

  console.log(`Keys sent to session ${options.sessionId}: ${options.keys.join(", ")}`);
}
