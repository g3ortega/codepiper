/**
 * Transcript event parser and normalizer
 *
 * Parses JSONL transcript events from Claude Code and normalizes them to a common format
 * for storage and streaming.
 */

export interface NormalizedEvent {
  type: "message" | "tool_use" | "tool_result" | "system" | "unknown";
  role?: "user" | "assistant" | "system";
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolResult?: any;
  timestamp?: string;
  metadata: Record<string, any>; // Preserve all fields
  raw: string; // Original JSON line
}

/**
 * Parse a single JSONL line from a Claude Code transcript
 *
 * @param line - Raw JSONL line
 * @returns Normalized event or null if parsing fails
 */
export function parseTranscriptLine(line: string): NormalizedEvent | null {
  // Handle empty or whitespace-only lines
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  // Parse JSON safely
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  // Detect event type
  const type = detectEventType(parsed);

  // Extract role (if present)
  const role = parsed.role as "user" | "assistant" | "system" | undefined;

  // Extract content
  const content = extractContent(parsed);

  // Extract tool-specific fields
  let toolName: string | undefined;
  let toolInput: any;
  let toolResult: any;

  if (type === "tool_use") {
    toolName = parsed.name;
    toolInput = parsed.input;
  } else if (type === "tool_result") {
    toolResult = content !== null ? content : parsed.content;
  }

  // Extract timestamp
  const timestamp = parsed.timestamp;

  // Build normalized event
  return {
    type,
    role,
    content: content !== null ? content : undefined,
    toolName,
    toolInput,
    toolResult,
    timestamp,
    metadata: parsed, // Preserve all original fields
    raw: trimmed,
  };
}

/**
 * Extract text content from an event
 *
 * Handles both string content and array content (with text blocks)
 *
 * @param event - Parsed event object
 * @returns Extracted text content or null
 */
export function extractContent(event: any): string | null {
  if (event.content === undefined || event.content === null) {
    return null;
  }

  // Handle string content (including empty strings)
  if (typeof event.content === "string") {
    return event.content;
  }

  // Handle array content (extract text blocks)
  if (Array.isArray(event.content)) {
    const textBlocks = event.content
      .filter((item: any) => item.type === "text" && item.text)
      .map((item: any) => item.text);

    if (textBlocks.length === 0) {
      return null;
    }

    return textBlocks.join("\n");
  }

  return null;
}

/**
 * Detect the type of event based on its structure
 *
 * @param event - Parsed event object
 * @returns Detected event type
 */
export function detectEventType(event: any): NormalizedEvent["type"] {
  // Check explicit type field first
  if (event.type === "tool_use") {
    return "tool_use";
  }
  if (event.type === "tool_result") {
    return "tool_result";
  }

  // Check for system role
  if (event.role === "system") {
    return "system";
  }

  // Check for message roles
  if (event.role === "user" || event.role === "assistant") {
    return "message";
  }

  // Infer tool_use from structure
  if (event.name && event.input !== undefined) {
    return "tool_use";
  }

  // Infer tool_result from structure
  if (event.tool_use_id) {
    return "tool_result";
  }

  return "unknown";
}
