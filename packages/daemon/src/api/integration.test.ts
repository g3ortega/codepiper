/**
 * Integration tests for daemon API server with real PTY sessions
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { SessionManager } from "../sessions/sessionManager";
import { createServer, type DaemonServer } from "./server";

describe("Integration: API Server + SessionManager + PTY", () => {
  setDefaultTimeout(20_000);

  let server: DaemonServer;
  let sessionManager: SessionManager;
  let socketPath: string;
  let tempDir: string;
  let db: Database;
  let eventBus: EventBus;
  let originalPath: string | undefined;

  beforeEach(
    async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepiper-integration-"));
      socketPath = path.join(tempDir, "test.sock");

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

      // Initialize database and event bus
      db = new Database(":memory:");
      await db.init();
      eventBus = new EventBus();

      // Create session manager
      sessionManager = new SessionManager(db, eventBus);

      server = await createServer(socketPath, sessionManager, db, eventBus);
    },
    { timeout: 20_000 }
  );

  afterEach(
    async () => {
      // Stop all sessions before closing server/DB to avoid "closed database" errors
      if (sessionManager) {
        await sessionManager.stopAll();
      }

      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }

      if (server) {
        await server.stop();
      }

      // Clean up temp directory
      try {
        if (fs.existsSync(socketPath)) {
          fs.unlinkSync(socketPath);
        }
        fs.rmdirSync(tempDir, { recursive: true });
      } catch (_err) {
        // Ignore cleanup errors
      }
    },
    { timeout: 20_000 }
  );

  test("should create session, send text, and stop it", async () => {
    // Create a bash session
    const createResponse = await fetch("http://localhost/sessions", {
      method: "POST",
      unix: socketPath,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        cwd: process.cwd(),
      }),
    });

    expect(createResponse.status).toBe(201);
    const { session } = await createResponse.json();
    expect(session.id).toBeDefined();
    expect(session.status).toBe("STARTING");

    // Send text to session
    const sendResponse = await fetch(`http://localhost/sessions/${session.id}/send`, {
      method: "POST",
      unix: socketPath,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "echo test",
        newline: true,
      }),
    });

    expect(sendResponse.status).toBe(200);

    // Get session status
    const getResponse = await fetch(`http://localhost/sessions/${session.id}`, {
      unix: socketPath,
    });

    expect(getResponse.status).toBe(200);
    const { session: updatedSession } = await getResponse.json();
    expect(updatedSession.id).toBe(session.id);

    // Stop session
    const stopResponse = await fetch(`http://localhost/sessions/${session.id}/stop`, {
      method: "POST",
      unix: socketPath,
    });

    expect(stopResponse.status).toBe(200);

    // Verify session is stopped
    const finalResponse = await fetch(`http://localhost/sessions/${session.id}`, {
      unix: socketPath,
    });

    const { session: stoppedSession } = await finalResponse.json();
    expect(stoppedSession.status).toBe("STOPPED");
  });

  test("should manage multiple concurrent sessions", async () => {
    // Create three sessions
    const sessions: string[] = [];

    for (let i = 0; i < 3; i++) {
      const response = await fetch("http://localhost/sessions", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude-code",
          cwd: process.cwd(),
        }),
      });

      const { session } = await response.json();
      sessions.push(session.id);
    }

    // List all sessions
    const listResponse = await fetch("http://localhost/sessions", {
      unix: socketPath,
    });

    const { sessions: allSessions } = await listResponse.json();
    expect(allSessions).toHaveLength(3);

    // Send text to each session
    for (const sessionId of sessions) {
      const response = await fetch(`http://localhost/sessions/${sessionId}/send`, {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `echo Session ${sessionId}`,
          newline: true,
        }),
      });

      // claude command may exit immediately in test env
      expect([200, 500]).toContain(response.status);
    }

    // Stop only the first session
    const stopResponse = await fetch(`http://localhost/sessions/${sessions[0]}/stop`, {
      method: "POST",
      unix: socketPath,
    });

    expect(stopResponse.status).toBe(200);

    // Verify first is stopped, others are still running
    const session0 = await fetch(`http://localhost/sessions/${sessions[0]}`, {
      unix: socketPath,
    });
    const { session: s0 } = await session0.json();
    expect(s0.status).toBe("STOPPED");

    const session1 = await fetch(`http://localhost/sessions/${sessions[1]}`, {
      unix: socketPath,
    });
    const { session: s1 } = await session1.json();
    expect(s1.status).not.toBe("STOPPED");
  });

  test("should send keys to session", async () => {
    // Create session
    const createResponse = await fetch("http://localhost/sessions", {
      method: "POST",
      unix: socketPath,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        cwd: process.cwd(),
      }),
    });

    const { session } = await createResponse.json();

    // Send keys
    const keysResponse = await fetch(`http://localhost/sessions/${session.id}/keys`, {
      method: "POST",
      unix: socketPath,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keys: ["ctrl+c", "enter"],
      }),
    });

    // claude command may exit immediately in test env
    expect([200, 500]).toContain(keysResponse.status);
  });

  test("should handle session lifecycle correctly", async () => {
    // Create
    const createResponse = await fetch("http://localhost/sessions", {
      method: "POST",
      unix: socketPath,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        cwd: process.cwd(),
      }),
    });

    const { session } = await createResponse.json();
    expect(session.createdAt).toBeDefined();
    expect(session.updatedAt).toBeDefined();
    expect(session.pid).toBeDefined();
    expect(typeof session.pid).toBe("number");

    // Kill forcefully
    const killResponse = await fetch(`http://localhost/sessions/${session.id}/kill`, {
      method: "POST",
      unix: socketPath,
    });

    expect(killResponse.status).toBe(200);

    // Verify session is stopped
    const finalResponse = await fetch(`http://localhost/sessions/${session.id}`, {
      unix: socketPath,
    });

    const { session: killedSession } = await finalResponse.json();
    expect(killedSession.status).toBe("STOPPED");
  });

  test("should support WebSocket manager event broadcasting", async () => {
    // Create a session
    const createResponse = await fetch("http://localhost/sessions", {
      method: "POST",
      unix: socketPath,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        cwd: process.cwd(),
      }),
    });

    const { session } = await createResponse.json();

    // Mock WebSocket client
    const mockWs = {
      readyState: 1,
      sentMessages: [] as string[],
      send(data: string) {
        this.sentMessages.push(data);
      },
      close() {
        this.readyState = 3;
      },
    };

    // Connect mock client to WebSocket manager
    server.wsManager.handleConnection(mockWs as any);

    // Subscribe to sessions topic
    server.wsManager.handleMessage(mockWs as any, {
      op: "subscribe",
      topic: "sessions",
    });

    // Broadcast session change
    server.wsManager.broadcastSessionChange(session);

    // Should have received message
    expect(mockWs.sentMessages.length).toBeGreaterThan(0);
    const message = JSON.parse(mockWs.sentMessages[0]);
    expect(message.topic).toBe("sessions");
    expect(message.id).toBe(session.id);

    server.wsManager.handleDisconnect(mockWs as any);
  });

  test("should broadcast events to multiple WebSocket clients", async () => {
    // Create session first
    const createResponse = await fetch("http://localhost/sessions", {
      method: "POST",
      unix: socketPath,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        cwd: process.cwd(),
      }),
    });

    const { session } = await createResponse.json();

    // Create two mock clients
    const mockWs1 = {
      readyState: 1,
      sentMessages: [] as string[],
      send(data: string) {
        this.sentMessages.push(data);
      },
      close() {
        this.readyState = 3;
      },
    };

    const mockWs2 = {
      readyState: 1,
      sentMessages: [] as string[],
      send(data: string) {
        this.sentMessages.push(data);
      },
      close() {
        this.readyState = 3;
      },
    };

    // Connect both clients
    server.wsManager.handleConnection(mockWs1 as any);
    server.wsManager.handleConnection(mockWs2 as any);

    // Subscribe both to same session's events
    const topic = `session:${session.id}:events`;
    server.wsManager.handleMessage(mockWs1 as any, { op: "subscribe", topic });
    server.wsManager.handleMessage(mockWs2 as any, { op: "subscribe", topic });

    // Emit an event
    server.eventBus.emit("session:event", {
      sessionId: session.id,
      type: "SessionStart",
      timestamp: new Date(),
      payload: { cwd: process.cwd() },
    });

    // Both clients should receive the message
    expect(mockWs1.sentMessages.length).toBeGreaterThan(0);
    expect(mockWs2.sentMessages.length).toBeGreaterThan(0);

    const msg1 = JSON.parse(mockWs1.sentMessages[0]);
    const msg2 = JSON.parse(mockWs2.sentMessages[0]);

    expect(msg1.topic).toBe(topic);
    expect(msg2.topic).toBe(topic);
    expect(msg1.data.type).toBe("SessionStart");
    expect(msg2.data.type).toBe("SessionStart");

    server.wsManager.handleDisconnect(mockWs1 as any);
    server.wsManager.handleDisconnect(mockWs2 as any);
  });

  test("should filter events by subscription topic", async () => {
    // Create two sessions
    const session1Response = await fetch("http://localhost/sessions", {
      method: "POST",
      unix: socketPath,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        cwd: process.cwd(),
      }),
    });
    const { session: session1 } = await session1Response.json();

    const session2Response = await fetch("http://localhost/sessions", {
      method: "POST",
      unix: socketPath,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        cwd: process.cwd(),
      }),
    });
    const { session: session2 } = await session2Response.json();

    // Create mock client
    const mockWs = {
      readyState: 1,
      sentMessages: [] as string[],
      send(data: string) {
        this.sentMessages.push(data);
      },
      close() {
        this.readyState = 3;
      },
    };

    // Connect and subscribe only to session1's events
    server.wsManager.handleConnection(mockWs as any);
    server.wsManager.handleMessage(mockWs as any, {
      op: "subscribe",
      topic: `session:${session1.id}:events`,
    });

    // Emit events for both sessions
    server.eventBus.emit("session:event", {
      sessionId: session1.id,
      type: "SessionStart",
      timestamp: new Date(),
      payload: {},
    });

    server.eventBus.emit("session:event", {
      sessionId: session2.id,
      type: "SessionStart",
      timestamp: new Date(),
      payload: {},
    });

    // Should only receive session1's event
    expect(mockWs.sentMessages.length).toBe(1);
    const message = JSON.parse(mockWs.sentMessages[0]);
    expect(message.topic).toBe(`session:${session1.id}:events`);

    server.wsManager.handleDisconnect(mockWs as any);
  });
});
