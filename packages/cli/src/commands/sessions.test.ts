import { afterEach, describe, expect, mock, test } from "bun:test";
import { listSessions, parseSessionsOptions } from "./sessions";

const originalFetch = globalThis.fetch;

describe("sessions command", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  describe("parseSessionsOptions", () => {
    test("parses default options", () => {
      const args: string[] = [];
      const options = parseSessionsOptions(args);

      expect(options.socket).toBe("/tmp/codepiper.sock");
      expect(options.format).toBe("table");
    });

    test("parses socket path", () => {
      const args = ["--socket", "/custom/path.sock"];
      const options = parseSessionsOptions(args);

      expect(options.socket).toBe("/custom/path.sock");
    });

    test("parses output format", () => {
      const args1 = ["--format", "json"];
      expect(parseSessionsOptions(args1).format).toBe("json");

      const args2 = ["-f", "table"];
      expect(parseSessionsOptions(args2).format).toBe("table");
    });

    test("validates format value", () => {
      const args = ["--format", "invalid"];
      expect(() => parseSessionsOptions(args)).toThrow("Invalid format");
    });

    test("parses filter by provider", () => {
      const args = ["--provider", "claude-code"];
      const options = parseSessionsOptions(args);

      expect(options.provider).toBe("claude-code");
    });

    test("parses filter by status", () => {
      const args = ["--status", "RUNNING"];
      const options = parseSessionsOptions(args);

      expect(options.status).toBe("RUNNING");
    });
  });

  describe("listSessions", () => {
    test("fetches sessions from daemon", async () => {
      const mockSessions = [
        {
          id: "session-1",
          provider: "claude-code",
          cwd: "/repo1",
          status: "RUNNING",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          pid: 1234,
        },
        {
          id: "session-2",
          provider: "claude-code",
          cwd: "/repo2",
          status: "STOPPED",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const mockFetch = mock(async (url: string, options: any) => {
        expect(url).toContain("http://localhost/sessions");
        expect(options.unix).toBe("/tmp/codepiper.sock");
        expect(options.method).toBe("GET");

        return new Response(JSON.stringify({ sessions: mockSessions }), {
          status: 200,
        });
      });

      global.fetch = mockFetch as any;

      const result = await listSessions({
        socket: "/tmp/codepiper.sock",
        format: "table",
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("session-1");
      expect(result[1].id).toBe("session-2");
    });

    test("includes query parameters for filters", async () => {
      const mockFetch = mock(async (url: string) => {
        expect(url).toContain("provider=claude-code");
        expect(url).toContain("status=RUNNING");

        return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      await listSessions({
        socket: "/tmp/codepiper.sock",
        format: "table",
        provider: "claude-code",
        status: "RUNNING",
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    test("handles empty session list", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
      });

      global.fetch = mockFetch as any;

      const result = await listSessions({
        socket: "/tmp/codepiper.sock",
        format: "table",
      });

      expect(result).toHaveLength(0);
    });

    test("handles daemon connection error", async () => {
      const mockFetch = mock(async () => {
        throw new Error("ENOENT: no such file or directory");
      });

      global.fetch = mockFetch as any;

      await expect(
        listSessions({
          socket: "/tmp/codepiper.sock",
          format: "table",
        })
      ).rejects.toThrow("Failed to connect to daemon");
    });

    test("handles daemon error response", async () => {
      const mockFetch = mock(async () => {
        return new Response(
          JSON.stringify({
            error: "Internal server error",
          }),
          { status: 500 }
        );
      });

      global.fetch = mockFetch as any;

      await expect(
        listSessions({
          socket: "/tmp/codepiper.sock",
          format: "table",
        })
      ).rejects.toThrow("Internal server error");
    });
  });
});
