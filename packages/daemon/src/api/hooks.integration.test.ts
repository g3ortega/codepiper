/**
 * Integration tests for hooks endpoint
 *
 * Tests the full flow from HTTP request through database storage and event emission.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { SessionManager } from "../sessions/sessionManager";
import { createServer, type DaemonServer } from "./server";

describe("Hooks Integration", () => {
  let server: DaemonServer;
  let sessionManager: SessionManager;
  let socketPath: string;
  let tempDir: string;
  let sessionId: string;
  let hookSecret: string;
  let db: Database;
  let eventBus: EventBus;

  const hookHeaders = () => ({
    "Content-Type": "application/json",
    "X-CodePiper-Secret": hookSecret,
  });

  beforeEach(async () => {
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepiper-test-"));
    socketPath = path.join(tempDir, "test.sock");

    // Initialize database and event bus
    db = new Database(":memory:");
    await db.init();
    eventBus = new EventBus();

    // Create session manager
    sessionManager = new SessionManager(db, eventBus);

    // Start server (with in-memory database)
    server = await createServer(socketPath, sessionManager, db, eventBus);
    hookSecret = process.env.CODEPIPER_SECRET || "";

    // Create a test session in database
    sessionId = "test-session-123";
    server.db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: "/test/cwd",
      status: "STARTING",
    });
  });

  afterEach(async () => {
    // Stop all sessions before closing server/DB to avoid "closed database" errors
    if (sessionManager) {
      await sessionManager.stopAll();
    }
    if (server) {
      await server.stop();
    }

    try {
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
      fs.rmdirSync(tempDir);
    } catch (_err) {
      // Ignore cleanup errors
    }
  });

  describe("SessionStart event", () => {
    test("should handle SessionStart event end-to-end", async () => {
      // Send SessionStart hook event
      const response = await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "SessionStart",
          data: {
            session_id: sessionId,
            transcript_path: "/tmp/transcripts/test-session-123.jsonl",
            cwd: "/test/cwd",
            model: "claude-sonnet-4-5",
          },
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);

      // Verify session was updated in database
      const session = server.db.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.status).toBe("RUNNING");
      expect(session?.transcriptPath).toBe("/tmp/transcripts/test-session-123.jsonl");

      // Verify event was stored in database
      const events = server.db.getEventsBySessionId(sessionId);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("SessionStart");
      expect(events[0].source).toBe("hook");
      expect(events[0].payload).toHaveProperty("transcript_path");
    });
  });

  describe("Notification event", () => {
    test("should handle permission_prompt notification", async () => {
      const response = await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "Notification",
          data: {
            type: "permission_prompt",
            message: "Waiting for permission",
          },
        }),
      });

      expect(response.status).toBe(200);

      // Verify session status updated
      const session = server.db.getSession(sessionId);
      expect(session?.status).toBe("NEEDS_PERMISSION");

      // Verify event stored
      const events = server.db.getEventsBySessionId(sessionId);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("Notification");
    });

    test("creates session notification for permission_prompt when notifications are enabled", async () => {
      server.db.updateDaemonSettings({
        notificationsEnabled: true,
        notificationEventDefaults: {
          "session.permission_required": true,
        },
      });

      const response = await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "Notification",
          data: {
            type: "permission_prompt",
            message: "Waiting for permission",
          },
        }),
      });

      expect(response.status).toBe(200);

      const notifications = server.db.listSessionNotifications({ sessionId });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].eventType).toBe("session.permission_required");
      expect(notifications[0].title).toBe("Permission required");
      expect(notifications[0].body).toContain("permission approval");
      expect(notifications[0].readAt).toBeNull();
    });

    test("should handle idle_prompt notification", async () => {
      const response = await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "Notification",
          data: {
            type: "idle_prompt",
            message: "Waiting for input",
          },
        }),
      });

      expect(response.status).toBe(200);

      const session = server.db.getSession(sessionId);
      expect(session?.status).toBe("NEEDS_INPUT");
    });
  });

  describe("PermissionRequest event", () => {
    beforeEach(async () => {
      // Create a default policy that allows read operations
      server.db.createPolicy({
        id: "test-policy",
        name: "Test Policy",
        description: "Allow reads, deny writes",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [
          {
            id: "allow-reads",
            action: "allow",
            tool: "read",
            reason: "Read operations are safe",
          },
          {
            id: "deny-writes",
            action: "deny",
            tool: "write",
            reason: "Write operations denied",
          },
        ],
      });
    });

    test("should handle read permission request and allow it", async () => {
      const response = await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "PermissionRequest",
          data: {
            input: "Read file package.json",
            requestedPermissions: [
              {
                operation: "read",
                path: "/test/cwd/package.json",
              },
            ],
          },
        }),
      });

      expect(response.status).toBe(200);

      // Should return permission decision
      const decision = await response.json();
      expect(decision.allow).toBe(true);
      expect(decision.decision).toBe("allow");

      // Verify event stored with decision
      const events = server.db.getEventsBySessionId(sessionId);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("PermissionRequest");
      expect(events[0].payload).toHaveProperty("decision");
      expect((events[0].payload as any).decision.allow).toBe(true);
    });

    test("should handle write permission request and deny it", async () => {
      const response = await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "PermissionRequest",
          data: {
            input: "Write file test.txt",
            requestedPermissions: [
              {
                operation: "write",
                path: "/test/cwd/test.txt",
              },
            ],
          },
        }),
      });

      expect(response.status).toBe(200);

      const decision = await response.json();
      expect(decision.allow).toBe(false);
      expect(decision.decision).toBe("deny");
      expect(decision.message).toContain("denied");

      // Verify event stored with decision
      const events = server.db.getEventsBySessionId(sessionId);
      expect(events[0].payload).toHaveProperty("decision");
      expect((events[0].payload as any).decision.allow).toBe(false);
    });
  });

  describe("Stop event", () => {
    test("should handle Stop event", async () => {
      const response = await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "Stop",
          data: {
            reason: "turn_complete",
          },
        }),
      });

      expect(response.status).toBe(200);

      // Verify event stored
      const events = server.db.getEventsBySessionId(sessionId);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("Stop");
    });

    test("creates session notification for Stop when notifications are enabled", async () => {
      server.db.updateDaemonSettings({
        notificationsEnabled: true,
        notificationEventDefaults: {
          "session.turn_completed": true,
        },
      });

      const response = await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "Stop",
          data: {
            reason: "turn_complete",
          },
        }),
      });

      expect(response.status).toBe(200);

      const notifications = server.db.listSessionNotifications({ sessionId });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].eventType).toBe("session.turn_completed");
      expect(notifications[0].sourceEventId).toBeGreaterThan(0);
      expect(notifications[0].title).toBe("Turn completed");
      expect(notifications[0].body).toContain("ready for your next prompt");
      expect(notifications[0].readAt).toBeNull();

      const counts = server.db.getSessionNotificationCounts();
      expect(counts.totalUnread).toBe(1);
      expect(counts.bySession).toEqual({
        [sessionId]: 1,
      });
    });

    test("skips session notification for Stop when session is muted", async () => {
      server.db.updateDaemonSettings({
        notificationsEnabled: true,
        notificationEventDefaults: {
          "session.turn_completed": true,
        },
      });
      server.db.setSessionNotificationPrefs(sessionId, false);

      const response = await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "Stop",
          data: {
            reason: "turn_complete",
          },
        }),
      });

      expect(response.status).toBe(200);

      const notifications = server.db.listSessionNotifications({ sessionId });
      expect(notifications).toHaveLength(0);
      expect(server.db.getSessionNotificationCounts()).toEqual({
        totalUnread: 0,
        bySession: {},
      });
    });
  });

  describe("Event bus emission", () => {
    test("should emit events on event bus", async () => {
      let emittedEvent: any = null;

      // Subscribe to event bus
      server.eventBus.on("session:event", (event) => {
        emittedEvent = event;
      });

      // Send hook event
      await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "SessionStart",
          data: { session_id: sessionId },
        }),
      });

      // Give event bus time to emit
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify event was emitted
      expect(emittedEvent).not.toBeNull();
      expect(emittedEvent.sessionId).toBe(sessionId);
      expect(emittedEvent.type).toBe("SessionStart");
    });
  });

  describe("Error handling", () => {
    test("should return 404 for non-existent session", async () => {
      const response = await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId: "non-existent-session",
          event: "SessionStart",
          data: {},
        }),
      });

      expect(response.status).toBe(404);
      const error = await response.json();
      expect(error.error).toContain("Session not found");
    });

    test("should return 400 for invalid event type", async () => {
      const response = await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "InvalidEvent",
          data: {},
        }),
      });

      expect(response.status).toBe(400);
      const error = await response.json();
      expect(error.error).toContain("Unknown event type");
    });
  });

  describe("Multiple events flow", () => {
    test("should handle sequence of events correctly", async () => {
      // 1. SessionStart
      await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "SessionStart",
          data: { session_id: sessionId, transcript_path: "/tmp/test.jsonl" },
        }),
      });

      // 2. PermissionRequest
      await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "PermissionRequest",
          data: {
            input: "Read file",
            requestedPermissions: [{ operation: "read", path: "/test/file.txt" }],
          },
        }),
      });

      // 3. Notification
      await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "Notification",
          data: { type: "idle_prompt" },
        }),
      });

      // 4. Stop
      await fetch("http://localhost/hooks/claude", {
        unix: socketPath,
        method: "POST",
        headers: hookHeaders(),
        body: JSON.stringify({
          sessionId,
          event: "Stop",
          data: { reason: "turn_complete" },
        }),
      });

      // Verify all events stored in order
      const events = server.db.getEventsBySessionId(sessionId);
      expect(events.length).toBe(4);
      expect(events[0].type).toBe("SessionStart");
      expect(events[1].type).toBe("PermissionRequest");
      expect(events[2].type).toBe("Notification");
      expect(events[3].type).toBe("Stop");

      // Verify final session state
      const session = server.db.getSession(sessionId);
      expect(session?.status).toBe("NEEDS_INPUT");
      expect(session?.transcriptPath).toBe("/tmp/test.jsonl");
    });
  });
});
