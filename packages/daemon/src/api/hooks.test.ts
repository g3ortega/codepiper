/**
 * Tests for hooks ingestion endpoint
 *
 * This endpoint receives hook events from `codepiper hook-forward` command
 * and processes them according to the event type.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { EventBus } from "@codepiper/core";
import type { Database } from "../db/db";
import { type HookContext, handleHookEvent } from "./hooks";

// Mock dependencies
let mockDb: Database;
let mockEventBus: EventBus;
let ctx: HookContext;

describe("Hooks Ingestion", () => {
  beforeEach(() => {
    // Create mock database with spy methods
    mockDb = {
      getSession: mock(() => ({
        id: "test-session-123",
        provider: "claude-code" as const,
        cwd: "/test/cwd",
        status: "STARTING" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      updateSession: mock(() => {}),
      insertEvent: mock(() => 1),
      getDaemonSettings: mock(() => ({
        preserveSessions: false,
        defaultPolicyAction: "ask",
        forwardSshAuthSock: true,
        codexHostAccessProfileEnabled: false,
        terminalFeatures: {
          wsPtyPasteEnabled: true,
          latencyProbesEnabled: true,
          diagnosticsPanelEnabled: false,
          codexAppServerSpikeEnabled: false,
          wsPtyPasteCanaryPercent: 100,
          latencyProbesCanaryPercent: 100,
          diagnosticsPanelCanaryPercent: 0,
        },
        notificationsEnabled: false,
        systemNotificationsEnabled: false,
        notificationSoundsEnabled: true,
        notificationEventDefaults: {},
        notificationSoundMap: {},
        updatedAt: new Date(),
      })),
      getSessionNotificationPrefs: mock((sessionId: string) => ({
        sessionId,
        enabled: null,
        updatedAt: new Date(),
      })),
      insertSessionNotification: mock(() => 1),
      insertSessionNotificationWithStatus: mock(() => ({
        id: 1,
        inserted: true,
      })),
      getSessionNotificationCounts: mock(() => ({
        totalUnread: 1,
        bySession: { "test-session-123": 1 },
      })),
    } as any;

    // Create mock event bus
    mockEventBus = {
      emit: mock(() => {}),
    } as any;

    // Create context
    ctx = { db: mockDb, eventBus: mockEventBus };
  });

  afterEach(() => {
    mock.restore();
  });

  describe("POST /hooks/claude", () => {
    test("should reject request without session ID", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "SessionStart",
          data: {},
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("sessionId");
    });

    test("should reject request without event type", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("event");
    });

    test("should reject invalid JSON", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json {",
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(400);
    });

    test("should reject unknown event type", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "UnknownEvent",
          data: {},
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("Unknown event type");
    });

    test("should reject request for non-existent session", async () => {
      mockDb.getSession = mock(() => undefined);

      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "non-existent",
          event: "SessionStart",
          data: {},
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain("Session not found");
    });
  });

  describe("SessionStart event", () => {
    test("should process SessionStart event and update transcript path", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "SessionStart",
          data: {
            session_id: "test-session-123",
            transcript_path: "/tmp/transcripts/test-session-123.jsonl",
            cwd: "/test/cwd",
            model: "claude-sonnet-4-5",
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);

      // Should update session with transcript path
      expect(mockDb.updateSession).toHaveBeenCalledWith("test-session-123", {
        transcriptPath: "/tmp/transcripts/test-session-123.jsonl",
        status: "RUNNING",
      });

      // Should insert event into database
      expect(mockDb.insertEvent).toHaveBeenCalledWith({
        sessionId: "test-session-123",
        source: "hook",
        type: "SessionStart",
        payload: expect.any(Object),
      });

      // Should emit event on bus
      expect(mockEventBus.emit).toHaveBeenCalledWith("session:event", expect.any(Object));
    });

    test("should handle SessionStart without transcript path", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "SessionStart",
          data: {
            session_id: "test-session-123",
            cwd: "/test/cwd",
            model: "claude-sonnet-4-5",
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);

      // Should update session status but not transcript path
      expect(mockDb.updateSession).toHaveBeenCalledWith("test-session-123", {
        status: "RUNNING",
      });
    });

    test("should skip transcript tailer start when session is not actively managed", async () => {
      const setTranscriptPathMock = mock(async () => {});

      ctx.sessionManager = {
        getSession: mock(() => undefined),
        setTranscriptPath: setTranscriptPathMock,
      } as any;

      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "SessionStart",
          data: {
            transcript_path: "/tmp/transcripts/test-session-123.jsonl",
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);
      expect(setTranscriptPathMock).not.toHaveBeenCalled();
    });
  });

  describe("Notification event", () => {
    test("should process permission_prompt notification and set status to NEEDS_PERMISSION", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "Notification",
          data: {
            type: "permission_prompt",
            message: "Waiting for permission decision",
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);

      // Should update session status
      expect(mockDb.updateSession).toHaveBeenCalledWith("test-session-123", {
        status: "NEEDS_PERMISSION",
      });

      // Should insert event into database
      expect(mockDb.insertEvent).toHaveBeenCalled();

      // Should emit event on bus
      expect(mockEventBus.emit).toHaveBeenCalled();
    });

    test("should create session notification for permission_prompt when notifications are enabled", async () => {
      mockDb.insertEvent = mock(() => 42);
      mockDb.getDaemonSettings = mock(() => ({
        preserveSessions: false,
        defaultPolicyAction: "ask",
        forwardSshAuthSock: true,
        codexHostAccessProfileEnabled: false,
        terminalFeatures: {
          wsPtyPasteEnabled: true,
          latencyProbesEnabled: true,
          diagnosticsPanelEnabled: false,
          codexAppServerSpikeEnabled: false,
          wsPtyPasteCanaryPercent: 100,
          latencyProbesCanaryPercent: 100,
          diagnosticsPanelCanaryPercent: 0,
        },
        notificationsEnabled: true,
        systemNotificationsEnabled: false,
        notificationSoundsEnabled: true,
        notificationEventDefaults: {},
        notificationSoundMap: {},
        updatedAt: new Date(),
      }));

      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "Notification",
          data: {
            type: "permission_prompt",
            message: "Waiting for permission decision",
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);

      expect(mockDb.insertSessionNotificationWithStatus).toHaveBeenCalledWith({
        sessionId: "test-session-123",
        provider: "claude-code",
        eventType: "session.permission_required",
        sourceEventId: 42,
        title: "Permission required",
        body: "cwd is waiting for permission approval in Claude Code.",
        payload: {
          sessionId: "test-session-123",
          sessionLabel: "cwd",
          provider: "claude-code",
          hookEvent: "Notification",
          notificationType: "permission_prompt",
          message: "Waiting for permission decision",
        },
      });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "notification:created",
        expect.objectContaining({
          sessionId: "test-session-123",
          eventType: "session.permission_required",
          sourceEventId: 42,
        })
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith("notification:counts_updated", {
        totalUnread: 1,
        bySession: { "test-session-123": 1 },
      });
    });

    test("should process idle_prompt notification and set status to NEEDS_INPUT", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "Notification",
          data: {
            type: "idle_prompt",
            message: "Waiting for user input",
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);

      // Should update session status
      expect(mockDb.updateSession).toHaveBeenCalledWith("test-session-123", {
        status: "NEEDS_INPUT",
      });
    });

    test("should process auth_success notification without status change", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "Notification",
          data: {
            type: "auth_success",
            message: "Authentication successful",
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);

      // Should NOT update session status for auth_success
      expect(mockDb.updateSession).not.toHaveBeenCalled();

      // Should still insert event and emit
      expect(mockDb.insertEvent).toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalled();
    });
  });

  describe("PermissionRequest event", () => {
    test("should process PermissionRequest and return decision", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
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

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);

      const decision = await response.json();
      expect(decision).toHaveProperty("allow");
      expect(decision).toHaveProperty("decision");
      expect(typeof decision.allow).toBe("boolean");

      // Should insert event into database
      expect(mockDb.insertEvent).toHaveBeenCalled();

      // Should emit event on bus
      expect(mockEventBus.emit).toHaveBeenCalled();
    });

    test("should allow read operations by default", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "PermissionRequest",
          data: {
            input: "Read file README.md",
            requestedPermissions: [
              {
                operation: "read",
                path: "/test/cwd/README.md",
              },
            ],
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      const decision = await response.json();
      expect(decision.allow).toBe(true);
      expect(decision.decision).toBe("allow");
    });

    test("should deny write operations by default", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
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

      const response = await handleHookEvent(req, ctx);
      const decision = await response.json();
      expect(decision.allow).toBe(false);
      expect(decision.decision).toBe("deny");
      expect(decision.message).toContain("denied");
    });

    test("should handle multiple permissions in single request", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "PermissionRequest",
          data: {
            input: "Read multiple files",
            requestedPermissions: [
              { operation: "read", path: "/test/cwd/file1.txt" },
              { operation: "read", path: "/test/cwd/file2.txt" },
            ],
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      const decision = await response.json();
      expect(decision.allow).toBe(true);
      expect(decision.decision).toBe("allow");
    });

    test("should deny if any permission in request is write", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "PermissionRequest",
          data: {
            input: "Read and write files",
            requestedPermissions: [
              { operation: "read", path: "/test/cwd/file1.txt" },
              { operation: "write", path: "/test/cwd/file2.txt" },
            ],
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      const decision = await response.json();
      expect(decision.allow).toBe(false);
      expect(decision.decision).toBe("deny");
    });
  });

  describe("Stop event", () => {
    test("should process Stop event and mark turn completed", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "Stop",
          data: {
            reason: "turn_complete",
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);

      // Should insert event into database
      expect(mockDb.insertEvent).toHaveBeenCalledWith({
        sessionId: "test-session-123",
        source: "hook",
        type: "Stop",
        payload: expect.any(Object),
      });

      // Notifications are disabled by default.
      expect(mockDb.insertSessionNotificationWithStatus).not.toHaveBeenCalled();

      // Should emit event on bus
      expect(mockEventBus.emit).toHaveBeenCalled();

      // Could update session metadata to track last turn completion
      // This is optional for now
    });

    test("should create session notification for Stop when notifications are enabled", async () => {
      mockDb.insertEvent = mock(() => 42);
      mockDb.getDaemonSettings = mock(() => ({
        preserveSessions: false,
        defaultPolicyAction: "ask",
        forwardSshAuthSock: true,
        codexHostAccessProfileEnabled: false,
        terminalFeatures: {
          wsPtyPasteEnabled: true,
          latencyProbesEnabled: true,
          diagnosticsPanelEnabled: false,
          codexAppServerSpikeEnabled: false,
          wsPtyPasteCanaryPercent: 100,
          latencyProbesCanaryPercent: 100,
          diagnosticsPanelCanaryPercent: 0,
        },
        notificationsEnabled: true,
        systemNotificationsEnabled: false,
        notificationSoundsEnabled: true,
        notificationEventDefaults: {},
        notificationSoundMap: {},
        updatedAt: new Date(),
      }));

      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "Stop",
          data: {
            reason: "turn_complete",
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);

      expect(mockDb.insertSessionNotificationWithStatus).toHaveBeenCalledWith({
        sessionId: "test-session-123",
        provider: "claude-code",
        eventType: "session.turn_completed",
        sourceEventId: 42,
        title: "Turn completed",
        body: "cwd is ready for your next prompt.",
        payload: {
          sessionId: "test-session-123",
          sessionLabel: "cwd",
          provider: "claude-code",
          hookEvent: "Stop",
          reason: "turn_complete",
        },
      });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "notification:created",
        expect.objectContaining({
          sessionId: "test-session-123",
          eventType: "session.turn_completed",
          sourceEventId: 42,
        })
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith("notification:counts_updated", {
        totalUnread: 1,
        bySession: { "test-session-123": 1 },
      });
    });

    test("should prefer custom session name in Stop notification copy", async () => {
      mockDb.insertEvent = mock(() => 42);
      mockDb.getSession = mock(() => ({
        id: "test-session-123",
        provider: "claude-code",
        cwd: "/test/cwd",
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          ui: {
            customName: "Operator Alpha",
          },
        },
      }));
      mockDb.getDaemonSettings = mock(() => ({
        preserveSessions: false,
        defaultPolicyAction: "ask",
        forwardSshAuthSock: true,
        codexHostAccessProfileEnabled: false,
        terminalFeatures: {
          wsPtyPasteEnabled: true,
          latencyProbesEnabled: true,
          diagnosticsPanelEnabled: false,
          codexAppServerSpikeEnabled: false,
          wsPtyPasteCanaryPercent: 100,
          latencyProbesCanaryPercent: 100,
          diagnosticsPanelCanaryPercent: 0,
        },
        notificationsEnabled: true,
        systemNotificationsEnabled: false,
        notificationSoundsEnabled: true,
        notificationEventDefaults: {},
        notificationSoundMap: {},
        updatedAt: new Date(),
      }));

      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "Stop",
          data: {
            reason: "turn_complete",
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);

      expect(mockDb.insertSessionNotificationWithStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "Operator Alpha is ready for your next prompt.",
          payload: expect.objectContaining({
            sessionLabel: "Operator Alpha",
          }),
        })
      );
    });

    test("should skip notification fanout when Stop notification is deduplicated", async () => {
      mockDb.insertEvent = mock(() => 42);
      mockDb.getDaemonSettings = mock(() => ({
        preserveSessions: false,
        defaultPolicyAction: "ask",
        forwardSshAuthSock: true,
        codexHostAccessProfileEnabled: false,
        terminalFeatures: {
          wsPtyPasteEnabled: true,
          latencyProbesEnabled: true,
          diagnosticsPanelEnabled: false,
          codexAppServerSpikeEnabled: false,
          wsPtyPasteCanaryPercent: 100,
          latencyProbesCanaryPercent: 100,
          diagnosticsPanelCanaryPercent: 0,
        },
        notificationsEnabled: true,
        systemNotificationsEnabled: false,
        notificationSoundsEnabled: true,
        notificationEventDefaults: {},
        notificationSoundMap: {},
        updatedAt: new Date(),
      }));
      mockDb.insertSessionNotificationWithStatus = mock(() => ({
        id: 7,
        inserted: false,
      }));

      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "Stop",
          data: {
            reason: "turn_complete",
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);
      expect(mockDb.insertSessionNotificationWithStatus).toHaveBeenCalled();
      expect(mockEventBus.emit).not.toHaveBeenCalledWith("notification:created", expect.anything());
      expect(mockEventBus.emit).not.toHaveBeenCalledWith(
        "notification:counts_updated",
        expect.anything()
      );
    });

    test("should skip Stop notification when session notification preference is muted", async () => {
      mockDb.getDaemonSettings = mock(() => ({
        preserveSessions: false,
        defaultPolicyAction: "ask",
        forwardSshAuthSock: true,
        codexHostAccessProfileEnabled: false,
        terminalFeatures: {
          wsPtyPasteEnabled: true,
          latencyProbesEnabled: true,
          diagnosticsPanelEnabled: false,
          codexAppServerSpikeEnabled: false,
          wsPtyPasteCanaryPercent: 100,
          latencyProbesCanaryPercent: 100,
          diagnosticsPanelCanaryPercent: 0,
        },
        notificationsEnabled: true,
        systemNotificationsEnabled: false,
        notificationSoundsEnabled: true,
        notificationEventDefaults: {},
        notificationSoundMap: {},
        updatedAt: new Date(),
      }));
      mockDb.getSessionNotificationPrefs = mock((sessionId: string) => ({
        sessionId,
        enabled: false,
        updatedAt: new Date(),
      }));

      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "Stop",
          data: {
            reason: "turn_complete",
          },
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);
      expect(mockDb.insertSessionNotificationWithStatus).not.toHaveBeenCalled();
      expect(mockEventBus.emit).not.toHaveBeenCalledWith("notification:created", expect.anything());
    });
  });

  describe("Event storage", () => {
    test("should store all events in database with correct source", async () => {
      const events = ["SessionStart", "Notification", "Stop"];

      for (const event of events) {
        const req = new Request("http://localhost/hooks/claude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: "test-session-123",
            event,
            data: {},
          }),
        });

        await handleHookEvent(req, ctx);

        // Every event should be stored with source = "hook"
        expect(mockDb.insertEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            source: "hook",
            type: event,
          })
        );
      }
    });

    test("should preserve full event payload in database", async () => {
      const payload = {
        session_id: "test-session-123",
        transcript_path: "/tmp/test.jsonl",
        cwd: "/test/cwd",
        model: "claude-sonnet-4-5",
        extraField: "should be preserved",
      };

      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "SessionStart",
          data: payload,
        }),
      });

      await handleHookEvent(req, ctx);

      // Should store full payload
      expect(mockDb.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: payload,
        })
      );
    });
  });

  describe("Event bus emission", () => {
    test("should emit events on session:event topic", async () => {
      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "SessionStart",
          data: {},
        }),
      });

      await handleHookEvent(req, ctx);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "session:event",
        expect.objectContaining({
          sessionId: "test-session-123",
          type: "SessionStart",
        })
      );
    });

    test("should include event ID in emitted event", async () => {
      mockDb.insertEvent = mock(() => 42); // Return event ID

      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "SessionStart",
          data: {},
        }),
      });

      await handleHookEvent(req, ctx);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "session:event",
        expect.objectContaining({
          id: 42,
        })
      );
    });
  });

  describe("Authentication", () => {
    test("should reject request without CODEPIPER_SECRET header", async () => {
      ctx.hookSecret = "test-hook-secret";

      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "SessionStart",
          data: {},
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("hook secret");
    });

    test("should reject request with invalid CODEPIPER_SECRET", async () => {
      ctx.hookSecret = "test-hook-secret";

      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CodePiper-Secret": "wrong-secret",
        },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "SessionStart",
          data: {},
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("hook secret");
    });

    test("should accept request with valid CODEPIPER_SECRET", async () => {
      ctx.hookSecret = "test-hook-secret";

      const req = new Request("http://localhost/hooks/claude", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CodePiper-Secret": "test-hook-secret",
        },
        body: JSON.stringify({
          sessionId: "test-session-123",
          event: "SessionStart",
          data: {},
        }),
      });

      const response = await handleHookEvent(req, ctx);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(mockDb.insertEvent).toHaveBeenCalled();
    });
  });
});
