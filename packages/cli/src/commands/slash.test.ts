import { afterEach, describe, expect, mock, test } from "bun:test";
import { parseSlashOptions, sendSlashCommand } from "./slash";

const originalFetch = globalThis.fetch;

describe("slash command", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  describe("parseSlashOptions", () => {
    test("parses session ID and command", () => {
      const args = ["session-123", "status"];
      const options = parseSlashOptions(args);

      expect(options.sessionId).toBe("session-123");
      expect(options.command).toBe("status");
    });

    test("requires session ID", () => {
      const args: string[] = [];
      expect(() => parseSlashOptions(args)).toThrow("session-id is required");
    });

    test("requires command", () => {
      const args = ["session-123"];
      expect(() => parseSlashOptions(args)).toThrow("command is required");
    });

    test("parses socket path", () => {
      const args = ["session-123", "status", "--socket", "/custom.sock"];
      const options = parseSlashOptions(args);

      expect(options.socket).toBe("/custom.sock");
    });

    test("parses command arguments", () => {
      const args = ["session-123", "help", "arg1", "arg2"];
      const options = parseSlashOptions(args);

      expect(options.command).toBe("help");
      expect(options.args).toEqual(["arg1", "arg2"]);
    });

    test("filters out socket flag from args", () => {
      const args = ["session-123", "help", "arg1", "--socket", "/custom.sock", "arg2"];
      const options = parseSlashOptions(args);

      expect(options.args).toEqual(["arg1", "arg2"]);
    });
  });

  describe("sendSlashCommand", () => {
    test("sends POST request with command", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        expect(url).toBe("http://localhost/sessions/session-123/slash");
        expect(options.unix).toBe("/tmp/codepiper.sock");
        expect(options.method).toBe("POST");

        const body = JSON.parse(options.body);
        expect(body.command).toBe("status");

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
        });
      });

      global.fetch = mockFetch as any;

      await sendSlashCommand({
        sessionId: "session-123",
        command: "status",
        socket: "/tmp/codepiper.sock",
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    test("includes command arguments", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        const body = JSON.parse(options.body);
        expect(body.command).toBe("help");
        expect(body.args).toEqual(["arg1", "arg2"]);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
        });
      });

      global.fetch = mockFetch as any;

      await sendSlashCommand({
        sessionId: "session-123",
        command: "help",
        args: ["arg1", "arg2"],
        socket: "/tmp/codepiper.sock",
      });

      expect(mockFetch).toHaveBeenCalled();
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
        sendSlashCommand({
          sessionId: "invalid",
          command: "status",
          socket: "/tmp/codepiper.sock",
        })
      ).rejects.toThrow("Session not found");
    });

    test("handles daemon connection error", async () => {
      const mockFetch = mock(async () => {
        throw new Error("ENOENT: no such file or directory");
      });

      global.fetch = mockFetch as any;

      await expect(
        sendSlashCommand({
          sessionId: "session-123",
          command: "status",
          socket: "/tmp/codepiper.sock",
        })
      ).rejects.toThrow("Failed to connect to daemon");
    });
  });
});
