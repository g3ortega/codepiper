import { readErrorJson, readJson, responseErrorMessage } from "../lib/api";
import { getRequiredValue } from "../lib/args";

export interface LogsOptions {
  sessionId: string;
  socket: string;
  follow?: boolean;
  tail: number;
  since?: string;
  format: "pretty" | "json" | "text";
  source?: string; // Filter by source: hook, transcript, pty, statusline
  type?: string; // Filter by event type
  showMessages?: boolean; // Extract and show only assistant/user messages
}

interface Event {
  id: number;
  sessionId: string;
  timestamp: string; // ISO 8601 timestamp from database
  source: string;
  type: string;
  payload: any;
}

const VALID_FORMATS = ["pretty", "json", "text"];

export function parseLogsOptions(args: string[]): LogsOptions {
  let sessionId: string | undefined;
  let socket = "/tmp/codepiper.sock";
  let follow = false;
  let tail = 100;
  let since: string | undefined;
  let format: "pretty" | "json" | "text" = "pretty";
  let source: string | undefined;
  let type: string | undefined;
  let showMessages = false;

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
    } else if (arg === "--tail" || arg === "-n") {
      const tailValue = getRequiredValue(args, i, arg);
      tail = parseInt(tailValue, 10);
      i++;
    } else if (arg === "--since") {
      since = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--format") {
      const formatValue = getRequiredValue(args, i, arg);
      i++;
      if (!VALID_FORMATS.includes(formatValue)) {
        throw new Error(
          `Invalid format: ${formatValue}. Valid options: ${VALID_FORMATS.join(", ")}`
        );
      }
      format = formatValue as "pretty" | "json" | "text";
    } else if (arg === "--source") {
      source = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--type") {
      type = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--messages" || arg === "-m") {
      showMessages = true;
    } else if (!(arg.startsWith("-") || sessionId)) {
      sessionId = arg;
    }
  }

  if (!sessionId) {
    throw new Error("session-id is required");
  }

  const options: LogsOptions = {
    sessionId,
    socket,
    follow,
    tail,
    format,
    showMessages,
  };
  if (since !== undefined) {
    options.since = since;
  }
  if (source !== undefined) {
    options.source = source;
  }
  if (type !== undefined) {
    options.type = type;
  }

  return options;
}

export async function fetchLogs(options: LogsOptions): Promise<Event[]> {
  const params = new URLSearchParams();
  if (options.since) {
    params.append("since", options.since);
  }
  if (options.tail) {
    params.append("limit", options.tail.toString());
  }
  if (options.source) {
    params.append("source", options.source);
  }
  if (options.type) {
    params.append("type", options.type);
  }

  const queryString = params.toString();
  const url = `http://localhost/sessions/${options.sessionId}/events${queryString ? `?${queryString}` : ""}`;

  try {
    const response = await fetch(url, {
      unix: options.socket,
      method: "GET",
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }

    const data = await readJson<{ events?: Event[] }>(response);
    return data.events || [];
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

/**
 * Extract assistant/user messages from transcript events
 */
function extractMessages(
  events: Event[]
): Array<{ role: string; content: string; timestamp: string }> {
  const messages: Array<{ role: string; content: string; timestamp: string }> = [];

  for (const event of events) {
    if (event.source !== "transcript") continue;

    // User messages
    if (event.type === "user" && event.payload?.message?.content) {
      messages.push({
        role: "user",
        content: event.payload.message.content,
        timestamp: event.timestamp,
      });
    }

    // Assistant messages
    if (event.type === "assistant" && event.payload?.message?.content) {
      const content = event.payload.message.content;
      let text = "";

      if (Array.isArray(content)) {
        // Extract text from content array (skip thinking blocks)
        for (const block of content) {
          if (block.type === "text") {
            text += block.text;
          }
        }
      } else if (typeof content === "string") {
        text = content;
      }

      if (text.trim()) {
        messages.push({
          role: "assistant",
          content: text,
          timestamp: event.timestamp,
        });
      }
    }
  }

  return messages;
}

/**
 * Format events as conversation text (user/assistant exchanges only)
 */
function formatText(events: Event[]): void {
  const messages = extractMessages(events);

  if (messages.length === 0) {
    console.log("No messages found.");
    return;
  }

  for (const msg of messages) {
    const timestamp = new Date(msg.timestamp).toLocaleString();
    const role = msg.role === "user" ? "User" : "Assistant";
    console.log(`\n[${timestamp}] ${role}:`);
    console.log(msg.content);
    console.log("─".repeat(80));
  }

  console.log(`\nTotal: ${messages.length} message(s)`);
}

/**
 * Format events as pretty console output
 */
function formatPretty(events: Event[], showMessages = false): void {
  if (events.length === 0) {
    console.log("No events found.");
    return;
  }

  // If --messages flag is set, show conversation flow
  if (showMessages) {
    formatText(events);
    return;
  }

  for (const event of events) {
    const timestamp = new Date(event.timestamp).toLocaleString();
    const source = event.source.padEnd(10);
    const type = event.type.padEnd(20);

    console.log(`${timestamp} [${source}] ${type}`);

    // For assistant messages, extract and show just the text
    if (event.type === "assistant" && event.payload?.message?.content) {
      const content = event.payload.message.content;
      let text = "";

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            text += block.text;
          }
        }
      } else if (typeof content === "string") {
        text = content;
      }

      if (text.trim()) {
        // Truncate if too long
        const preview = text.length > 200 ? `${text.substring(0, 200)}...` : text;
        console.log(`  📝 ${preview}`);
      }
    }
    // For user messages, show the content
    else if (event.type === "user" && event.payload?.message?.content) {
      console.log(`  👤 ${event.payload.message.content}`);
    }
    // For hook events, show key fields
    else if (event.source === "hook") {
      const hookEvent = event.payload.hook_event_name || event.payload.event;
      if (hookEvent) {
        console.log(`  🪝 Event: ${hookEvent}`);
      }
    }
    // For other events, show compact payload
    else {
      const payloadStr = JSON.stringify(event.payload);
      if (payloadStr.length < 100 && payloadStr !== "{}") {
        console.log(`  ${payloadStr}`);
      } else if (payloadStr !== "{}") {
        console.log(`  ${JSON.stringify(event.payload, null, 2)}`);
      }
    }

    console.log(); // blank line between events
  }

  console.log(`Total: ${events.length} event(s)`);
}

