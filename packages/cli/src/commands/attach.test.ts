import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  fetchSessionOutput,
  parseAttachOptions,
  verifySessionExists,
  writeOutputDelta,
} from "./attach";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;

function captureStdout(run: () => void): string {
  const writes: string[] = [];
  process.stdout.write = mock((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as any;
  run();
  return writes.join("");
}

describe("attach command", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
  });

  describe("parseAttachOptions", () => {
    test("parses session ID from first argument", () => {
      const args = ["session-123"];
      const options = parseAttachOptions(args);

      expect(options.sessionId).toBe("session-123");
      expect(options.socket).toBe("/tmp/codepiper.sock");
    });

    test("requires session ID", () => {
      const args: string[] = [];
      expect(() => parseAttachOptions(args)).toThrow("session-id is required");
    });

    test("parses socket path", () => {
      const args = ["session-123", "--socket", "/custom/path.sock"];
      const options = parseAttachOptions(args);

      expect(options.sessionId).toBe("session-123");
      expect(options.socket).toBe("/custom/path.sock");
    });

    test("parses follow mode", () => {
      const args = ["session-123", "--follow"];
      const options = parseAttachOptions(args);

      expect(options.follow).toBe(true);
    });

    test("defaults follow mode to false", () => {
      const args = ["session-123"];
      const options = parseAttachOptions(args);

      expect(options.follow).toBe(false);
    });

    test("parses short socket and follow flags", () => {
      const args = ["session-123", "-s", "/custom.sock", "-f"];
      const options = parseAttachOptions(args);

      expect(options.socket).toBe("/custom.sock");
      expect(options.follow).toBe(true);
    });

    test("uses first positional arg as session id and ignores later positional args", () => {
      const args = ["session-123", "--follow", "session-ignored"];
      const options = parseAttachOptions(args);
      expect(options.sessionId).toBe("session-123");
    });
  });

  describe("verifySessionExists", () => {
    test("resolves for existing session", async () => {
      globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as any;
      await expect(
        verifySessionExists("session-123", "/tmp/codepiper.sock")
      ).resolves.toBeUndefined();
    });

    test("throws clear not found error for 404", async () => {
      globalThis.fetch = mock(async () => new Response(null, { status: 404 })) as any;
      await expect(verifySessionExists("missing", "/tmp/codepiper.sock")).rejects.toThrow(
        "Session not found: missing"
      );
    });

    test("maps ENOENT fetch errors to daemon-connect hint", async () => {
      globalThis.fetch = mock(async () => {
        throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
      }) as any;
      await expect(verifySessionExists("session-123", "/tmp/custom.sock")).rejects.toThrow(
        "Failed to connect to daemon at /tmp/custom.sock"
      );
    });
  });

  describe("fetchSessionOutput", () => {
    test("returns output string from daemon payload", async () => {
      globalThis.fetch = mock(
        async () => new Response(JSON.stringify({ output: "hello\n" }), { status: 200 })
      ) as any;

      await expect(fetchSessionOutput("session-123", "/tmp/codepiper.sock")).resolves.toBe(
        "hello\n"
      );
    });

    test("returns empty string when daemon payload omits output field", async () => {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({}), { status: 200 })) as any;

      await expect(fetchSessionOutput("session-123", "/tmp/codepiper.sock")).resolves.toBe("");
    });

    test("throws route error for output-unavailable statuses", async () => {
      globalThis.fetch = mock(
        async () =>
          new Response(JSON.stringify({ error: "Session output unavailable" }), {
            status: 409,
            statusText: "Conflict",
          })
      ) as any;

      await expect(fetchSessionOutput("session-123", "/tmp/codepiper.sock")).rejects.toThrow(
        "Session output unavailable"
      );
    });
  });

  describe("writeOutputDelta", () => {
    test("writes full output when there is no previous content", () => {
      const output = captureStdout(() => writeOutputDelta("", "line one\nline two\n"));
      expect(output).toBe("line one\nline two\n");
    });

    test("writes only appended suffix when output grows", () => {
      const output = captureStdout(() => writeOutputDelta("abc", "abcdef"));
      expect(output).toBe("def");
    });

    test("writes changed suffix from first mismatch for non-append updates", () => {
      const output = captureStdout(() => writeOutputDelta("abc123", "abcXYZ"));
      expect(output).toBe("XYZ");
    });

    test("writes nothing when output is empty or unchanged", () => {
      expect(captureStdout(() => writeOutputDelta("abc", "abc"))).toBe("");
      expect(captureStdout(() => writeOutputDelta("abc", ""))).toBe("");
    });
  });
});
