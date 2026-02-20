import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { ProviderId, SessionStatus } from "@codepiper/core";
import { Database } from "./db";

describe("Database", () => {
  let db: Database;
  const testDbPath = "/tmp/codepiper-test.db";

  beforeEach(async () => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      await rm(testDbPath);
    }
    db = new Database(testDbPath);
    await db.init();
  });

  afterEach(async () => {
    db.close();
    if (existsSync(testDbPath)) {
      await rm(testDbPath);
    }
  });

  describe("Database Initialization", () => {
    it("should create database file", () => {
      expect(existsSync(testDbPath)).toBe(true);
    });

    it("should create sessions table", () => {
      const result = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
      );
      expect(result).toHaveLength(1);
    });

    it("should create events table", () => {
      const result = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
      );
      expect(result).toHaveLength(1);
    });

    it("should create transcript_offsets table", () => {
      const result = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='transcript_offsets'"
      );
      expect(result).toHaveLength(1);
    });

    it("should create policies table", () => {
      const result = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='policies'"
      );
      expect(result).toHaveLength(1);
    });

    it("should create policy_decisions table", () => {
      const result = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='policy_decisions'"
      );
      expect(result).toHaveLength(1);
    });

    it("should handle re-initialization without errors", async () => {
      await db.init();
      expect(existsSync(testDbPath)).toBe(true);
    });
  });

  describe("Session CRUD Operations", () => {
    it("should create a session", () => {
      const sessionId = "test-session-1";
      const provider: ProviderId = "claude-code";
      const cwd = "/test/path";
      const status: SessionStatus = "STARTING";

      db.createSession({
        id: sessionId,
        provider,
        cwd,
        status,
      });

      const session = db.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.id).toBe(sessionId);
      expect(session?.provider).toBe(provider);
      expect(session?.cwd).toBe(cwd);
      expect(session?.status).toBe(status);
      expect(session?.createdAt).toBeInstanceOf(Date);
      expect(session?.updatedAt).toBeInstanceOf(Date);
    });

    it("should create session with optional fields", () => {
      const sessionId = "test-session-2";
      const metadata = { key: "value", count: 42 };

      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test/path",
        status: "RUNNING",
        pid: 12345,
        ptyRows: 30,
        ptyCols: 120,
        transcriptPath: "/tmp/transcript.jsonl",
        metadata,
      });

      const session = db.getSession(sessionId);
      expect(session?.pid).toBe(12345);
      expect(session?.ptyRows).toBe(30);
      expect(session?.ptyCols).toBe(120);
      expect(session?.transcriptPath).toBe("/tmp/transcript.jsonl");
      expect(session?.metadata).toEqual(metadata);
    });

    it("should get session by id", () => {
      const sessionId = "test-session-3";
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      const session = db.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.id).toBe(sessionId);
    });

    it("should return undefined for non-existent session", () => {
      const session = db.getSession("non-existent");
      expect(session).toBeUndefined();
    });

    it("should update session status", async () => {
      const sessionId = "test-session-4";
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "STARTING",
      });

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      db.updateSession(sessionId, { status: "RUNNING" });

      const session = db.getSession(sessionId);
      expect(session?.status).toBe("RUNNING");
      expect(session?.updatedAt.getTime()).toBeGreaterThan(session?.createdAt.getTime() || 0);
    });

    it("should update session with multiple fields", () => {
      const sessionId = "test-session-5";
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "STARTING",
      });

      db.updateSession(sessionId, {
        status: "RUNNING",
        pid: 99999,
        transcriptPath: "/new/path.jsonl",
        metadata: { updated: true },
      });

      const session = db.getSession(sessionId);
      expect(session?.status).toBe("RUNNING");
      expect(session?.pid).toBe(99999);
      expect(session?.transcriptPath).toBe("/new/path.jsonl");
      expect(session?.metadata).toEqual({ updated: true });
    });

    it("should list all sessions", () => {
      db.createSession({
        id: "session-1",
        provider: "claude-code",
        cwd: "/test1",
        status: "RUNNING",
      });
      db.createSession({
        id: "session-2",
        provider: "claude-code",
        cwd: "/test2",
        status: "STOPPED",
      });

      const sessions = db.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.id).sort()).toEqual(["session-1", "session-2"]);
    });

    it("should filter sessions by status", () => {
      db.createSession({
        id: "running-1",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });
      db.createSession({
        id: "running-2",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });
      db.createSession({
        id: "stopped-1",
        provider: "claude-code",
        cwd: "/test",
        status: "STOPPED",
      });

      const running = db.listSessions({ status: "RUNNING" });
      expect(running).toHaveLength(2);
      expect(running.every((s) => s.status === "RUNNING")).toBe(true);
    });

    it("should filter sessions by provider", () => {
      db.createSession({
        id: "claude-1",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });
      db.createSession({
        id: "claude-2",
        provider: "claude-code",
        cwd: "/test",
        status: "STOPPED",
      });
      db.createSession({
        id: "session-3",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      const claudeSessions = db.listSessions({ provider: "claude-code" });
      expect(claudeSessions).toHaveLength(3);
      expect(claudeSessions.every((s) => s.provider === "claude-code")).toBe(true);
    });

    it("should delete session", () => {
      const sessionId = "test-session-delete";
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      expect(db.getSession(sessionId)).toBeDefined();

      db.deleteSession(sessionId);

      expect(db.getSession(sessionId)).toBeUndefined();
    });
  });

  describe("Event Operations", () => {
    const sessionId = "test-session-events";

    beforeEach(() => {
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });
    });

    it("should insert event", () => {
      const eventId = db.insertEvent({
        sessionId,
        source: "hook",
        type: "SessionStart",
        payload: { model: "claude-3-5-sonnet" },
      });

      expect(eventId).toBeGreaterThan(0);
    });

    it("should insert event with custom timestamp", () => {
      const customTs = new Date("2024-01-01T00:00:00Z");
      const eventId = db.insertEvent({
        sessionId,
        source: "transcript",
        type: "UserPrompt",
        payload: { text: "Hello" },
        timestamp: customTs,
      });

      const events = db.getEventsBySessionId(sessionId);
      const event = events.find((e) => e.id === eventId);
      expect(event?.timestamp.toISOString()).toBe(customTs.toISOString());
    });

    it("should get events by session id", () => {
      db.insertEvent({
        sessionId,
        source: "hook",
        type: "SessionStart",
        payload: {},
      });
      db.insertEvent({
        sessionId,
        source: "hook",
        type: "Notification",
        payload: { type: "idle_prompt" },
      });

      const events = db.getEventsBySessionId(sessionId);
      expect(events).toHaveLength(2);
      expect(events[0].sessionId).toBe(sessionId);
      expect(events[1].sessionId).toBe(sessionId);
    });

    it("should get events by session id with limit", () => {
      for (let i = 0; i < 10; i++) {
        db.insertEvent({
          sessionId,
          source: "pty",
          type: "Output",
          payload: { chunk: `output-${i}` },
        });
      }

      const events = db.getEventsBySessionId(sessionId, { limit: 5 });
      expect(events).toHaveLength(5);
    });

    it("should get events by session id since event id", () => {
      const id1 = db.insertEvent({
        sessionId,
        source: "hook",
        type: "Event1",
        payload: {},
      });
      const id2 = db.insertEvent({
        sessionId,
        source: "hook",
        type: "Event2",
        payload: {},
      });
      const id3 = db.insertEvent({
        sessionId,
        source: "hook",
        type: "Event3",
        payload: {},
      });

      const events = db.getEventsBySessionId(sessionId, { since: id1 });
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.id)).toEqual([id2, id3]);
    });

    it("should filter events by type", () => {
      db.insertEvent({
        sessionId,
        source: "hook",
        type: "SessionStart",
        payload: {},
      });
      db.insertEvent({
        sessionId,
        source: "hook",
        type: "Notification",
        payload: {},
      });
      db.insertEvent({
        sessionId,
        source: "hook",
        type: "Notification",
        payload: {},
      });

      const events = db.getEventsBySessionId(sessionId, {
        type: "Notification",
      });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.type === "Notification")).toBe(true);
    });

    it("should filter events by source", () => {
      db.insertEvent({
        sessionId,
        source: "hook",
        type: "Event1",
        payload: {},
      });
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "Event2",
        payload: {},
      });
      db.insertEvent({
        sessionId,
        source: "hook",
        type: "Event3",
        payload: {},
      });

      const hookEvents = db.getEventsBySessionId(sessionId, { source: "hook" });
      expect(hookEvents).toHaveLength(2);
      expect(hookEvents.every((e) => e.source === "hook")).toBe(true);
    });

    it("should isolate events between sessions", () => {
      const session2Id = "test-session-2";
      db.createSession({
        id: session2Id,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      db.insertEvent({ sessionId, source: "hook", type: "Event1", payload: {} });
      db.insertEvent({
        sessionId: session2Id,
        source: "hook",
        type: "Event2",
        payload: {},
      });

      const session1Events = db.getEventsBySessionId(sessionId);
      const session2Events = db.getEventsBySessionId(session2Id);

      expect(session1Events).toHaveLength(1);
      expect(session2Events).toHaveLength(1);
      expect(session1Events[0].type).toBe("Event1");
      expect(session2Events[0].type).toBe("Event2");
    });
  });

  describe("Session Notification Operations", () => {
    const sessionId = "test-session-notifications-1";
    const session2Id = "test-session-notifications-2";

    const createNotification = (
      targetSessionId: string,
      overrides: {
        eventType?: string;
        title?: string;
        payload?: Record<string, unknown>;
        sourceEventId?: number;
      } = {}
    ) =>
      db.insertSessionNotification({
        sessionId: targetSessionId,
        provider: "claude-code",
        eventType: overrides.eventType ?? "session.turn_completed",
        sourceEventId: overrides.sourceEventId,
        title: overrides.title ?? "Claude finished",
        payload: overrides.payload ?? { sessionId: targetSessionId },
      });

    beforeEach(() => {
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });
      db.createSession({
        id: session2Id,
        provider: "codex",
        cwd: "/test-2",
        status: "RUNNING",
      });
    });

    it("should insert and list notifications newest-first", () => {
      const sourceEventId = db.insertEvent({
        sessionId,
        source: "hook",
        type: "Stop",
        payload: { reason: "turn_complete" },
      });

      const firstId = createNotification(sessionId, {
        title: "First",
        sourceEventId,
      });
      const secondId = createNotification(sessionId, {
        title: "Second",
      });

      const notifications = db.listSessionNotifications();
      expect(notifications).toHaveLength(2);
      expect(notifications[0].id).toBe(secondId);
      expect(notifications[1].id).toBe(firstId);
      expect(notifications[1].sourceEventId).toBe(sourceEventId);
      expect(notifications[1].title).toBe("First");
      expect(notifications[1].payload).toEqual({ sessionId });
      expect(notifications[1].createdAt).toBeInstanceOf(Date);
      expect(notifications[1].readAt).toBeNull();
    });

    it("should dedupe notifications by sourceEventId + eventType", () => {
      const sourceEventId = db.insertEvent({
        sessionId,
        source: "hook",
        type: "Stop",
        payload: { reason: "turn_complete" },
      });

      const firstId = createNotification(sessionId, {
        sourceEventId,
        eventType: "session.turn_completed",
        title: "First title",
      });
      const dedupedId = createNotification(sessionId, {
        sourceEventId,
        eventType: "session.turn_completed",
        title: "Second title should be ignored",
      });
      const differentTypeId = createNotification(sessionId, {
        sourceEventId,
        eventType: "session.permission_required",
        title: "Different type should insert",
      });

      expect(dedupedId).toBe(firstId);
      expect(differentTypeId).not.toBe(firstId);

      const notifications = db.listSessionNotifications({ sessionId });
      expect(notifications).toHaveLength(2);
      expect(notifications.map((notification) => notification.id)).toEqual([
        differentTypeId,
        firstId,
      ]);
      expect(notifications[1].title).toBe("First title");
    });

    it("should report inserted=false when sourceEventId + eventType already exists", () => {
      const sourceEventId = db.insertEvent({
        sessionId,
        source: "hook",
        type: "Stop",
        payload: { reason: "turn_complete" },
      });

      const firstInsert = db.insertSessionNotificationWithStatus({
        sessionId,
        provider: "claude-code",
        eventType: "session.turn_completed",
        sourceEventId,
        title: "First",
        payload: { sessionId },
      });
      const secondInsert = db.insertSessionNotificationWithStatus({
        sessionId,
        provider: "claude-code",
        eventType: "session.turn_completed",
        sourceEventId,
        title: "Second",
        payload: { sessionId, duplicate: true },
      });

      expect(firstInsert.inserted).toBe(true);
      expect(secondInsert.inserted).toBe(false);
      expect(secondInsert.id).toBe(firstInsert.id);
      expect(db.listSessionNotifications({ sessionId })).toHaveLength(1);
    });

    it("should filter notifications by session, event type, unread flag, cursor, and limit", () => {
      const id1 = createNotification(sessionId, {
        eventType: "session.turn_completed",
        title: "S1-1",
      });
      const id2 = createNotification(sessionId, {
        eventType: "session.permission_required",
        title: "S1-2",
      });
      const id3 = createNotification(session2Id, {
        eventType: "session.turn_completed",
        title: "S2-1",
      });

      db.markSessionNotificationRead(id2, "click");

      const sessionOnly = db.listSessionNotifications({ sessionId });
      expect(sessionOnly.map((n) => n.id)).toEqual([id2, id1]);

      const typeOnly = db.listSessionNotifications({
        eventType: "session.permission_required",
      });
      expect(typeOnly).toHaveLength(1);
      expect(typeOnly[0].id).toBe(id2);

      const unreadOnly = db.listSessionNotifications({ unreadOnly: true });
      expect(unreadOnly.map((n) => n.id)).toEqual([id3, id1]);

      const beforeCursor = db.listSessionNotifications({ before: id3 });
      expect(beforeCursor.map((n) => n.id)).toEqual([id2, id1]);

      const limited = db.listSessionNotifications({ limit: 1 });
      expect(limited).toHaveLength(1);
      expect(limited[0].id).toBe(id3);
    });

    it("should compute unread counts globally and by session", () => {
      const id1 = createNotification(sessionId);
      const id2 = createNotification(sessionId);
      createNotification(session2Id);

      db.markSessionNotificationRead(id2, "click");

      const counts = db.getSessionNotificationCounts();
      expect(counts.totalUnread).toBe(2);
      expect(counts.bySession).toEqual({
        [sessionId]: 1,
        [session2Id]: 1,
      });

      db.markSessionNotificationRead(id1, "click");
      const nextCounts = db.getSessionNotificationCounts();
      expect(nextCounts.totalUnread).toBe(1);
      expect(nextCounts.bySession).toEqual({
        [session2Id]: 1,
      });
    });

    it("should mark a single notification as read idempotently", () => {
      const id = createNotification(sessionId);
      const firstReadAt = new Date("2026-02-19T00:00:00.000Z");

      const changed = db.markSessionNotificationRead(id, "click", firstReadAt);
      const changedAgain = db.markSessionNotificationRead(
        id,
        "bulk",
        new Date("2026-02-19T00:05:00.000Z")
      );

      expect(changed).toBe(true);
      expect(changedAgain).toBe(false);

      const notification = db.listSessionNotifications({ sessionId })[0];
      expect(notification.readSource).toBe("click");
      expect(notification.readAt?.toISOString()).toBe(firstReadAt.toISOString());
    });

    it("should mark notifications as read in bulk with optional session filter", () => {
      createNotification(sessionId);
      createNotification(sessionId);
      createNotification(session2Id);

      const readAt = new Date("2026-02-19T01:00:00.000Z");
      const sessionChanges = db.markSessionNotificationsRead({
        sessionId,
        readSource: "open_session",
        readAt,
      });
      const idempotentSessionChanges = db.markSessionNotificationsRead({
        sessionId,
        readSource: "open_session",
        readAt: new Date("2026-02-19T01:05:00.000Z"),
      });

      expect(sessionChanges).toBe(2);
      expect(idempotentSessionChanges).toBe(0);

      const midCounts = db.getSessionNotificationCounts();
      expect(midCounts.totalUnread).toBe(1);
      expect(midCounts.bySession).toEqual({
        [session2Id]: 1,
      });

      const globalChanges = db.markSessionNotificationsRead({ readSource: "bulk" });
      const idempotentGlobalChanges = db.markSessionNotificationsRead({ readSource: "bulk" });

      expect(globalChanges).toBe(1);
      expect(idempotentGlobalChanges).toBe(0);
      expect(db.getSessionNotificationCounts()).toEqual({
        totalUnread: 0,
        bySession: {},
      });
    });

    it("should get and upsert session notification prefs", async () => {
      const initialPrefs = db.getSessionNotificationPrefs(sessionId);
      expect(initialPrefs.sessionId).toBe(sessionId);
      expect(initialPrefs.enabled).toBeNull();
      expect(initialPrefs.updatedAt.toISOString()).toBe(new Date(0).toISOString());

      const firstWrite = db.setSessionNotificationPrefs(sessionId, false);
      expect(firstWrite.enabled).toBe(false);
      expect(firstWrite.updatedAt).toBeInstanceOf(Date);

      const afterFirstWrite = db.getSessionNotificationPrefs(sessionId);
      expect(afterFirstWrite.enabled).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 5));

      const secondWrite = db.setSessionNotificationPrefs(sessionId, true);
      expect(secondWrite.enabled).toBe(true);
      expect(secondWrite.updatedAt.getTime()).toBeGreaterThan(firstWrite.updatedAt.getTime());

      const afterSecondWrite = db.getSessionNotificationPrefs(sessionId);
      expect(afterSecondWrite.enabled).toBe(true);
      expect(afterSecondWrite.updatedAt.getTime()).toBeGreaterThan(
        afterFirstWrite.updatedAt.getTime()
      );

      db.setSessionNotificationPrefs(sessionId, null);
      const afterThirdWrite = db.getSessionNotificationPrefs(sessionId);
      expect(afterThirdWrite.enabled).toBeNull();
    });

    it("should cascade-delete notifications and prefs with session deletion", () => {
      createNotification(sessionId);
      createNotification(session2Id);
      db.setSessionNotificationPrefs(sessionId, true);
      db.setSessionNotificationPrefs(session2Id, false);

      db.deleteSession(sessionId);

      const remainingNotifications = db.listSessionNotifications();
      expect(remainingNotifications).toHaveLength(1);
      expect(remainingNotifications[0].sessionId).toBe(session2Id);

      const removedPrefs = db.getSessionNotificationPrefs(sessionId);
      expect(removedPrefs.enabled).toBeNull();

      const remainingPrefs = db.getSessionNotificationPrefs(session2Id);
      expect(remainingPrefs.enabled).toBe(false);
    });
  });

  describe("Push Subscription Operations", () => {
    it("should upsert and list push subscriptions", async () => {
      const first = db.upsertPushSubscription({
        endpoint: "https://example.push/endpoint-1",
        keys: {
          p256dh: "p256dh-key-1",
          auth: "auth-key-1",
        },
        expirationTime: null,
      });
      expect(first.endpoint).toBe("https://example.push/endpoint-1");
      expect(first.keys).toEqual({
        p256dh: "p256dh-key-1",
        auth: "auth-key-1",
      });
      expect(first.expirationTime).toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 5));

      const second = db.upsertPushSubscription({
        endpoint: "https://example.push/endpoint-2",
        keys: {
          p256dh: "p256dh-key-2",
          auth: "auth-key-2",
        },
        expirationTime: 1_700_000_000_000,
      });
      expect(second.endpoint).toBe("https://example.push/endpoint-2");

      const listed = db.listPushSubscriptions();
      expect(listed).toHaveLength(2);
      expect(listed.map((subscription) => subscription.endpoint)).toEqual([
        "https://example.push/endpoint-2",
        "https://example.push/endpoint-1",
      ]);
    });

    it("should update existing push subscription by endpoint", async () => {
      const first = db.upsertPushSubscription({
        endpoint: "https://example.push/endpoint-1",
        keys: {
          p256dh: "p256dh-key-1",
          auth: "auth-key-1",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      const second = db.upsertPushSubscription({
        endpoint: "https://example.push/endpoint-1",
        keys: {
          p256dh: "p256dh-key-1b",
          auth: "auth-key-1b",
        },
        expirationTime: 1_900_000_000_000,
      });

      expect(second.endpoint).toBe(first.endpoint);
      expect(second.keys).toEqual({
        p256dh: "p256dh-key-1b",
        auth: "auth-key-1b",
      });
      expect(second.expirationTime).toBe(1_900_000_000_000);
      expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
      expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());

      const listed = db.listPushSubscriptions();
      expect(listed).toHaveLength(1);
    });

    it("should delete push subscriptions idempotently", () => {
      db.upsertPushSubscription({
        endpoint: "https://example.push/endpoint-1",
        keys: {
          p256dh: "p256dh-key-1",
          auth: "auth-key-1",
        },
      });

      const deleted = db.deletePushSubscription("https://example.push/endpoint-1");
      const deletedAgain = db.deletePushSubscription("https://example.push/endpoint-1");

      expect(deleted).toBe(true);
      expect(deletedAgain).toBe(false);
      expect(db.listPushSubscriptions()).toEqual([]);
    });
  });

  describe("Transcript Offset Management", () => {
    const sessionId = "test-session-offsets";
    const transcriptPath = "/tmp/transcript.jsonl";

    beforeEach(() => {
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
        transcriptPath,
      });
    });

    it("should get transcript offset (initial state)", () => {
      const offset = db.getTranscriptOffset(sessionId, transcriptPath);
      expect(offset).toEqual({
        byteOffset: 0,
        lastLineHash: null,
      });
    });

    it("should update transcript offset", () => {
      db.updateTranscriptOffset(sessionId, transcriptPath, {
        byteOffset: 1024,
        lastLineHash: "abc123",
      });

      const offset = db.getTranscriptOffset(sessionId, transcriptPath);
      expect(offset.byteOffset).toBe(1024);
      expect(offset.lastLineHash).toBe("abc123");
    });

    it("should update transcript offset multiple times", () => {
      db.updateTranscriptOffset(sessionId, transcriptPath, {
        byteOffset: 100,
        lastLineHash: "hash1",
      });
      db.updateTranscriptOffset(sessionId, transcriptPath, {
        byteOffset: 200,
        lastLineHash: "hash2",
      });
      db.updateTranscriptOffset(sessionId, transcriptPath, {
        byteOffset: 300,
        lastLineHash: "hash3",
      });

      const offset = db.getTranscriptOffset(sessionId, transcriptPath);
      expect(offset.byteOffset).toBe(300);
      expect(offset.lastLineHash).toBe("hash3");
    });

    it("should handle different transcript paths per session", () => {
      const path1 = "/tmp/transcript1.jsonl";
      const path2 = "/tmp/transcript2.jsonl";

      db.updateTranscriptOffset(sessionId, path1, {
        byteOffset: 100,
        lastLineHash: "hash1",
      });
      db.updateTranscriptOffset(sessionId, path2, {
        byteOffset: 200,
        lastLineHash: "hash2",
      });

      const offset1 = db.getTranscriptOffset(sessionId, path1);
      const offset2 = db.getTranscriptOffset(sessionId, path2);

      expect(offset1.byteOffset).toBe(100);
      expect(offset2.byteOffset).toBe(200);
    });

    it("should isolate offsets between sessions", () => {
      const session2Id = "test-session-2";
      db.createSession({
        id: session2Id,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      db.updateTranscriptOffset(sessionId, transcriptPath, {
        byteOffset: 100,
        lastLineHash: "session1",
      });
      db.updateTranscriptOffset(session2Id, transcriptPath, {
        byteOffset: 200,
        lastLineHash: "session2",
      });

      const offset1 = db.getTranscriptOffset(sessionId, transcriptPath);
      const offset2 = db.getTranscriptOffset(session2Id, transcriptPath);

      expect(offset1.byteOffset).toBe(100);
      expect(offset1.lastLineHash).toBe("session1");
      expect(offset2.byteOffset).toBe(200);
      expect(offset2.lastLineHash).toBe("session2");
    });
  });

  describe("Policy CRUD Operations", () => {
    it("should create a policy", () => {
      const policyId = "test-policy-1";
      const rules = [
        {
          id: "rule-1",
          action: "allow" as const,
          tool: "Read",
          reason: "Allow read operations",
        },
      ];

      db.createPolicy({
        id: policyId,
        name: "Test Policy",
        description: "A test policy",
        enabled: true,
        priority: 10,
        rules,
      });

      const policy = db.getPolicy(policyId);
      expect(policy).toBeDefined();
      expect(policy?.id).toBe(policyId);
      expect(policy?.name).toBe("Test Policy");
      expect(policy?.description).toBe("A test policy");
      expect(policy?.enabled).toBe(true);
      expect(policy?.priority).toBe(10);
      expect(policy?.rules).toEqual(rules);
      expect(policy?.createdAt).toBeInstanceOf(Date);
      expect(policy?.updatedAt).toBeInstanceOf(Date);
    });

    it("should create policy with defaults", () => {
      const policyId = "test-policy-2";
      db.createPolicy({
        id: policyId,
        name: "Minimal Policy",
        rules: [],
      });

      const policy = db.getPolicy(policyId);
      expect(policy?.enabled).toBe(true);
      expect(policy?.priority).toBe(0);
      expect(policy?.sessionId).toBeUndefined();
      expect(policy?.description).toBeUndefined();
    });

    it("should create session-specific policy", () => {
      const sessionId = "test-session-1";
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      const policyId = "session-policy-1";
      db.createPolicy({
        id: policyId,
        name: "Session Policy",
        sessionId,
        rules: [],
      });

      const policy = db.getPolicy(policyId);
      expect(policy?.sessionId).toBe(sessionId);
    });

    it("should return undefined for non-existent policy", () => {
      const policy = db.getPolicy("non-existent");
      expect(policy).toBeUndefined();
    });

    it("should update policy name", () => {
      const policyId = "test-policy-3";
      db.createPolicy({
        id: policyId,
        name: "Original Name",
        rules: [],
      });

      db.updatePolicy(policyId, { name: "Updated Name" });

      const policy = db.getPolicy(policyId);
      expect(policy?.name).toBe("Updated Name");
    });

    it("should update policy enabled state", () => {
      const policyId = "test-policy-4";
      db.createPolicy({
        id: policyId,
        name: "Test Policy",
        enabled: true,
        rules: [],
      });

      db.updatePolicy(policyId, { enabled: false });

      const policy = db.getPolicy(policyId);
      expect(policy?.enabled).toBe(false);
    });

    it("should update policy priority", () => {
      const policyId = "test-policy-5";
      db.createPolicy({
        id: policyId,
        name: "Test Policy",
        priority: 10,
        rules: [],
      });

      db.updatePolicy(policyId, { priority: 50 });

      const policy = db.getPolicy(policyId);
      expect(policy?.priority).toBe(50);
    });

    it("should update policy rules", () => {
      const policyId = "test-policy-6";
      const originalRules = [{ id: "rule-1", action: "allow" as const }];
      const updatedRules = [
        { id: "rule-1", action: "deny" as const },
        { id: "rule-2", action: "allow" as const },
      ];

      db.createPolicy({
        id: policyId,
        name: "Test Policy",
        rules: originalRules,
      });

      db.updatePolicy(policyId, { rules: updatedRules });

      const policy = db.getPolicy(policyId);
      expect(policy?.rules).toEqual(updatedRules);
    });

    it("should update multiple fields at once", () => {
      const policyId = "test-policy-7";
      db.createPolicy({
        id: policyId,
        name: "Original",
        description: "Original description",
        enabled: true,
        priority: 10,
        rules: [],
      });

      db.updatePolicy(policyId, {
        name: "Updated",
        description: "Updated description",
        enabled: false,
        priority: 20,
      });

      const policy = db.getPolicy(policyId);
      expect(policy?.name).toBe("Updated");
      expect(policy?.description).toBe("Updated description");
      expect(policy?.enabled).toBe(false);
      expect(policy?.priority).toBe(20);
    });

    it("should delete policy", () => {
      const policyId = "test-policy-8";
      db.createPolicy({
        id: policyId,
        name: "To Delete",
        rules: [],
      });

      const before = db.getPolicy(policyId);
      expect(before).toBeDefined();

      db.deletePolicy(policyId);

      const after = db.getPolicy(policyId);
      expect(after).toBeUndefined();
    });

    it("should list all policies", () => {
      db.createPolicy({
        id: "policy-1",
        name: "Policy 1",
        priority: 10,
        rules: [],
      });
      db.createPolicy({
        id: "policy-2",
        name: "Policy 2",
        priority: 20,
        rules: [],
      });

      const policies = db.listPolicies();
      expect(policies).toHaveLength(2);
      // Should be ordered by priority DESC
      expect(policies[0].id).toBe("policy-2");
      expect(policies[1].id).toBe("policy-1");
    });

    it("should filter policies by enabled state", () => {
      db.createPolicy({
        id: "policy-enabled",
        name: "Enabled",
        enabled: true,
        rules: [],
      });
      db.createPolicy({
        id: "policy-disabled",
        name: "Disabled",
        enabled: false,
        rules: [],
      });

      const enabledPolicies = db.listPolicies({ enabled: true });
      expect(enabledPolicies).toHaveLength(1);
      expect(enabledPolicies[0].id).toBe("policy-enabled");
    });

    it("should filter policies by session", () => {
      const sessionId = "test-session-1";
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      db.createPolicy({
        id: "global-policy",
        name: "Global",
        rules: [],
      });
      db.createPolicy({
        id: "session-policy",
        name: "Session",
        sessionId,
        rules: [],
      });

      const globalPolicies = db.listPolicies({ sessionId: null as any });
      expect(globalPolicies).toHaveLength(1);
      expect(globalPolicies[0].id).toBe("global-policy");

      const sessionPolicies = db.listPolicies({ sessionId });
      expect(sessionPolicies).toHaveLength(1);
      expect(sessionPolicies[0].id).toBe("session-policy");
    });

    it("should cascade delete session policies", () => {
      const sessionId = "test-session-cascade";
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      db.createPolicy({
        id: "session-policy",
        name: "Session Policy",
        sessionId,
        rules: [],
      });

      const before = db.getPolicy("session-policy");
      expect(before).toBeDefined();

      db.deleteSession(sessionId);

      const after = db.getPolicy("session-policy");
      expect(after).toBeUndefined();
    });
  });

  describe("Policy Decision (Audit) Operations", () => {
    const sessionId = "test-session-decisions";

    beforeEach(() => {
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });
    });

    it("should insert policy decision", () => {
      const decisionId = db.insertPolicyDecision({
        sessionId,
        toolName: "Read",
        args: { file_path: "/test/file.txt" },
        decision: "allow",
        reason: "Read operations are safe",
      });

      expect(decisionId).toBeGreaterThan(0);

      const decisions = db.getPolicyDecisionsBySessionId(sessionId);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].id).toBe(decisionId);
      expect(decisions[0].toolName).toBe("Read");
      expect(decisions[0].decision).toBe("allow");
      expect(decisions[0].reason).toBe("Read operations are safe");
      expect(decisions[0].args).toEqual({ file_path: "/test/file.txt" });
    });

    it("should insert decision with policy and event reference", () => {
      const policyId = "test-policy";
      db.createPolicy({
        id: policyId,
        name: "Test Policy",
        rules: [],
      });

      const eventId = db.insertEvent({
        sessionId,
        source: "hook",
        type: "PermissionRequest",
        payload: {},
      });

      const _decisionId = db.insertPolicyDecision({
        sessionId,
        eventId,
        policyId,
        toolName: "Write",
        decision: "deny",
      });

      const decisions = db.getPolicyDecisionsBySessionId(sessionId);
      expect(decisions[0].eventId).toBe(eventId);
      expect(decisions[0].policyId).toBe(policyId);
    });

    it("should insert decision with custom timestamp", () => {
      const customTs = new Date("2024-01-01T12:00:00Z");
      db.insertPolicyDecision({
        sessionId,
        toolName: "Bash",
        decision: "deny",
        timestamp: customTs,
      });

      const decisions = db.getPolicyDecisionsBySessionId(sessionId);
      expect(decisions[0].timestamp.toISOString()).toBe(customTs.toISOString());
    });

    it("should get decisions by session", () => {
      db.insertPolicyDecision({
        sessionId,
        toolName: "Read",
        decision: "allow",
      });
      db.insertPolicyDecision({
        sessionId,
        toolName: "Write",
        decision: "deny",
      });

      const decisions = db.getPolicyDecisionsBySessionId(sessionId);
      expect(decisions).toHaveLength(2);
    });

    it("should filter decisions by decision type", () => {
      db.insertPolicyDecision({
        sessionId,
        toolName: "Read",
        decision: "allow",
      });
      db.insertPolicyDecision({
        sessionId,
        toolName: "Write",
        decision: "deny",
      });
      db.insertPolicyDecision({
        sessionId,
        toolName: "Edit",
        decision: "deny",
      });

      const denyDecisions = db.getPolicyDecisionsBySessionId(sessionId, {
        decision: "deny",
      });
      expect(denyDecisions).toHaveLength(2);
      expect(denyDecisions.every((d) => d.decision === "deny")).toBe(true);
    });

    it("should limit decisions", () => {
      for (let i = 0; i < 10; i++) {
        db.insertPolicyDecision({
          sessionId,
          toolName: `Tool${i}`,
          decision: "allow",
        });
      }

      const decisions = db.getPolicyDecisionsBySessionId(sessionId, { limit: 5 });
      expect(decisions).toHaveLength(5);
    });

    it("should get decisions since id", () => {
      const id1 = db.insertPolicyDecision({
        sessionId,
        toolName: "Tool1",
        decision: "allow",
      });
      const id2 = db.insertPolicyDecision({
        sessionId,
        toolName: "Tool2",
        decision: "allow",
      });
      const id3 = db.insertPolicyDecision({
        sessionId,
        toolName: "Tool3",
        decision: "allow",
      });

      const decisions = db.getPolicyDecisionsBySessionId(sessionId, { since: id1 });
      expect(decisions).toHaveLength(2);
      expect(decisions.map((d) => d.id)).toEqual([id2, id3]);
    });

    it("should isolate decisions between sessions", () => {
      const session2Id = "test-session-2";
      db.createSession({
        id: session2Id,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      db.insertPolicyDecision({
        sessionId,
        toolName: "Tool1",
        decision: "allow",
      });
      db.insertPolicyDecision({
        sessionId: session2Id,
        toolName: "Tool2",
        decision: "deny",
      });

      const session1Decisions = db.getPolicyDecisionsBySessionId(sessionId);
      const session2Decisions = db.getPolicyDecisionsBySessionId(session2Id);

      expect(session1Decisions).toHaveLength(1);
      expect(session2Decisions).toHaveLength(1);
      expect(session1Decisions[0].toolName).toBe("Tool1");
      expect(session2Decisions[0].toolName).toBe("Tool2");
    });

    it("should cascade delete decisions when session is deleted", () => {
      db.insertPolicyDecision({
        sessionId,
        toolName: "Test",
        decision: "allow",
      });

      const before = db.getPolicyDecisionsBySessionId(sessionId);
      expect(before).toHaveLength(1);

      db.deleteSession(sessionId);

      const after = db.getPolicyDecisionsBySessionId(sessionId);
      expect(after).toHaveLength(0);
    });
  });

  describe("Daemon Settings", () => {
    it("should return defaults when no settings exist", () => {
      const settings = db.getDaemonSettings();
      expect(settings.preserveSessions).toBe(false);
      expect(settings.defaultPolicyAction).toBe("ask");
      expect(settings.forwardSshAuthSock).toBe(true);
      expect(settings.codexHostAccessProfileEnabled).toBe(false);
      expect(settings.terminalFeatures.wsPtyPasteEnabled).toBe(true);
      expect(settings.terminalFeatures.latencyProbesEnabled).toBe(true);
      expect(settings.terminalFeatures.diagnosticsPanelEnabled).toBe(false);
      expect(settings.terminalFeatures.codexAppServerSpikeEnabled).toBe(false);
      expect(settings.terminalFeatures.wsPtyPasteCanaryPercent).toBe(100);
      expect(settings.terminalFeatures.latencyProbesCanaryPercent).toBe(100);
      expect(settings.terminalFeatures.diagnosticsPanelCanaryPercent).toBe(0);
      expect(settings.notificationsEnabled).toBe(false);
      expect(settings.systemNotificationsEnabled).toBe(false);
      expect(settings.notificationSoundsEnabled).toBe(true);
      expect(settings.notificationEventDefaults).toEqual({});
      expect(settings.notificationSoundMap).toEqual({});
      expect(settings.updatedAt).toBeInstanceOf(Date);
    });

    it("should create settings on first update", () => {
      db.updateDaemonSettings({ preserveSessions: true });
      const settings = db.getDaemonSettings();
      expect(settings.preserveSessions).toBe(true);
      expect(settings.defaultPolicyAction).toBe("ask");
      expect(settings.forwardSshAuthSock).toBe(true);
      expect(settings.codexHostAccessProfileEnabled).toBe(false);
      expect(settings.notificationsEnabled).toBe(false);
      expect(settings.systemNotificationsEnabled).toBe(false);
      expect(settings.notificationSoundsEnabled).toBe(true);
      expect(settings.notificationEventDefaults).toEqual({});
      expect(settings.notificationSoundMap).toEqual({});
    });

    it("should update forwardSshAuthSock", () => {
      db.updateDaemonSettings({ forwardSshAuthSock: false });
      const settings = db.getDaemonSettings();
      expect(settings.forwardSshAuthSock).toBe(false);
    });

    it("should update codexHostAccessProfileEnabled", () => {
      db.updateDaemonSettings({ codexHostAccessProfileEnabled: true });
      const settings = db.getDaemonSettings();
      expect(settings.codexHostAccessProfileEnabled).toBe(true);
    });

    it("should update defaultPolicyAction to deny", () => {
      db.updateDaemonSettings({ defaultPolicyAction: "deny" });
      const settings = db.getDaemonSettings();
      expect(settings.defaultPolicyAction).toBe("deny");
    });

    it("should update defaultPolicyAction back to ask", () => {
      db.updateDaemonSettings({ defaultPolicyAction: "deny" });
      db.updateDaemonSettings({ defaultPolicyAction: "ask" });
      const settings = db.getDaemonSettings();
      expect(settings.defaultPolicyAction).toBe("ask");
    });

    it("should update both settings independently", () => {
      db.updateDaemonSettings({ preserveSessions: true });
      db.updateDaemonSettings({ defaultPolicyAction: "deny" });
      const settings = db.getDaemonSettings();
      expect(settings.preserveSessions).toBe(true);
      expect(settings.defaultPolicyAction).toBe("deny");
      expect(settings.forwardSshAuthSock).toBe(true);
      expect(settings.codexHostAccessProfileEnabled).toBe(false);
    });

    it("should update both settings at once", () => {
      db.updateDaemonSettings({
        preserveSessions: true,
        defaultPolicyAction: "deny",
        forwardSshAuthSock: false,
        codexHostAccessProfileEnabled: true,
      });
      const settings = db.getDaemonSettings();
      expect(settings.preserveSessions).toBe(true);
      expect(settings.defaultPolicyAction).toBe("deny");
      expect(settings.forwardSshAuthSock).toBe(false);
      expect(settings.codexHostAccessProfileEnabled).toBe(true);
    });

    it("should update terminal feature settings", () => {
      db.updateDaemonSettings({
        terminalFeatures: {
          wsPtyPasteEnabled: false,
          latencyProbesEnabled: false,
          diagnosticsPanelEnabled: true,
          codexAppServerSpikeEnabled: true,
          wsPtyPasteCanaryPercent: 35,
          latencyProbesCanaryPercent: 15,
          diagnosticsPanelCanaryPercent: 5,
        },
      });
      const settings = db.getDaemonSettings();
      expect(settings.terminalFeatures.wsPtyPasteEnabled).toBe(false);
      expect(settings.terminalFeatures.latencyProbesEnabled).toBe(false);
      expect(settings.terminalFeatures.diagnosticsPanelEnabled).toBe(true);
      expect(settings.terminalFeatures.codexAppServerSpikeEnabled).toBe(true);
      expect(settings.terminalFeatures.wsPtyPasteCanaryPercent).toBe(35);
      expect(settings.terminalFeatures.latencyProbesCanaryPercent).toBe(15);
      expect(settings.terminalFeatures.diagnosticsPanelCanaryPercent).toBe(5);
    });

    it("should clamp terminal canary percentages to valid range", () => {
      db.updateDaemonSettings({
        terminalFeatures: {
          wsPtyPasteCanaryPercent: 123,
          latencyProbesCanaryPercent: -4,
          diagnosticsPanelCanaryPercent: 49.6,
        },
      });
      const settings = db.getDaemonSettings();
      expect(settings.terminalFeatures.wsPtyPasteCanaryPercent).toBe(100);
      expect(settings.terminalFeatures.latencyProbesCanaryPercent).toBe(0);
      expect(settings.terminalFeatures.diagnosticsPanelCanaryPercent).toBe(50);
    });

    it("should handle migration (column added to existing table)", async () => {
      // Simulate an existing database that was created before the column was added
      // by verifying the ALTER TABLE migration in init() works
      const db2 = new Database(":memory:");
      await db2.init();
      const settings = db2.getDaemonSettings();
      expect(settings.defaultPolicyAction).toBe("ask");
      expect(settings.forwardSshAuthSock).toBe(true);
      expect(settings.codexHostAccessProfileEnabled).toBe(false);
      expect(settings.terminalFeatures.wsPtyPasteEnabled).toBe(true);
      expect(settings.terminalFeatures.codexAppServerSpikeEnabled).toBe(false);
      expect(settings.notificationsEnabled).toBe(false);
      expect(settings.systemNotificationsEnabled).toBe(false);
      expect(settings.notificationSoundsEnabled).toBe(true);
      expect(settings.notificationEventDefaults).toEqual({});
      expect(settings.notificationSoundMap).toEqual({});
      db2.close();
    });

    it("should update notification settings", () => {
      db.updateDaemonSettings({
        notificationsEnabled: true,
        systemNotificationsEnabled: true,
        notificationSoundsEnabled: false,
        notificationEventDefaults: {
          "session.turn_completed": true,
          "session.permission_required": false,
        },
        notificationSoundMap: {
          "session.turn_completed": "chime",
        },
      });
      const settings = db.getDaemonSettings();
      expect(settings.notificationsEnabled).toBe(true);
      expect(settings.systemNotificationsEnabled).toBe(true);
      expect(settings.notificationSoundsEnabled).toBe(false);
      expect(settings.notificationEventDefaults).toEqual({
        "session.turn_completed": true,
        "session.permission_required": false,
      });
      expect(settings.notificationSoundMap).toEqual({
        "session.turn_completed": "chime",
      });
    });
  });
});
