import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "@/lib/api";
import { BUILTIN_NOTIFICATION_SOUND_DEFAULT } from "@/lib/notificationSounds";
import { getServiceWorkerUrl, sendSkipWaiting } from "@/lib/serviceWorker";
import { websocketManager } from "@/lib/websocket";
import type {
  PushSubscriptionPayload,
  SessionNotificationCounts,
  SessionNotificationRecord,
} from "@/types/api";
import type { WsNotificationsPayload } from "@/types/websocket";

const EMPTY_NOTIFICATION_COUNTS: SessionNotificationCounts = {
  totalUnread: 0,
  bySession: {},
};

interface NotificationRuntimeSettings {
  notificationsEnabled: boolean;
  systemNotificationsEnabled: boolean;
  notificationSoundsEnabled: boolean;
  notificationEventDefaults: Record<string, boolean>;
  notificationSoundMap: Record<string, string>;
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationRuntimeSettings = {
  notificationsEnabled: false,
  systemNotificationsEnabled: false,
  notificationSoundsEnabled: true,
  notificationEventDefaults: {},
  notificationSoundMap: { default: BUILTIN_NOTIFICATION_SOUND_DEFAULT },
};

interface NotificationState {
  counts: SessionNotificationCounts;
  settings: NotificationRuntimeSettings;
  lastCreatedNotification: SessionNotificationRecord | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  clearLastCreatedNotification: (id?: number) => void;
}

const NotificationContext = createContext<NotificationState | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeNotificationCounts(value: unknown): SessionNotificationCounts {
  if (!isRecord(value)) {
    return EMPTY_NOTIFICATION_COUNTS;
  }

  const rawBySession = isRecord(value.bySession) ? value.bySession : {};
  const bySession = Object.entries(rawBySession).reduce<Record<string, number>>(
    (acc, [sessionId, count]) => {
      const safeCount = toNonNegativeInteger(count);
      if (safeCount > 0) {
        acc[sessionId] = safeCount;
      }
      return acc;
    },
    {}
  );

  return {
    totalUnread: toNonNegativeInteger(value.totalUnread),
    bySession,
  };
}

function isNotificationCountsPayload(
  payload: WsNotificationsPayload
): payload is Extract<WsNotificationsPayload, { type: "notification_counts_updated" }> {
  return payload.type === "notification_counts_updated" && isRecord(payload.data);
}

function isApiStatusCode(error: unknown, expectedStatus: number): boolean {
  if (!isRecord(error)) {
    return false;
  }
  return typeof error.status === "number" && error.status === expectedStatus;
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return null;
}

function isPushSubscriptionSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function getConfiguredPushPublicKey(): string | null {
  const raw = import.meta.env.VITE_PUSH_PUBLIC_KEY;
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  return raw.trim();
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = window.atob(normalized);
  const output = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let i = 0; i < decoded.length; i += 1) {
    output[i] = decoded.charCodeAt(i);
  }
  return output.buffer;
}

function toBase64Url(value: ArrayBuffer | null): string | null {
  if (!value) {
    return null;
  }

  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pushSubscriptionUsesPublicKey(subscription: PushSubscription, publicKey: string): boolean {
  const applicationServerKey = subscription.options?.applicationServerKey;
  if (!applicationServerKey) {
    // Some browsers don't expose the key for existing subscriptions.
    return true;
  }
  return toBase64Url(applicationServerKey) === publicKey;
}

function toPushSubscriptionPayload(subscription: PushSubscription): PushSubscriptionPayload | null {
  const p256dh = toBase64Url(subscription.getKey("p256dh"));
  const auth = toBase64Url(subscription.getKey("auth"));
  if (!(p256dh && auth)) {
    return null;
  }

  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh,
      auth,
    },
  };
}

async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSubscriptionSupported()) {
    return null;
  }

  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) {
      sendSkipWaiting(existing);
      return existing;
    }
    const registered = await navigator.serviceWorker.register(getServiceWorkerUrl());
    sendSkipWaiting(registered);
    return registered;
  } catch {
    return null;
  }
}

