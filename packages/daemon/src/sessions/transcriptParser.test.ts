import { describe, expect, test } from "bun:test";
import { detectEventType, extractContent, parseTranscriptLine } from "./transcriptParser";

describe("parseTranscriptLine", () => {
  test("should parse valid user message", () => {
    const line = JSON.stringify({
      role: "user",
      content: "Hello, Claude!",
      timestamp: "2024-01-15T10:00:00Z",
    });

    const result = parseTranscriptLine(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("message");
    expect(result?.role).toBe("user");
    expect(result?.content).toBe("Hello, Claude!");
    expect(result?.timestamp).toBe("2024-01-15T10:00:00Z");
    expect(result?.raw).toBe(line);
  });

  test("should parse valid assistant message", () => {
    const line = JSON.stringify({
      role: "assistant",
      content: "How can I help you?",
      timestamp: "2024-01-15T10:00:01Z",
    });

    const result = parseTranscriptLine(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("message");
    expect(result?.role).toBe("assistant");
    expect(result?.content).toBe("How can I help you?");
  });

  test("should parse system message", () => {
    const line = JSON.stringify({
      role: "system",
      content: "Session started",
    });

    const result = parseTranscriptLine(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("system");
    expect(result?.role).toBe("system");
  });

  test("should parse tool_use event", () => {
    const line = JSON.stringify({
      type: "tool_use",
      name: "read_file",
      input: { path: "/path/to/file.ts" },
      id: "tool-123",
    });

    const result = parseTranscriptLine(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("tool_use");
    expect(result?.toolName).toBe("read_file");
    expect(result?.toolInput).toEqual({ path: "/path/to/file.ts" });
  });

  test("should parse tool_result event", () => {
    const line = JSON.stringify({
      type: "tool_result",
      tool_use_id: "tool-123",
      content: "File contents here",
    });

    const result = parseTranscriptLine(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("tool_result");
    expect(result?.toolResult).toBe("File contents here");
  });

  test("should handle invalid JSON gracefully", () => {
    const result = parseTranscriptLine("{ invalid json }");
    expect(result).toBeNull();
  });

  test("should handle empty string", () => {
    const result = parseTranscriptLine("");
    expect(result).toBeNull();
  });

  test("should handle whitespace-only string", () => {
    const result = parseTranscriptLine("   \n  ");
    expect(result).toBeNull();
  });

  test("should preserve all fields in metadata", () => {
    const line = JSON.stringify({
      role: "user",
      content: "Test",
      custom_field_1: "value1",
      custom_field_2: { nested: "value2" },
      timestamp: "2024-01-15T10:00:00Z",
    });

    const result = parseTranscriptLine(line);

    expect(result?.metadata).toEqual({
      role: "user",
      content: "Test",
      custom_field_1: "value1",
      custom_field_2: { nested: "value2" },
      timestamp: "2024-01-15T10:00:00Z",
    });
  });

  test("should handle message with empty content", () => {
    const line = JSON.stringify({
      role: "assistant",
      content: "",
    });

    const result = parseTranscriptLine(line);

    expect(result).not.toBeNull();
    expect(result?.content).toBe("");
  });

  test("should handle message with array content", () => {
    const line = JSON.stringify({
      role: "assistant",
      content: [
        { type: "text", text: "Here's the file:" },
        { type: "tool_use", name: "read_file" },
      ],
    });

    const result = parseTranscriptLine(line);

    expect(result).not.toBeNull();
    expect(result?.metadata.content).toEqual([
      { type: "text", text: "Here's the file:" },
      { type: "tool_use", name: "read_file" },
    ]);
  });

  test("should handle very long content", () => {
    const longContent = "x".repeat(100000);
    const line = JSON.stringify({
      role: "user",
      content: longContent,
    });

    const result = parseTranscriptLine(line);

    expect(result).not.toBeNull();
    expect(result?.content).toBe(longContent);
  });

  test("should handle special characters", () => {
    const line = JSON.stringify({
      role: "user",
      content: 'Special chars: \n\t"quotes" \\backslash\\ 😀',
    });

    const result = parseTranscriptLine(line);

    expect(result).not.toBeNull();
    expect(result?.content).toBe('Special chars: \n\t"quotes" \\backslash\\ 😀');
  });

  test("should handle unicode characters", () => {
    const line = JSON.stringify({
      role: "user",
      content: "Hello 世界 🌍 café",
    });

    const result = parseTranscriptLine(line);

    expect(result).not.toBeNull();
    expect(result?.content).toBe("Hello 世界 🌍 café");
  });

  test("should classify unknown event types", () => {
    const line = JSON.stringify({
      unknown_field: "value",
      other_field: 123,
    });

    const result = parseTranscriptLine(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("unknown");
  });

  test("should handle null values in fields", () => {
    const line = JSON.stringify({
      role: "user",
      content: null,
      timestamp: null,
    });

    const result = parseTranscriptLine(line);

    expect(result).not.toBeNull();
    expect(result?.content).toBeUndefined();
  });
});

describe("extractContent", () => {
  test("should extract string content", () => {
    const event = { content: "Hello, world!" };
    expect(extractContent(event)).toBe("Hello, world!");
  });

  test("should extract text from array content", () => {
    const event = {
      content: [
        { type: "text", text: "First part" },
        { type: "text", text: "Second part" },
      ],
    };
    expect(extractContent(event)).toBe("First part\nSecond part");
  });

  test("should extract text from mixed array content", () => {
    const event = {
      content: [
        { type: "text", text: "Text part" },
        { type: "tool_use", name: "read_file" },
        { type: "text", text: "More text" },
      ],
    };
    expect(extractContent(event)).toBe("Text part\nMore text");
  });

  test("should return null for missing content", () => {
    const event = { role: "user" };
    expect(extractContent(event)).toBeNull();
  });

  test("should return null for null content", () => {
    const event = { content: null };
    expect(extractContent(event)).toBeNull();
  });

  test("should return null for empty array content", () => {
    const event = { content: [] };
    expect(extractContent(event)).toBeNull();
  });

  test("should handle content with no text items", () => {
    const event = {
      content: [{ type: "tool_use", name: "read_file" }],
    };
    expect(extractContent(event)).toBeNull();
  });

  test("should extract tool_result content", () => {
    const event = {
      type: "tool_result",
      content: "Result data",
    };
    expect(extractContent(event)).toBe("Result data");
  });

  test("should handle empty string content", () => {
    const event = { content: "" };
    expect(extractContent(event)).toBe("");
  });
});

describe("detectEventType", () => {
  test("should detect message with role", () => {
    expect(detectEventType({ role: "user" })).toBe("message");
    expect(detectEventType({ role: "assistant" })).toBe("message");
  });

  test("should detect system message", () => {
    expect(detectEventType({ role: "system" })).toBe("system");
  });

  test("should detect tool_use by type field", () => {
    expect(detectEventType({ type: "tool_use" })).toBe("tool_use");
  });

  test("should detect tool_use by name field", () => {
    expect(detectEventType({ name: "read_file", input: {} })).toBe("tool_use");
  });

  test("should detect tool_result by type field", () => {
    expect(detectEventType({ type: "tool_result" })).toBe("tool_result");
  });

  test("should detect tool_result by tool_use_id field", () => {
    expect(detectEventType({ tool_use_id: "123" })).toBe("tool_result");
  });

  test("should return unknown for unrecognized events", () => {
    expect(detectEventType({ some_field: "value" })).toBe("unknown");
  });

  test("should return unknown for empty object", () => {
    expect(detectEventType({})).toBe("unknown");
  });
});
