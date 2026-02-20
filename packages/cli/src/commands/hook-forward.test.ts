import { afterEach, describe, expect, mock, test } from "bun:test";
import { forwardHook } from "./hook-forward";

const originalFetch = globalThis.fetch;

/**
 * Sample hook event payloads based on Claude Code hooks spec
 */
const SAMPLE_EVENTS = {
  SessionStart: {
    event: "SessionStart",
    session_id: "test-session-123",
    transcript_path: "/tmp/claude/transcript-123.jsonl",
    cwd: "/home/user/project",
    permission_mode: "plan",
    model: "claude-sonnet-4-5",
  },
  Notification: {
    event: "Notification",
    session_id: "test-session-123",
    notification_type: "idle_prompt",
    message: "Agent is idle",
    title: "Idle",
  },
  PermissionRequest: {
    event: "PermissionRequest",
    session_id: "test-session-123",
    tool_name: "Bash",
    tool_input: {
      command: "ls -la",
    },
    transcript_path: "/tmp/claude/transcript-123.jsonl",
  },
  Stop: {
    event: "Stop",
    session_id: "test-session-123",
    stop_hook_active: true,
    transcript_path: "/tmp/claude/transcript-123.jsonl",
  },
};

const TEST_OPTIONS = {
  socketPath: "/tmp/codepiper.sock",
  sessionId: "test-session-123",
  secret: "test-secret",
};

