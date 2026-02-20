import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import {
  getNotificationDescription,
  getNotificationEventLabel,
  getNotificationProviderLabel,
  getNotificationSessionLabel,
  getNotificationTitle,
} from "@/lib/notificationPresentation";
import { formatRelativeTime } from "@/lib/utils";
import type { SessionNotificationRecord } from "@/types/api";
import type { WsNotificationsPayload } from "@/types/websocket";
import { useNotifications } from "../../contexts/NotificationContext";
import { websocketManager } from "../../lib/websocket";

interface NotificationInboxPanelProps {
  open: boolean;
  onClose: () => void;
}

const NOTIFICATION_PAGE_SIZE = 5;
const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isApiStatusCode(error: unknown, expectedStatus: number): boolean {
  return isRecord(error) && typeof error.status === "number" && error.status === expectedStatus;
}

function isNotificationCreatedPayload(
  payload: WsNotificationsPayload
): payload is Extract<WsNotificationsPayload, { type: "notification_created" }> {
  return payload.type === "notification_created";
}

function toNotificationRecord(value: unknown): SessionNotificationRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "number" || typeof value.sessionId !== "string") return null;
  if (typeof value.title !== "string" || typeof value.eventType !== "string") return null;
  if (typeof value.createdAt !== "string") return null;

  return {
    id: value.id,
    sessionId: value.sessionId,
    provider: typeof value.provider === "string" ? value.provider : "unknown",
    eventType: value.eventType,
    sourceEventId: typeof value.sourceEventId === "number" ? value.sourceEventId : null,
    title: value.title,
    body: typeof value.body === "string" ? value.body : null,
    payload: isRecord(value.payload) ? value.payload : {},
    createdAt: value.createdAt,
    readAt: typeof value.readAt === "string" ? value.readAt : null,
    readSource: typeof value.readSource === "string" ? value.readSource : null,
  };
}

function dedupeNotifications(
  notifications: SessionNotificationRecord[]
): SessionNotificationRecord[] {
  const seen = new Set<number>();
  const result: SessionNotificationRecord[] = [];
  for (const notification of notifications) {
    if (seen.has(notification.id)) continue;
    seen.add(notification.id);
    result.push(notification);
  }
  return result;
}

function replaceOrInsertNotification(
  previous: SessionNotificationRecord[],
  nextNotification: SessionNotificationRecord
): SessionNotificationRecord[] {
  const next = previous.filter((item) => item.id !== nextNotification.id);
  next.unshift(nextNotification);
  return dedupeNotifications(next);
}

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQueryList = window.matchMedia(MOBILE_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    setIsMobile(mediaQueryList.matches);

    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", handleChange);
      return () => mediaQueryList.removeEventListener("change", handleChange);
    }

    mediaQueryList.addListener(handleChange);
    return () => mediaQueryList.removeListener(handleChange);
  }, []);

  return isMobile;
}

