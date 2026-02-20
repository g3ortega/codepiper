import {
  ArrowLeft,
  Bell,
  Check,
  Circle,
  GitBranch,
  OctagonX,
  Pencil,
  RotateCw,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { EventsView } from "../components/events/EventsView";
import { GitView } from "../components/git/GitView";
import { ThemeMenuButton } from "../components/layout/ThemePicker";
import { LogsView } from "../components/logs/LogsView";
import { SessionPoliciesView } from "../components/policies/SessionPoliciesView";
import { ProviderBadge } from "../components/sessions/ProviderBadge";
import { TerminalView } from "../components/terminal/TerminalView";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useNotifications } from "../contexts/NotificationContext";
import { api } from "../lib/api";
import { useSessions } from "../lib/hooks/useSessions";
import {
  DEFAULT_SESSION_DETAIL_TABS,
  FALLBACK_PROVIDER_OPTIONS,
  getProviderInfo,
  getSessionDetailTabsForProvider,
  type SessionDetailTab,
  supportsSessionHistoryViews,
} from "../lib/providerCapabilities";
import {
  buildSessionDisplayNameMap,
  getSessionCustomName,
  getSessionDefaultLabel,
  getSessionDisplayName,
} from "../lib/sessionPresentation";
import { formatRelativeTime, getStatusColor, truncate } from "../lib/utils";
import type { ProviderInfo, Session } from "../types/api";

const TAB_LABELS: Record<SessionDetailTab, string> = {
  terminal: "Terminal",
  git: "Git",
  policies: "Policies",
  logs: "Logs",
  events: "Events",
};