describe("hook-forward command", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("JSON parsing", () => {
    test("parses valid JSON event", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        const body = JSON.parse(options.body);
        // New payload format: { sessionId, event, data }
        expect(body.event).toBe("SessionStart");
        expect(body.sessionId).toBe("test-session-123");
        expect(body.data).toBeDefined();
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(JSON.stringify(SAMPLE_EVENTS.SessionStart), TEST_OPTIONS);

      expect(mockFetch).toHaveBeenCalled();
      expect(result.exitCode).toBe(0);
    });

    test("handles multiline JSON", async () => {
      const event = {
        ...SAMPLE_EVENTS.PermissionRequest,
        tool_input: {
          command: "echo 'line1'\necho 'line2'",
        },
      };

      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ decision: "allow" }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(JSON.stringify(event, null, 2), TEST_OPTIONS);

      expect(mockFetch).toHaveBeenCalled();
      expect(result.exitCode).toBe(0);
    });

    test("throws error on invalid JSON", async () => {
      await expect(forwardHook("not valid json", TEST_OPTIONS)).rejects.toThrow(/Invalid JSON/);
    });

    test("throws error on empty input", async () => {
      await expect(forwardHook("", TEST_OPTIONS)).rejects.toThrow(/No input/);
    });

    test("throws error on whitespace-only input", async () => {
      await expect(forwardHook("   \n  ", TEST_OPTIONS)).rejects.toThrow(/No input/);
    });
  });

  describe("environment variables", () => {
    test("uses provided socketPath", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        expect(options.unix).toBe("/custom/socket.sock");
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      await forwardHook(JSON.stringify(SAMPLE_EVENTS.SessionStart), {
        ...TEST_OPTIONS,
        socketPath: "/custom/socket.sock",
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    test("uses provided sessionId for metadata", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        const body = JSON.parse(options.body);
        // New payload format uses sessionId at top level
        expect(body.sessionId).toBe("codepiper-session-456");
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      await forwardHook(JSON.stringify(SAMPLE_EVENTS.SessionStart), {
        ...TEST_OPTIONS,
        sessionId: "codepiper-session-456",
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    test("uses provided secret for authentication", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        expect(options.headers["X-CodePiper-Secret"]).toBe("my-secret-token");
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      await forwardHook(JSON.stringify(SAMPLE_EVENTS.SessionStart), {
        ...TEST_OPTIONS,
        secret: "my-secret-token",
      });

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("POST to daemon", () => {
    test("sends POST to /hooks/claude endpoint", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        expect(url).toBe("http://localhost/hooks/claude");
        expect(options.method).toBe("POST");
        expect(options.headers["Content-Type"]).toBe("application/json");
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      await forwardHook(JSON.stringify(SAMPLE_EVENTS.SessionStart), TEST_OPTIONS);

      expect(mockFetch).toHaveBeenCalled();
    });

    test("includes hook event and codepiper metadata in body", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        const body = JSON.parse(options.body);
        // New payload format: { sessionId, event, data }
        expect(body.event).toBe("Notification");
        expect(body.sessionId).toBe("test-session-123");
        expect(body.data).toBeDefined();
        expect(body.data.notification_type).toBe("idle_prompt");
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      await forwardHook(JSON.stringify(SAMPLE_EVENTS.Notification), TEST_OPTIONS);

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("PermissionRequest handling", () => {
    test("returns decision JSON for allow", async () => {
      const mockFetch = mock(async () => {
        return new Response(
          JSON.stringify({
            decision: "allow",
          }),
          { status: 200 }
        );
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(
        JSON.stringify(SAMPLE_EVENTS.PermissionRequest),
        TEST_OPTIONS
      );

      expect(result.exitCode).toBe(0);
      expect(result.output).toBe(JSON.stringify({ decision: "allow" }));
    });

    test("returns decision JSON for deny", async () => {
      const mockFetch = mock(async () => {
        return new Response(
          JSON.stringify({
            decision: "deny",
            denialMessage: "Command not allowed",
          }),
          { status: 200 }
        );
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(
        JSON.stringify(SAMPLE_EVENTS.PermissionRequest),
        TEST_OPTIONS
      );

      expect(result.exitCode).toBe(2);
      expect(result.output).toBe(
        JSON.stringify({
          decision: "deny",
          denialMessage: "Command not allowed",
        })
      );
    });

    test("returns decision JSON with updatedInput", async () => {
      const mockFetch = mock(async () => {
        return new Response(
          JSON.stringify({
            decision: "allow",
            updatedInput: {
              command: "ls -la /safe/path",
            },
          }),
          { status: 200 }
        );
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(
        JSON.stringify(SAMPLE_EVENTS.PermissionRequest),
        TEST_OPTIONS
      );

      expect(result.exitCode).toBe(0);
      expect(result.output).toBe(
        JSON.stringify({
          decision: "allow",
          updatedInput: { command: "ls -la /safe/path" },
        })
      );
    });

    test("exits with code 0 for allow decision", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ decision: "allow" }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(
        JSON.stringify(SAMPLE_EVENTS.PermissionRequest),
        TEST_OPTIONS
      );

      expect(result.exitCode).toBe(0);
    });

    test("exits with code 2 for deny decision (blocks action)", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ decision: "deny" }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(
        JSON.stringify(SAMPLE_EVENTS.PermissionRequest),
        TEST_OPTIONS
      );

      expect(result.exitCode).toBe(2);
    });

    test("normalizes legacy daemon allow=true response", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ allow: true }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(
        JSON.stringify(SAMPLE_EVENTS.PermissionRequest),
        TEST_OPTIONS
      );

      expect(result.exitCode).toBe(0);
      expect(result.output).toBe(JSON.stringify({ decision: "allow" }));
    });

    test("normalizes legacy daemon allow=false response", async () => {
      const mockFetch = mock(async () => {
        return new Response(
          JSON.stringify({
            allow: false,
            message: "Blocked by policy",
          }),
          { status: 200 }
        );
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(
        JSON.stringify(SAMPLE_EVENTS.PermissionRequest),
        TEST_OPTIONS
      );

      expect(result.exitCode).toBe(2);
      expect(result.output).toBe(
        JSON.stringify({
          decision: "deny",
          denialMessage: "Blocked by policy",
        })
      );
    });

    test("returns no output for ask decision", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ decision: "ask" }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(
        JSON.stringify(SAMPLE_EVENTS.PermissionRequest),
        TEST_OPTIONS
      );

      expect(result.exitCode).toBe(0);
      expect(result.output).toBeUndefined();
    });
  });

  describe("non-PermissionRequest events", () => {
    test("does not output for SessionStart", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(JSON.stringify(SAMPLE_EVENTS.SessionStart), TEST_OPTIONS);

      expect(result.exitCode).toBe(0);
      expect(result.output).toBeUndefined();
    });

    test("does not output for Notification", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(JSON.stringify(SAMPLE_EVENTS.Notification), TEST_OPTIONS);

      expect(result.exitCode).toBe(0);
      expect(result.output).toBeUndefined();
    });

    test("does not output for Stop", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(JSON.stringify(SAMPLE_EVENTS.Stop), TEST_OPTIONS);

      expect(result.exitCode).toBe(0);
      expect(result.output).toBeUndefined();
    });

    test("exits with code 0 for non-PermissionRequest events", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      const result = await forwardHook(JSON.stringify(SAMPLE_EVENTS.Stop), TEST_OPTIONS);

      expect(result.exitCode).toBe(0);
    });
  });

  describe("error handling", () => {
    test("throws error on daemon connection failure", async () => {
      const mockFetch = mock(async () => {
        throw new Error("ENOENT: no such file or directory");
      });

      global.fetch = mockFetch as any;

      await expect(
        forwardHook(JSON.stringify(SAMPLE_EVENTS.SessionStart), TEST_OPTIONS)
      ).rejects.toThrow(/Failed to connect to daemon/);
    });

    test("throws error on HTTP error response", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
        });
      });

      global.fetch = mockFetch as any;

      await expect(
        forwardHook(JSON.stringify(SAMPLE_EVENTS.SessionStart), TEST_OPTIONS)
      ).rejects.toThrow(/Internal server error/);
    });

    test("throws error on malformed daemon response", async () => {
      const mockFetch = mock(async () => {
        return new Response("not json", { status: 200 });
      });

      global.fetch = mockFetch as any;

      await expect(
        forwardHook(JSON.stringify(SAMPLE_EVENTS.PermissionRequest), TEST_OPTIONS)
      ).rejects.toThrow();
    });

    test("handles 404 session not found", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ error: "Session not found" }), {
          status: 404,
        });
      });

      global.fetch = mockFetch as any;

      await expect(
        forwardHook(JSON.stringify(SAMPLE_EVENTS.SessionStart), TEST_OPTIONS)
      ).rejects.toThrow(/Session not found/);
    });
  });
});
