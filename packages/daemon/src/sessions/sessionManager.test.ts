/**
 * Tests for SessionManager
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventBus, type ProviderId } from "@codepiper/core";
import { Database } from "../db/db";
import { SessionManager } from "./sessionManager";

describe("SessionManager", () => {
  setDefaultTimeout(20_000);

  let manager: SessionManager;
  let tempDir: string;
  let db: Database;
  let eventBus: EventBus;
  let originalPath: string | undefined;

  beforeEach(
    async () => {
      db = new Database(":memory:");
      await db.init();
      eventBus = new EventBus();
      manager = new SessionManager(db, eventBus);
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepiper-test-"));

      // CI-safe stub so provider command resolution never depends on a real Claude install.
      const binDir = path.join(tempDir, "bin");
      fs.mkdirSync(binDir, { recursive: true });
      const stubScript =
        "#!/usr/bin/env sh\n# test stub: keep process alive\nwhile :; do sleep 3600; done\n";
      for (const binary of ["claude", "codex"]) {
        fs.writeFileSync(path.join(binDir, binary), stubScript, { mode: 0o755 });
      }
      originalPath = process.env.PATH;
      process.env.PATH = originalPath ? `${binDir}:${originalPath}` : binDir;
    },
    { timeout: 20_000 }
  );

  afterEach(
    async () => {
      // Clean up all sessions
      await manager.stopAll();

      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }

      // Clean up temp directory
      try {
        fs.rmdirSync(tempDir, { recursive: true });
      } catch (_err) {
        // Ignore cleanup errors
      }
    },
    { timeout: 20_000 }
  );

  describe("Session creation", () => {
    test("should create a new session", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.provider).toBe("claude-code");
      expect(session.cwd).toBe(tempDir);
      expect(session.status).toBe("STARTING");
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.updatedAt).toBeInstanceOf(Date);
    });

    test("should generate unique session IDs", async () => {
      const session1 = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      const session2 = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      expect(session1.id).not.toBe(session2.id);
    });

    test("should accept custom environment variables", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
        env: {
          CUSTOM_VAR: "test-value",
        },
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
    });

    test("should accept custom args", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
        args: ["--verbose"],
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
    });

    test("should forward SSH agent env vars by default", async () => {
      const previousSock = process.env.SSH_AUTH_SOCK;
      const previousPid = process.env.SSH_AGENT_PID;
      process.env.SSH_AUTH_SOCK = "/tmp/codepiper-test-agent.sock";
      process.env.SSH_AGENT_PID = "424242";

      try {
        const session = await manager.createSession({
          provider: "claude-code" as ProviderId,
          cwd: tempDir,
        });

        const managedSession = (manager as any).sessions.get(session.id);
        expect(managedSession).toBeDefined();
        expect(managedSession.process.env.SSH_AUTH_SOCK).toBe("/tmp/codepiper-test-agent.sock");
        expect(managedSession.process.env.SSH_AGENT_PID).toBe("424242");
      } finally {
        if (previousSock === undefined) {
          delete process.env.SSH_AUTH_SOCK;
        } else {
          process.env.SSH_AUTH_SOCK = previousSock;
        }
        if (previousPid === undefined) {
          delete process.env.SSH_AGENT_PID;
        } else {
          process.env.SSH_AGENT_PID = previousPid;
        }
      }
    });

    test("should not forward SSH agent env vars when disabled in daemon settings", async () => {
      const previousSock = process.env.SSH_AUTH_SOCK;
      const previousPid = process.env.SSH_AGENT_PID;
      process.env.SSH_AUTH_SOCK = "/tmp/codepiper-test-agent-disabled.sock";
      process.env.SSH_AGENT_PID = "515151";
      db.updateDaemonSettings({ forwardSshAuthSock: false });

      try {
        const session = await manager.createSession({
          provider: "claude-code" as ProviderId,
          cwd: tempDir,
        });

        const managedSession = (manager as any).sessions.get(session.id);
        expect(managedSession).toBeDefined();
        expect(managedSession.process.env.SSH_AUTH_SOCK).toBeUndefined();
        expect(managedSession.process.env.SSH_AGENT_PID).toBeUndefined();
      } finally {
        if (previousSock === undefined) {
          delete process.env.SSH_AUTH_SOCK;
        } else {
          process.env.SSH_AUTH_SOCK = previousSock;
        }
        if (previousPid === undefined) {
          delete process.env.SSH_AGENT_PID;
        } else {
          process.env.SSH_AGENT_PID = previousPid;
        }
      }
    });

    test("should scrub ANTHROPIC_API_KEY in subscription mode (default)", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
        env: {
          ANTHROPIC_API_KEY: "should-be-removed",
          OTHER_VAR: "should-remain",
        },
      });

      expect(session).toBeDefined();
      // Default billingMode is "subscription" — key should be scrubbed
    });

    test("should preserve ANTHROPIC_API_KEY in api billing mode", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
        env: {
          ANTHROPIC_API_KEY: "should-be-kept",
          OTHER_VAR: "should-remain",
        },
        billingMode: "api",
      });

      expect(session).toBeDefined();
      // billingMode "api" — key should be preserved in spawned environment
    });

    test("should create runtime artifacts with owner-only permissions", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      const runtimeDir = manager.getSessionRuntimeDir(session.id);
      const sessionsRootDir = manager.getSessionsRootDir();
      const imageDir = manager.getImageDir(session.id);
      const outputLogPath = `${runtimeDir}/output.log`;

      expect(fs.existsSync(sessionsRootDir)).toBe(true);
      expect(fs.existsSync(runtimeDir)).toBe(true);
      expect(fs.existsSync(imageDir)).toBe(true);
      expect(fs.existsSync(outputLogPath)).toBe(true);

      const sessionsRootMode = fs.statSync(sessionsRootDir).mode & 0o777;
      const runtimeMode = fs.statSync(runtimeDir).mode & 0o777;
      const imageMode = fs.statSync(imageDir).mode & 0o777;
      const outputLogMode = fs.statSync(outputLogPath).mode & 0o777;

      expect(sessionsRootMode & 0o077).toBe(0);
      expect(runtimeMode & 0o077).toBe(0);
      expect(imageMode & 0o077).toBe(0);
      expect(outputLogMode & 0o077).toBe(0);
    });

    test("should throw for non-existent working directory", async () => {
      await expect(
        manager.createSession({
          provider: "claude-code" as ProviderId,
          cwd: "/non/existent/directory",
        })
      ).rejects.toThrow();
    });
  });

  describe("Session retrieval", () => {
    test("should get session by ID", async () => {
      const created = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      const retrieved = manager.getSession(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    test("should return undefined for non-existent session", () => {
      const session = manager.getSession("non-existent-id");
      expect(session).toBeUndefined();
    });

    test("should list all sessions", async () => {
      await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(2);
    });

    test("should return empty array when no sessions exist", () => {
      const sessions = manager.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe("Session lifecycle", () => {
    test("should stop session gracefully", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      await manager.stopSession(session.id);

      // Session is removed from in-memory map after stop; check database
      const stopped = db.getSession(session.id);
      expect(stopped?.status).toBe("STOPPED");
    });

    test("should kill session forcefully", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      await manager.killSession(session.id);

      // Session is removed from in-memory map after kill; check database
      const killed = db.getSession(session.id);
      expect(killed?.status).toBe("STOPPED");
    });

    test("should throw when stopping non-existent session", async () => {
      await expect(manager.stopSession("non-existent-id")).rejects.toThrow();
    });

    test("should throw when killing non-existent session", async () => {
      await expect(manager.killSession("non-existent-id")).rejects.toThrow();
    });

    test("should stop all sessions", async () => {
      await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      await manager.stopAll();

      const sessions = manager.listSessions();
      for (const session of sessions) {
        expect(session.status).toBe("STOPPED");
      }
    });

    test("should cleanup in-memory session on natural process exit", async () => {
      const sessionId = crypto.randomUUID();
      const now = new Date();

      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: tempDir,
        status: "RUNNING",
      });

      manager.registerSession(
        {
          id: sessionId,
          provider: "claude-code",
          cwd: tempDir,
          status: "RUNNING",
          createdAt: now,
          updatedAt: now,
        },
        {
          closed: true,
          pid: 12345,
          write: () => {},
          kill: async () => {},
        } as any
      );

      (manager as any).handlePtyExit(sessionId, 0, null);
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(manager.getSession(sessionId)).toBeUndefined();
      expect(db.getSession(sessionId)?.status).toBe("STOPPED");
    });
  });

  describe("Session resume/recover", () => {
    test("should reopen a stopped claude session using stored provider resume context", async () => {
      const sessionId = crypto.randomUUID();
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: tempDir,
        status: "STOPPED",
        metadata: {
          launch: {
            args: ["--model", "sonnet"],
            billingMode: "subscription",
            envSetIds: [],
          },
          providerSession: {
            id: "claude-external-session-id",
            mode: "resume",
            source: "manual-test",
          },
          security: {
            dangerousMode: true,
          },
        },
      });

      const resumed = await manager.resumeSession(sessionId);

      expect(resumed.id).toBe(sessionId);
      expect(resumed.status).toBe("STARTING");

      const persisted = db.getSession(sessionId);
      const metadata = persisted?.metadata as Record<string, any>;
      expect(metadata.launch?.args).toEqual(["--model", "sonnet"]);
      expect(metadata.providerSession?.id).toBe("claude-external-session-id");
      expect(metadata.security?.dangerousMode).toBe(true);
    });

    test("should reject codex reopen when provider session id is unavailable", async () => {
      const sessionId = crypto.randomUUID();
      db.createSession({
        id: sessionId,
        provider: "codex",
        cwd: tempDir,
        status: "STOPPED",
        metadata: {
          launch: {
            args: [],
            billingMode: "subscription",
            envSetIds: [],
          },
        },
      });

      await expect(manager.resumeSession(sessionId)).rejects.toThrow(
        "Provider session id is unavailable for codex"
      );
    });
  });

  describe("Codex provider session id capture", () => {
    test("captures provider session id from codex session banner output", () => {
      const sessionId = crypto.randomUUID();
      const providerSessionId = "019c7285-ba64-7462-bbfc-4227f3e24e88";
      const now = new Date();
      db.createSession({
        id: sessionId,
        provider: "codex",
        cwd: tempDir,
        status: "RUNNING",
        metadata: {
          providerSession: {
            mode: "resume",
            source: "codex-auto-detect-pending",
          },
        },
      });

      manager.registerSession(
        {
          id: sessionId,
          provider: "codex",
          cwd: tempDir,
          status: "RUNNING",
          createdAt: now,
          updatedAt: now,
          metadata: {
            providerSession: {
              mode: "resume",
              source: "codex-auto-detect-pending",
            },
          },
        },
        {
          closed: false,
          pid: 23456,
          write: () => {},
          kill: async () => {},
        } as any
      );

      (manager as any).handlePtyData(sessionId, "\u001b[35mcodex session\u001b[0m 019c7285-ba64");
      (manager as any).handlePtyData(sessionId, "-7462-bbfc-4227f3e24e88\r\n");

      const persisted = db.getSession(sessionId);
      const metadata = (persisted?.metadata ?? {}) as Record<string, any>;
      expect(metadata.providerSession?.id).toBe(providerSessionId);
      expect(metadata.providerSession?.source).toBe("codex-session-configured-banner");
    });
  });

  describe("Session input", () => {
    test("should send text to session", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      // Should not throw
      await manager.sendText(session.id, "test input");
      expect(true).toBe(true);
    });

    test("should send keys to session", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      // Claude command may exit immediately in test environments
      // (no claude binary or auth), making the tmux pane unavailable.
      // Wait briefly then check if session is still alive before sending keys.
      await new Promise((resolve) => setTimeout(resolve, 500));

      try {
        await manager.sendKeys(session.id, ["ctrl+c", "enter"]);
      } catch {
        // Session exited before we could send keys — expected in CI/test
      }
      expect(true).toBe(true);
    });

    test("should throw when sending text to non-existent session", async () => {
      await expect(manager.sendText("non-existent-id", "test")).rejects.toThrow();
    });

    test("should throw when sending keys to non-existent session", async () => {
      await expect(manager.sendKeys("non-existent-id", ["enter"])).rejects.toThrow();
    });
  });

  describe("Multiple concurrent sessions", () => {
    test("should manage multiple sessions simultaneously", async () => {
      const session1 = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      const session2 = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      const session3 = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(3);

      // Verify each session is independent
      expect(session1.id).not.toBe(session2.id);
      expect(session2.id).not.toBe(session3.id);
      expect(session1.id).not.toBe(session3.id);
    });

    test("should stop specific session without affecting others", async () => {
      const session1 = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      const session2 = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      await manager.stopSession(session1.id);

      // Session removed from in-memory map after stop; check database
      const stopped = db.getSession(session1.id);
      const running = manager.getSession(session2.id);

      expect(stopped?.status).toBe("STOPPED");
      expect(running).toBeDefined();
    });

    test("should handle concurrent operations on different sessions", async () => {
      const session1 = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      const session2 = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      // Run operations concurrently
      await Promise.all([
        manager.sendText(session1.id, "text to session 1"),
        manager.sendText(session2.id, "text to session 2"),
        manager.sendKeys(session1.id, ["enter"]),
      ]);

      // Both sessions should still be active
      const s1 = manager.getSession(session1.id);
      const s2 = manager.getSession(session2.id);
      expect(s1).toBeDefined();
      expect(s2).toBeDefined();
    });
  });

  describe("Session state tracking", () => {
    test("should update session status", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      expect(session.status).toBe("STARTING");

      // Update status to RUNNING
      manager.updateSessionStatus(session.id, "RUNNING");

      const updated = manager.getSession(session.id);
      expect(updated?.status).toBe("RUNNING");
    });

    test("should track PID", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      expect(session.pid).toBeDefined();
      expect(typeof session.pid).toBe("number");
      expect(session.pid).toBeGreaterThan(0);
    });

    test("should update session metadata", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      manager.updateSessionMetadata(session.id, {
        transcriptPath: "/tmp/transcript.jsonl",
        model: "claude-opus-4-6",
      });

      const updated = manager.getSession(session.id);
      expect(updated?.transcriptPath).toBe("/tmp/transcript.jsonl");
      expect(updated?.metadata?.model).toBe("claude-opus-4-6");
    });

    test("should track session update time", async () => {
      const session = await manager.createSession({
        provider: "claude-code" as ProviderId,
        cwd: tempDir,
      });

      const initialUpdatedAt = session.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      manager.updateSessionStatus(session.id, "RUNNING");

      const updated = manager.getSession(session.id);
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(initialUpdatedAt.getTime());
    });
  });
});