export function SessionDetailPage() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const { sessions: allSessions, refresh: refreshSessions } = useSessions();
  const { counts } = useNotifications();
  const [session, setSession] = useState<Session | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [providerOptions, setProviderOptions] = useState<ProviderInfo[]>([
    ...FALLBACK_PROVIDER_OPTIONS,
  ]);

  const availableTabs = useMemo<readonly SessionDetailTab[]>(
    () =>
      session
        ? getSessionDetailTabsForProvider(session.provider, providerOptions)
        : DEFAULT_SESSION_DETAIL_TABS,
    [providerOptions, session]
  );
  const supportsConversationView = useMemo(() => {
    if (!session) {
      return true;
    }
    return supportsSessionHistoryViews(
      getProviderInfo(session.provider, providerOptions).capabilities
    );
  }, [providerOptions, session]);
  const activeTab: SessionDetailTab =
    tab && availableTabs.includes(tab as SessionDetailTab)
      ? (tab as SessionDetailTab)
      : (availableTabs[0] ?? "terminal");
  const sessionDisplayNames = useMemo(() => buildSessionDisplayNameMap(allSessions), [allSessions]);
  const sessionCustomName = useMemo(
    () => (session ? getSessionCustomName(session) : null),
    [session]
  );
  const sessionDisplayName = useMemo(() => {
    if (!session) {
      return "";
    }
    return getSessionDisplayName(session, sessionDisplayNames);
  }, [session, sessionDisplayNames]);

  useEffect(() => {
    let cancelled = false;

    void api
      .getProviders()
      .then((response) => {
        if (cancelled || response.providers.length === 0) {
          return;
        }
        setProviderOptions(response.providers);
      })
      .catch(() => {
        // Keep fallback provider capabilities when providers route is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep session route synchronized with capability-aware tabs.
  useEffect(() => {
    if (!id) {
      return;
    }
    if (!tab || tab !== activeTab) {
      navigate(`/sessions/${id}/${activeTab}`, { replace: true });
    }
  }, [activeTab, id, navigate, tab]);

  const handleTabChange = useCallback(
    (value: string) => {
      navigate(`/sessions/${id}/${value}`, { replace: true });
    },
    [id, navigate]
  );

  useEffect(() => {
    if (!id) return;

    const fetchSession = async () => {
      try {
        setLoading(true);
        const response = await api.getSession(id);
        setSession(response.session);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to fetch session");
        navigate("/sessions");
      } finally {
        setLoading(false);
      }
    };

    const fetchBranch = async () => {
      try {
        const res = await api.getGitStatus(id);
        setBranch(res.branch || null);
      } catch {
        // not a git repo or session not ready
      }
    };

    fetchSession();
    fetchBranch();

    const interval = setInterval(async () => {
      try {
        const response = await api.getSession(id);
        setSession(response.session);
      } catch {
        // ignore polling errors
      }
      fetchBranch();
    }, 5000);

    return () => clearInterval(interval);
  }, [id, navigate]);

  useEffect(() => {
    if (!id) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleMarkRead = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        void api.markNotificationsRead({ sessionId: id, readSource: "open_session" }).catch(() => {
          // Best-effort path; keep UX non-blocking.
        });
      }, 1200);
    };

    scheduleMarkRead();

    const handleFocus = () => {
      scheduleMarkRead();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        scheduleMarkRead();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [id]);

  useEffect(() => {
    if (renaming) {
      return;
    }
    setNameDraft(sessionCustomName ?? "");
  }, [renaming, sessionCustomName]);

  const handleStop = async () => {
    if (!id) return;
    try {
      await api.stopSession(id);
      toast.success("Session stopped");
      const response = await api.getSession(id);
      setSession(response.session);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop session");
    }
  };

  const handleKill = async () => {
    if (!id) return;
    try {
      await api.killSession(id);
      toast.success("Session killed");
      const response = await api.getSession(id);
      setSession(response.session);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to kill session");
    }
  };

  const handleResume = async () => {
    if (!id) return;
    try {
      const response = await api.resumeSession(id);
      toast.success("Session resumed");
      setSession(response.session);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resume session");
    }
  };

  const handleRecover = async () => {
    if (!id) return;
    try {
      const response = await api.recoverSession(id);
      toast.success("Session recovered");
      setSession(response.session);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to recover session");
    }
  };

  const handleStartRename = useCallback(() => {
    if (!session) return;
    setNameDraft(sessionCustomName ?? "");
    setRenaming(true);
  }, [session, sessionCustomName]);

  const handleCancelRename = useCallback(() => {
    setNameDraft(sessionCustomName ?? "");
    setRenaming(false);
  }, [sessionCustomName]);

  const handleSaveRename = useCallback(async () => {
    if (!(session && id) || savingName) {
      return;
    }

    const nextName = nameDraft.trim();
    setSavingName(true);
    try {
      const response = await api.updateSessionName(id, {
        name: nextName.length > 0 ? nextName : null,
      });
      setSession(response.session);
      setRenaming(false);
      await refreshSessions();
      toast.success(nextName.length > 0 ? "Session name updated" : "Session name reset");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update session name");
    } finally {
      setSavingName(false);
    }
  }, [id, nameDraft, refreshSessions, savingName, session]);

  const getStatusVariant = (
    status: string
  ): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
    const color = getStatusColor(status);
    switch (color) {
      case "green":
        return "success";
      case "yellow":
        return "warning";
      case "red":
        return "destructive";
      case "blue":
      case "cyan":
        return "default";
      default:
        return "secondary";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span className="text-sm">Loading session...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-muted-foreground mb-3">Session not found</p>
          <button
            type="button"
            onClick={() => navigate("/sessions")}
            className="text-sm text-primary hover:underline"
          >
            Back to sessions
          </button>
        </div>
      </div>
    );
  }

  const canStop = session.status === "RUNNING" || session.status === "STARTING";
  const canKill = session.status !== "STOPPED" && session.status !== "CRASHED";
  const canResume = session.status === "STOPPED" || session.status === "CRASHED";
  const canRecover = session.status === "STOPPED" || session.status === "CRASHED";
  const isActive = session.status === "RUNNING" || session.status === "STARTING";
  const sessionUnreadCount = counts.bySession[session.id] ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* Session header */}
      <div className="border-b border-border px-4 md:px-6 py-2 md:py-5 pt-safe md:pt-5 bg-gradient-to-b from-primary/10 via-primary/[0.04] to-transparent">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 md:gap-3 md:mb-2 flex-wrap">
              <button
                type="button"
                onClick={() => navigate("/sessions")}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Sessions</span>
              </button>
              <span className="text-muted-foreground/30 hidden sm:inline">/</span>
              {renaming ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <Input
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleSaveRename();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        handleCancelRename();
                      }
                    }}
                    disabled={savingName}
                    placeholder={getSessionDefaultLabel(session.cwd)}
                    className="h-8 w-[170px] md:w-[250px] text-sm"
                    maxLength={80}
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => void handleSaveRename()}
                    disabled={savingName}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleCancelRename}
                    disabled={savingName}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 min-w-0">
                  <h1 className="text-base md:text-lg font-semibold truncate max-w-[210px] md:max-w-[360px]">
                    {sessionDisplayName}
                  </h1>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={handleStartRename}
                    aria-label="Rename session"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                {truncate(session.id, 8)}
              </Badge>
              <ProviderBadge provider={session.provider} />
              <Badge variant={getStatusVariant(session.status)} className="shrink-0">
                {isActive && <Circle className="h-1.5 w-1.5 fill-current mr-1.5 pulse-live" />}
                {session.status}
              </Badge>
              {sessionUnreadCount > 0 && (
                <Badge variant="warning" className="shrink-0">
                  <Bell className="h-3 w-3 mr-1" />
                  {sessionUnreadCount > 99 ? "99+" : sessionUnreadCount} unread
                </Badge>
              )}
            </div>
            <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
              <span className="font-mono text-xs truncate">{session.cwd}</span>
              <span className="text-border">&middot;</span>
              <span>Created {formatRelativeTime(session.createdAt)}</span>
              {session.pid && (
                <>
                  <span className="text-border">&middot;</span>
                  <span className="font-mono text-xs">PID: {session.pid}</span>
                </>
              )}
              {branch && (
                <>
                  <span className="text-border">&middot;</span>
                  <span className="font-mono text-xs inline-flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    {branch}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex gap-1.5 md:gap-2 shrink-0">
            <ThemeMenuButton className="md:hidden h-9 w-9 border border-border bg-background/80 hover:bg-accent/80" />
            {canResume && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResume}
                className="border-primary/30 text-primary hover:bg-primary/10 text-xs md:text-sm h-8"
              >
                <RotateCw className="h-3 w-3 mr-1" />
                <span className="hidden sm:inline">Resume</span>
              </Button>
            )}
            {canRecover && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRecover}
                className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 text-xs md:text-sm h-8"
              >
                <RotateCw className="h-3 w-3 mr-1" />
                <span className="hidden sm:inline">Recover</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleStop}
              disabled={!canStop}
              className="border-border hover:bg-accent/60 text-xs md:text-sm h-8"
            >
              <Square className="h-3 w-3 mr-1" />
              <span className="hidden sm:inline">Stop</span>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleKill}
              disabled={!canKill}
              className="text-xs md:text-sm h-8"
            >
              <OctagonX className="h-3 w-3 mr-1" />
              <span className="hidden sm:inline">Kill</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs content */}
      <div className="flex-1 min-h-0">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col">
          <div className="border-b border-border px-4 md:px-6 overflow-x-auto scrollbar-none">
            <TabsList className="bg-transparent h-8 md:h-10 gap-0">
              {availableTabs.map((tabName) => (
                <TabsTrigger
                  key={tabName}
                  value={tabName}
                  className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-muted-foreground hover:text-foreground px-3 md:px-4 text-xs md:text-sm transition-colors capitalize"
                >
                  {TAB_LABELS[tabName]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            <TabsContent value="terminal" className="h-full m-0">
              <TerminalView
                sessionId={session.id}
                sessionStatus={session.status}
                supportsConversationView={supportsConversationView}
              />
            </TabsContent>

            <TabsContent value="policies" className="h-full m-0">
              <SessionPoliciesView sessionId={session.id} />
            </TabsContent>

            <TabsContent value="git" className="h-full m-0">
              <GitView sessionId={session.id} cwd={session.cwd} />
            </TabsContent>

            {availableTabs.includes("logs") && (
              <TabsContent value="logs" className="h-full m-0">
                <LogsView sessionId={session.id} />
              </TabsContent>
            )}

            {availableTabs.includes("events") && (
              <TabsContent value="events" className="h-full m-0">
                <EventsView sessionId={session.id} />
              </TabsContent>
            )}
          </div>
        </Tabs>
      </div>
    </div>
  );
}
