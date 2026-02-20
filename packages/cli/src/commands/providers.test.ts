import { afterEach, describe, expect, mock, test } from "bun:test";
import { listProviders, parseProvidersOptions } from "./providers";

const originalFetch = globalThis.fetch;

describe("providers command", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("parseProvidersOptions", () => {
    test("parses default options", () => {
      const options = parseProvidersOptions([]);
      expect(options.socket).toBe("/tmp/codepiper.sock");
      expect(options.format).toBe("table");
    });

    test("parses socket and format", () => {
      const options = parseProvidersOptions(["--socket", "/tmp/custom.sock", "--format", "json"]);
      expect(options.socket).toBe("/tmp/custom.sock");
      expect(options.format).toBe("json");
    });

    test("rejects invalid format", () => {
      expect(() => parseProvidersOptions(["--format", "yaml"])).toThrow(
        "Invalid format: yaml. Valid options: table, json"
      );
    });
  });

  describe("listProviders", () => {
    test("returns providers from daemon", async () => {
      globalThis.fetch = mock(async (url: string, options: any) => {
        expect(url).toBe("http://localhost/providers");
        expect(options.unix).toBe("/tmp/codepiper.sock");
        expect(options.method).toBe("GET");
        return new Response(
          JSON.stringify({
            providers: [
              {
                id: "claude-code",
                label: "Claude Code",
                runtime: "tmux",
                capabilities: {
                  nativeHooks: true,
                  supportsDangerousMode: true,
                  supportsModelSwitch: true,
                  supportsTranscriptTailing: true,
                  supportsTmuxAdoption: true,
                  policyChannel: "native-hooks",
                  metricsChannel: "transcript",
                },
              },
            ],
          }),
          { status: 200 }
        );
      }) as any;

      const providers = await listProviders({
        socket: "/tmp/codepiper.sock",
        format: "table",
      });

      expect(providers).toHaveLength(1);
      expect(providers[0]?.id).toBe("claude-code");
      expect(providers[0]?.capabilities.nativeHooks).toBe(true);
    });

    test("throws daemon connection error", async () => {
      globalThis.fetch = mock(async () => {
        throw new Error("ENOENT: no such file or directory");
      }) as any;

      await expect(
        listProviders({
          socket: "/tmp/codepiper.sock",
          format: "table",
        })
      ).rejects.toThrow("Failed to connect to daemon at /tmp/codepiper.sock");
    });
  });
});
