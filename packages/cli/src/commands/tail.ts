import { getRequiredValue } from "../lib/args";

export interface TailOptions {
  sessionId: string;
  follow: boolean;
  lines: number;
}

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
};

export function parseTailOptions(args: string[]): TailOptions {
  let sessionId: string | undefined;
  let follow = false;
  let lines = 50; // Default to last 50 lines

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--follow" || arg === "-f") {
      follow = true;
    } else if (arg === "--lines" || arg === "-n") {
      const linesValue = getRequiredValue(args, i, arg);
      lines = Number.parseInt(linesValue, 10);
      i++;
    } else if (!(arg.startsWith("-") || sessionId)) {
      sessionId = arg;
    }
  }

  if (!sessionId) {
    throw new Error("session-id is required");
  }

  return { sessionId, follow, lines };
}

async function getOutputLogPath(sessionId: string): Promise<string> {
  return `${process.env.HOME}/.codepiper/sessions/${sessionId}/output.log`;
}

async function tailFile(path: string, lines: number): Promise<void> {
  const fs = require("node:fs");

  try {
    const content = await fs.promises.readFile(path, "utf-8");
    const allLines = content.split("\n");
    const lastLines = allLines.slice(-lines);

    process.stdout.write(lastLines.join("\n"));

    if (!lastLines[lastLines.length - 1]?.endsWith("\n")) {
      process.stdout.write("\n");
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      console.error(`${colors.dim}No output log found at: ${path}${colors.reset}`);
    } else {
      throw err;
    }
  }
}

async function followFile(path: string): Promise<void> {
  const fs = require("node:fs");

  let lastSize = 0;

  try {
    const stats = await fs.promises.stat(path);
    lastSize = stats.size;

    // Display initial content
    const content = await fs.promises.readFile(path, "utf-8");
    process.stdout.write(content);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      console.log(`${colors.dim}Waiting for output log...${colors.reset}`);
    }
  }

  // Poll for new content
  const interval = setInterval(async () => {
    try {
      const stats = await fs.promises.stat(path);
      if (stats.size > lastSize) {
        const stream = fs.createReadStream(path, {
          start: lastSize,
          end: stats.size,
          encoding: "utf-8",
        });

        for await (const chunk of stream) {
          process.stdout.write(chunk);
        }

        lastSize = stats.size;
      }
    } catch {
      // File might not exist yet, keep polling
    }
  }, 100);

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    clearInterval(interval);
    console.log(`\n${colors.dim}Stopped following output${colors.reset}`);
    process.exit(0);
  });
}

export async function runTailCommand(args: string[]): Promise<void> {
  const options = parseTailOptions(args);
  const logPath = await getOutputLogPath(options.sessionId);

  const shortId = options.sessionId.slice(0, 8);

  if (options.follow) {
    console.log(
      `${colors.dim}Following output for session ${colors.cyan}${shortId}...${colors.reset}`
    );
    console.log(`${colors.dim}Press Ctrl+C to stop${colors.reset}\n`);
    await followFile(logPath);
  } else {
    console.log(
      `${colors.dim}Last ${options.lines} lines for session ${colors.cyan}${shortId}...${colors.reset}\n`
    );
    await tailFile(logPath, options.lines);
  }
}
