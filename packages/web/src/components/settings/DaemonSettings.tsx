import { Bell, Bug, Key, RefreshCw, RotateCcw, Shield, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useNotifications } from "@/contexts/NotificationContext";
import { api } from "@/lib/api";
import {
  BUILTIN_NOTIFICATION_SOUND_DEFAULT,
  isLikelyAudioFile,
  KNOWN_NOTIFICATION_EVENT_OPTIONS,
  MAX_NOTIFICATION_SOUND_BYTES,
  resolveNotificationSoundSource,
} from "@/lib/notificationSounds";
import { getServiceWorkerUrl, sendSkipWaiting } from "@/lib/serviceWorker";
import { cn } from "@/lib/utils";
import type {
  DaemonSettings as DaemonSettingsPayload,
  DaemonTerminalFeaturesSettings,
  PushDeliveryStatus,
  PushSubscriptionPayload,
  PushSubscriptionRecord,
} from "@/types/api";

type FeatureEnabledKey =
  | "wsPtyPasteEnabled"
  | "latencyProbesEnabled"
  | "diagnosticsPanelEnabled"
  | "codexAppServerSpikeEnabled";

interface TerminalFeatureRow {
  enabledKey: FeatureEnabledKey;
  label: string;
  description: string;
}

interface SettingToggleProps {
  checked: boolean;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  compact?: boolean;
  title?: string;
}

function SettingToggle({
  checked,
  onClick,
  disabled = false,
  danger = false,
  compact = false,
  title,
}: SettingToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50",
        compact ? "h-5 w-9" : "h-6 w-11",
        checked
          ? danger
            ? "border-red-400/70 bg-red-500/95"
            : "border-cyan-400/70 bg-cyan-500/95"
          : "border-border/70 bg-muted-foreground/25"
      )}
    >
      <span
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-transform",
          compact ? "h-4 w-4" : "h-5 w-5",
          checked ? (compact ? "translate-x-4" : "translate-x-5") : "translate-x-0"
        )}
      />
    </button>
  );
}

const TERMINAL_FEATURE_ROWS: TerminalFeatureRow[] = [
  {
    enabledKey: "wsPtyPasteEnabled",
    label: "WS PTY paste transport",
    description: "Enables pty_paste chunk transport for large clipboard input.",
  },
  {
    enabledKey: "latencyProbesEnabled",
    label: "Terminal latency probes",
    description: "Captures key-to-echo, scroll-to-paint, and reconnect-resync latency metrics.",
  },
  {
    enabledKey: "diagnosticsPanelEnabled",
    label: "Hidden diagnostics panel",
    description: "Allows Ctrl/Cmd+Shift+D diagnostics overlay in terminal view.",
  },
  {
    enabledKey: "codexAppServerSpikeEnabled",
    label: "Codex app-server spike (scaffold)",
    description:
      "Experimental provider wiring path for future Codex app-server transport; currently no-op runtime scaffold.",
  },
];

function getDefaultTerminalFeatures(): DaemonTerminalFeaturesSettings {
  return {
    wsPtyPasteEnabled: true,
    latencyProbesEnabled: true,
    diagnosticsPanelEnabled: false,
    codexAppServerSpikeEnabled: false,
    wsPtyPasteCanaryPercent: 100,
    latencyProbesCanaryPercent: 100,
    diagnosticsPanelCanaryPercent: 0,
  };
}

type BrowserNotificationPermission = NotificationPermission | "unsupported";
type PushSubscriptionSyncReason =
  | "unsupported"
  | "permission_denied"
  | "missing_key"
  | "missing_keys"
  | "not_subscribed";
type PushSubscriptionSyncResult =
  | { status: "synced" }
  | { status: "skipped"; reason: PushSubscriptionSyncReason }
  | { status: "error"; message: string };

interface PushSubscriptionHealth {
  localEndpoint: string | null;
  daemonHasLocalEndpoint: boolean;
  daemonSubscriptionCount: number;
  checkedAt: number | null;
}

const PUSH_STATUS_REASON_LABELS: Record<string, string> = {
  feature_disabled: "Daemon push feature is disabled (`CODEPIPER_PUSH_ENABLED` != 1).",
  missing_vapid_public_key: "Daemon VAPID public key is missing (`CODEPIPER_PUSH_PUBLIC_KEY`).",
  missing_vapid_private_key: "Daemon VAPID private key is missing (`CODEPIPER_PUSH_PRIVATE_KEY`).",
  invalid_vapid_configuration: "Daemon VAPID configuration is invalid.",
  daemon_notifications_disabled: "Global notifications are disabled in daemon settings.",
  daemon_system_notifications_disabled: "System notifications are disabled in daemon settings.",
  not_available: "Daemon push runtime status is unavailable.",
};

