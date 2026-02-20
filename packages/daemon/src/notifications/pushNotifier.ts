import type { EventBus } from "@codepiper/core";
import webpush from "web-push";
import type { IDatabase, PushSubscriptionRecord } from "../db/db";

const DEFAULT_PUSH_SUBJECT = "mailto:push@codepiper.dev";
const PUSH_ENABLED_ENV = "CODEPIPER_PUSH_ENABLED";
const PUSH_PUBLIC_KEY_ENV = "CODEPIPER_PUSH_PUBLIC_KEY";
const PUSH_PRIVATE_KEY_ENV = "CODEPIPER_PUSH_PRIVATE_KEY";
const PUSH_SUBJECT_ENV = "CODEPIPER_PUSH_SUBJECT";

type ConsoleLike = Pick<Console, "warn" | "error">;

export interface NotificationCreatedEvent {
  id: number;
  sessionId: string;
  eventType: string;
  title: string;
  body: string | null;
  payload?: Record<string, unknown>;
}

export interface PushRuntimeStatus {
  enabled: boolean;
  configured: boolean;
  reasons: string[];
  publicKey: string | null;
}

export interface PushDeliveryResult {
  attempted: number;
  delivered: number;
  expired: number;
  failed: number;
  skipped: boolean;
  reason?: "not_available" | "no_subscriptions";
}

interface WebPushClient {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: {
      endpoint: string;
      expirationTime: number | null;
      keys: { p256dh: string; auth: string };
    },
    payload?: string
  ): Promise<unknown>;
}

type PushNotifierDatabase = Pick<IDatabase, "listPushSubscriptions" | "deletePushSubscription">;

export interface PushNotifierOptions {
  enabled?: boolean;
  vapidPublicKey?: string | null;
  vapidPrivateKey?: string | null;
  vapidSubject?: string | null;
  webPushClient?: WebPushClient;
  logger?: ConsoleLike;
}

function toTrimmedEnv(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNotificationCreatedEvent(value: unknown): value is NotificationCreatedEvent {
  if (!isRecord(value)) {
    return false;
  }

  const payload = value.payload;
  const payloadValid = payload === undefined || isRecord(payload);
  return (
    typeof value.id === "number" &&
    typeof value.sessionId === "string" &&
    typeof value.eventType === "string" &&
    typeof value.title === "string" &&
    (typeof value.body === "string" || value.body === null) &&
    payloadValid
  );
}

function isExpiredSubscriptionError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  const statusCode = error.statusCode;
  return statusCode === 404 || statusCode === 410;
}

function toWebPushSubscription(subscription: PushSubscriptionRecord): {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
} {
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  };
}

function resolveSessionLabel(event: NotificationCreatedEvent): string {
  if (isRecord(event.payload) && typeof event.payload.sessionLabel === "string") {
    const candidate = event.payload.sessionLabel.trim();
    if (candidate.length > 0) {
      return candidate;
    }
  }

  return `session ${event.sessionId.slice(0, 8)}`;
}

function bodyIncludesSessionLabel(body: string, sessionLabel: string): boolean {
  return body.toLocaleLowerCase().includes(sessionLabel.toLocaleLowerCase());
}

function ensureBodyIncludesSessionLabel(body: string | null, sessionLabel: string): string | null {
  if (!(typeof body === "string" && body.trim().length > 0)) {
    return null;
  }

  const normalized = body.trim();
  if (bodyIncludesSessionLabel(normalized, sessionLabel)) {
    return normalized;
  }

  return `${sessionLabel}: ${normalized}`;
}

function ensureTitleIncludesSessionLabel(title: string, sessionLabel: string): string {
  if (bodyIncludesSessionLabel(title, sessionLabel)) {
    return title;
  }
  return `${sessionLabel} · ${title}`;
}

function toNotificationPayload(event: NotificationCreatedEvent): string {
  const sessionLabel = resolveSessionLabel(event);
  const fallbackBody =
    event.eventType === "session.turn_completed"
      ? `${sessionLabel} is ready for your next prompt.`
      : event.eventType === "session.permission_required"
        ? `${sessionLabel} is waiting for your permission approval.`
        : event.eventType === "session.input_required"
          ? `${sessionLabel} is waiting for your input.`
          : `${sessionLabel} has an update: ${event.eventType.replaceAll(/[._]+/g, " ")}`;
  const body = ensureBodyIncludesSessionLabel(event.body, sessionLabel) ?? fallbackBody;
  const title = ensureTitleIncludesSessionLabel(event.title, sessionLabel);
  const payload = {
    title,
    body,
    sessionId: event.sessionId,
    sessionLabel,
    notificationId: event.id,
    url: `/sessions/${encodeURIComponent(event.sessionId)}/terminal`,
    tag: `codepiper:notification:${event.id}`,
  };
  return JSON.stringify(payload);
}

export class PushNotifier {
  private readonly db: PushNotifierDatabase;
  private readonly eventBus: EventBus<Record<string, unknown>>;
  private readonly logger: ConsoleLike;
  private readonly webPushClient: WebPushClient;
  private readonly enabled: boolean;
  private readonly configured: boolean;
  private readonly baseReasons: string[];
  private readonly publicKey: string | null;
  private unsubscribeNotificationCreated: (() => void) | null = null;
  private pendingEvents: NotificationCreatedEvent[] = [];
  private queueProcessing = false;

