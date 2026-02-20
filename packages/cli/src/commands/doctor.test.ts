import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  checkClaudeInstallation,
  checkCodexInstallation,
  checkDaemon,
  checkTmux,
  evaluatePlatform,
  parseDoctorOptions,
} from "./doctor";

const originalFetch = globalThis.fetch;

/** Build a mock Bun.spawn result with the given exit code and stdout content. */
function mockSpawnResult(exitCode: number, stdout = "", stderr = "") {
  return {
    exited: Promise.resolve(),
    exitCode: Promise.resolve(exitCode),
    stdout: {
      async *[Symbol.asyncIterator]() {
        if (stdout) yield Buffer.from(stdout);
      },
    },
    stderr: {
      async *[Symbol.asyncIterator]() {
        if (stderr) yield Buffer.from(stderr);
      },
    },
  };
}

/** Mock Bun.spawn with a sequence of results, restoring after the callback. */
async function withMockSpawn<T>(
  results: ReturnType<typeof mockSpawnResult>[],
  fn: () => Promise<T>
): Promise<T> {
  let callIndex = 0;
  const originalSpawn = Bun.spawn;
  Bun.spawn = mock(() => {
    const result = results[Math.min(callIndex, results.length - 1)];
    callIndex++;
    return result as any;
  });
  try {
    return await fn();
  } finally {
    Bun.spawn = originalSpawn;
  }
}

describe("doctor command", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("parseDoctorOptions", () => {
    test("parses default options", () => {
      const options = parseDoctorOptions([]);
      expect(options.socket).toBe("/tmp/codepiper.sock");
    });

    test("parses socket path", () => {
      const options = parseDoctorOptions(["--socket", "/custom.sock"]);
      expect(options.socket).toBe("/custom.sock");
    });
  });

  describe("checkClaudeInstallation", () => {
    test("detects claude binary in PATH", async () => {
      const result = await withMockSpawn([mockSpawnResult(0, "/usr/local/bin/claude\n")], () =>
        checkClaudeInstallation()
      );

      expect(result.installed).toBe(true);
      expect(result.path).toBe("/usr/local/bin/claude");
    });

    test("detects missing claude binary", async () => {
      const result = await withMockSpawn([mockSpawnResult(1, "", "claude not found\n")], () =>
        checkClaudeInstallation()
      );

      expect(result.installed).toBe(false);
    });

    test("gets claude version", async () => {
      const result = await withMockSpawn(
        [mockSpawnResult(0, "/usr/local/bin/claude\n"), mockSpawnResult(0, "claude 2.1.0\n")],
        () => checkClaudeInstallation()
      );

      expect(result.version).toBe("claude 2.1.0");
    });
  });

  describe("checkCodexInstallation", () => {
    test("detects codex binary in PATH", async () => {
      const result = await withMockSpawn([mockSpawnResult(0, "/usr/local/bin/codex\n")], () =>
        checkCodexInstallation()
      );

      expect(result.installed).toBe(true);
      expect(result.path).toBe("/usr/local/bin/codex");
    });

    test("detects missing codex binary", async () => {
      const result = await withMockSpawn([mockSpawnResult(1, "", "codex not found\n")], () =>
        checkCodexInstallation()
      );

      expect(result.installed).toBe(false);
    });

    test("gets codex version", async () => {
      const result = await withMockSpawn(
        [mockSpawnResult(0, "/usr/local/bin/codex\n"), mockSpawnResult(0, "codex-cli 0.101.0\n")],
        () => checkCodexInstallation()
      );

      expect(result.version).toBe("codex-cli 0.101.0");
    });
  });

  describe("checkTmux", () => {
    test("detects tmux in PATH with version", async () => {
      const result = await withMockSpawn(
        [mockSpawnResult(0, "/usr/local/bin/tmux\n"), mockSpawnResult(0, "tmux 3.4\n")],
        () => checkTmux()
      );

      expect(result.installed).toBe(true);
      expect(result.path).toBe("/usr/local/bin/tmux");
      expect(result.version).toBe("tmux 3.4");
      expect(result.versionOk).toBe(true);
    });

    test("detects missing tmux", async () => {
      const result = await withMockSpawn([mockSpawnResult(1, "", "tmux not found\n")], () =>
        checkTmux()
      );

      expect(result.installed).toBe(false);
      expect(result.error).toContain("tmux command not found");
    });

    test("flags old tmux version", async () => {
      const result = await withMockSpawn(
        [mockSpawnResult(0, "/usr/bin/tmux\n"), mockSpawnResult(0, "tmux 2.9\n")],
        () => checkTmux()
      );

      expect(result.installed).toBe(true);
      expect(result.versionOk).toBe(false);
    });
  });

  describe("checkDaemon", () => {
    test("detects running daemon", async () => {
      const mockFetch = mock(async (url: string, options: any) => {
        expect(url).toBe("http://localhost/health");
        expect(options.unix).toBe("/tmp/codepiper.sock");
        return new Response(JSON.stringify({ status: "ok", version: "0.1.0" }), { status: 200 });
      });
      global.fetch = mockFetch as any;

      const result = await checkDaemon("/tmp/codepiper.sock");

      expect(result.running).toBe(true);
      expect(result.version).toBe("0.1.0");
    });

    test("detects daemon not running", async () => {
      global.fetch = mock(async () => {
        throw new Error("ENOENT: no such file or directory");
      }) as any;

      const result = await checkDaemon("/tmp/codepiper.sock");

      expect(result.running).toBe(false);
    });

    test("handles daemon error response", async () => {
      global.fetch = mock(async () => {
        return new Response("Internal error", { status: 500 });
      }) as any;

      const result = await checkDaemon("/tmp/codepiper.sock");

      expect(result.running).toBe(false);
      expect(result.error).toContain("HTTP 500");
    });
  });

  describe("evaluatePlatform", () => {
    test("marks linux x64 as supported", () => {
      const result = evaluatePlatform("linux", "x64");
      expect(result.supported).toBe(true);
    });

    test("marks darwin arm64 as supported", () => {
      const result = evaluatePlatform("darwin", "arm64");
      expect(result.supported).toBe(true);
    });

    test("marks unsupported platform/arch combinations", () => {
      const unsupportedOs = evaluatePlatform("win32", "x64");
      const unsupportedArch = evaluatePlatform("linux", "ia32");
      expect(unsupportedOs.supported).toBe(false);
      expect(unsupportedArch.supported).toBe(false);
    });
  });
});
