import { afterEach, describe, expect, mock, test } from "bun:test";
import { parseStartOptions, startSession } from "./start";

const originalFetch = globalThis.fetch;

describe("start command", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  describe("parseStartOptions", () => {
    test("parses basic options with required flags", () => {
      const args = ["--provider", "claude-code", "--dir", "/path/to/repo"];
      const options = parseStartOptions(args);

      expect(options.provider).toBe("claude-code");
      expect(options.dir).toBe("/path/to/repo");
    });

    test("uses current directory as default", () => {
      const args = ["--provider", "claude-code"];
      const options = parseStartOptions(args);

      expect(options.provider).toBe("claude-code");
      expect(options.dir).toBe(process.cwd());
    });

    test("parses provider aliases", () => {
      const args1 = ["--provider", "claude"];
      expect(parseStartOptions(args1).provider).toBe("claude-code");

      const args2 = ["-p", "claude-code"];
      expect(parseStartOptions(args2).provider).toBe("claude-code");

      const args3 = ["--provider", "codex"];
      expect(parseStartOptions(args3).provider).toBe("codex");
    });

    test("validates provider value", () => {
      const args = ["--provider", "invalid-provider"];
      expect(() => parseStartOptions(args)).toThrow("Invalid provider");
    });

    test("requires provider flag", () => {
      const args: string[] = [];
      expect(() => parseStartOptions(args)).toThrow("provider is required");
    });

    test("parses additional args", () => {
      const args = ["--provider", "claude-code", "--dir", "/repo", "--", "arg1", "arg2"];
      const options = parseStartOptions(args);

      expect(options.additionalArgs).toEqual(["arg1", "arg2"]);
    });

    test("parses socket path", () => {
      const args = ["--provider", "claude-code", "--socket", "/custom/path.sock"];
      const options = parseStartOptions(args);

      expect(options.socket).toBe("/custom/path.sock");
    });

    test("uses default socket path", () => {
      const args = ["--provider", "claude-code"];
      const options = parseStartOptions(args);

      expect(options.socket).toBe("/tmp/codepiper.sock");
    });

    test("parses dangerous mode flag", () => {
      const args = ["--provider", "codex", "--dangerous"];
      const options = parseStartOptions(args);

      expect(options.provider).toBe("codex");
      expect(options.dangerous).toBe(true);
    });
  });

  describe("startSession", () => {
    test("sends POST request to daemon with correct payload", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        expect(url).toBe("http://localhost/sessions");
        expect(options.unix).toBe("/tmp/codepiper.sock");
        expect(options.method).toBe("POST");

        const body = JSON.parse(options.body);
        expect(body.provider).toBe("claude-code");
        expect(body.cwd).toBe("/path/to/repo");

        return new Response(
          JSON.stringify({
            session: {
              id: "test-session-id",
              provider: "claude-code",
              cwd: "/path/to/repo",
              status: "STARTING",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
          { status: 201 }
        );
      });

      global.fetch = mockFetch as any;

      const result = await startSession({
        provider: "claude-code",
        dir: "/path/to/repo",
        socket: "/tmp/codepiper.sock",
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(result.id).toBe("test-session-id");
      expect(result.status).toBe("STARTING");
    });

    test("includes additional args in request", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        const body = JSON.parse(options.body);
        expect(body.args).toEqual(["--verbose", "--debug"]);

        return new Response(
          JSON.stringify({
            session: {
              id: "test-id",
              provider: "claude-code",
              cwd: "/repo",
              status: "STARTING",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
          { status: 201 }
        );
      });

      global.fetch = mockFetch as any;

      await startSession({
        provider: "claude-code",
        dir: "/repo",
        socket: "/tmp/codepiper.sock",
        additionalArgs: ["--verbose", "--debug"],
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    test("includes dangerous mode in request payload", async () => {
      const mockFetch = mock(async (_url: string, options: any) => {
        const body = JSON.parse(options.body);
        expect(body.dangerousMode).toBe(true);
        expect(body.provider).toBe("codex");

        return new Response(
          JSON.stringify({
            session: {
              id: "codex-session",
              provider: "codex",
              cwd: "/repo",
              status: "STARTING",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
          { status: 201 }
        );
      });

      global.fetch = mockFetch as any;

      await startSession({
        provider: "codex",
        dir: "/repo",
        socket: "/tmp/codepiper.sock",
        dangerous: true,
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    test("handles daemon connection error", async () => {
      const mockFetch = mock(async () => {
        throw new Error("ENOENT: no such file or directory");
      });

      global.fetch = mockFetch as any;

      await expect(
        startSession({
          provider: "claude-code",
          dir: "/repo",
          socket: "/tmp/codepiper.sock",
        })
      ).rejects.toThrow("Failed to connect to daemon");
    });

    test("handles daemon error response", async () => {
      const mockFetch = mock(async () => {
        return new Response(
          JSON.stringify({
            error: "Provider not found",
          }),
          { status: 400 }
        );
      });

      global.fetch = mockFetch as any;

      await expect(
        startSession({
          provider: "claude-code",
          dir: "/repo",
          socket: "/tmp/codepiper.sock",
        })
      ).rejects.toThrow("Provider not found");
    });

    test("handles invalid JSON response", async () => {
      const mockFetch = mock(async () => {
        return new Response("not json", { status: 201 });
      });

      global.fetch = mockFetch as any;

      await expect(
        startSession({
          provider: "claude-code",
          dir: "/repo",
          socket: "/tmp/codepiper.sock",
        })
      ).rejects.toThrow();
    });
  });
});
