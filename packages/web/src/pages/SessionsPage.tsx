import { ChevronLeft, ChevronRight, Monitor } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "@/contexts/NotificationContext";
import { CreateSessionDialog } from "../components/sessions/CreateSessionDialog";
import { ProviderBadge } from "../components/sessions/ProviderBadge";
import { SessionFilters } from "../components/sessions/SessionFilters";
import { SessionRowActions } from "../components/sessions/SessionRowActions";
import { Badge } from "../components/ui/badge";
import { useSessions } from "../lib/hooks/useSessions";
import { getProviderPresentation } from "../lib/providerPresentation";
import { buildSessionDisplayNameMap, getSessionDisplayName } from "../lib/sessionPresentation";
import { formatRelativeTime, getStatusColor, truncate } from "../lib/utils";

const PAGE_SIZE = 15;

export function SessionsPage() {
  const navigate = useNavigate();
  const { sessions, loading, error, updateSessionStatus } = useSessions();
  const { counts } = useNotifications();
  const [statusFilter, setStatusFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const sessionDisplayNames = useMemo(() => buildSessionDisplayNameMap(sessions), [sessions]);

  const filteredSessions = useMemo(() => {
    const statusPriority: Record<string, number> = {
      RUNNING: 0,
      STARTING: 1,
      NEEDS_PERMISSION: 2,
      NEEDS_INPUT: 3,
      STOPPED: 4,
      CRASHED: 5,
    };

    return sessions
      .filter((session) => {
        if (statusFilter !== "all" && session.status !== statusFilter) {
          return false;
        }

        if (providerFilter !== "all" && session.provider !== providerFilter) {
          return false;
        }

        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const displayName = getSessionDisplayName(session, sessionDisplayNames).toLowerCase();
          return (
            session.id.toLowerCase().includes(query) ||
            displayName.includes(query) ||
            session.cwd.toLowerCase().includes(query) ||
            session.provider.toLowerCase().includes(query)
          );
        }

        return true;
      })
      .sort((a, b) => {
        const aPriority = statusPriority[a.status] ?? 99;
        const bPriority = statusPriority[b.status] ?? 99;
        if (aPriority !== bPriority) return aPriority - bPriority;

        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return bTime - aTime;
      });
  }, [sessions, statusFilter, providerFilter, searchQuery, sessionDisplayNames]);

  const totalPages = Math.max(1, Math.ceil(filteredSessions.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedSessions = filteredSessions.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );
  const providerOptions = useMemo(() => {
    const providerSet = new Set(sessions.map((session) => session.provider));
    return Array.from(providerSet)
      .sort((a, b) => a.localeCompare(b))
      .map((provider) => ({
        value: provider,
        label: getProviderPresentation(provider).label,
      }));
  }, [sessions]);

  useEffect(() => {
    if (providerFilter === "all") {
      return;
    }
    const stillExists = providerOptions.some((option) => option.value === providerFilter);
    if (!stillExists) {
      setProviderFilter("all");
    }
  }, [providerFilter, providerOptions]);

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

  if (error) {
    return (
      <div className="p-4 md:p-8 max-w-7xl mx-auto">
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-4 text-red-400 text-sm">
          Error loading sessions: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-4 md:mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1 hidden sm:block">
            Manage your interactive CLI sessions
          </p>
        </div>
        <div className="hidden sm:block">
          <CreateSessionDialog />
        </div>
      </div>

      {/* Filters */}
      <SessionFilters
        statusFilter={statusFilter}
        providerFilter={providerFilter}
        providerOptions={providerOptions}
        searchQuery={searchQuery}
        onStatusChange={(v) => {
          setStatusFilter(v);
          setCurrentPage(1);
        }}
        onProviderChange={(v) => {
          setProviderFilter(v);
          setCurrentPage(1);
        }}
        onSearchChange={(v) => {
          setSearchQuery(v);
          setCurrentPage(1);
        }}
      />

      {/* Content */}
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
            <span className="text-sm">Loading sessions...</span>
          </div>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 rounded-xl border border-border bg-card/80">
          <Monitor className="h-10 w-10 text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground mb-1">No sessions found</p>
          {sessions.length === 0 && (
            <p className="text-xs text-muted-foreground/60">
              Create your first session to get started
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Desktop: Table layout */}
          <div className="hidden md:block rounded-xl border border-border overflow-hidden bg-card/80 backdrop-blur-sm">
            <div className="grid grid-cols-[1fr_130px_110px_92px_1.3fr_100px_60px] gap-4 px-5 py-3 border-b border-border text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              <div>ID</div>
              <div>Provider</div>
              <div>Status</div>
              <div>Unread</div>
              <div>Session</div>
              <div>Created</div>
              <div className="text-right">Actions</div>
            </div>
            {paginatedSessions.map((session) => {
              const unreadCount = counts.bySession[session.id] ?? 0;
              const displayName = getSessionDisplayName(session, sessionDisplayNames);
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: row click navigation
                // biome-ignore lint/a11y/noStaticElementInteractions: row click navigation
                <div
                  key={session.id}
                  className="grid grid-cols-[1fr_130px_110px_92px_1.3fr_100px_60px] gap-4 px-5 py-3 items-center border-b border-border/60 last:border-0 hover:bg-accent/50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/sessions/${session.id}`)}
                >
                  <div className="font-mono text-sm text-foreground">{truncate(session.id, 8)}</div>
                  <div>
                    <ProviderBadge provider={session.provider} compact />
                  </div>
                  <div>
                    <Badge variant={getStatusVariant(session.status)}>{session.status}</Badge>
                  </div>
                  <div>
                    {unreadCount > 0 ? (
                      <Badge variant="warning" className="font-mono">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground/35">0</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-foreground truncate">{displayName}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {truncate(session.cwd, 50)}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatRelativeTime(session.createdAt)}
                  </div>
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation wrapper */}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation wrapper */}
                  <div className="text-right" onClick={(e) => e.stopPropagation()}>
                    <SessionRowActions session={session} onStatusChange={updateSessionStatus} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mobile: Card layout */}
          <div className="md:hidden space-y-2">
            {paginatedSessions.map((session) => {
              const unreadCount = counts.bySession[session.id] ?? 0;
              const displayName = getSessionDisplayName(session, sessionDisplayNames);
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: card click navigation
                // biome-ignore lint/a11y/noStaticElementInteractions: card click navigation
                <div
                  key={session.id}
                  className="rounded-xl border border-border bg-card/80 p-3.5 active:bg-accent/50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/sessions/${session.id}`)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ProviderBadge provider={session.provider} compact />
                      <Badge variant={getStatusVariant(session.status)} className="text-[10px]">
                        {session.status}
                      </Badge>
                      {unreadCount > 0 && (
                        <Badge variant="warning" className="text-[10px] font-mono">
                          {unreadCount > 99 ? "99+" : unreadCount} unread
                        </Badge>
                      )}
                      <span className="font-mono text-sm text-foreground">
                        {truncate(session.id, 8)}
                      </span>
                    </div>
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation wrapper */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation wrapper */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <SessionRowActions session={session} onStatusChange={updateSessionStatus} />
                    </div>
                  </div>
                  <div className="text-sm text-foreground truncate mb-0.5">{displayName}</div>
                  <div className="text-xs text-muted-foreground truncate font-mono mb-1">
                    {truncate(session.cwd, 45)}
                  </div>
                  <div className="text-[11px] text-muted-foreground/60">
                    {formatRelativeTime(session.createdAt)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Footer: count + pagination */}
      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredSessions.length)}{" "}
          of {filteredSessions.length}
          {filteredSessions.length !== sessions.length && (
            <span className="text-muted-foreground/40"> ({sessions.length} total)</span>
          )}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                type="button"
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`h-7 min-w-[28px] px-1.5 flex items-center justify-center rounded-md text-xs font-mono transition-colors ${
                  page === safePage
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                }`}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
