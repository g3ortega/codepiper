import { afterEach, describe, expect, mock, test } from "bun:test";
import { parseSendOptions, sendText, uploadImage } from "./send";

const originalFetch = globalThis.fetch;

describe("send command", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  describe("parseSendOptions", () => {
    test("parses session ID and text", () => {
      const args = ["session-123", "hello world"];
      const options = parseSendOptions(args);

      expect(options.sessionId).toBe("session-123");
      expect(options.text).toBe("hello world");
    });

    test("requires session ID", () => {
      const args: string[] = [];
      expect(() => parseSendOptions(args)).toThrow("session-id is required");
    });

    test("requires text or image", () => {
      const args = ["session-123"];
      expect(() => parseSendOptions(args)).toThrow("text or --image is required");
    });

    test("parses socket path", () => {
      const args = ["session-123", "hello", "--socket", "/custom.sock"];
      const options = parseSendOptions(args);

      expect(options.socket).toBe("/custom.sock");
    });

    test("parses newline flag", () => {
      const args1 = ["session-123", "hello", "--newline"];
      expect(parseSendOptions(args1).newline).toBe(true);

      const args2 = ["session-123", "hello", "-n"];
      expect(parseSendOptions(args2).newline).toBe(true);
    });

    test("defaults newline to true", () => {
      const args = ["session-123", "hello"];
      const options = parseSendOptions(args);

      expect(options.newline).toBe(true);
    });

    test("parses no-newline flag", () => {
      const args = ["session-123", "hello", "--no-newline"];
      const options = parseSendOptions(args);

      expect(options.newline).toBe(false);
    });

    test("joins multiple text arguments", () => {
      const args = ["session-123", "hello", "world", "foo"];
      const options = parseSendOptions(args);

      expect(options.text).toBe("hello world foo");
    });

    test("handles text with flags after", () => {
      const args = ["session-123", "hello", "--no-newline"];
      const options = parseSendOptions(args);

      expect(options.text).toBe("hello");
      expect(options.newline).toBe(false);
    });

    test("parses --image flag", () => {
      const args = ["session-123", "hello", "--image", "./screenshot.png"];
      const options = parseSendOptions(args);

      expect(options.image).toBe("./screenshot.png");
      expect(options.text).toBe("hello");
    });

    test("parses -i shorthand", () => {
      const args = ["session-123", "hello", "-i", "./screenshot.png"];
      const options = parseSendOptions(args);

      expect(options.image).toBe("./screenshot.png");
    });

    test("allows image without text", () => {
      const args = ["session-123", "--image", "./screenshot.png"];
      const options = parseSendOptions(args);

      expect(options.image).toBe("./screenshot.png");
      expect(options.text).toBe("");
    });

    test("parses image URL", () => {
      const args = ["session-123", "--image", "https://example.com/img.png"];
      const options = parseSendOptions(args);

      expect(options.image).toBe("https://example.com/img.png");
    });
  });

  describe("sendText", () => {
    test("sends POST request with text and newline", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        expect(url).toBe("http://localhost/sessions/session-123/send");
        expect(options.unix).toBe("/tmp/codepiper.sock");
        expect(options.method).toBe("POST");

        const body = JSON.parse(options.body);
        expect(body.text).toBe("hello world");
        expect(body.newline).toBe(true);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
        });
      });

      global.fetch = mockFetch as any;

      await sendText({
        sessionId: "session-123",
        text: "hello world",
        socket: "/tmp/codepiper.sock",
        newline: true,
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    test("sends text without newline", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        const body = JSON.parse(options.body);
        expect(body.newline).toBe(false);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
        });
      });

      global.fetch = mockFetch as any;

      await sendText({
        sessionId: "session-123",
        text: "hello",
        socket: "/tmp/codepiper.sock",
        newline: false,
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
        sendText({
          sessionId: "invalid",
          text: "hello",
          socket: "/tmp/codepiper.sock",
          newline: true,
        })
      ).rejects.toThrow("Session not found");
    });

    test("handles daemon connection error", async () => {
      const mockFetch = mock(async () => {
        throw new Error("ENOENT: no such file or directory");
      });

      global.fetch = mockFetch as any;

      await expect(
        sendText({
          sessionId: "session-123",
          text: "hello",
          socket: "/tmp/codepiper.sock",
          newline: true,
        })
      ).rejects.toThrow("Failed to connect to daemon");
    });
  });

  describe("uploadImage", () => {
    test("sends multipart FormData to upload-image endpoint", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        expect(url).toBe("http://localhost/sessions/session-123/upload-image");
        expect(options.unix).toBe("/tmp/codepiper.sock");
        expect(options.method).toBe("POST");
        expect(options.body).toBeInstanceOf(FormData);

        return new Response(
          JSON.stringify({ path: "/tmp/sessions/session-123/images/upload-123-test.png" }),
          { status: 200 }
        );
      });

      global.fetch = mockFetch as any;

      // Create a small temp file for testing
      const tmpPath = `/tmp/codepiper-test-${Date.now()}.png`;
      // Write a minimal valid PNG (1x1 pixel)
      const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await Bun.write(tmpPath, pngHeader);

      try {
        const result = await uploadImage("session-123", tmpPath, "/tmp/codepiper.sock");
        expect(result).toBe("/tmp/sessions/session-123/images/upload-123-test.png");
        expect(mockFetch).toHaveBeenCalled();
      } finally {
        const fs = await import("node:fs");
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore
        }
      }
    });

    test("throws on upload failure", async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify({ error: "Invalid image type" }), { status: 400 });
      });

      global.fetch = mockFetch as any;

      const tmpPath = `/tmp/codepiper-test-${Date.now()}.png`;
      const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      await Bun.write(tmpPath, pngHeader);

      try {
        await expect(uploadImage("session-123", tmpPath, "/tmp/codepiper.sock")).rejects.toThrow(
          "Invalid image type"
        );
      } finally {
        const fs = await import("node:fs");
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore
        }
      }
    });
  });
});