function parseNotificationRecord(value: unknown): SessionNotificationRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "number" || typeof value.sessionId !== "string") {
    return null;
  }
  if (typeof value.title !== "string" || typeof value.eventType !== "string") {
    return null;
  }
  const createdAt = parseIsoDate(value.createdAt);
  if (!createdAt) {
    return null;
  }

  return {
    id: value.id,
    sessionId: value.sessionId,
    provider: typeof value.provider === "string" ? value.provider : "unknown",
    eventType: value.eventType,
    sourceEventId: typeof value.sourceEventId === "number" ? value.sourceEventId : null,
    title: value.title,
    body: typeof value.body === "string" ? value.body : null,
    payload: isRecord(value.payload) ? value.payload : {},
    createdAt,
    readAt: parseIsoDate(value.readAt),
    readSource: typeof value.readSource === "string" ? value.readSource : null,
  };
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<SessionNotificationCounts>(EMPTY_NOTIFICATION_COUNTS);
  const [settings, setSettings] = useState<NotificationRuntimeSettings>(
    DEFAULT_NOTIFICATION_SETTINGS
  );
  const [lastCreatedNotification, setLastCreatedNotification] =
    useState<SessionNotificationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await api.getNotificationCounts();
      setCounts(normalizeNotificationCounts(response.counts));
      setError(null);
    } catch (err) {
      // Backward-compatibility path while older daemons are still in mixed rollout.
      if (isApiStatusCode(err, 404)) {
        setCounts(EMPTY_NOTIFICATION_COUNTS);
        setError(null);
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to load notifications";
      setError(message);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const response = await api.getDaemonSettings();
      const persistedSoundMap = response.settings.notificationSoundMap ?? {};
      setSettings({
        notificationsEnabled: response.settings.notificationsEnabled ?? false,
        systemNotificationsEnabled: response.settings.systemNotificationsEnabled ?? false,
        notificationSoundsEnabled: response.settings.notificationSoundsEnabled ?? true,
        notificationEventDefaults: response.settings.notificationEventDefaults ?? {},
        notificationSoundMap: {
          default: BUILTIN_NOTIFICATION_SOUND_DEFAULT,
          ...persistedSoundMap,
        },
      });
    } catch (err) {
      if (isApiStatusCode(err, 404)) {
        setSettings(DEFAULT_NOTIFICATION_SETTINGS);
      }
    }
  }, []);

  const clearLastCreatedNotification = useCallback((id?: number) => {
    setLastCreatedNotification((current) => {
      if (!current) {
        return null;
      }
      if (typeof id === "number" && current.id !== id) {
        return current;
      }
      return null;
    });
  }, []);

  useEffect(() => {
    let isActive = true;

    setLoading(true);
    void Promise.all([refresh(), refreshSettings()]).finally(() => {
      if (isActive) {
        setLoading(false);
      }
    });

    const unsubscribeNotifications = websocketManager.subscribe("notifications", (payload) => {
      if (payload.type === "notification_created") {
        const notification = parseNotificationRecord(payload.data);
        if (notification) {
          setLastCreatedNotification(notification);
        }
        return;
      }

      if (!isNotificationCountsPayload(payload)) {
        return;
      }
      setCounts(normalizeNotificationCounts(payload.data));
    });

    const unsubscribeConnection = websocketManager.onConnectionChange((connected) => {
      if (!connected) {
        return;
      }
      void refresh();
      void refreshSettings();
    });

    return () => {
      isActive = false;
      unsubscribeNotifications();
      unsubscribeConnection();
    };
  }, [refresh, refreshSettings]);

  useEffect(() => {
    if (!(settings.notificationsEnabled && settings.systemNotificationsEnabled)) {
      return;
    }
    if (!isPushSubscriptionSupported()) {
      return;
    }
    if (
      typeof window === "undefined" ||
      typeof window.Notification === "undefined" ||
      window.Notification.permission !== "granted"
    ) {
      return;
    }

    let cancelled = false;

    const ensurePushSubscription = async () => {
      try {
        const runtimePublicKey = async (): Promise<string | null> => {
          const envKey = getConfiguredPushPublicKey();
          if (envKey) {
            return envKey;
          }

          try {
            const response = await api.getPushDeliveryStatus();
            const daemonKey = response.status.publicKey;
            if (typeof daemonKey === "string" && daemonKey.trim() !== "") {
              return daemonKey.trim();
            }
          } catch {
            // Ignore and fallback to null.
          }

          return null;
        };

        const publicKey = await runtimePublicKey();
        if (!publicKey || cancelled) {
          return;
        }

        const registration = await ensureServiceWorkerRegistration();
        if (!(registration && !cancelled)) {
          return;
        }

        let subscription = await registration.pushManager.getSubscription();
        if (subscription && !pushSubscriptionUsesPublicKey(subscription, publicKey)) {
          const staleEndpoint = subscription.endpoint;
          await api.deletePushSubscription(staleEndpoint).catch(() => undefined);
          await subscription.unsubscribe().catch(() => undefined);
          subscription = null;
        }

        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64UrlToArrayBuffer(publicKey),
          });
        }

        if (!(subscription && !cancelled)) {
          return;
        }

        const payload = toPushSubscriptionPayload(subscription);
        if (!payload) {
          return;
        }

        await api.upsertPushSubscription(payload);
      } catch {
        // Best-effort sync only; UI controls show detailed health/errors.
      }
    };

    void ensurePushSubscription();

    return () => {
      cancelled = true;
    };
  }, [settings.notificationsEnabled, settings.systemNotificationsEnabled]);

  const value = useMemo<NotificationState>(
    () => ({
      counts,
      settings,
      lastCreatedNotification,
      loading,
      error,
      refresh,
      refreshSettings,
      clearLastCreatedNotification,
    }),
    [
      counts,
      settings,
      lastCreatedNotification,
      loading,
      error,
      refresh,
      refreshSettings,
      clearLastCreatedNotification,
    ]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationState {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
}