export function NotificationInboxPanel({ open, onClose }: NotificationInboxPanelProps) {
  const navigate = useNavigate();
  const isMobileViewport = useIsMobileViewport();
  const { refresh: refreshCounts } = useNotifications();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [notifications, setNotifications] = useState<SessionNotificationRecord[]>([]);
  const [supported, setSupported] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [cursorBefore, setCursorBefore] = useState<number | undefined>(undefined);

  const loadNotifications = useCallback(async () => {
    if (!open) return;

    setLoading(true);
    try {
      const response = await api.getNotifications({
        unreadOnly,
        limit: NOTIFICATION_PAGE_SIZE + 1,
      });
      const received = dedupeNotifications(response.notifications);
      const nextHasMore = received.length > NOTIFICATION_PAGE_SIZE;
      const visible = nextHasMore ? received.slice(0, NOTIFICATION_PAGE_SIZE) : received;

      setNotifications(visible);
      setHasMore(nextHasMore);
      setCursorBefore(visible.length > 0 ? visible[visible.length - 1]?.id : undefined);
      setSupported(true);
      setError(null);
      await refreshCounts();
    } catch (err) {
      if (isApiStatusCode(err, 404)) {
        setNotifications([]);
        setSupported(false);
        setHasMore(false);
        setCursorBefore(undefined);
        setError(null);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [open, unreadOnly, refreshCounts]);

  const handleLoadMore = useCallback(async () => {
    if (!(open && hasMore && cursorBefore !== undefined) || loading || loadingMore) {
      return;
    }

    setLoadingMore(true);
    try {
      const response = await api.getNotifications({
        unreadOnly,
        before: cursorBefore,
        limit: NOTIFICATION_PAGE_SIZE + 1,
      });
      const received = dedupeNotifications(response.notifications);
      const nextHasMore = received.length > NOTIFICATION_PAGE_SIZE;
      const page = nextHasMore ? received.slice(0, NOTIFICATION_PAGE_SIZE) : received;

      if (page.length === 0) {
        setHasMore(false);
        return;
      }

      setNotifications((previous) => dedupeNotifications([...previous, ...page]));
      setCursorBefore(page[page.length - 1]?.id);
      setHasMore(nextHasMore);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more notifications");
    } finally {
      setLoadingMore(false);
    }
  }, [cursorBefore, hasMore, loading, loadingMore, open, unreadOnly]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadNotifications();
  }, [open, loadNotifications]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const unsubscribe = websocketManager.subscribe("notifications", (payload) => {
      if (payload.type === "notification_read") {
        void loadNotifications();
        return;
      }

      if (isNotificationCreatedPayload(payload)) {
        const parsed = toNotificationRecord(payload.data);
        if (!(parsed && !(unreadOnly && parsed.readAt))) {
          return;
        }
        setNotifications((previous) => replaceOrInsertNotification(previous, parsed));
        return;
      }

      if (payload.type === "notification_counts_updated") {
        void refreshCounts();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [open, unreadOnly, loadNotifications, refreshCounts]);

  const unreadCount = useMemo(
    () => notifications.reduce((count, item) => count + (item.readAt ? 0 : 1), 0),
    [notifications]
  );

  const handleOpenNotification = useCallback(
    async (notification: SessionNotificationRecord) => {
      if (!notification.readAt) {
        try {
          await api.markNotificationRead(notification.id, "click");
        } catch {
          // If mark-read fails, still attempt navigation.
        }
      }

      setNotifications((previous) =>
        previous.map((item) =>
          item.id === notification.id
            ? { ...item, readAt: item.readAt ?? new Date().toISOString(), readSource: "click" }
            : item
        )
      );
      void refreshCounts();
      navigate(`/sessions/${notification.sessionId}/terminal`);
      onClose();
    },
    [navigate, onClose, refreshCounts]
  );

  const handleMarkAllRead = useCallback(async () => {
    try {
      const response = await api.markNotificationsRead({ readSource: "bulk" });
      if (response.updated > 0) {
        const timestamp = new Date().toISOString();
        setNotifications((previous) =>
          previous.map((item) =>
            item.readAt ? item : { ...item, readAt: timestamp, readSource: "bulk" }
          )
        );
      }
      void refreshCounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark notifications as read");
    }
  }, [refreshCounts]);

  if (!open) {
    return null;
  }

  const panelBody = (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="bg-gradient-to-b from-cyan-500/10 via-cyan-500/[0.02] to-transparent">
          <div className="flex items-center justify-between border-b border-border/80 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-semibold">Notifications</h3>
              {unreadCount > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/95 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/85 hover:text-foreground disabled:opacity-40"
              disabled={loading || loadingMore || notifications.length === 0 || unreadCount === 0}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          </div>

          <div className="border-b border-border/70 px-3 py-2.5">
            <div className="grid grid-cols-2 items-center gap-1 rounded-lg bg-muted/25 p-1">
              <button
                type="button"
                onClick={() => setUnreadOnly(false)}
                className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  !unreadOnly
                    ? "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setUnreadOnly(true)}
                className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  unreadOnly
                    ? "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Unread
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:pb-2.5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading notifications...</span>
            </div>
          ) : !supported ? (
            <div className="px-3 py-6 text-sm text-muted-foreground">
              Notification inbox is not supported by the connected daemon version.
            </div>
          ) : error ? (
            <div className="px-3 py-6 text-sm text-red-400">{error}</div>
          ) : notifications.length === 0 ? (
            <div className="px-3 py-8 text-sm text-muted-foreground">
              {unreadOnly ? "No unread notifications." : "No notifications yet."}
            </div>
          ) : (
            <ul className="space-y-2">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => void handleOpenNotification(notification)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      notification.readAt
                        ? "border-border/65 bg-background/98 hover:bg-accent/60"
                        : "border-cyan-500/35 bg-gradient-to-r from-cyan-500/14 via-cyan-500/[0.05] to-background/95 hover:from-cyan-500/20"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          {getNotificationTitle(notification)}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                          <span className="rounded-full border border-border/70 bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
                            {getNotificationEventLabel(notification.eventType)}
                          </span>
                          <span className="rounded-full border border-border/70 bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
                            {getNotificationProviderLabel(notification.provider)}
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(notification.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-snug text-foreground/80">
                      {getNotificationDescription(notification)}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="rounded-md bg-muted/25 px-1.5 py-0.5 font-mono">
                        {getNotificationSessionLabel(notification)}
                      </span>
                      {!notification.readAt && (
                        <>
                          <span className="text-border">•</span>
                          <span className="text-cyan-400">Unread</span>
                        </>
                      )}
                    </div>
                  </button>
                </li>
              ))}
              {(hasMore || loadingMore) && (
                <li className="pt-1 pb-2 text-center">
                  <button
                    type="button"
                    onClick={() => void handleLoadMore()}
                    disabled={loadingMore}
                    className="text-xs font-medium text-cyan-400 hover:text-cyan-300 underline underline-offset-4 disabled:opacity-45 disabled:no-underline"
                  >
                    {loadingMore ? "Loading..." : "Load more"}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </>
  );

  const shouldUseMobilePortal = isMobileViewport && typeof document !== "undefined";
  const backdropClassName = shouldUseMobilePortal
    ? "fixed inset-0 z-[260] cursor-default bg-background/60 backdrop-blur-[2.5px]"
    : "fixed inset-0 z-[90] hidden cursor-default bg-background/60 backdrop-blur-[2.5px] md:block md:bg-transparent md:backdrop-blur-0";
  const panelClassName = shouldUseMobilePortal
    ? "notification-inbox-surface fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3.25rem)] bottom-[calc(env(safe-area-inset-bottom)+5.2rem)] z-[270] flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 text-popover-foreground shadow-[0_26px_60px_rgba(0,0,0,0.34)]"
    : "notification-inbox-surface relative z-[120] hidden min-h-0 flex-col overflow-hidden rounded-xl border border-border text-popover-foreground shadow-[0_20px_48px_rgba(0,0,0,0.45)] md:absolute md:inset-x-auto md:right-0 md:top-[calc(100%+0.5rem)] md:flex md:w-[24rem] md:max-h-[70vh]";

  const inboxContent = (
    <>
      <button
        type="button"
        aria-label="Close notification inbox"
        className={backdropClassName}
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Notification inbox"
        className={panelClassName}
      >
        {panelBody}
      </section>
    </>
  );

  if (isMobileViewport && typeof document === "undefined") {
    return null;
  }

  if (shouldUseMobilePortal) {
    return createPortal(inboxContent, document.body);
  }

  return inboxContent;
}
