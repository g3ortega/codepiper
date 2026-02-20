import { Bell, LogOut, Wifi, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { ThemeMenuButton } from "@/components/layout/ThemePicker";
import { NotificationInboxPanel } from "@/components/notifications/NotificationInboxPanel";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useTheme } from "@/contexts/ThemeContext";
import { api } from "@/lib/api";
import { useSessions } from "@/lib/hooks/useSessions";
import {
  getNotificationDescription,
  getNotificationEventLabel,
  getNotificationProviderLabel,
  getNotificationTitle,
} from "@/lib/notificationPresentation";
import { resolveNotificationSoundSource } from "@/lib/notificationSounds";
import { buildSessionDisplayNameMap } from "@/lib/sessionPresentation";
import { cn } from "../../lib/utils";
import { websocketManager } from "../../lib/websocket";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getActiveTerminalSessionId(pathname: string): string | null {
  const match = pathname.match(/^\/sessions\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) {
    return null;
  }

  const sessionId = match[1];
  const tab = match[2];
  if (tab && tab !== "terminal") {
    return null;
  }

  return sessionId;
}

function canShowSystemNotifications(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof window.Notification !== "undefined" &&
    window.Notification.permission === "granted"
  );
}

function getNotificationTargetPath(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}/terminal`;
}

const USER_INACTIVITY_THRESHOLD_MS = 45_000;

interface InAppToastState {
  id: number;
  eventType: string;
  eventLabel: string;
  providerLabel: string;
  title: string;
  description: string;
  targetPath: string;
}

interface InAppToastTone {
  badge: string;
  button: string;
  border: string;
}

function getInAppToastTone(eventType: string): InAppToastTone {
  if (eventType === "session.turn_completed") {
    return {
      badge:
        "border border-emerald-500/25 bg-emerald-500/14 text-emerald-800 dark:text-emerald-300",
      button:
        "border border-emerald-500/55 bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400",
      border: "border-emerald-500/28",
    };
  }

  if (eventType === "session.permission_required") {
    return {
      badge: "border border-amber-500/25 bg-amber-500/14 text-amber-800 dark:text-amber-300",
      button:
        "border border-amber-500/55 bg-amber-600 text-white hover:bg-amber-500 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400",
      border: "border-amber-500/32",
    };
  }

  return {
    badge: "border border-cyan-500/25 bg-cyan-500/12 text-cyan-800 dark:text-cyan-300",
    button:
      "border border-cyan-500/55 bg-cyan-600 text-white hover:bg-cyan-500 dark:bg-cyan-500 dark:text-cyan-950 dark:hover:bg-cyan-400",
    border: "border-cyan-500/28",
  };
}

export function Header() {
  const { logout } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { sessions } = useSessions();
  const { counts, settings, lastCreatedNotification, clearLastCreatedNotification } =
    useNotifications();
  const [wsConnected, setWsConnected] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [bellAnimated, setBellAnimated] = useState(false);
  const [inAppToast, setInAppToast] = useState<InAppToastState | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastInteractionAtRef = useRef<number>(Date.now());
  const activeTerminalSessionId = useMemo(
    () => getActiveTerminalSessionId(location.pathname),
    [location.pathname]
  );
  const sessionDisplayNames = useMemo(() => buildSessionDisplayNameMap(sessions), [sessions]);

  useEffect(() => {
    setWsConnected(websocketManager.isConnected());
    return websocketManager.onConnectionChange((connected) => {
      setWsConnected(connected);
    });
  }, []);

  useEffect(() => {
    if (!inboxOpen) {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setInboxOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [inboxOpen]);

  useEffect(() => {
    const markInteraction = () => {
      lastInteractionAtRef.current = Date.now();
    };

    const passive = { passive: true } as const;
    window.addEventListener("pointerdown", markInteraction, passive);
    window.addEventListener("keydown", markInteraction);
    window.addEventListener("touchstart", markInteraction, passive);
    window.addEventListener("focus", markInteraction);
    document.addEventListener("visibilitychange", markInteraction);

    return () => {
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("keydown", markInteraction);
      window.removeEventListener("touchstart", markInteraction);
      window.removeEventListener("focus", markInteraction);
      document.removeEventListener("visibilitychange", markInteraction);
    };
  }, []);

  const playNotificationSound = useCallback(
    async (eventType: string) => {
      if (!settings.notificationSoundsEnabled) {
        return;
      }

      const mappedSound = resolveNotificationSoundSource(settings.notificationSoundMap, eventType);
      if (mappedSound) {
        try {
          const audio = new Audio(mappedSound);
          audio.volume = 0.55;
          await audio.play();
          return;
        } catch {
          // Fall through to generated tone if custom sound playback fails.
        }
      }

      try {
        const audioContextFactory =
          window.AudioContext ||
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!audioContextFactory) {
          return;
        }

        if (!audioContextRef.current) {
          audioContextRef.current = new audioContextFactory();
        }
        const audioContext = audioContextRef.current;
        if (audioContext.state === "suspended") {
          await audioContext.resume().catch(() => undefined);
        }

        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 880;
        gain.gain.value = 0.0001;
        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        const now = audioContext.currentTime;
        gain.gain.exponentialRampToValueAtTime(0.035, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        oscillator.start(now);
        oscillator.stop(now + 0.18);
      } catch {
        // Ignore playback failures (autoplay policy, missing audio context, etc.)
      }
    },
    [settings.notificationSoundsEnabled, settings.notificationSoundMap]
  );

  const showSystemNotification = useCallback(
    async (
      notification: NonNullable<typeof lastCreatedNotification>,
      targetPath: string,
      resolvedSessionLabel?: string | null
    ): Promise<boolean> => {
      if (!(settings.systemNotificationsEnabled && canShowSystemNotifications())) {
        return false;
      }

      const body = getNotificationDescription(notification, resolvedSessionLabel);
      const title = getNotificationTitle(notification, resolvedSessionLabel);
      const tag = `codepiper:notification:${notification.id}`;
      const data = {
        url: targetPath,
        sessionId: notification.sessionId,
        notificationId: notification.id,
      };

      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration) {
            await registration.showNotification(title, {
              body,
              tag,
              icon: "/apple-touch-icon.png",
              badge: "/logo.svg",
              data,
            });
            return true;
          }
        }

        const browserNotification = new window.Notification(title, {
          body,
          tag,
          icon: "/apple-touch-icon.png",
          data,
        });
        browserNotification.onclick = () => {
          if (typeof window.focus === "function") {
            window.focus();
          }
          void api.markNotificationRead(notification.id, "click");
          navigate(targetPath);
          browserNotification.close();
        };
        return true;
      } catch {
        return false;
      }
    },
    [navigate, settings.systemNotificationsEnabled]
  );

  useEffect(() => {
    if (!inAppToast) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setInAppToast((current) => (current?.id === inAppToast.id ? null : current));
    }, 6500);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [inAppToast]);

  useEffect(() => {
    if (!lastCreatedNotification) {
      return;
    }

    const eventEnabled = settings.notificationEventDefaults[lastCreatedNotification.eventType];
    if (eventEnabled === false) {
      clearLastCreatedNotification(lastCreatedNotification.id);
      return;
    }

    const documentVisible =
      typeof document !== "undefined" ? document.visibilityState === "visible" : false;
    const isSameActiveTerminalSession =
      activeTerminalSessionId === lastCreatedNotification.sessionId && documentVisible;
    const isUserInactive =
      Date.now() - lastInteractionAtRef.current >= USER_INACTIVITY_THRESHOLD_MS;

    // If user is actively working on the same terminal session, suppress notification cues.
    if (isSameActiveTerminalSession && !isUserInactive) {
      void api.markNotificationRead(lastCreatedNotification.id, "active").catch(() => undefined);
      clearLastCreatedNotification(lastCreatedNotification.id);
      return;
    }

    const targetPath = getNotificationTargetPath(lastCreatedNotification.sessionId);
    const resolvedSessionLabel = sessionDisplayNames.get(lastCreatedNotification.sessionId) ?? null;
    const shouldRenderInAppToast = documentVisible;
    let animationTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const dispatch = async () => {
      await showSystemNotification(lastCreatedNotification, targetPath, resolvedSessionLabel);
      if (cancelled) {
        return;
      }

      if (shouldRenderInAppToast) {
        if (!prefersReducedMotion()) {
          setBellAnimated(true);
          animationTimer = setTimeout(() => setBellAnimated(false), 700);
          if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            navigator.vibrate?.(20);
          }
        }

        setInAppToast({
          id: lastCreatedNotification.id,
          eventType: lastCreatedNotification.eventType,
          eventLabel: getNotificationEventLabel(lastCreatedNotification.eventType),
          providerLabel: getNotificationProviderLabel(lastCreatedNotification.provider),
          title: getNotificationTitle(lastCreatedNotification, resolvedSessionLabel),
          description: getNotificationDescription(lastCreatedNotification, resolvedSessionLabel),
          targetPath,
        });

        void playNotificationSound(lastCreatedNotification.eventType);
      }

      clearLastCreatedNotification(lastCreatedNotification.id);
    };

    void dispatch();

    return () => {
      cancelled = true;
      if (animationTimer) {
        clearTimeout(animationTimer);
      }
    };
  }, [
    clearLastCreatedNotification,
    lastCreatedNotification,
    playNotificationSound,
    showSystemNotification,
    activeTerminalSessionId,
    settings.notificationEventDefaults,
    sessionDisplayNames,
  ]);

  const headerSurfaceClass =
    theme.mode === "dark"
      ? "bg-background/60 backdrop-blur-xl"
      : "bg-background/92 backdrop-blur-md";

  const toastTone = inAppToast ? getInAppToastTone(inAppToast.eventType) : null;

  const handleOpenToast = useCallback(() => {
    if (!inAppToast) {
      return;
    }
    void api.markNotificationRead(inAppToast.id, "click");
    navigate(inAppToast.targetPath);
    setInAppToast(null);
  }, [inAppToast, navigate]);

  const handleDismissToast = useCallback(() => {
    setInAppToast(null);
  }, []);

  const inAppToastPortal =
    inAppToast && toastTone && typeof document !== "undefined"
      ? createPortal(
          <div className="pointer-events-none fixed z-[500] right-[max(0.5rem,calc(env(safe-area-inset-right,0px)+0.35rem))] top-[max(0.5rem,calc(env(safe-area-inset-top,0px)+0.35rem))] w-[min(21.5rem,calc(100vw-1rem))]">
            <article
              className={cn(
                "pointer-events-auto animate-in rounded-2xl border p-3 shadow-[0_18px_36px_rgba(2,8,23,0.34)]",
                theme.mode === "dark"
                  ? "bg-card/96 text-card-foreground backdrop-blur-md"
                  : "bg-popover/98 text-popover-foreground",
                toastTone.border
              )}
              aria-live="polite"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[0.93rem] font-semibold leading-5">
                    {inAppToast.title}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        toastTone.badge
                      )}
                    >
                      {inAppToast.eventLabel}
                    </span>
                    <span className="inline-flex rounded-full border border-border/60 bg-muted/35 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {inAppToast.providerLabel}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDismissToast}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Dismiss notification"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <p className="line-clamp-3 text-[0.79rem] leading-5 text-muted-foreground">
                {inAppToast.description}
              </p>

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={handleOpenToast}
                  className={cn(
                    "h-8 rounded-full px-4 text-[0.75rem] font-semibold tracking-[0.01em] transition-colors",
                    toastTone.button
                  )}
                >
                  Open session
                </button>
              </div>
            </article>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <header className={cn("relative z-[80] border-b border-border pt-safe", headerSurfaceClass)}>
        <div className="flex h-12 items-center justify-between px-4 md:px-6">
          {/* Mobile: brand name, Desktop: empty (sidebar has logo) */}
          <div className="flex items-center gap-2.5">
            <a href="/" className="md:hidden flex items-center gap-2">
              <img src="/piper.svg" alt="CodePiper" className="h-7 w-7" />
              <span className="text-sm font-semibold tracking-wide">CodePiper</span>
            </a>

            {/* Connection status — desktop only */}
            <div
              className={cn(
                "hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all",
                wsConnected
                  ? "bg-emerald-500/[0.1] text-emerald-700 border border-emerald-500/30 dark:bg-emerald-500/[0.08] dark:text-emerald-400 dark:border-emerald-500/20"
                  : "bg-red-500/[0.1] text-red-700 border border-red-500/30 dark:bg-red-500/[0.08] dark:text-red-400 dark:border-red-500/20"
              )}
            >
              {wsConnected ? (
                <>
                  <div className="relative">
                    <Wifi className="h-3 w-3" />
                    <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-live" />
                  </div>
                  <span>Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3" />
                  <span>Disconnected</span>
                </>
              )}
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Mobile connection indicator — just a dot */}
            <div className="md:hidden">
              <div
                className={cn(
                  "w-2 h-2 rounded-full",
                  wsConnected
                    ? "bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
                    : "bg-red-500 dark:bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]"
                )}
              />
            </div>

            <div className="relative">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={inboxOpen}
                onClick={() => setInboxOpen((current) => !current)}
                className="relative h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200"
                title={
                  counts.totalUnread > 0
                    ? `${counts.totalUnread} unread notification${counts.totalUnread === 1 ? "" : "s"}`
                    : "No unread notifications"
                }
              >
                <Bell className={cn("h-4 w-4", bellAnimated && "bell-wiggle")} />
                {counts.totalUnread > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] rounded-full bg-amber-500 text-[9px] font-bold text-amber-950 flex items-center justify-center px-1 leading-none shadow-[0_0_8px_rgba(245,158,11,0.45)] pulse-live">
                    {counts.totalUnread > 99 ? "99+" : counts.totalUnread}
                  </span>
                )}
              </button>
              <NotificationInboxPanel open={inboxOpen} onClose={() => setInboxOpen(false)} />
            </div>

            <ThemeMenuButton />

            {/* Sign out */}
            <button
              type="button"
              onClick={logout}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      {inAppToastPortal}
    </>
  );
}
