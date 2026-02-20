import { afterEach, describe, expect, mock, test } from "bun:test";
import { parseKeysOptions, sendKeys } from "./keys";

const originalFetch = globalThis.fetch;

describe("keys command", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  describe("parseKeysOptions", () => {
    test("parses session ID and keys", () => {
      const args = ["session-123", "ctrl+c"];
      const options = parseKeysOptions(args);

      expect(options.sessionId).toBe("session-123");
      expect(options.keys).toEqual(["ctrl+c"]);
    });

    test("parses multiple keys", () => {
      const args = ["session-123", "ctrl+c", "enter"];
      const options = parseKeysOptions(args);

      expect(options.keys).toEqual(["ctrl+c", "enter"]);
    });

    test("requires session ID", () => {
      const args: string[] = [];
      expect(() => parseKeysOptions(args)).toThrow("session-id is required");
    });

    test("requires at least one key", () => {
      const args = ["session-123"];
      expect(() => parseKeysOptions(args)).toThrow("at least one key is required");
    });

    test("parses socket path", () => {
      const args = ["session-123", "enter", "--socket", "/custom.sock"];
      const options = parseKeysOptions(args);

      expect(options.socket).toBe("/custom.sock");
    });

    test("filters out socket flag from keys", () => {
      const args = ["session-123", "ctrl+c", "--socket", "/custom.sock", "enter"];
      const options = parseKeysOptions(args);

      expect(options.keys).toEqual(["ctrl+c", "enter"]);
    });
  });

  describe("sendKeys", () => {
    test("sends POST request with keys array", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        expect(url).toBe("http://localhost/sessions/session-123/keys");
        expect(options.unix).toBe("/tmp/codepiper.sock");
        expect(options.method).toBe("POST");

        const body = JSON.parse(options.body);
        expect(body.keys).toEqual(["ctrl+c", "enter"]);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
        });
      });

      global.fetch = mockFetch as any;

      await sendKeys({
        sessionId: "session-123",
        keys: ["ctrl+c", "enter"],
        socket: "/tmp/codepiper.sock",
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    test("handles single key", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        const body = JSON.parse(options.body);
        expect(body.keys).toEqual(["escape"]);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
        });
      });

      global.fetch = mockFetch as any;

      await sendKeys({
        sessionId: "session-123",
        keys: ["escape"],
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
        sendKeys({
          sessionId: "invalid",
          keys: ["enter"],
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
        sendKeys({
          sessionId: "session-123",
          keys: ["enter"],
          socket: "/tmp/codepiper.sock",
        })
      ).rejects.toThrow("Failed to connect to daemon");
    });
  });
});