  constructor(
    db: PushNotifierDatabase,
    eventBus: EventBus<Record<string, unknown>>,
    options: PushNotifierOptions = {}
  ) {
    this.db = db;
    this.eventBus = eventBus;
    this.logger = options.logger ?? console;
    this.webPushClient = options.webPushClient ?? webpush;
    this.enabled = options.enabled ?? process.env[PUSH_ENABLED_ENV] === "1";
    this.baseReasons = [];
    this.publicKey = null;

    if (!this.enabled) {
      this.baseReasons.push("feature_disabled");
      this.configured = false;
      return;
    }

    const vapidPublicKey = toTrimmedEnv(
      options.vapidPublicKey ?? process.env[PUSH_PUBLIC_KEY_ENV] ?? null
    );
    const vapidPrivateKey = toTrimmedEnv(
      options.vapidPrivateKey ?? process.env[PUSH_PRIVATE_KEY_ENV] ?? null
    );
    const vapidSubject = toTrimmedEnv(
      options.vapidSubject ?? process.env[PUSH_SUBJECT_ENV] ?? DEFAULT_PUSH_SUBJECT
    );
    this.publicKey = vapidPublicKey || null;

    if (!vapidPublicKey) {
      this.baseReasons.push("missing_vapid_public_key");
    }
    if (!vapidPrivateKey) {
      this.baseReasons.push("missing_vapid_private_key");
    }
    if (!(vapidPublicKey && vapidPrivateKey)) {
      this.logger.warn(
        `[push] ${PUSH_ENABLED_ENV}=1 but VAPID keys are missing; push delivery disabled`
      );
      this.configured = false;
      return;
    }

    try {
      this.webPushClient.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      this.configured = true;
    } catch (error) {
      this.logger.error("[push] Failed to configure VAPID details; push delivery disabled", error);
      this.baseReasons.push("invalid_vapid_configuration");
      this.configured = false;
    }
  }

  getStatus(): PushRuntimeStatus {
    return {
      enabled: this.enabled,
      configured: this.configured,
      reasons: Array.from(new Set(this.baseReasons)),
      publicKey: this.publicKey,
    };
  }

  start(): void {
    if (!(this.enabled && this.configured) || this.unsubscribeNotificationCreated) {
      return;
    }

    this.unsubscribeNotificationCreated = this.eventBus.on("notification:created", (event) => {
      if (!isNotificationCreatedEvent(event)) {
        return;
      }
      this.pendingEvents.push(event);
      void this.drainQueue();
    });
  }

  stop(): void {
    if (this.unsubscribeNotificationCreated) {
      this.unsubscribeNotificationCreated();
      this.unsubscribeNotificationCreated = null;
    }
    this.pendingEvents = [];
  }

  async sendTestNotification(params?: {
    title?: string;
    body?: string;
    sessionId?: string;
  }): Promise<PushDeliveryResult> {
    if (!(this.enabled && this.configured)) {
      return {
        attempted: 0,
        delivered: 0,
        expired: 0,
        failed: 0,
        skipped: true,
        reason: "not_available",
      };
    }

    const subscriptions = this.db.listPushSubscriptions();
    if (subscriptions.length === 0) {
      return {
        attempted: 0,
        delivered: 0,
        expired: 0,
        failed: 0,
        skipped: true,
        reason: "no_subscriptions",
      };
    }

    const event: NotificationCreatedEvent = {
      id: Date.now(),
      sessionId: params?.sessionId?.trim() || "push-test",
      eventType: "session.turn_completed",
      title: params?.title?.trim() || "CodePiper test notification",
      body: params?.body?.trim() || "Push delivery is working.",
    };

    const payload = toNotificationPayload(event);
    return this.deliverPayloadToSubscriptions(payload, subscriptions);
  }

  private async drainQueue(): Promise<void> {
    if (this.queueProcessing) {
      return;
    }

    this.queueProcessing = true;
    try {
      while (this.pendingEvents.length > 0) {
        const event = this.pendingEvents.shift();
        if (!event) {
          continue;
        }
        await this.deliverEvent(event);
      }
    } finally {
      this.queueProcessing = false;
    }
  }

  private async deliverEvent(event: NotificationCreatedEvent): Promise<void> {
    const subscriptions = this.db.listPushSubscriptions();
    if (subscriptions.length === 0) {
      return;
    }

    const payload = toNotificationPayload(event);
    await this.deliverPayloadToSubscriptions(payload, subscriptions);
  }

  private async deliverPayloadToSubscriptions(
    payload: string,
    subscriptions: PushSubscriptionRecord[]
  ): Promise<PushDeliveryResult> {
    const result: PushDeliveryResult = {
      attempted: subscriptions.length,
      delivered: 0,
      expired: 0,
      failed: 0,
      skipped: false,
    };

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await this.webPushClient.sendNotification(toWebPushSubscription(subscription), payload);
          result.delivered += 1;
        } catch (error) {
          if (isExpiredSubscriptionError(error)) {
            this.db.deletePushSubscription(subscription.endpoint);
            result.expired += 1;
            return;
          }

          result.failed += 1;
          const statusCode =
            isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : "unknown";
          this.logger.warn(`[push] Delivery failed for a subscription (status=${statusCode})`);
        }
      })
    );

    return result;
  }
}
