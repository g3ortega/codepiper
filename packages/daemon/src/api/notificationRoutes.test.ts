import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { SessionManager } from "../sessions/sessionManager";
import { createServer, type DaemonServer } from "./server";

describe("Notification Routes", () => {
  let server: DaemonServer;
  let socketPath: string;
  let tempDir: string;
  let db: Database;
  let eventBus: EventBus;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepiper-notifications-test-"));
    socketPath = path.join(tempDir, "test.sock");

    db = new Database(":memory:");
    await db.init();
    eventBus = new EventBus();
    sessionManager = new SessionManager(db, eventBus);

    server = await createServer(socketPath, sessionManager, db, eventBus, {
      pushNotifierOptions: { enabled: false },
    });
  });

  afterEach(async () => {
    if (sessionManager) await sessionManager.stopAll();
    if (server) await server.stop();
    db.close();
    try {
      if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function fetchSocket(urlPath: string, init?: RequestInit) {
    return fetch(`http://localhost${urlPath}`, {
      ...init,
      unix: socketPath,
    } as any);
  }

  function createSession(sessionId: string, provider: "claude-code" | "codex" = "claude-code") {
    db.createSession({
      id: sessionId,
      provider,
      cwd: "/tmp",
      status: "RUNNING",
    });
  }

  function createNotification(
    sessionId: string,
    overrides: { eventType?: string; title?: string; readAt?: Date; readSource?: string } = {}
  ) {
    return db.insertSessionNotification({
      sessionId,
      provider: "claude-code",
      eventType: overrides.eventType ?? "session.turn_completed",
      title: overrides.title ?? "Claude finished",
      payload: { sessionId },
      readAt: overrides.readAt,
      readSource: overrides.readSource,
    });
  }

  function createPushSubscriptionPayload(
    overrides: {
      endpoint?: string;
      p256dh?: string;
      auth?: string;
      expirationTime?: number | null;
    } = {}
  ) {
    return {
      endpoint: overrides.endpoint ?? "https://push.example/endpoint-1",
      expirationTime:
        overrides.expirationTime === undefined ? 1_800_000_000_000 : overrides.expirationTime,
      keys: {
        p256dh: overrides.p256dh ?? "p256dh-key",
        auth: overrides.auth ?? "auth-key",
      },
    };
  }

  test("GET /notifications returns notification list with filters", async () => {
    createSession("session-1", "claude-code");
    createSession("session-2", "codex");

    const id1 = createNotification("session-1", { title: "s1-1" });
    const id2 = createNotification("session-1", {
      title: "s1-2",
      eventType: "session.permission_required",
    });
    const id3 = createNotification("session-2", { title: "s2-1" });
    db.markSessionNotificationRead(id2, "click");

    const res = await fetchSocket("/notifications?sessionId=session-1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.notifications.map((n: any) => n.id)).toEqual([id2, id1]);

    const unreadRes = await fetchSocket("/notifications?unreadOnly=true");
    expect(unreadRes.status).toBe(200);
    const unreadData = await unreadRes.json();
    expect(unreadData.notifications.map((n: any) => n.id)).toEqual([id3, id1]);

    const beforeRes = await fetchSocket(`/notifications?before=${id3}&limit=2`);
    expect(beforeRes.status).toBe(200);
    const beforeData = await beforeRes.json();
    expect(beforeData.notifications.map((n: any) => n.id)).toEqual([id2, id1]);
  });

  test("GET /notifications/counts returns unread totals", async () => {
    createSession("session-1");
    createSession("session-2");

    const readId = createNotification("session-1");
    createNotification("session-1");
    createNotification("session-2");
    db.markSessionNotificationRead(readId, "click");

    const res = await fetchSocket("/notifications/counts");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.totalUnread).toBe(2);
    expect(data.counts.bySession).toEqual({
      "session-1": 1,
      "session-2": 1,
    });
  });

  test("GET /notifications/push/status returns daemon push runtime status", async () => {
    const initial = await fetchSocket("/notifications/push/status");
    expect(initial.status).toBe(200);
    const initialData = await initial.json();
    expect(initialData.status.enabled).toBe(false);
    expect(initialData.status.configured).toBe(false);
    expect(initialData.status.publicKey).toBeNull();
    expect(initialData.status.reasons).toEqual(expect.arrayContaining(["feature_disabled"]));

    db.updateDaemonSettings({
      notificationsEnabled: true,
      systemNotificationsEnabled: true,
    });

    const updated = await fetchSocket("/notifications/push/status");
    expect(updated.status).toBe(200);
    const updatedData = await updated.json();
    expect(updatedData.status.enabled).toBe(false);
    expect(updatedData.status.configured).toBe(false);
    expect(updatedData.status.publicKey).toBeNull();
    expect(updatedData.status.reasons).toEqual(expect.arrayContaining(["feature_disabled"]));
  });

  test("POST /notifications/push/test returns skipped result when push runtime is unavailable", async () => {
    const response = await fetchSocket("/notifications/push/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result).toEqual({
      attempted: 0,
      delivered: 0,
      expired: 0,
      failed: 0,
      skipped: true,
      reason: "not_available",
    });
  });

  test("POST /notifications/:id/read marks one notification idempotently", async () => {
    createSession("session-1");
    const notificationId = createNotification("session-1");

    const readEvents: Array<Record<string, unknown>> = [];
    const countEvents: Array<Record<string, unknown>> = [];
    const unsubscribeRead = eventBus.on("notification:read", (event) => {
      readEvents.push(event as Record<string, unknown>);
    });
    const unsubscribeCounts = eventBus.on("notification:counts_updated", (event) => {
      countEvents.push(event as Record<string, unknown>);
    });

    const first = await fetchSocket(`/notifications/${notificationId}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readSource: "click" }),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ success: true, changed: true });

    const second = await fetchSocket(`/notifications/${notificationId}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readSource: "bulk" }),
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ success: true, changed: false });

    expect(readEvents).toHaveLength(1);
    expect(readEvents[0].id).toBe(notificationId);
    expect(readEvents[0].readSource).toBe("click");

    expect(countEvents).toHaveLength(1);
    expect(countEvents[0].totalUnread).toBe(0);

    unsubscribeRead();
    unsubscribeCounts();
  });

  test("POST /notifications/read marks notifications in bulk", async () => {
    createSession("session-1");
    createSession("session-2");
    createNotification("session-1");
    createNotification("session-1");
    createNotification("session-2");

    const scopedRes = await fetchSocket("/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-1", readSource: "open_session" }),
    });
    expect(scopedRes.status).toBe(200);
    const scopedData = await scopedRes.json();
    expect(scopedData.updated).toBe(2);

    const countsRes = await fetchSocket("/notifications/counts");
    expect(countsRes.status).toBe(200);
    const countsData = await countsRes.json();
    expect(countsData.counts.totalUnread).toBe(1);
    expect(countsData.counts.bySession).toEqual({ "session-2": 1 });
  });

  test("session notification prefs endpoints read and update prefs", async () => {
    createSession("session-1");

    const getDefault = await fetchSocket("/sessions/session-1/notifications/prefs");
    expect(getDefault.status).toBe(200);
    const defaultData = await getDefault.json();
    expect(defaultData.prefs.sessionId).toBe("session-1");
    expect(defaultData.prefs.enabled).toBeNull();

    const putRes = await fetchSocket("/sessions/session-1/notifications/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(putRes.status).toBe(200);
    const putData = await putRes.json();
    expect(putData.prefs.enabled).toBe(false);

    const getUpdated = await fetchSocket("/sessions/session-1/notifications/prefs");
    expect(getUpdated.status).toBe(200);
    const updatedData = await getUpdated.json();
    expect(updatedData.prefs.enabled).toBe(false);
  });

  test("push subscription endpoints upsert, list, and delete subscriptions", async () => {
    const initialList = await fetchSocket("/notifications/push/subscriptions");
    expect(initialList.status).toBe(200);
    const initialData = await initialList.json();
    expect(initialData.subscriptions).toEqual([]);

    const putFirst = await fetchSocket("/notifications/push/subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPushSubscriptionPayload()),
    });
    expect(putFirst.status).toBe(200);
    const putFirstData = await putFirst.json();
    expect(putFirstData.subscription.endpoint).toBe("https://push.example/endpoint-1");
    expect(putFirstData.subscription.expirationTime).toBe(1_800_000_000_000);

    const putUpdate = await fetchSocket("/notifications/push/subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPushSubscriptionPayload({
          expirationTime: null,
        })
      ),
    });
    expect(putUpdate.status).toBe(200);
    const putUpdateData = await putUpdate.json();
    expect(putUpdateData.subscription.expirationTime).toBeNull();

    const listAfterUpsert = await fetchSocket("/notifications/push/subscriptions");
    expect(listAfterUpsert.status).toBe(200);
    const listAfterUpsertData = await listAfterUpsert.json();
    expect(listAfterUpsertData.subscriptions).toHaveLength(1);
    expect(listAfterUpsertData.subscriptions[0].endpoint).toBe("https://push.example/endpoint-1");
    expect(listAfterUpsertData.subscriptions[0].expirationTime).toBeNull();

    const deleteFirst = await fetchSocket("/notifications/push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://push.example/endpoint-1" }),
    });
    expect(deleteFirst.status).toBe(200);
    expect(await deleteFirst.json()).toEqual({ success: true, deleted: true });

    const deleteAgain = await fetchSocket("/notifications/push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://push.example/endpoint-1" }),
    });
    expect(deleteAgain.status).toBe(200);
    expect(await deleteAgain.json()).toEqual({ success: true, deleted: false });
  });

  test("push subscription endpoint validation enforces https with localhost http exception", async () => {
    const insecureRemote = await fetchSocket("/notifications/push/subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPushSubscriptionPayload({
          endpoint: "http://push.example/insecure",
        })
      ),
    });
    expect(insecureRemote.status).toBe(400);

    const localhostHttp = await fetchSocket("/notifications/push/subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPushSubscriptionPayload({
          endpoint: "http://localhost:8787/dev-push",
        })
      ),
    });
    expect(localhostHttp.status).toBe(200);
    const localhostData = await localhostHttp.json();
    expect(localhostData.subscription.endpoint).toBe("http://localhost:8787/dev-push");

    const withCredentials = await fetchSocket("/notifications/push/subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPushSubscriptionPayload({
          endpoint: "https://user:pass@push.example/endpoint",
        })
      ),
    });
    expect(withCredentials.status).toBe(400);
  });

  test("returns validation errors for invalid notification queries and payloads", async () => {
    createSession("session-1");
    createNotification("session-1");

    const badUnread = await fetchSocket("/notifications?unreadOnly=1");
    expect(badUnread.status).toBe(400);

    const badBefore = await fetchSocket("/notifications?before=0");
    expect(badBefore.status).toBe(400);

    const badLimit = await fetchSocket("/notifications?limit=500");
    expect(badLimit.status).toBe(400);

    const unknownSession = await fetchSocket("/notifications?sessionId=missing-session");
    expect(unknownSession.status).toBe(404);

    const badSingleRead = await fetchSocket("/notifications/1/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readSource: "" }),
    });
    expect(badSingleRead.status).toBe(400);

    const tooLongSingleReadSource = await fetchSocket("/notifications/1/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readSource: "x".repeat(65) }),
    });
    expect(tooLongSingleReadSource.status).toBe(400);

    const badBulkRead = await fetchSocket("/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "" }),
    });
    expect(badBulkRead.status).toBe(400);

    const tooLongBulkReadSource = await fetchSocket("/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readSource: "x".repeat(65) }),
    });
    expect(tooLongBulkReadSource.status).toBe(400);

    const prefsMissingSession = await fetchSocket("/sessions/missing/notifications/prefs");
    expect(prefsMissingSession.status).toBe(404);

    const badPrefsUpdate = await fetchSocket("/sessions/session-1/notifications/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: "yes" }),
    });
    expect(badPrefsUpdate.status).toBe(400);

    const badPushKeys = await fetchSocket("/notifications/push/subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://push.example/endpoint-2",
        keys: {
          p256dh: "",
          auth: "auth-key",
        },
      }),
    });
    expect(badPushKeys.status).toBe(400);

    const badPushEndpoint = await fetchSocket("/notifications/push/subscriptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "not-a-valid-url",
        keys: {
          p256dh: "p256dh-key",
          auth: "auth-key",
        },
      }),
    });
    expect(badPushEndpoint.status).toBe(400);

    const badPushDelete = await fetchSocket("/notifications/push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "" }),
    });
    expect(badPushDelete.status).toBe(400);

    const badPushTest = await fetchSocket("/notifications/push/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: 42 }),
    });
    expect(badPushTest.status).toBe(400);
  });
});
