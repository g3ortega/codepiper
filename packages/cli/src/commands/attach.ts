import * as os from "node:os";
import { readErrorJson, readJson, responseErrorMessage } from "../lib/api";
import { getRequiredValue } from "../lib/args";

export interface AttachOptions {
  sessionId: string;
  socket: string;
  follow: boolean;
}

export function parseAttachOptions(args: string[]): AttachOptions {
  let sessionId: string | undefined;
  let socket = "/tmp/codepiper.sock";
  let follow = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--follow" || arg === "-f") {
      follow = true;
    } else if (!(arg.startsWith("-") || sessionId)) {
      sessionId = arg;
    }
  }

  if (!sessionId) {
    throw new Error("session-id is required");
  }

  return { sessionId, socket, follow };
}

interface TerminalState {
  originalRawMode: boolean;
  originalIsTTY: boolean;
}

class SessionOutputUnavailableError extends Error {}

function getHomeDir(): string {
  return process.env.HOME || os.homedir();
}

export async function verifySessionExists(sessionId: string, socket: string): Promise<void> {
  try {
    const response = await fetch(`http://localhost/sessions/${sessionId}`, {
      unix: socket,
      method: "GET",
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${socket}. Is the daemon running?`);
    }
    throw error;
  }
}

async function displayHistoricalOutput(sessionId: string): Promise<void> {
  // Try to read historical output from log file
  const outputLogPath = `${getHomeDir()}/.codepiper/sessions/${sessionId}/output.log`;

  try {
    const fs = require("node:fs");
    const content = await fs.promises.readFile(outputLogPath, "utf-8");
    if (content) {
      process.stdout.write(content);
    }
  } catch (_err) {
    // Log file doesn't exist yet, or is empty - that's okay
  }
}

async function setupTerminal(follow: boolean): Promise<TerminalState> {
  const originalRawMode = process.stdin.isRaw ?? false;
  const originalIsTTY = process.stdin.isTTY ?? false;

  if (!follow && originalIsTTY) {
    // Interactive mode: enable raw mode for direct key forwarding
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  return {
    originalRawMode,
    originalIsTTY,
  };
}

async function restoreTerminal(state: TerminalState): Promise<void> {
  if (process.stdin.setRawMode && state.originalIsTTY) {
    process.stdin.setRawMode(state.originalRawMode);
  }
  if (!state.originalRawMode) {
    process.stdin.pause();
  }
}

export async function fetchSessionOutput(sessionId: string, socket: string): Promise<string> {
  try {
    const response = await fetch(`http://localhost/sessions/${sessionId}/output`, {
      unix: socket,
      method: "GET",
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      const message = responseErrorMessage(response, errorData);
      if (response.status === 404 || response.status === 409) {
        throw new SessionOutputUnavailableError(message);
      }
      throw new Error(message);
    }

    const data = await readJson<{ output?: string }>(response);
    return typeof data.output === "string" ? data.output : "";
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${socket}. Is the daemon running?`);
    }
    throw error;
  }
}

export function writeOutputDelta(previous: string, current: string): void {
  if (current.length === 0 || current === previous) {
    return;
  }

  if (!previous) {
    process.stdout.write(current);
    return;
  }

  // Fast path for append-only changes.
  if (current.startsWith(previous)) {
    process.stdout.write(current.slice(previous.length));
    return;
  }

  // Fallback: emit changed suffix from common prefix.
  const max = Math.min(previous.length, current.length);
  let idx = 0;
  while (idx < max && previous[idx] === current[idx]) {
    idx++;
  }
  process.stdout.write(current.slice(idx));
}

async function connectAndStream(sessionId: string, socket: string, follow: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let isClosing = false;
    let polling = false;
    let lastOutput = "";
    let pollTimer: Timer | undefined;

    const stop = (finish: "resolve" | "reject", error?: unknown) => {
      if (isClosing) {
        return;
      }
      isClosing = true;

      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      process.off("SIGINT", sigintHandler);

      if (!follow) {
        process.stdin.off("data", stdinHandler);
      }

      if (finish === "resolve") {
        resolve();
      } else {
        reject(error);
      }
    };

    const pollOutput = async () => {
      if (isClosing || polling) {
        return;
      }
      polling = true;

      try {
        const output = await fetchSessionOutput(sessionId, socket);
        if (!isClosing) {
          writeOutputDelta(lastOutput, output);
          lastOutput = output;
        }
      } catch (error) {
        if (!isClosing) {
          if (error instanceof SessionOutputUnavailableError) {
            stop("resolve");
            return;
          }
          stop("reject", error);
        }
      } finally {
        polling = false;
      }
    };

    // Handle stdin in interactive mode
    const stdinHandler = async (chunk: Buffer) => {
      const text = chunk.toString();

      // Check for Ctrl+C (0x03)
      if (text === "\x03") {
        stop("resolve");
        return;
      }

      // Echo input locally in raw mode (so user can see what they're typing)
      // Output polling will also reflect terminal state.
      process.stdout.write(text);

      // Send input to session
      try {
        await fetch(`http://localhost/sessions/${sessionId}/send`, {
          unix: socket,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            newline: false,
          }),
        });
      } catch (err) {
        if (!isClosing) {
          stop("reject", err);
        }
      }
    };

    if (!follow) {
      process.stdin.on("data", stdinHandler);
    }

    // Handle SIGINT (Ctrl+C from terminal, not from stdin in raw mode)
    const sigintHandler = () => {
      if (!isClosing) {
        stop("resolve");
      }
    };

    process.on("SIGINT", sigintHandler);

    pollTimer = setInterval(() => {
      void pollOutput();
    }, 100);
    void pollOutput();
  });
}

export async function attachToSession(options: AttachOptions): Promise<void> {
  // 1. Verify session exists
  await verifySessionExists(options.sessionId, options.socket);

  console.log(`Attaching to session ${options.sessionId}...`);
  console.log(`Mode: ${options.follow ? "follow (read-only)" : "interactive"}`);
  console.log(`Press Ctrl+C to detach.\n`);

  // 2. Setup terminal
  const terminalState = await setupTerminal(options.follow);

  try {
    // 3. Display historical output first
    await displayHistoricalOutput(options.sessionId);

    // 4. Connect and stream new output
    await connectAndStream(options.sessionId, options.socket, options.follow);
  } finally {
    // 5. Always restore terminal state
    await restoreTerminal(terminalState);
    console.log("\nDetached.");
  }
}

export async function runAttachCommand(args: string[]): Promise<void> {
  const options = parseAttachOptions(args);
  await attachToSession(options);
}
