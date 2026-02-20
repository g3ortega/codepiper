import { describe, expect, test } from "bun:test";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { PushNotifier } from "./pushNotifier";

interface FakePushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  expirationTime: number | null;
  createdAt: Date;
  updatedAt: Date;
}

function createSubscription(endpoint: string): FakePushSubscription {
  const now = new Date();
  return {
    endpoint,
    keys: {
      p256dh: `${endpoint}-p256dh`,
      auth: `${endpoint}-auth`,
    },
    expirationTime: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createSettings(
  overrides: Partial<{ notificationsEnabled: boolean; systemNotificationsEnabled: boolean }> = {}
) {
  return {
    preserveSessions: false,
    defaultPolicyAction: "ask" as const,
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
    notificationsEnabled: overrides.notificationsEnabled ?? true,
    systemNotificationsEnabled: overrides.systemNotificationsEnabled ?? true,
    notificationSoundsEnabled: true,
    notificationEventDefaults: {},
    notificationSoundMap: {},
    updatedAt: new Date(),
  };
}

function createNotificationCreatedEvent(
  overrides: Partial<{
    id: number;
    sessionId: string;
    eventType: string;
    title: string;
    body: string | null;
    payload: Record<string, unknown>;
  }> = {}
) {
  return {
    id: overrides.id ?? 1,
    sessionId: overrides.sessionId ?? "session-1",
    eventType: overrides.eventType ?? "session.turn_completed",
    title: overrides.title ?? "Claude finished a turn",
    body: overrides.body ?? null,
    payload: overrides.payload ?? { sessionLabel: "operator" },
  };
}

async function flushAsyncQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PushNotifier", () => {
  test("does not deliver when disabled", async () => {
    const eventBus = new EventBus<Record<string, unknown>>();
    const sentPayloads: string[] = [];
    const webPushClient = {
      setVapidDetails: () => {},
      sendNotification: async (_subscription: unknown, payload?: string) => {
        sentPayloads.push(payload ?? "");
      },
    };

    const db = {
      getDaemonSettings: () => createSettings(),
      listPushSubscriptions: () => [createSubscription("https://push.example/endpoint-1")],
      deletePushSubscription: () => false,
    };

    const notifier = new PushNotifier(db as any, eventBus, {
      enabled: false,
      webPushClient,
    });
    notifier.start();

    eventBus.emit("notification:created", createNotificationCreatedEvent());
    await flushAsyncQueue();

    expect(sentPayloads).toEqual([]);
  });

  test("warns and disables delivery when enabled but VAPID keys are missing", async () => {
    const eventBus = new EventBus<Record<string, unknown>>();
    const warnings: string[] = [];
    const sentPayloads: string[] = [];
    const webPushClient = {
      setVapidDetails: () => {},
      sendNotification: async (_subscription: unknown, payload?: string) => {
        sentPayloads.push(payload ?? "");
      },
    };

    const db = {
      getDaemonSettings: () => createSettings(),
      listPushSubscriptions: () => [createSubscription("https://push.example/endpoint-1")],
      deletePushSubscription: () => false,
    };

    const notifier = new PushNotifier(db as any, eventBus, {
      enabled: true,
      vapidPublicKey: "",
      vapidPrivateKey: "",
      webPushClient,
      logger: {
        warn: (message: string) => warnings.push(message),
        error: () => {},
      },
    });
    notifier.start();

    eventBus.emit("notification:created", createNotificationCreatedEvent());
    await flushAsyncQueue();

    expect(sentPayloads).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("VAPID keys are missing");
  });

  test("delivers payload to all stored subscriptions when enabled", async () => {
    const eventBus = new EventBus<Record<string, unknown>>();
    const delivered: Array<{ endpoint: string; payload: string }> = [];
    const webPushClient = {
      setVapidDetails: () => {},
      sendNotification: async (
        subscription: { endpoint: string },
        payload?: string
      ): Promise<void> => {
        delivered.push({ endpoint: subscription.endpoint, payload: payload ?? "" });
      },
    };

    const db = {
      getDaemonSettings: () => createSettings(),
      listPushSubscriptions: () => [
        createSubscription("https://push.example/endpoint-1"),
        createSubscription("https://push.example/endpoint-2"),
      ],
      deletePushSubscription: () => false,
    };

    const notifier = new PushNotifier(db as any, eventBus, {
      enabled: true,
      vapidPublicKey: "vapid-public",
      vapidPrivateKey: "vapid-private",
      vapidSubject: "mailto:test@example.com",
      webPushClient,
    });
    notifier.start();

    eventBus.emit(
      "notification:created",
      createNotificationCreatedEvent({
        id: 42,
        sessionId: "session-42",
        title: "Turn complete",
      })
    );
    await flushAsyncQueue();

    expect(delivered).toHaveLength(2);
    expect(delivered[0].endpoint).toContain("endpoint-1");
    expect(delivered[1].endpoint).toContain("endpoint-2");

    const payload = JSON.parse(delivered[0].payload);
    expect(payload.notificationId).toBe(42);
    expect(payload.sessionId).toBe("session-42");
    expect(payload.url).toBe("/sessions/session-42/terminal");
    expect(payload.tag).toBe("codepiper:notification:42");
  });

  test("uses permission-required fallback body when notification body is missing", async () => {
    const eventBus = new EventBus<Record<string, unknown>>();
    const delivered: Array<{ endpoint: string; payload: string }> = [];
    const webPushClient = {
      setVapidDetails: () => {},
      sendNotification: async (
        subscription: { endpoint: string },
        payload?: string
      ): Promise<void> => {
        delivered.push({ endpoint: subscription.endpoint, payload: payload ?? "" });
      },
    };

    const db = {
      getDaemonSettings: () => createSettings(),
      listPushSubscriptions: () => [createSubscription("https://push.example/endpoint-1")],
      deletePushSubscription: () => false,
    };

    const notifier = new PushNotifier(db as any, eventBus, {
      enabled: true,
      vapidPublicKey: "vapid-public",
      vapidPrivateKey: "vapid-private",
      webPushClient,
    });
    notifier.start();

    eventBus.emit(
      "notification:created",
      createNotificationCreatedEvent({
        id: 77,
        eventType: "session.permission_required",
        title: "Permission required",
      })
    );
    await flushAsyncQueue();

    expect(delivered).toHaveLength(1);
    const payload = JSON.parse(delivered[0].payload);
    expect(payload.body).toBe("operator is waiting for your permission approval.");
    expect(payload.notificationId).toBe(77);
  });

  test("delivers when daemon system notifications are disabled", async () => {
    const eventBus = new EventBus<Record<string, unknown>>();
    const delivered: Array<{ endpoint: string; payload: string }> = [];
    const webPushClient = {
      setVapidDetails: () => {},
      sendNotification: async (
        subscription: { endpoint: string },
        payload?: string
      ): Promise<void> => {
        delivered.push({ endpoint: subscription.endpoint, payload: payload ?? "" });
      },
    };

    const db = {
      getDaemonSettings: () => createSettings({ systemNotificationsEnabled: false }),
      listPushSubscriptions: () => [createSubscription("https://push.example/endpoint-1")],
      deletePushSubscription: () => false,
    };

    const notifier = new PushNotifier(db as any, eventBus, {
      enabled: true,
      vapidPublicKey: "vapid-public",
      vapidPrivateKey: "vapid-private",
      webPushClient,
    });
    notifier.start();

    eventBus.emit("notification:created", createNotificationCreatedEvent());
    await flushAsyncQueue();

    expect(delivered).toHaveLength(1);
  });

  test("deletes expired subscriptions when push endpoint returns 410", async () => {
    const eventBus = new EventBus<Record<string, unknown>>();
    const deletedEndpoints: string[] = [];
    const webPushClient = {
      setVapidDetails: () => {},
      sendNotification: async (subscription: { endpoint: string }): Promise<void> => {
        if (subscription.endpoint.includes("expired")) {
          throw { statusCode: 410 };
        }
      },
    };

    const db = {
      getDaemonSettings: () => createSettings(),
      listPushSubscriptions: () => [
        createSubscription("https://push.example/expired-endpoint"),
        createSubscription("https://push.example/active-endpoint"),
      ],
      deletePushSubscription: (endpoint: string) => {
        deletedEndpoints.push(endpoint);
        return true;
      },
    };

    const notifier = new PushNotifier(db as any, eventBus, {
      enabled: true,
      vapidPublicKey: "vapid-public",
      vapidPrivateKey: "vapid-private",
      webPushClient,
    });
    notifier.start();

    eventBus.emit("notification:created", createNotificationCreatedEvent());
    await flushAsyncQueue();

    expect(deletedEndpoints).toEqual(["https://push.example/expired-endpoint"]);
  });

  test("does not gate delivery on daemon notification settings at runtime", async () => {
    const eventBus = new EventBus<Record<string, unknown>>();
    const delivered: Array<{ endpoint: string; payload: string }> = [];
    const webPushClient = {
      setVapidDetails: () => {},
      sendNotification: async (
        subscription: { endpoint: string },
        payload?: string
      ): Promise<void> => {
        delivered.push({ endpoint: subscription.endpoint, payload: payload ?? "" });
      },
    };

    const db = new Database(":memory:");
    await db.init();
    db.upsertPushSubscription({
      endpoint: "https://push.example/runtime-endpoint",
      expirationTime: null,
      keys: {
        p256dh: "runtime-p256dh",
        auth: "runtime-auth",
      },
    });

    const notifier = new PushNotifier(db, eventBus, {
      enabled: true,
      vapidPublicKey: "vapid-public",
      vapidPrivateKey: "vapid-private",
      webPushClient,
    });
    notifier.start();

    eventBus.emit("notification:created", createNotificationCreatedEvent({ id: 1 }));
    await flushAsyncQueue();
    expect(delivered).toHaveLength(1);

    db.updateDaemonSettings({
      notificationsEnabled: true,
      systemNotificationsEnabled: false,
    });
    eventBus.emit("notification:created", createNotificationCreatedEvent({ id: 2 }));
    await flushAsyncQueue();
    expect(delivered).toHaveLength(2);

    db.updateDaemonSettings({
      systemNotificationsEnabled: true,
    });
    eventBus.emit("notification:created", createNotificationCreatedEvent({ id: 3 }));
    await flushAsyncQueue();
    expect(delivered).toHaveLength(3);

    const payload = JSON.parse(delivered[2].payload);
    expect(payload.notificationId).toBe(3);
    expect(payload.sessionId).toBe("session-1");

    notifier.stop();
    db.close();
  });
});