function formatPushStatusReason(reason: string): string {
  return PUSH_STATUS_REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") {
    return "unsupported";
  }

  if (!window.isSecureContext) {
    return "unsupported";
  }

  return window.Notification.permission;
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
    // Some browsers do not expose the key back on existing subscriptions.
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

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read sound file"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read sound file"));
    reader.readAsDataURL(file);
  });
}

export function DaemonSettings() {
  const { refreshSettings: refreshNotificationRuntimeSettings } = useNotifications();
  const [preserveSessions, setPreserveSessions] = useState(false);
  const [defaultPolicyAction, setDefaultPolicyAction] = useState<"ask" | "deny">("ask");
  const [forwardSshAuthSock, setForwardSshAuthSock] = useState(true);
  const [codexHostAccessProfileEnabled, setCodexHostAccessProfileEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [systemNotificationsEnabled, setSystemNotificationsEnabled] = useState(false);
  const [notificationSoundsEnabled, setNotificationSoundsEnabled] = useState(true);
  const [notificationEventDefaults, setNotificationEventDefaults] = useState<
    Record<string, boolean>
  >({});
  const [notificationSoundMap, setNotificationSoundMap] = useState<Record<string, string>>({
    default: BUILTIN_NOTIFICATION_SOUND_DEFAULT,
  });
  const [uploadingSoundKey, setUploadingSoundKey] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermission>(() => getBrowserNotificationPermission());
  const [pushHealth, setPushHealth] = useState<PushSubscriptionHealth>({
    localEndpoint: null,
    daemonHasLocalEndpoint: false,
    daemonSubscriptionCount: 0,
    checkedAt: null,
  });
  const [pushHealthLoading, setPushHealthLoading] = useState(false);
  const [pushHealthError, setPushHealthError] = useState<string | null>(null);
  const [pushRuntimeStatus, setPushRuntimeStatus] = useState<PushDeliveryStatus | null>(null);
  const [pushRuntimeError, setPushRuntimeError] = useState<string | null>(null);
  const [sendingPushTest, setSendingPushTest] = useState(false);
  const [terminalFeatures, setTerminalFeatures] = useState<DaemonTerminalFeaturesSettings>(
    getDefaultTerminalFeatures()
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const syncFromSettings = useCallback((settings: DaemonSettingsPayload) => {
    setPreserveSessions(settings.preserveSessions);
    setDefaultPolicyAction(settings.defaultPolicyAction ?? "ask");
    setForwardSshAuthSock(settings.forwardSshAuthSock ?? true);
    setCodexHostAccessProfileEnabled(settings.codexHostAccessProfileEnabled ?? false);
    setNotificationsEnabled(settings.notificationsEnabled ?? false);
    setSystemNotificationsEnabled(settings.systemNotificationsEnabled ?? false);
    setNotificationSoundsEnabled(settings.notificationSoundsEnabled ?? true);
    setNotificationEventDefaults(settings.notificationEventDefaults ?? {});
    setNotificationSoundMap({
      default: BUILTIN_NOTIFICATION_SOUND_DEFAULT,
      ...(settings.notificationSoundMap ?? {}),
    });
    setNotificationPermission(getBrowserNotificationPermission());
    const nextFeatures = settings.terminalFeatures ?? getDefaultTerminalFeatures();
    setTerminalFeatures(nextFeatures);
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const { settings } = await api.getDaemonSettings();
      syncFromSettings(settings);
    } catch {
      toast.error("Failed to load daemon settings");
    } finally {
      setLoading(false);
    }
  }, [syncFromSettings]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateSettings = useCallback(
    async (params: {
      preserveSessions?: boolean;
      defaultPolicyAction?: "ask" | "deny";
      forwardSshAuthSock?: boolean;
      codexHostAccessProfileEnabled?: boolean;
      notificationsEnabled?: boolean;
      systemNotificationsEnabled?: boolean;
      notificationSoundsEnabled?: boolean;
      notificationEventDefaults?: Record<string, boolean>;
      notificationSoundMap?: Record<string, string>;
      terminalFeatures?: Partial<DaemonTerminalFeaturesSettings>;
    }) => {
      setSaving(true);
      try {
        const { settings } = await api.updateDaemonSettings(params);
        syncFromSettings(settings);
        void refreshNotificationRuntimeSettings();
        return settings;
      } finally {
        setSaving(false);
      }
    },
    [refreshNotificationRuntimeSettings, syncFromSettings]
  );

  const handleTogglePreserve = async () => {
    const nextValue = !preserveSessions;
    try {
      await updateSettings({ preserveSessions: nextValue });
      toast.success(
        nextValue
          ? "Sessions will be preserved on daemon restart"
          : "Sessions will be stopped on daemon shutdown"
      );
    } catch {
      toast.error("Failed to update setting");
    }
  };

  const handleTogglePolicy = async () => {
    const nextValue = defaultPolicyAction === "deny" ? "ask" : "deny";
    try {
      await updateSettings({ defaultPolicyAction: nextValue });
      toast.success(
        nextValue === "deny"
          ? "Unmatched permissions will now be denied by default"
          : "Unmatched permissions will now prompt for approval"
      );
    } catch {
      toast.error("Failed to update setting");
    }
  };

  const handleToggleSshForward = async () => {
    const nextValue = !forwardSshAuthSock;
    try {
      await updateSettings({ forwardSshAuthSock: nextValue });
      toast.success(
        nextValue
          ? "SSH agent forwarding is enabled for new sessions"
          : "SSH agent forwarding is disabled for new sessions"
      );
    } catch {
      toast.error("Failed to update setting");
    }
  };

  const handleToggleCodexHostAccessProfile = async () => {
    const nextValue = !codexHostAccessProfileEnabled;
    try {
      await updateSettings({ codexHostAccessProfileEnabled: nextValue });
      toast.success(
        nextValue
          ? "Codex host-access profile enabled for new Codex sessions"
          : "Codex host-access profile disabled"
      );
    } catch {
      toast.error("Failed to update setting");
    }
  };

  const handleToggleTerminalFeature = async (row: TerminalFeatureRow) => {
    const nextValue = !terminalFeatures[row.enabledKey];
    const patch = { [row.enabledKey]: nextValue } as Partial<DaemonTerminalFeaturesSettings>;
    try {
      await updateSettings({ terminalFeatures: patch });
      toast.success(`${row.label} ${nextValue ? "enabled" : "disabled"}`);
    } catch {
      toast.error(`Failed to update ${row.label}`);
    }
  };

  const handleToggleNotifications = async () => {
    const nextValue = !notificationsEnabled;
    try {
      await updateSettings({ notificationsEnabled: nextValue });
      toast.success(nextValue ? "Notifications enabled" : "Notifications disabled");
    } catch {
      toast.error("Failed to update notification setting");
    }
  };

  const handleToggleNotificationSounds = async () => {
    if (!notificationsEnabled) {
      return;
    }
    const nextValue = !notificationSoundsEnabled;
    try {
      await updateSettings({ notificationSoundsEnabled: nextValue });
      toast.success(nextValue ? "Notification sounds enabled" : "Notification sounds disabled");
    } catch {
      toast.error("Failed to update notification sound setting");
    }
  };

  const resolvePushPublicKey = useCallback((): string | null => {
    const envKey = getConfiguredPushPublicKey();
    if (envKey) {
      return envKey;
    }
    if (typeof pushRuntimeStatus?.publicKey === "string" && pushRuntimeStatus.publicKey.trim()) {
      return pushRuntimeStatus.publicKey.trim();
    }
    return null;
  }, [pushRuntimeStatus?.publicKey]);

  const syncPushSubscription = useCallback(
    async (options?: { forceRenew?: boolean }): Promise<PushSubscriptionSyncResult> => {
      if (!isPushSubscriptionSupported()) {
        return { status: "skipped", reason: "unsupported" };
      }

      if (getBrowserNotificationPermission() !== "granted") {
        return { status: "skipped", reason: "permission_denied" };
      }

      const registration = await ensureServiceWorkerRegistration();
      if (!registration) {
        return { status: "error", message: "Service worker is not available for push sync" };
      }

      const publicKey = resolvePushPublicKey();
      let subscription = await registration.pushManager.getSubscription();

      if (options?.forceRenew && subscription) {
        try {
          await api.deletePushSubscription(subscription.endpoint);
        } catch {
          // Continue local cleanup.
        }
        await subscription.unsubscribe().catch(() => undefined);
        subscription = null;
      }

      if (subscription && publicKey && !pushSubscriptionUsesPublicKey(subscription, publicKey)) {
        // Re-subscribe when keys changed so daemon can deliver with current VAPID pair.
        try {
          await api.deletePushSubscription(subscription.endpoint);
        } catch {
          // Continue local cleanup.
        }
        await subscription.unsubscribe().catch(() => undefined);
        subscription = null;
      }

      if (!subscription) {
        if (!publicKey) {
          return { status: "skipped", reason: "missing_key" };
        }
        try {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64UrlToArrayBuffer(publicKey),
          });
        } catch (error) {
          return {
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Push subscription request failed unexpectedly",
          };
        }
      }

      const payload = toPushSubscriptionPayload(subscription);
      if (!payload) {
        return { status: "skipped", reason: "missing_keys" };
      }

      try {
        await api.upsertPushSubscription(payload);
        return { status: "synced" };
      } catch (error) {
        return {
          status: "error",
          message:
            error instanceof Error ? error.message : "Failed to sync push subscription with daemon",
        };
      }
    },
    [resolvePushPublicKey]
  );

  const removePushSubscription = useCallback(async (): Promise<PushSubscriptionSyncResult> => {
    if (!isPushSubscriptionSupported()) {
      return { status: "skipped", reason: "unsupported" };
    }

    const registration = await ensureServiceWorkerRegistration();
    if (!registration) {
      return { status: "error", message: "Service worker is not available for push cleanup" };
    }

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      return { status: "skipped", reason: "not_subscribed" };
    }

    try {
      await api.deletePushSubscription(subscription.endpoint);
    } catch {
      // If daemon-side delete fails, continue best-effort unsubscribe locally.
    }

    try {
      await subscription.unsubscribe();
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to unsubscribe push subscription",
      };
    }

    return { status: "synced" };
  }, []);

  const refreshPushHealth = useCallback(async () => {
    setPushHealthLoading(true);
    setPushHealthError(null);
    setPushRuntimeError(null);

    try {
      let localEndpoint: string | null = null;
      if (isPushSubscriptionSupported()) {
        const registration = await ensureServiceWorkerRegistration();
        if (registration) {
          const localSubscription = await registration.pushManager.getSubscription();
          localEndpoint = localSubscription?.endpoint ?? null;
        }
      }

      let subscriptions: PushSubscriptionRecord[] = [];
      try {
        const response = await api.listPushSubscriptions();
        subscriptions = response.subscriptions;
      } catch (error) {
        setPushHealthError(
          error instanceof Error ? error.message : "Failed to load daemon push subscriptions"
        );
      }

      try {
        const runtime = await api.getPushDeliveryStatus();
        setPushRuntimeStatus(runtime.status);
      } catch (error) {
        setPushRuntimeStatus(null);
        setPushRuntimeError(
          error instanceof Error ? error.message : "Failed to load daemon push runtime status"
        );
      }

      setPushHealth({
        localEndpoint,
        daemonHasLocalEndpoint:
          localEndpoint !== null && subscriptions.some((item) => item.endpoint === localEndpoint),
        daemonSubscriptionCount: subscriptions.length,
        checkedAt: Date.now(),
      });
    } finally {
      setPushHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPushHealth();
  }, [refreshPushHealth]);

  const handleResyncPushSubscription = async () => {
    const result = await syncPushSubscription({ forceRenew: true });
    if (result.status === "synced") {
      toast.success("Push subscription synced");
    } else if (result.status === "skipped") {
      if (result.reason === "missing_key") {
        toast.error("Cannot sync push subscription: daemon/web push public key is unavailable");
      } else if (result.reason === "permission_denied") {
        toast.error("Cannot sync push subscription: notification permission is not granted");
      } else if (result.reason === "unsupported") {
        toast.error("Push is not supported on this browser");
      } else {
        toast.error("Push subscription is not available to sync");
      }
    } else {
      toast.error(`Push sync failed: ${result.message}`);
    }
    await refreshPushHealth();
  };

  const handleSendPushTest = async () => {
    if (sendingPushTest) {
      return;
    }

    setSendingPushTest(true);
    try {
      let { result } = await api.sendTestPushNotification();

      if (!result.skipped && result.delivered === 0 && result.failed > 0) {
        const renewResult = await syncPushSubscription({ forceRenew: true });
        if (renewResult.status === "synced") {
          const retry = await api.sendTestPushNotification();
          result = retry.result;
        }
      }

      if (result.skipped) {
        if (result.reason === "no_subscriptions") {
          toast.error("Cannot send test push: no browser subscription is registered");
        } else {
          toast.error("Cannot send test push: daemon push runtime is unavailable");
        }
      } else if (result.delivered > 0) {
        const details =
          result.failed > 0 || result.expired > 0
            ? ` (${result.failed} failed, ${result.expired} expired)`
            : "";
        toast.success(`Test push delivered to ${result.delivered}/${result.attempted}${details}`);
      } else {
        toast.error(
          `Test push reached 0/${result.attempted} subscriptions (${result.failed} failed, ${result.expired} expired)`
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send test push notification");
    } finally {
      setSendingPushTest(false);
      await refreshPushHealth();
    }
  };

  const handleToggleSystemNotifications = async () => {
    if (!notificationsEnabled) {
      return;
    }

    const nextValue = !systemNotificationsEnabled;

    if (!nextValue) {
      try {
        const cleanupResult = await removePushSubscription();
        await updateSettings({ systemNotificationsEnabled: false });
        await refreshPushHealth();
        toast.success("System notifications disabled");
        if (cleanupResult.status === "error") {
          toast.error(`Push cleanup warning: ${cleanupResult.message}`);
        }
      } catch {
        toast.error("Failed to update system notification setting");
      }
      return;
    }

    const permissionBefore = getBrowserNotificationPermission();
    setNotificationPermission(permissionBefore);

    if (permissionBefore === "unsupported") {
      toast.error("System notifications are unavailable on this browser or origin");
      return;
    }

    try {
      const permission =
        permissionBefore === "granted" ? "granted" : await window.Notification.requestPermission();
      setNotificationPermission(permission);

      if (permission !== "granted") {
        await updateSettings({ systemNotificationsEnabled: false });
        toast.error("System notification permission was not granted");
        return;
      }

      const pushSyncResult = await syncPushSubscription();
      await updateSettings({ systemNotificationsEnabled: true });
      await refreshPushHealth();
      if (pushSyncResult.status === "synced") {
        toast.success("System notifications enabled (push synced)");
      } else if (pushSyncResult.status === "skipped") {
        if (pushSyncResult.reason === "missing_key") {
          toast.success("System notifications enabled (push key unavailable)");
        } else if (pushSyncResult.reason === "unsupported") {
          toast.success("System notifications enabled (push unavailable on this browser)");
        } else {
          toast.success("System notifications enabled");
        }
      } else {
        toast.error(
          `System notifications enabled, but push sync failed: ${pushSyncResult.message}`
        );
      }
    } catch {
      toast.error("Failed to enable system notifications");
    }
  };

  const notificationEventOptions = useMemo(() => {
    const byKey = new Map(KNOWN_NOTIFICATION_EVENT_OPTIONS.map((option) => [option.key, option]));
    for (const key of Object.keys(notificationEventDefaults)) {
      if (!byKey.has(key)) {
        byKey.set(key, { key, label: key });
      }
    }
    for (const key of Object.keys(notificationSoundMap)) {
      if (key === "default") {
        continue;
      }
      if (!byKey.has(key)) {
        byKey.set(key, { key, label: key });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [notificationEventDefaults, notificationSoundMap]);

  const handleToggleNotificationEvent = async (eventKey: string) => {
    if (!notificationsEnabled) {
      return;
    }
    const nextValue = notificationEventDefaults[eventKey] === false;
    const nextDefaults = {
      ...notificationEventDefaults,
      [eventKey]: nextValue,
    };

    try {
      await updateSettings({ notificationEventDefaults: nextDefaults });
      toast.success(`${eventKey} ${nextValue ? "enabled" : "disabled"}`);
    } catch {
      toast.error(`Failed to update ${eventKey}`);
    }
  };

  const handlePreviewNotificationSound = useCallback(
    async (eventKey: string) => {
      const source = resolveNotificationSoundSource(notificationSoundMap, eventKey);
      try {
        const audio = new Audio(source);
        audio.volume = 0.55;
        await audio.play();
      } catch {
        toast.error("Unable to preview sound (browser playback may be blocked)");
      }
    },
    [notificationSoundMap]
  );

  const handleSetDefaultBuiltinSound = async () => {
    const nextMap = {
      ...notificationSoundMap,
      default: BUILTIN_NOTIFICATION_SOUND_DEFAULT,
    };
    try {
      await updateSettings({ notificationSoundMap: nextMap });
      toast.success("Default notification sound reset to built-in");
    } catch {
      toast.error("Failed to reset default sound");
    }
  };

  const handleResetEventSoundToDefault = async (eventKey: string) => {
    const nextMap = { ...notificationSoundMap };
    delete nextMap[eventKey];
    try {
      await updateSettings({ notificationSoundMap: nextMap });
      toast.success(`Using default sound for ${eventKey}`);
    } catch {
      toast.error(`Failed to reset ${eventKey} sound`);
    }
  };

  const handleUploadNotificationSound = async (soundKey: string, file: File | null) => {
    if (!file) {
      return;
    }
    if (!isLikelyAudioFile(file)) {
      toast.error("Upload a supported audio file (mp3, wav, ogg, m4a, webm, aac, flac)");
      return;
    }
    if (file.size > MAX_NOTIFICATION_SOUND_BYTES) {
      toast.error(
        `Sound file is too large. Maximum size is ${Math.round(MAX_NOTIFICATION_SOUND_BYTES / 1024)}KB.`
      );
      return;
    }

    setUploadingSoundKey(soundKey);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const nextMap = {
        ...notificationSoundMap,
        [soundKey]: dataUrl,
      };
      await updateSettings({ notificationSoundMap: nextMap });
      toast.success(
        soundKey === "default"
          ? "Uploaded new default notification sound"
          : `Uploaded custom sound for ${soundKey}`
      );
    } catch {
      toast.error("Failed to upload notification sound");
    } finally {
      setUploadingSoundKey(null);
    }
  };

  const handleRestartDaemon = async () => {
    if (restarting) {
      return;
    }

    setRestarting(true);
    try {
      const response = await api.restartDaemon();
      toast.success(response.message);

      // Give daemon time to come back before refreshing UI.
      window.setTimeout(() => {
        window.location.reload();
      }, 2500);
    } catch (error) {
      setRestarting(false);
      toast.error(error instanceof Error ? error.message : "Failed to restart daemon");
    }
  };

  const autoDenyUnmatched = defaultPolicyAction === "deny";
  const systemNotificationsUnsupported = notificationPermission === "unsupported";
  const systemNotificationPermissionDenied = notificationPermission === "denied";
  const systemNotificationPermissionPending = notificationPermission === "default";
  const pushSubscriptionSupported = isPushSubscriptionSupported();
  const pushPublicKeyConfigured = resolvePushPublicKey() !== null;
  const systemNotificationHintsAvailable = !systemNotificationsUnsupported;
  const localPushSubscribed = pushHealth.localEndpoint !== null;
  const daemonPushReady = Boolean(pushRuntimeStatus?.enabled && pushRuntimeStatus.configured);
  const pushSyncReady = notificationPermission === "granted" && pushSubscriptionSupported;
  const defaultSoundSource = notificationSoundMap.default || BUILTIN_NOTIFICATION_SOUND_DEFAULT;
  const defaultSoundIsCustom = defaultSoundSource.startsWith("data:");
  const notificationPermissionLabel =
    notificationPermission === "unsupported"
      ? "Unsupported"
      : notificationPermission === "default"
        ? "Pending"
        : notificationPermission;

  if (loading) {
    return (
      <div className="flex justify-center items-center h-24">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          <span className="text-sm">Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <RotateCcw className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">Session Preservation</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4 ml-6">
          Keep active tmux sessions running across daemon restarts.
        </p>

        <div className="flex items-center gap-3 ml-6">
          <SettingToggle
            checked={preserveSessions}
            onClick={handleTogglePreserve}
            disabled={saving || restarting}
          />
          <span className="text-sm">
            {preserveSessions ? "Preserve sessions on restart" : "Stop sessions on shutdown"}
          </span>
        </div>
      </div>

      <div className="border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <Key className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">SSH Agent Forwarding</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4 ml-6">
          Forward SSH agent env vars (`SSH_AUTH_SOCK`, `SSH_AGENT_PID`) into new sessions only.
        </p>

        <div className="flex items-center gap-3 ml-6">
          <SettingToggle
            checked={forwardSshAuthSock}
            onClick={handleToggleSshForward}
            disabled={saving || restarting}
          />
          <span className="text-sm">
            {forwardSshAuthSock ? "Forward SSH agent to new sessions" : "Do not forward SSH agent"}
          </span>
        </div>
      </div>

      <div className="border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">Notifications</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4 ml-6">
          Control notification delivery for completed turns, system banners, and sounds.
        </p>

        <div className="ml-6 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm">Enable notifications</p>
              <p className="text-xs text-muted-foreground">
                Master switch for all notification delivery.
              </p>
            </div>
            <SettingToggle
              checked={notificationsEnabled}
              onClick={handleToggleNotifications}
              disabled={saving || restarting}
            />
          </div>

          {!notificationsEnabled && (
            <p className="text-xs text-muted-foreground">
              Notifications are off. In-app banners, system alerts, and push delivery are paused
              until re-enabled.
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm">System notifications</p>
              <p className="text-xs text-muted-foreground">
                Requires browser permission and a secure context. Permission is requested only when
                enabling.
              </p>
            </div>
            <SettingToggle
              checked={systemNotificationsEnabled}
              onClick={handleToggleSystemNotifications}
              disabled={
                saving || restarting || !notificationsEnabled || systemNotificationsUnsupported
              }
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm">Notification sounds</p>
              <p className="text-xs text-muted-foreground">
                Enables in-app notification audio cues when supported by browser playback policy.
              </p>
            </div>
            <SettingToggle
              checked={notificationSoundsEnabled}
              onClick={handleToggleNotificationSounds}
              disabled={saving || restarting || !notificationsEnabled}
            />
          </div>

          {systemNotificationsUnsupported && (
            <p className="text-xs text-amber-400/90">
              System notifications are unavailable here. Use HTTPS (or localhost) and a browser that
              supports the Notification API.
            </p>
          )}

          {systemNotificationHintsAvailable && !pushSubscriptionSupported && (
            <p className="text-xs text-muted-foreground">
              Web push is not supported on this browser; local system notifications can still work.
            </p>
          )}

          {systemNotificationHintsAvailable &&
            pushSubscriptionSupported &&
            !pushPublicKeyConfigured && (
              <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                <p className="text-xs text-muted-foreground leading-snug">
                  Web push is not configured: no public key is available from daemon runtime or web
                  env. Configure daemon VAPID keys and restart daemon. Local system notifications
                  still work on this device.
                </p>
              </div>
            )}

          {!systemNotificationsUnsupported && systemNotificationPermissionDenied && (
            <p className="text-xs text-amber-400/90">
              Browser permission is currently denied. Re-enable permission from browser site
              settings to turn this back on.
            </p>
          )}

          {!systemNotificationsUnsupported && systemNotificationPermissionPending && (
            <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
              <p className="text-xs text-muted-foreground leading-snug">
                Notification permission is pending. Enable System notifications to prompt browser
                permission.
              </p>
            </div>
          )}

          <div className="rounded-md border border-border/70 bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Push delivery health</p>
                <p className="text-xs text-muted-foreground">
                  Shows whether this browser push subscription is synced with daemon storage.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void refreshPushHealth()}
                  disabled={saving || restarting || pushHealthLoading}
                  className="inline-flex h-8 items-center gap-1 px-2.5 rounded-md text-xs border border-border bg-background/70 hover:bg-accent/60 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${pushHealthLoading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => void handleResyncPushSubscription()}
                  disabled={saving || restarting || pushHealthLoading || !pushSyncReady}
                  className="h-8 px-2.5 rounded-md text-xs border border-border bg-background/70 hover:bg-accent/60 transition-colors disabled:opacity-50"
                >
                  Resync
                </button>
                <button
                  type="button"
                  onClick={() => void handleSendPushTest()}
                  disabled={saving || restarting || pushHealthLoading || sendingPushTest}
                  className="h-8 px-2.5 rounded-md text-xs border border-border bg-background/70 hover:bg-accent/60 transition-colors disabled:opacity-50"
                >
                  {sendingPushTest ? "Testing..." : "Test push"}
                </button>
              </div>
            </div>

            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <p className="text-muted-foreground">
                Daemon push runtime:{" "}
                <span className="text-foreground">
                  {pushRuntimeStatus
                    ? daemonPushReady
                      ? "Ready"
                      : pushRuntimeStatus.enabled
                        ? "Misconfigured"
                        : "Disabled"
                    : "Unknown"}
                </span>
              </p>
              <p className="text-muted-foreground">
                Browser push support:{" "}
                <span className="text-foreground">
                  {pushSubscriptionSupported ? "Supported" : "Unavailable"}
                </span>
              </p>
              <p className="text-muted-foreground">
                Notification permission:{" "}
                <span className="text-foreground capitalize">{notificationPermissionLabel}</span>
              </p>
              <p className="text-muted-foreground">
                Local subscription:{" "}
                <span className="text-foreground">
                  {localPushSubscribed ? "Active" : "Not subscribed"}
                </span>
              </p>
              <p className="text-muted-foreground">
                Daemon sync status:{" "}
                <span className="text-foreground">
                  {localPushSubscribed
                    ? pushHealth.daemonHasLocalEndpoint
                      ? "Synced"
                      : "Missing in daemon"
                    : pushHealth.daemonSubscriptionCount > 0
                      ? "No local subscription"
                      : "No subscriptions"}
                </span>
              </p>
              <p className="text-muted-foreground sm:col-span-2">
                Stored daemon subscriptions:{" "}
                <span className="text-foreground">{pushHealth.daemonSubscriptionCount}</span>
                {pushHealth.checkedAt ? (
                  <>
                    {" "}
                    · Last checked:{" "}
                    <span className="text-foreground">
                      {new Date(pushHealth.checkedAt).toLocaleTimeString()}
                    </span>
                  </>
                ) : null}
              </p>
            </div>

            {pushRuntimeStatus && pushRuntimeStatus.reasons.length > 0 && (
              <div className="space-y-1">
                {pushRuntimeStatus.reasons.map((reason) => (
                  <p key={reason} className="text-[11px] text-muted-foreground">
                    {formatPushStatusReason(reason)}
                  </p>
                ))}
              </div>
            )}

            {pushHealthError && <p className="text-xs text-amber-400/90">{pushHealthError}</p>}
            {pushRuntimeError && <p className="text-xs text-amber-400/90">{pushRuntimeError}</p>}

            {!pushSyncReady && (
              <p className="text-[11px] text-muted-foreground">
                Resync is available when browser permission is granted and push is supported.
              </p>
            )}
          </div>

          <div className="rounded-md border border-border/70 bg-muted/20 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Default sound</p>
                <p className="text-xs text-muted-foreground">
                  {defaultSoundIsCustom ? "Custom uploaded sound" : "Built-in CodePiper soft chime"}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handlePreviewNotificationSound("session.turn_completed")}
                  disabled={saving || restarting || !notificationsEnabled}
                  className="px-2 py-1 rounded-md text-xs border border-border bg-background/70 hover:bg-accent/60 transition-colors disabled:opacity-50"
                >
                  Test
                </button>
                <button
                  type="button"
                  onClick={handleSetDefaultBuiltinSound}
                  disabled={saving || restarting || !notificationsEnabled}
                  className="px-2 py-1 rounded-md text-xs border border-border bg-background/70 hover:bg-accent/60 transition-colors disabled:opacity-50"
                >
                  Use built-in
                </button>
                <label className="px-2 py-1 rounded-md text-xs border border-border bg-background/70 hover:bg-accent/60 transition-colors cursor-pointer">
                  {uploadingSoundKey === "default" ? "Uploading..." : "Upload"}
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm,.flac"
                    className="hidden"
                    disabled={saving || restarting || !notificationsEnabled}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      void handleUploadNotificationSound("default", file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Per-event overrides</p>
              {notificationEventOptions.map((eventOption) => {
                const eventEnabled = notificationEventDefaults[eventOption.key] !== false;
                const customSound = notificationSoundMap[eventOption.key];
                const inputId = `notification-sound-${eventOption.key.replace(/[^a-zA-Z0-9-_]/g, "-")}`;
                return (
                  <div
                    key={eventOption.key}
                    className="rounded-md border border-border/60 bg-background/40 p-2.5 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium">{eventOption.label}</p>
                        <p className="text-[11px] text-muted-foreground">{eventOption.key}</p>
                      </div>
                      <SettingToggle
                        compact
                        checked={eventEnabled}
                        onClick={() => void handleToggleNotificationEvent(eventOption.key)}
                        disabled={saving || restarting || !notificationsEnabled}
                        title={eventEnabled ? "Event enabled" : "Event disabled"}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-muted-foreground">
                        {customSound ? "Custom sound override" : "Uses default sound"}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handlePreviewNotificationSound(eventOption.key)}
                          disabled={saving || restarting || !notificationsEnabled}
                          className="px-2 py-1 rounded-md text-[11px] border border-border bg-background/70 hover:bg-accent/60 transition-colors disabled:opacity-50"
                        >
                          Test
                        </button>
                        {customSound && (
                          <button
                            type="button"
                            onClick={() => void handleResetEventSoundToDefault(eventOption.key)}
                            disabled={saving || restarting || !notificationsEnabled}
                            className="px-2 py-1 rounded-md text-[11px] border border-border bg-background/70 hover:bg-accent/60 transition-colors disabled:opacity-50"
                          >
                            Use default
                          </button>
                        )}
                        <label
                          htmlFor={inputId}
                          className="px-2 py-1 rounded-md text-[11px] border border-border bg-background/70 hover:bg-accent/60 transition-colors cursor-pointer"
                        >
                          {uploadingSoundKey === eventOption.key ? "Uploading..." : "Upload"}
                        </label>
                        <input
                          id={inputId}
                          type="file"
                          accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm,.flac"
                          className="hidden"
                          disabled={saving || restarting || !notificationsEnabled}
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            void handleUploadNotificationSound(eventOption.key, file);
                            event.currentTarget.value = "";
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Uploaded sounds are stored as settings payloads and apply to all clients connected to
              this daemon.
            </p>
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <Key className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">Codex Host Access Profile</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4 ml-6">
          When enabled, new Codex sessions launch with `--sandbox danger-full-access -a on-request`
          to support host-level workflows like GPG signing.
        </p>

        <div className="flex items-center gap-3 ml-6">
          <SettingToggle
            checked={codexHostAccessProfileEnabled}
            onClick={handleToggleCodexHostAccessProfile}
            disabled={saving || restarting}
          />
          <span className="text-sm">
            {codexHostAccessProfileEnabled
              ? "Enable host access profile for new Codex sessions"
              : "Use default Codex sandbox profile"}
          </span>
        </div>
      </div>

      <div className="border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">Default Policy Action</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4 ml-6">
          Applies only when no policy rule matches a permission request.
        </p>

        <div className="flex items-center gap-3 ml-6">
          <SettingToggle
            checked={autoDenyUnmatched}
            onClick={handleTogglePolicy}
            disabled={saving || restarting}
            danger
          />
          <span className="text-sm">
            {autoDenyUnmatched ? "Auto-deny unmatched requests" : "Ask for unmatched requests"}
          </span>
        </div>
      </div>

      <div className="border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">Terminal Feature Rollout</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4 ml-6">
          Enable or disable terminal transport features for this daemon.
        </p>

        <div className="ml-6 space-y-4">
          {TERMINAL_FEATURE_ROWS.map((row) => {
            return (
              <div
                key={row.enabledKey}
                className="rounded-md border border-border/70 bg-muted/20 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{row.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{row.description}</p>
                  </div>
                  <SettingToggle
                    checked={terminalFeatures[row.enabledKey]}
                    onClick={() => void handleToggleTerminalFeature(row)}
                    disabled={saving || restarting}
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  Single-user deployment: this flag is on/off only.
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <Bug className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">Daemon Lifecycle</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4 ml-6">
          Restart daemon from the dashboard to apply daemon-level changes.
        </p>

        <div className="ml-6 flex items-center gap-3">
          <button
            type="button"
            onClick={handleRestartDaemon}
            disabled={saving || restarting}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted/30 hover:bg-muted/50 text-sm disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${restarting ? "animate-spin" : ""}`} />
            {restarting ? "Restarting..." : "Restart Daemon"}
          </button>
          <span className="text-xs text-muted-foreground">
            Expected reconnect in a few seconds.
          </span>
        </div>
      </div>
    </div>
  );
}
