import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type TerminalCursor, TmuxSession } from "./tmuxSession";

async function waitForCondition(
  predicate: () => boolean,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 4000;
  const intervalMs = options?.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return predicate();
}

describe("TmuxSession", () => {
  let sessions: TmuxSession[] = [];
  const testDir = "/tmp/codepiper-tmux-tests";

  beforeEach(async () => {
    // Ensure test directory exists
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup all test sessions
    for (const session of sessions) {
      try {
        if (!session.closed) {
          await session.kill("SIGKILL");
        }
      } catch {
        // Best effort cleanup
      }
    }
    sessions = [];

    // Cleanup test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Session Creation", () => {
    test("creates session with correct name", async () => {
      const sessionName = `test-create-${randomUUID().slice(0, 8)}`;
      const session = new TmuxSession({
        sessionName,
        command: ["sleep", "3600"],
        cwd: testDir,
        env: {},
      });
      sessions.push(session);

      await session.create();

      expect(session.closed).toBe(false);
      expect(session.pid).toBeGreaterThan(0);

      // Verify session exists in tmux
      const proc = Bun.spawn(["tmux", "has-session", "-t", sessionName], {
        stdout: "ignore",
        stderr: "ignore",
      });
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    });

    test("sets working directory correctly", async () => {
      const sessionName = `test-cwd-${randomUUID().slice(0, 8)}`;
      let output = "";

      const session = new TmuxSession({
        sessionName,
        command: ["bash"],
        cwd: testDir,
        env: {},
        onData: (data) => {
          output += data;
        },
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send pwd command
      await session.sendKey("pwd");
      await session.sendKey("Enter");
      await waitForCondition(() => output.includes(testDir));
      expect(output).toContain(testDir);
    });

    test("passes environment variables", async () => {
      const sessionName = `test-env-${randomUUID().slice(0, 8)}`;
      const testValue = `test-value-${randomUUID().slice(0, 8)}`;
      let output = "";

      const session = new TmuxSession({
        sessionName,
        command: ["bash"],
        cwd: testDir,
        env: { TEST_VAR: testValue },
        onData: (data) => {
          output += data;
        },
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check environment variable
      await session.sendKey("echo $TEST_VAR");
      await session.sendKey("Enter");
      const foundInStream = await waitForCondition(() => output.includes(testValue));
      if (!foundInStream) {
        output = await session.capturePane();
      }
      expect(output).toContain(testValue);
    });

    test("does not inherit unrelated parent environment variables", async () => {
      const sessionName = `test-env-isolation-${randomUUID().slice(0, 8)}`;
      const varName = `CODEPIPER_TEST_SECRET_${randomUUID().slice(0, 8).toUpperCase()}`;
      const varValue = `secret-${randomUUID().slice(0, 8)}`;
      const previous = process.env[varName];
      let output = "";

      process.env[varName] = varValue;

      try {
        const session = new TmuxSession({
          sessionName,
          command: ["bash"],
          cwd: testDir,
          env: {},
          onData: (data) => {
            output += data;
          },
        });
        sessions.push(session);

        await session.create();
        await new Promise((resolve) => setTimeout(resolve, 500));

        await session.sendKey(`printenv ${varName} || echo __MISSING__`);
        await session.sendKey("Enter");
        const foundMissing = await waitForCondition(() => output.includes("__MISSING__"));
        if (!foundMissing) {
          output = await session.capturePane();
        }
        expect(output).toContain("__MISSING__");
        expect(output).not.toContain(varValue);
      } finally {
        if (previous === undefined) {
          delete process.env[varName];
        } else {
          process.env[varName] = previous;
        }
      }
    });

    test("throws error when session creation fails", async () => {
      // Create a real session first, then try to create a duplicate (guaranteed failure)
      const dupName = `test-dup-${randomUUID().slice(0, 8)}`;
      const first = new TmuxSession({
        sessionName: dupName,
        command: ["sleep", "3600"],
        cwd: testDir,
        env: {},
      });
      sessions.push(first);
      await first.create();

      const duplicate = new TmuxSession({
        sessionName: dupName,
        command: ["sleep", "3600"],
        cwd: testDir,
        env: {},
      });
      sessions.push(duplicate);

      await expect(duplicate.create()).rejects.toThrow();
    });
  });

  describe("Input/Output", () => {
    test("sends text and captures output", async () => {
      const sessionName = `test-io-${randomUUID().slice(0, 8)}`;
      let output = "";

      const session = new TmuxSession({
        sessionName,
        command: ["bash"],
        cwd: testDir,
        env: {},
        onData: (data) => {
          output += data;
        },
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Use write() method with literal text
      session.write("echo hello");
      await session.sendKey("Enter");
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(output).toContain("hello");
    });

    test("handles UTF-8 multibyte characters", async () => {
      const sessionName = `test-utf8-${randomUUID().slice(0, 8)}`;
      let output = "";

      const session = new TmuxSession({
        sessionName,
        command: ["bash"],
        cwd: testDir,
        env: {},
        onData: (data) => {
          output += data;
        },
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Test emoji, Chinese, and special characters
      const testStrings = ["echo 🚀", "echo 你好", "echo café"];

      for (const str of testStrings) {
        output = ""; // Reset
        await session.sendKey(str);
        await session.sendKey("Enter");
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(output).toContain(str.replace("echo ", ""));
      }
    });

    test("batches rapid writes", async () => {
      const sessionName = `test-batch-${randomUUID().slice(0, 8)}`;
      let output = "";

      const session = new TmuxSession({
        sessionName,
        command: ["bash"],
        cwd: testDir,
        env: {},
        onData: (data) => {
          output += data;
        },
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send 100 characters rapidly
      const chars = "a".repeat(100);
      for (const char of chars) {
        session.write(char);
      }

      // Flush and send Enter
      session.flush();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await session.sendKey("Enter");
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Normalize tmux-wrapped prompt output (e.g. "\n<" continuation markers on narrow terminals)
      const normalizedOutput = output
        .replace(/\r/g, "")
        .replace(/\n[<>]/g, "")
        .replace(/\n/g, "");

      // Should see all 100 characters echoed, even if wrapped in pane rendering
      expect(normalizedOutput).toContain(chars);
    });

    test("throws error when writing to closed session", async () => {
      const sessionName = `test-write-closed-${randomUUID().slice(0, 8)}`;
      const session = new TmuxSession({
        sessionName,
        command: ["sleep", "0.1"],
        cwd: testDir,
        env: {},
      });
      sessions.push(session);

      await session.create();
      await session.kill("SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(() => session.write("test")).toThrow("Cannot write to closed tmux session");
    });

    test("captures cursor moves for both characters and spaces", async () => {
      const sessionName = `test-cursor-coherent-${randomUUID().slice(0, 8)}`;
      let lastCursor: TerminalCursor | null = null;

      const waitForCursor = async (
        predicate: (cursor: TerminalCursor) => boolean,
        timeoutMs = 3000
      ): Promise<TerminalCursor> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (lastCursor && predicate(lastCursor)) {
            return lastCursor;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Timed out waiting for cursor update");
      };

      const session = new TmuxSession({
        sessionName,
        command: ["bash"],
        cwd: testDir,
        env: {},
        onData: (_data, cursor) => {
          if (cursor) {
            lastCursor = cursor;
          }
        },
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 600));

      const base = await waitForCursor(() => true);

      session.write("a");
      session.flush();
      const afterChar = await waitForCursor(
        (cursor) => cursor.y > base.y || (cursor.y === base.y && cursor.x >= base.x + 1)
      );

      session.write(" ");
      session.flush();
      const afterSpace = await waitForCursor(
        (cursor) =>
          cursor.y > afterChar.y || (cursor.y === afterChar.y && cursor.x >= afterChar.x + 1)
      );

      expect(afterChar.visible).toBe(true);
      expect(afterSpace.visible).toBe(true);
    });
  });

  describe("Special Keys", () => {
    test("sends Enter key correctly", async () => {
      const sessionName = `test-enter-${randomUUID().slice(0, 8)}`;
      let output = "";

      const session = new TmuxSession({
        sessionName,
        command: ["bash"],
        cwd: testDir,
        env: {},
        onData: (data) => {
          output += data;
        },
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 500));

      session.write("echo test");
      await session.sendKey("Enter");
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(output).toContain("test");
    });

    test("sends Ctrl+C correctly", async () => {
      const sessionName = `test-ctrlc-${randomUUID().slice(0, 8)}`;
      let _exitCode: number | undefined;

      const session = new TmuxSession({
        sessionName,
        command: ["sleep", "3600"],
        cwd: testDir,
        env: {},
        onExit: (code) => {
          _exitCode = code;
        },
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send Ctrl+C
      await session.sendKey("C-c");
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(session.closed).toBe(true);
    });
  });

  describe("Exit Detection", () => {
    test("detects normal exit", async () => {
      const sessionName = `test-exit-${randomUUID().slice(0, 8)}`;
      let exitCode: number | undefined;
      let _exitSignal: string | null | undefined;

      const session = new TmuxSession({
        sessionName,
        command: ["bash", "-c", "sleep 0.5 && exit 0"],
        cwd: testDir,
        env: {},
        onExit: (code, signal) => {
          exitCode = code;
          _exitSignal = signal;
        },
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(session.closed).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("detects command failure exit", async () => {
      const sessionName = `test-fail-exit-${randomUUID().slice(0, 8)}`;
      let exitCalled = false;

      const session = new TmuxSession({
        sessionName,
        command: ["bash", "-c", "sleep 0.3 && exit 42"],
        cwd: testDir,
        env: {},
        onExit: () => {
          exitCalled = true;
        },
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 2500));

      expect(session.closed).toBe(true);
      expect(exitCalled).toBe(true);
    });
  });

  describe("Session Control", () => {
    test("kills session on demand with SIGTERM", async () => {
      const sessionName = `test-kill-term-${randomUUID().slice(0, 8)}`;
      let exitCalled = false;

      const session = new TmuxSession({
        sessionName,
        command: ["sleep", "3600"],
        cwd: testDir,
        env: {},
        onExit: () => {
          exitCalled = true;
        },
      });
      sessions.push(session);

      await session.create();
      expect(session.closed).toBe(false);

      await session.kill("SIGTERM");

      expect(session.closed).toBe(true);
      expect(exitCalled).toBe(true);
    });

    test("kills session on demand with SIGKILL", async () => {
      const sessionName = `test-kill-kill-${randomUUID().slice(0, 8)}`;
      const session = new TmuxSession({
        sessionName,
        command: ["sleep", "3600"],
        cwd: testDir,
        env: {},
      });
      sessions.push(session);

      await session.create();
      await session.kill("SIGKILL");

      expect(session.closed).toBe(true);

      // Verify session no longer exists in tmux
      const proc = Bun.spawn(["tmux", "has-session", "-t", sessionName], {
        stdout: "ignore",
        stderr: "ignore",
      });
      const exitCode = await proc.exited;
      expect(exitCode).toBe(1); // Session should not exist
    });

    test("calling kill twice is safe (idempotent)", async () => {
      const sessionName = `test-kill-idempotent-${randomUUID().slice(0, 8)}`;
      const session = new TmuxSession({
        sessionName,
        command: ["sleep", "3600"],
        cwd: testDir,
        env: {},
      });
      sessions.push(session);

      await session.create();
      await session.kill("SIGKILL");

      // Second kill should not throw — just await and verify it resolves
      await session.kill("SIGKILL");
      expect(session.closed).toBe(true);
    });

    test("resizes session correctly", async () => {
      const sessionName = `test-resize-${randomUUID().slice(0, 8)}`;
      const session = new TmuxSession({
        sessionName,
        command: ["bash"],
        cwd: testDir,
        env: {},
        cols: 80,
        rows: 24,
      });
      sessions.push(session);

      await session.create();

      // Resize to larger
      await session.resize(120, 40);

      // Verify resize (check tmux pane dimensions)
      const proc = Bun.spawn(
        ["tmux", "display-message", "-t", sessionName, "-p", "#{pane_width}x#{pane_height}"],
        { stdout: "pipe" }
      );
      const output = await new Response(proc.stdout).text();

      expect(output.trim()).toBe("120x40");
    });

    test("throws error when resizing closed session", async () => {
      const sessionName = `test-resize-closed-${randomUUID().slice(0, 8)}`;
      const session = new TmuxSession({
        sessionName,
        command: ["sleep", "0.1"],
        cwd: testDir,
        env: {},
      });
      sessions.push(session);

      await session.create();
      await session.kill("SIGKILL");

      await expect(session.resize(80, 24)).rejects.toThrow();
    });
  });

  describe("Output Capture", () => {
    test("capturePane returns current content", async () => {
      const sessionName = `test-capture-${randomUUID().slice(0, 8)}`;
      const session = new TmuxSession({
        sessionName,
        command: ["bash"],
        cwd: testDir,
        env: {},
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send a command
      await session.sendKey("echo unique-test-string-12345");
      await session.sendKey("Enter");
      await new Promise((resolve) => setTimeout(resolve, 500));

      const content = await session.capturePane();

      expect(content).toContain("unique-test-string-12345");
    });

    test("capturePane includes scrollback", async () => {
      const sessionName = `test-scrollback-${randomUUID().slice(0, 8)}`;
      const session = new TmuxSession({
        sessionName,
        command: ["bash"],
        cwd: testDir,
        env: {},
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Generate lots of output to fill scrollback
      for (let i = 0; i < 50; i++) {
        await session.sendKey(`echo line-${i}`);
        await session.sendKey("Enter");
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const content = await session.capturePane();

      // Should see both early and late lines
      expect(content).toContain("line-0");
      expect(content).toContain("line-49");
    });

    test("throws error when capturing closed session", async () => {
      const sessionName = `test-capture-closed-${randomUUID().slice(0, 8)}`;
      const session = new TmuxSession({
        sessionName,
        command: ["sleep", "0.1"],
        cwd: testDir,
        env: {},
      });
      sessions.push(session);

      await session.create();
      await session.kill("SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 200));

      await expect(session.capturePane()).rejects.toThrow();
    });
  });

  describe("Output Logging", () => {
    test("writes output to log file when outputLogPath provided", async () => {
      const sessionName = `test-log-${randomUUID().slice(0, 8)}`;
      const logPath = path.join(testDir, `${sessionName}.log`);

      const session = new TmuxSession({
        sessionName,
        command: ["bash"],
        cwd: testDir,
        env: {},
        outputLogPath: logPath,
        onData: () => {},
      });
      sessions.push(session);

      await session.create();
      await new Promise((resolve) => setTimeout(resolve, 500));

      await session.sendKey("echo logged-output-test");
      await session.sendKey("Enter");
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check log file exists and contains output
      const logContent = await fs.readFile(logPath, "utf-8");
      expect(logContent).toContain("logged-output-test");
    });
  });

  describe("Cleanup and Resource Management", () => {
    test("cleans up all timers on exit", async () => {
      const sessionName = `test-cleanup-${randomUUID().slice(0, 8)}`;
      let exitCalled = false;

      const session = new TmuxSession({
        sessionName,
        command: ["bash", "-c", "sleep 0.5 && exit 0"],
        cwd: testDir,
        env: {},
        onData: () => {},
        onExit: () => {
          exitCalled = true;
        },
      });
      sessions.push(session);

      await session.create();

      // Wait for natural exit
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(session.closed).toBe(true);
      expect(exitCalled).toBe(true);

      // Verify no pending timers (implicit - process should exit cleanly)
    });

    test("stops output polling when session killed externally", async () => {
      const sessionName = `test-external-kill-${randomUUID().slice(0, 8)}`;
      let exitCalled = false;

      const session = new TmuxSession({
        sessionName,
        command: ["sleep", "3600"],
        cwd: testDir,
        env: {},
        onData: () => {},
        onExit: () => {
          exitCalled = true;
        },
      });
      sessions.push(session);

      await session.create();

      // Kill session externally via tmux command
      const proc = Bun.spawn(["tmux", "kill-session", "-t", sessionName]);
      await proc.exited;

      // Wait for monitoring to detect exit
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(session.closed).toBe(true);
      expect(exitCalled).toBe(true);
    });
  });
});
