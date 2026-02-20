import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchLogs, parseLogsOptions, runLogsCommand } from "./logs";

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

describe("logs command", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.log = originalConsoleLog;
  });
  describe("parseLogsOptions", () => {
    test("parses session ID", () => {
      const args = ["session-123"];
      const options = parseLogsOptions(args);

      expect(options.sessionId).toBe("session-123");
      expect(options.socket).toBe("/tmp/codepiper.sock");
    });

    test("requires session ID", () => {
      const args: string[] = [];
      expect(() => parseLogsOptions(args)).toThrow("session-id is required");
    });

    test("parses socket path", () => {
      const args = ["session-123", "--socket", "/custom.sock"];
      const options = parseLogsOptions(args);

      expect(options.socket).toBe("/custom.sock");
    });

    test("parses follow flag", () => {
      const args = ["session-123", "--follow"];
      const options = parseLogsOptions(args);

      expect(options.follow).toBe(true);
    });

    test("parses tail count", () => {
      const args = ["session-123", "--tail", "50"];
      const options = parseLogsOptions(args);

      expect(options.tail).toBe(50);
    });

    test("defaults tail to 100", () => {
      const args = ["session-123"];
      const options = parseLogsOptions(args);

      expect(options.tail).toBe(100);
    });

    test("parses since event ID", () => {
      const args = ["session-123", "--since", "event-456"];
      const options = parseLogsOptions(args);

      expect(options.since).toBe("event-456");
    });

    test("parses format option", () => {
      const args = ["session-123", "--format", "json"];
      const options = parseLogsOptions(args);

      expect(options.format).toBe("json");
    });

    test("validates format value", () => {
      const args = ["session-123", "--format", "invalid"];
      expect(() => parseLogsOptions(args)).toThrow("Invalid format");
    });

    test("parses source/type filters and messages-only flag", () => {
      const args = ["session-123", "--source", "transcript", "--type", "assistant", "-m"];
      const options = parseLogsOptions(args);

      expect(options.source).toBe("transcript");
      expect(options.type).toBe("assistant");
      expect(options.showMessages).toBe(true);
    });
  });

  describe("fetchLogs", () => {
    test("fetches events from daemon", async () => {
      const mockEvents = [
        {
          id: 1,
          sessionId: "session-123",
          timestamp: new Date().toISOString(),
          source: "hook",
          type: "SessionStart",
          payload: {},
        },
        {
          id: 2,
          sessionId: "session-123",
          timestamp: new Date().toISOString(),
          source: "transcript",
          type: "UserMessage",
          payload: { content: "Hello" },
        },
      ];

      const mockFetch = mock(async (url: string, options: any) => {
        // Updated endpoint: /sessions/:id/events (not /transcript/events)
        expect(url).toContain("http://localhost/sessions/session-123/events");
        expect(options.unix).toBe("/tmp/codepiper.sock");
        expect(options.method).toBe("GET");

        return new Response(JSON.stringify({ events: mockEvents }), {
          status: 200,
        });
      });

      global.fetch = mockFetch as any;

      const result = await fetchLogs({
        sessionId: "session-123",
        socket: "/tmp/codepiper.sock",
        tail: 100,
        format: "pretty",
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
    });

    test("includes query parameters", async () => {
      const mockFetch = mock(async (url: string) => {
        expect(url).toContain("since=event-456");
        expect(url).toContain("limit=50");

        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      await fetchLogs({
        sessionId: "session-123",
        socket: "/tmp/codepiper.sock",
        tail: 50,
        since: "event-456",
        format: "pretty",
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    test("handles empty event list", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      const result = await fetchLogs({
        sessionId: "session-123",
        socket: "/tmp/codepiper.sock",
        tail: 100,
        format: "pretty",
      });

      expect(result).toHaveLength(0);
    });

    test("handles session not found error", async () => {
      const mockFetch = mock(async () => {
        return new Response(
          JSON.stringify({
            error: "Session not found",
          }),
          { status: 404 }
        );
      });

      global.fetch = mockFetch as any;

      await expect(
        fetchLogs({
          sessionId: "invalid",
          socket: "/tmp/codepiper.sock",
          tail: 100,
          format: "pretty",
        })
      ).rejects.toThrow("Session not found");
    });

    test("handles daemon connection error", async () => {
      const mockFetch = mock(async () => {
        throw new Error("ENOENT: no such file or directory");
      });

      global.fetch = mockFetch as any;

      await expect(
        fetchLogs({
          sessionId: "session-123",
          socket: "/tmp/codepiper.sock",
          tail: 100,
          format: "pretty",
        })
      ).rejects.toThrow("Failed to connect to daemon");
    });
  });

  describe("runLogsCommand", () => {
    test("prints pretty output with assistant, user, hook, and compact payload details", async () => {
      const captured: string[] = [];
      console.log = mock((...args: unknown[]) => {
        captured.push(args.join(" "));
      }) as any;

      const events = [
        {
          id: 1,
          sessionId: "session-123",
          timestamp: new Date().toISOString(),
          source: "transcript",
          type: "assistant",
          payload: {
            message: {
              content: [{ type: "text", text: "A".repeat(220) }],
            },
          },
        },
        {
          id: 2,
          sessionId: "session-123",
          timestamp: new Date().toISOString(),
          source: "transcript",
          type: "user",
          payload: { message: { content: "hello" } },
        },
        {
          id: 3,
          sessionId: "session-123",
          timestamp: new Date().toISOString(),
          source: "hook",
          type: "Notification",
          payload: { hook_event_name: "permission_prompt" },
        },
        {
          id: 4,
          sessionId: "session-123",
          timestamp: new Date().toISOString(),
          source: "statusline",
          type: "status",
          payload: { ok: true },
        },
      ];

      globalThis.fetch = mock(
        async () => new Response(JSON.stringify({ events }), { status: 200 })
      ) as any;

      await runLogsCommand(["session-123"]);
      const output = captured.join("\n");
      expect(output).toContain("📝");
      expect(output).toContain("...");
      expect(output).toContain("👤 hello");
      expect(output).toContain("🪝 Event: permission_prompt");
      expect(output).toContain('{"ok":true}');
      expect(output).toContain("Total: 4 event(s)");
    });

    test("prints text conversation format for --format text and strips non-text blocks", async () => {
      const captured: string[] = [];
      console.log = mock((...args: unknown[]) => {
        captured.push(args.join(" "));
      }) as any;

      const events = [
        {
          id: 1,
          sessionId: "session-123",
          timestamp: new Date().toISOString(),
          source: "transcript",
          type: "user",
          payload: { message: { content: "Where are we?" } },
        },
        {
          id: 2,
          sessionId: "session-123",
          timestamp: new Date().toISOString(),
          source: "transcript",
          type: "assistant",
          payload: {
            message: {
              content: [
                { type: "thinking", text: "ignored" },
                { type: "text", text: "Done." },
              ],
            },
          },
        },
      ];

      globalThis.fetch = mock(
        async () => new Response(JSON.stringify({ events }), { status: 200 })
      ) as any;

      await runLogsCommand(["session-123", "--format", "text"]);
      const output = captured.join("\n");
      expect(output).toContain("User:");
      expect(output).toContain("Assistant:");
      expect(output).toContain("Done.");
      expect(output).not.toContain("ignored");
      expect(output).toContain("Total: 2 message(s)");
    });

    test("uses conversation formatter for --messages in pretty mode", async () => {
      const captured: string[] = [];
      console.log = mock((...args: unknown[]) => {
        captured.push(args.join(" "));
      }) as any;

      const events = [
        {
          id: 1,
          sessionId: "session-123",
          timestamp: new Date().toISOString(),
          source: "transcript",
          type: "assistant",
          payload: { message: { content: "Ready" } },
        },
      ];

      globalThis.fetch = mock(
        async () => new Response(JSON.stringify({ events }), { status: 200 })
      ) as any;

      await runLogsCommand(["session-123", "--messages"]);
      const output = captured.join("\n");
      expect(output).toContain("Assistant:");
      expect(output).toContain("Ready");
      expect(output).toContain("Total: 1 message(s)");
      expect(output).not.toContain("event(s)");
    });
  });
});
