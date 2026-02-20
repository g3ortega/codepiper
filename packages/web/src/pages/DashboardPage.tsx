import { Activity, ArrowUpRight, MessageSquare, Monitor, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/formatting";
import { useSessions } from "@/lib/hooks/useSessions";
import { buildSessionDisplayNameMap, getSessionDisplayName } from "@/lib/sessionPresentation";
import { formatRelativeTime, getStatusColor, isActiveSession, truncate } from "@/lib/utils";

interface OverviewStats {
  sessionsCount: number;
  activeSessions: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalMessages: number;
  cacheHitRate: number;
}

const statCards = [
  {
    key: "active",
    label: "Active",
    icon: Monitor,
    gradient: "from-cyan-500/20 to-cyan-600/5",
    iconColor: "text-cyan-400",
    borderGlow: "shadow-[inset_0_1px_0_0_rgba(6,182,212,0.1)]",
  },
  {
    key: "messages",
    label: "Messages",
    icon: MessageSquare,
    gradient: "from-emerald-500/20 to-emerald-600/5",
    iconColor: "text-emerald-400",
    borderGlow: "shadow-[inset_0_1px_0_0_rgba(16,185,129,0.1)]",
  },
  {
    key: "tokens",
    label: "Tokens",
    icon: Activity,
    gradient: "from-violet-500/20 to-violet-600/5",
    iconColor: "text-violet-400",
    borderGlow: "shadow-[inset_0_1px_0_0_rgba(139,92,246,0.1)]",
  },
  {
    key: "cache",
    label: "Cache",
    icon: Zap,
    gradient: "from-amber-500/20 to-amber-600/5",
    iconColor: "text-amber-400",
    borderGlow: "shadow-[inset_0_1px_0_0_rgba(245,158,11,0.1)]",
  },
];

const STATUS_PRIORITY: Record<string, number> = {
  RUNNING: 0,
  STARTING: 1,
  NEEDS_PERMISSION: 2,
  NEEDS_INPUT: 3,
  STOPPED: 4,
  CRASHED: 5,
};

function DashboardPage() {
  const navigate = useNavigate();
  const { sessions } = useSessions();
  const [stats, setStats] = useState<OverviewStats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics/overview?range=today");
      if (res.ok) {
        setStats(await res.json());
      }
    } catch {
      // Analytics may not have data yet
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const activeSessions = sessions.filter(isActiveSession);
  const sessionDisplayNames = useMemo(() => buildSessionDisplayNameMap(sessions), [sessions]);

  const recentSessions = [...sessions]
    .sort((a, b) => {
      const ap = STATUS_PRIORITY[a.status] ?? 99;
      const bp = STATUS_PRIORITY[b.status] ?? 99;
      if (ap !== bp) return ap - bp;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, 5);

  const getStatValue = (key: string) => {
    switch (key) {
      case "active":
        return activeSessions.length.toString();
      case "messages":
        return formatNumber(stats?.totalMessages ?? 0);
      case "tokens":
        return formatNumber(
          stats?.inputTokens != null
            ? stats.inputTokens + stats.outputTokens
            : (stats?.totalTokens ?? 0)
        );
      case "cache":
        return `${stats?.cacheHitRate ?? 0}%`;
      default:
        return "0";
    }
  };

  const getStatSubtitle = (key: string) => {
    switch (key) {
      case "active":
        return `${sessions.length} total`;
      case "messages":
        return "User + assistant";
      case "tokens":
        return stats?.cacheReadTokens ? `${formatNumber(stats.cacheReadTokens)} cached` : undefined;
      default:
        return undefined;
    }
  };

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
      default:
        return "secondary";
    }
  };

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor your active sessions and system metrics
          </p>
        </div>

        {/* Stats Grid — 2 cols on mobile, 4 on desktop */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
          {statCards.map((card) => {
            const subtitle = getStatSubtitle(card.key);
            return (
              <div
                key={card.key}
                className={`relative rounded-xl border border-border bg-gradient-to-b ${card.gradient} backdrop-blur-sm p-4 md:p-5 ${card.borderGlow}`}
              >
                <div className="flex items-center justify-between mb-2 md:mb-3">
                  <span className="text-[10px] md:text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {card.label}
                  </span>
                  <card.icon className={`h-3.5 w-3.5 md:h-4 md:w-4 ${card.iconColor}`} />
                </div>
                <div className="text-2xl md:text-3xl font-bold tracking-tight">
                  {getStatValue(card.key)}
                </div>
                {subtitle && (
                  <div className="text-[10px] md:text-xs text-muted-foreground mt-1">
                    {subtitle}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Recent Sessions */}
        <div className="rounded-xl border border-border bg-card backdrop-blur-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-border">
            <h2 className="text-sm font-semibold tracking-wide">Recent Sessions</h2>
            <button
              type="button"
              onClick={() => navigate("/sessions")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-400 transition-colors"
            >
              View all <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
          <div>
            {recentSessions.length === 0 ? (
              <div className="py-12 md:py-16 text-center">
                <Monitor className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No sessions yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Create one from the Sessions page
                </p>
              </div>
            ) : (
              <div>
                {recentSessions.map((session) => {
                  const displayName = getSessionDisplayName(session, sessionDisplayNames);
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: row click navigation
                    // biome-ignore lint/a11y/noStaticElementInteractions: row click navigation
                    <div
                      key={session.id}
                      className="flex items-center justify-between px-4 md:px-6 py-3 md:py-3.5 hover:bg-accent/50 cursor-pointer transition-colors border-b border-border/60 last:border-0 active:bg-accent/70"
                      onClick={() => navigate(`/sessions/${session.id}`)}
                    >
                      <div className="flex items-center gap-2 md:gap-3 min-w-0">
                        <Badge variant={getStatusVariant(session.status)} className="shrink-0">
                          {session.status}
                        </Badge>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-sm text-foreground shrink-0">
                            {truncate(session.id, 8)}
                          </span>
                          <span className="text-muted-foreground text-sm truncate hidden sm:inline">
                            {truncate(displayName, 40)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 md:gap-4 shrink-0">
                        <span className="text-[11px] text-muted-foreground">
                          {formatRelativeTime(session.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
