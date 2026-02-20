import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderEvent, StartSessionOptions } from "@codepiper/core";
import { ClaudeCodeProvider } from "./provider";

describe("ClaudeCodeProvider", () => {
  let provider: ClaudeCodeProvider;
  let tempDir: string;

  beforeEach(async () => {
    provider = new ClaudeCodeProvider();
    tempDir = await mkdtemp(join(tmpdir(), "codepiper-provider-test-"));
  });

  afterEach(async () => {
    // Clean up any active sessions
    const sessions = provider.getSessions();
    for (const sessionId of sessions) {
      try {
        await provider.stopSession(sessionId);
      } catch (_error) {
        // Ignore cleanup errors
      }
    }

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("provider interface", () => {
    it("should have correct provider id", () => {
      expect(provider.id).toBe("claude-code");
    });

    it("should implement all provider methods", () => {
      expect(typeof provider.startSession).toBe("function");
      expect(typeof provider.sendText).toBe("function");
      expect(typeof provider.sendKeys).toBe("function");
      expect(typeof provider.stopSession).toBe("function");
      expect(typeof provider.onEvent).toBe("function");
    });
  });

  describe("startSession", () => {
    it("should scrub ANTHROPIC_API_KEY in subscription mode (default)", async () => {
      const sessionId = "test-session-scrub-key";
      const options: StartSessionOptions = {
        id: sessionId,
        cwd: tempDir,
        env: {
          PATH: process.env.PATH || "",
          ANTHROPIC_API_KEY: "should-be-removed",
          OTHER_VAR: "should-remain",
        },
      };

      const originalSpawn = Bun.spawn;
      let capturedEnv: Record<string, string> | undefined;

      try {
        // @ts-expect-error - mock for testing
        Bun.spawn = (cmd: string[], opts: any) => {
          capturedEnv = opts.env;
          throw new Error("Test mock - preventing actual spawn");
        };

        try {
          await provider.startSession(options);
        } catch (_error) {
          // Expected to fail with our mock
        }

        expect(capturedEnv).toBeDefined();
        expect(capturedEnv?.ANTHROPIC_API_KEY).toBeUndefined();
        expect(capturedEnv?.OTHER_VAR).toBe("should-remain");
      } finally {
        Bun.spawn = originalSpawn;
      }
    });

    it("should preserve ANTHROPIC_API_KEY in api billing mode", async () => {
      const sessionId = "test-session-api-mode";
      const options: StartSessionOptions = {
        id: sessionId,
        cwd: tempDir,
        env: {
          PATH: process.env.PATH || "",
          ANTHROPIC_API_KEY: "my-api-key",
          OTHER_VAR: "should-remain",
        },
        billingMode: "api",
      };

      const originalSpawn = Bun.spawn;
      let capturedEnv: Record<string, string> | undefined;

      try {
        // @ts-expect-error - mock for testing
        Bun.spawn = (cmd: string[], opts: any) => {
          capturedEnv = opts.env;
          throw new Error("Test mock - preventing actual spawn");
        };

        try {
          await provider.startSession(options);
        } catch (_error) {
          // Expected to fail with our mock
        }

        expect(capturedEnv).toBeDefined();
        expect(capturedEnv?.ANTHROPIC_API_KEY).toBe("my-api-key");
        expect(capturedEnv?.OTHER_VAR).toBe("should-remain");
      } finally {
        Bun.spawn = originalSpawn;
      }
    });

    it("should pass --session-id flag to claude command", async () => {
      const sessionId = "test-session-flag";
      const options: StartSessionOptions = {
        id: sessionId,
        cwd: tempDir,
        env: { PATH: process.env.PATH || "" },
      };

      const originalSpawn = Bun.spawn;
      let capturedCmd: string[] | undefined;

      try {
        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          capturedCmd = cmd;
          throw new Error("Test mock");
        };

        try {
          await provider.startSession(options);
        } catch (_error) {
          // Expected
        }

        expect(capturedCmd).toBeDefined();
        expect(capturedCmd).toContain("--session-id");
        expect(capturedCmd).toContain(sessionId);
      } finally {
        Bun.spawn = originalSpawn;
      }
    });

    it("should pass --settings flag with overlay settings path", async () => {
      const sessionId = "test-session-settings";
      const options: StartSessionOptions = {
        id: sessionId,
        cwd: tempDir,
        env: { PATH: process.env.PATH || "" },
      };

      const originalSpawn = Bun.spawn;
      let capturedCmd: string[] | undefined;

      try {
        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          capturedCmd = cmd;
          throw new Error("Test mock");
        };

        try {
          await provider.startSession(options);
        } catch (_error) {
          // Expected
        }

        expect(capturedCmd).toBeDefined();
        expect(capturedCmd).toContain("--settings");

        // Should have a settings path after --settings flag
        const settingsIndex = capturedCmd?.indexOf("--settings");
        expect(settingsIndex).toBeGreaterThanOrEqual(0);
        expect(capturedCmd?.[settingsIndex + 1]).toBeDefined();
        expect(capturedCmd?.[settingsIndex + 1]).toContain(sessionId);
      } finally {
        Bun.spawn = originalSpawn;
      }
    });

    it("should use claude command by default", async () => {
      const sessionId = "test-session-cmd";
      const options: StartSessionOptions = {
        id: sessionId,
        cwd: tempDir,
        env: { PATH: process.env.PATH || "" },
      };

      const originalSpawn = Bun.spawn;
      let capturedCmd: string[] | undefined;

      try {
        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          capturedCmd = cmd;
          throw new Error("Test mock");
        };

        try {
          await provider.startSession(options);
        } catch (_error) {
          // Expected
        }

        expect(capturedCmd).toBeDefined();
        expect(capturedCmd?.[0]).toBe("claude");
      } finally {
        Bun.spawn = originalSpawn;
      }
    });

    it("should pass additional args if provided", async () => {
      const sessionId = "test-session-args";
      const options: StartSessionOptions = {
        id: sessionId,
        cwd: tempDir,
        env: { PATH: process.env.PATH || "" },
        args: ["--verbose", "--max-tokens", "1000"],
      };

      const originalSpawn = Bun.spawn;
      let capturedCmd: string[] | undefined;

      try {
        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          capturedCmd = cmd;
          throw new Error("Test mock");
        };

        try {
          await provider.startSession(options);
        } catch (_error) {
          // Expected
        }

        expect(capturedCmd).toBeDefined();
        expect(capturedCmd).toContain("--verbose");
        expect(capturedCmd).toContain("--max-tokens");
        expect(capturedCmd).toContain("1000");
      } finally {
        Bun.spawn = originalSpawn;
      }
    });

    it("should return session handle with correct fields", async () => {
      const sessionId = "test-session-handle";
      const options: StartSessionOptions = {
        id: sessionId,
        cwd: tempDir,
        env: { PATH: process.env.PATH || "" },
      };

      const originalSpawn = Bun.spawn;

      try {
        // Create a mock that returns a valid-looking process
        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          return {
            pid: 12345,
            terminal: {
              write: () => {},
              resize: () => {},
              setRawMode: () => {},
              close: () => {},
              closed: false,
              ref: () => {},
              unref: () => {},
            },
            kill: () => {},
            exited: new Promise(() => {}),
          };
        };

        const handle = await provider.startSession(options);

        expect(handle.id).toBe(sessionId);
        expect(handle.provider).toBe("claude-code");
        expect(handle.cwd).toBe(tempDir);
        expect(handle.status).toBe("STARTING");
        expect(handle.pid).toBe(12345);
        expect(handle.createdAt).toBeInstanceOf(Date);
        expect(handle.updatedAt).toBeInstanceOf(Date);
      } finally {
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("sendText", () => {
    it("should throw error for non-existent session", async () => {
      await expect(provider.sendText("non-existent", "test")).rejects.toThrow();
    });

    it("should write text to PTY process", async () => {
      // We'll test with a mock session
      const sessionId = "test-session-text";
      const originalSpawn = Bun.spawn;
      const writtenData: string[] = [];

      try {
        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          return {
            pid: 12345,
            terminal: {
              write: (data: string) => {
                writtenData.push(data);
              },
              resize: () => {},
              setRawMode: () => {},
              close: () => {},
              closed: false,
              ref: () => {},
              unref: () => {},
            },
            kill: () => {},
            exited: new Promise(() => {}),
          };
        };

        await provider.startSession({
          id: sessionId,
          cwd: tempDir,
          env: { PATH: process.env.PATH || "" },
        });

        await provider.sendText(sessionId, "hello world");

        expect(writtenData.length).toBeGreaterThan(0);
        expect(writtenData.join("")).toContain("hello world");
      } finally {
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("sendKeys", () => {
    it("should throw error for non-existent session", async () => {
      await expect(provider.sendKeys("non-existent", ["enter"])).rejects.toThrow();
    });

    it("should translate key names to control sequences", async () => {
      const sessionId = "test-session-keys";
      const originalSpawn = Bun.spawn;
      const writtenData: string[] = [];

      try {
        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          return {
            pid: 12345,
            terminal: {
              write: (data: string) => {
                writtenData.push(data);
              },
              resize: () => {},
              setRawMode: () => {},
              close: () => {},
              closed: false,
              ref: () => {},
              unref: () => {},
            },
            kill: () => {},
            exited: new Promise(() => {}),
          };
        };

        await provider.startSession({
          id: sessionId,
          cwd: tempDir,
          env: { PATH: process.env.PATH || "" },
        });

        await provider.sendKeys(sessionId, ["enter", "ctrl+c", "tab"]);

        expect(writtenData.length).toBeGreaterThan(0);
        const allData = writtenData.join("");
        expect(allData).toContain("\r"); // enter
        expect(allData).toContain("\x03"); // ctrl+c
        expect(allData).toContain("\t"); // tab
      } finally {
        Bun.spawn = originalSpawn;
      }
    });

    it("should support arrow keys", async () => {
      const sessionId = "test-session-arrows";
      const originalSpawn = Bun.spawn;
      const writtenData: string[] = [];

      try {
        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          return {
            pid: 12345,
            terminal: {
              write: (data: string) => {
                writtenData.push(data);
              },
              resize: () => {},
              setRawMode: () => {},
              close: () => {},
              closed: false,
              ref: () => {},
              unref: () => {},
            },
            kill: () => {},
            exited: new Promise(() => {}),
          };
        };

        await provider.startSession({
          id: sessionId,
          cwd: tempDir,
          env: { PATH: process.env.PATH || "" },
        });

        await provider.sendKeys(sessionId, ["up", "down", "left", "right"]);

        const allData = writtenData.join("");
        expect(allData).toContain("\x1b[A"); // up
        expect(allData).toContain("\x1b[B"); // down
        expect(allData).toContain("\x1b[D"); // left
        expect(allData).toContain("\x1b[C"); // right
      } finally {
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("stopSession", () => {
    it("should throw error for non-existent session", async () => {
      await expect(provider.stopSession("non-existent")).rejects.toThrow();
    });

    it("should kill PTY process", async () => {
      const sessionId = "test-session-stop";
      const originalSpawn = Bun.spawn;
      let killCalled = false;

      try {
        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          return {
            pid: 12345,
            terminal: {
              write: () => {},
              resize: () => {},
              setRawMode: () => {},
              close: () => {
                killCalled = true;
              },
              closed: false,
              ref: () => {},
              unref: () => {},
            },
            kill: () => {
              killCalled = true;
            },
            exited: Promise.resolve(0),
          };
        };

        await provider.startSession({
          id: sessionId,
          cwd: tempDir,
          env: { PATH: process.env.PATH || "" },
        });

        await provider.stopSession(sessionId);

        expect(killCalled).toBe(true);
      } finally {
        Bun.spawn = originalSpawn;
      }
    });

    it("should remove session from active sessions", async () => {
      const sessionId = "test-session-remove";
      const originalSpawn = Bun.spawn;

      try {
        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          return {
            pid: 12345,
            terminal: {
              write: () => {},
              resize: () => {},
              setRawMode: () => {},
              close: () => {},
              closed: false,
              ref: () => {},
              unref: () => {},
            },
            kill: () => {},
            exited: Promise.resolve(0),
          };
        };

        await provider.startSession({
          id: sessionId,
          cwd: tempDir,
          env: { PATH: process.env.PATH || "" },
        });

        expect(provider.getSessions()).toContain(sessionId);

        await provider.stopSession(sessionId);

        expect(provider.getSessions()).not.toContain(sessionId);
      } finally {
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("onEvent", () => {
    it("should register event callback", () => {
      const callback = mock(() => {});

      provider.onEvent(callback);

      // Should not throw
      expect(callback).toBeDefined();
    });

    it("should emit PTY output events", async () => {
      const sessionId = "test-session-events";
      const originalSpawn = Bun.spawn;
      const events: ProviderEvent[] = [];
      let dataCallback: ((terminal: any, data: Uint8Array) => void) | undefined;

      provider.onEvent((evt) => {
        events.push(evt);
      });

      try {
        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          dataCallback = opts.terminal.data;
          return {
            pid: 12345,
            terminal: {
              write: () => {},
              resize: () => {},
              setRawMode: () => {},
              close: () => {},
              closed: false,
              ref: () => {},
              unref: () => {},
            },
            kill: () => {},
            exited: new Promise(() => {}),
          };
        };

        await provider.startSession({
          id: sessionId,
          cwd: tempDir,
          env: { PATH: process.env.PATH || "" },
        });

        // Simulate PTY output
        expect(dataCallback).toBeDefined();
        const testData = new TextEncoder().encode("test output");
        dataCallback?.(null as any, testData);

        // Wait a bit for event processing
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(events.length).toBeGreaterThan(0);
        const ptyEvent = events.find((e) => e.type === "pty_output");
        expect(ptyEvent).toBeDefined();
        expect(ptyEvent?.sessionId).toBe(sessionId);
      } finally {
        Bun.spawn = originalSpawn;
      }
    });

    it("should emit exit events", async () => {
      const sessionId = "test-session-exit";
      const originalSpawn = Bun.spawn;
      const events: ProviderEvent[] = [];
      let exitCallback: ((terminal: any, code: number, signal: string | null) => void) | undefined;

      provider.onEvent((evt) => {
        events.push(evt);
      });

      try {
        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          exitCallback = opts.terminal.exit;
          return {
            pid: 12345,
            terminal: {
              write: () => {},
              resize: () => {},
              setRawMode: () => {},
              close: () => {},
              closed: false,
              ref: () => {},
              unref: () => {},
            },
            kill: () => {},
            exited: new Promise(() => {}),
          };
        };

        await provider.startSession({
          id: sessionId,
          cwd: tempDir,
          env: { PATH: process.env.PATH || "" },
        });

        // Simulate process exit
        expect(exitCallback).toBeDefined();
        exitCallback?.(null as any, 0, null);

        // Wait for event processing
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(events.length).toBeGreaterThan(0);
        const exitEvent = events.find((e) => e.type === "pty_exit");
        expect(exitEvent).toBeDefined();
        expect(exitEvent?.sessionId).toBe(sessionId);
      } finally {
        Bun.spawn = originalSpawn;
      }
    });
  });

  describe("environment scrubbing", () => {
    it("should remove ANTHROPIC_API_KEY from parent env in subscription mode (default)", async () => {
      const sessionId = "test-session-parent-env";
      const originalEnv = process.env.ANTHROPIC_API_KEY;
      const originalSpawn = Bun.spawn;
      let capturedEnv: Record<string, string> | undefined;

      try {
        // Set API key in parent process
        process.env.ANTHROPIC_API_KEY = "parent-key";

        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          capturedEnv = opts.env;
          throw new Error("Test mock");
        };

        try {
          await provider.startSession({
            id: sessionId,
            cwd: tempDir,
            env: { ...process.env, PATH: process.env.PATH || "" },
            // billingMode omitted → defaults to "subscription"
          });
        } catch (_error) {
          // Expected
        }

        expect(capturedEnv).toBeDefined();
        expect(capturedEnv?.ANTHROPIC_API_KEY).toBeUndefined();
      } finally {
        if (originalEnv) {
          process.env.ANTHROPIC_API_KEY = originalEnv;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
        Bun.spawn = originalSpawn;
      }
    });

    it("should preserve ANTHROPIC_API_KEY from parent env in api mode", async () => {
      const sessionId = "test-session-parent-env-api";
      const originalEnv = process.env.ANTHROPIC_API_KEY;
      const originalSpawn = Bun.spawn;
      let capturedEnv: Record<string, string> | undefined;

      try {
        process.env.ANTHROPIC_API_KEY = "parent-key";

        // @ts-expect-error
        Bun.spawn = (cmd: string[], opts: any) => {
          capturedEnv = opts.env;
          throw new Error("Test mock");
        };

        try {
          await provider.startSession({
            id: sessionId,
            cwd: tempDir,
            env: { ...process.env, PATH: process.env.PATH || "" },
            billingMode: "api",
          });
        } catch (_error) {
          // Expected
        }

        expect(capturedEnv).toBeDefined();
        expect(capturedEnv?.ANTHROPIC_API_KEY).toBe("parent-key");
      } finally {
        if (originalEnv) {
          process.env.ANTHROPIC_API_KEY = originalEnv;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
        Bun.spawn = originalSpawn;
      }
    });
  });
});