export async function runLogsCommand(args: string[]): Promise<void> {
  const options = parseLogsOptions(args);

  if (options.follow) {
    console.log(`Following logs for session ${options.sessionId}...`);
    console.log("Press Ctrl+C to stop.\n");

    await followLogs(options);
    return;
  }

  const events = await fetchLogs(options);

  if (options.format === "json") {
    console.log(JSON.stringify(events, null, 2));
  } else if (options.format === "text") {
    formatText(events);
  } else {
    formatPretty(events, options.showMessages);
  }
}

/**
 * Follow logs in near real-time by polling the daemon over Unix socket.
 * This avoids hardcoded WS ports and works regardless of daemon auth mode.
 */
async function followLogs(options: LogsOptions): Promise<void> {
  let stopping = false;
  let since = options.since;
  const pollLimit = Math.max(options.tail, 200);

  const sigintHandler = () => {
    if (!stopping) {
      stopping = true;
      console.log("\nStopping...");
    }
  };

  process.on("SIGINT", sigintHandler);

  try {
    while (!stopping) {
      const pollOptions: LogsOptions = {
        ...options,
        tail: pollLimit,
      };
      if (since !== undefined) {
        pollOptions.since = since;
      }
      const events = await fetchLogs(pollOptions);

      for (const event of events) {
        formatSingleEvent(event, options);
        if (typeof event.id === "number") {
          since = String(event.id);
        }
      }

      if (stopping) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    process.off("SIGINT", sigintHandler);
  }
}

/**
 * Format and print a single event (for follow mode)
 */
function formatSingleEvent(event: Event, options: LogsOptions): void {
  if (options.format === "json") {
    console.log(JSON.stringify(event, null, 2));
    return;
  }

  if (options.format === "text") {
    const messages = extractMessages([event]);
    if (messages.length > 0) {
      const msg = messages[0];
      if (!msg) {
        return;
      }
      const timestamp = new Date(msg.timestamp).toLocaleString();
      const role = msg.role === "user" ? "User" : "Assistant";
      console.log(`\n[${timestamp}] ${role}:`);
      console.log(msg.content);
      console.log("─".repeat(80));
    }
    return;
  }

  // Pretty format (default)
  const timestamp = new Date(event.timestamp).toLocaleString();
  const source = event.source.padEnd(10);
  const type = event.type.padEnd(20);

  console.log(`${timestamp} [${source}] ${type}`);

  // Show event details (same as formatPretty logic)
  if (event.type === "assistant" && event.payload?.message?.content) {
    const content = event.payload.message.content;
    let text = "";

    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text") {
          text += block.text;
        }
      }
    } else if (typeof content === "string") {
      text = content;
    }

    if (text.trim()) {
      const preview = text.length > 200 ? `${text.substring(0, 200)}...` : text;
      console.log(`  📝 ${preview}`);
    }
  } else if (event.type === "user" && event.payload?.message?.content) {
    console.log(`  👤 ${event.payload.message.content}`);
  } else if (event.source === "hook") {
    const hookEvent = event.payload.hook_event_name || event.payload.event;
    if (hookEvent) {
      console.log(`  🪝 Event: ${hookEvent}`);
    }
  } else {
    const payloadStr = JSON.stringify(event.payload);
    if (payloadStr.length < 100 && payloadStr !== "{}") {
      console.log(`  ${payloadStr}`);
    } else if (payloadStr !== "{}") {
      console.log(`  ${JSON.stringify(event.payload, null, 2)}`);
    }
  }

  console.log(); // blank line
}
