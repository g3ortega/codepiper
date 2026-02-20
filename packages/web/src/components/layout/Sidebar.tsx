import {
  BarChart3,
  GitBranch,
  LayoutDashboard,
  Monitor,
  Plus,
  Settings,
  Shield,
} from "lucide-react";
import { useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useNotifications } from "@/contexts/NotificationContext";
import { buildSessionDisplayNameMap, getSessionDisplayName } from "@/lib/sessionPresentation";
import { useSessions } from "../../lib/hooks/useSessions";
import { cn, isActiveSession, needsAttention } from "../../lib/utils";
import { CreateSessionDialog } from "../sessions/CreateSessionDialog";

const navBefore = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Sessions", href: "/sessions", icon: Monitor },
];

const navAfter = [
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Workflows", href: "/workflows", icon: GitBranch },
  { name: "Policies", href: "/policies", icon: Shield },
];

function NavTooltip({ label }: { label: string }) {
  return (
    <span className="absolute left-full ml-2.5 px-2.5 py-1 rounded-md bg-popover border border-border text-xs font-medium text-popover-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 shadow-lg shadow-black/20">
      {label}
    </span>
  );
}

function NavItem({
  item,
  sessionCount,
  attentionCount,
  unreadCount,
}: {
  item: { name: string; href: string; icon: React.ComponentType<{ className?: string }> };
  sessionCount: number;
  attentionCount: number;
  unreadCount: number;
}) {
  const displayCount = unreadCount > 0 ? unreadCount : sessionCount;

  return (
    <NavLink
      to={item.href}
      end={item.href === "/"}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200",
          isActive
            ? "text-cyan-400 bg-cyan-500/[0.12]"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <div className="absolute -left-[6px] top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-gradient-to-b from-cyan-400 to-cyan-600 shadow-[0_0_8px_rgba(6,182,212,0.4)]" />
          )}
          <item.icon
            className={cn(
              "h-[18px] w-[18px] transition-colors",
              isActive ? "text-cyan-400" : "text-muted-foreground group-hover:text-foreground"
            )}
          />
          {item.href === "/sessions" && displayCount > 0 && (
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold leading-none px-1",
                unreadCount > 0 || attentionCount > 0
                  ? "bg-amber-500 text-amber-950 shadow-[0_0_8px_rgba(245,158,11,0.5)] pulse-live"
                  : "bg-cyan-500/90 text-cyan-950 shadow-[0_0_6px_rgba(6,182,212,0.4)]"
              )}
            >
              {displayCount > 99 ? "99+" : displayCount}
            </span>
          )}
          <NavTooltip label={item.name} />
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentSessionId = location.pathname.match(/^\/sessions\/([^/]+)/)?.[1];
  const { sessions } = useSessions();
  const { counts } = useNotifications();
  const attentionCount = sessions.filter(needsAttention).length;

  const recentActive = useMemo(() => {
    return sessions
      .filter(isActiveSession)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [sessions]);
  const sessionDisplayNames = useMemo(() => buildSessionDisplayNameMap(sessions), [sessions]);

  const sessionCount = recentActive.length;

  return (
    <aside className="hidden md:flex w-[60px] border-r border-border bg-card flex-col items-center relative overflow-visible">
      {/* Subtle gradient glow */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-cyan-500/[0.04] to-transparent pointer-events-none" />

      {/* Logo */}
      <button
        type="button"
        onClick={() => navigate("/")}
        className="py-4 relative group cursor-pointer"
        title="Dashboard"
      >
        <img
          src="/piper.svg"
          alt="CodePiper"
          className="w-10 h-10 transition-transform group-hover:scale-110"
        />
      </button>

      {/* New Session */}
      <div className="pb-2 relative group">
        <CreateSessionDialog>
          <button
            type="button"
            className="w-9 h-9 rounded-lg bg-cyan-500/10 text-cyan-400/70 hover:bg-cyan-500/20 hover:text-cyan-400 flex items-center justify-center transition-all duration-200 border border-cyan-500/10 hover:border-cyan-500/20"
          >
            <Plus className="h-4 w-4" />
          </button>
        </CreateSessionDialog>
        <NavTooltip label="New Session" />
      </div>

      {/* Divider */}
      <div className="w-6 border-t border-border/60 mb-1" />

      {/* Main Navigation */}
      <nav className="flex-1 flex flex-col items-center gap-0.5 py-1 relative">
        {navBefore.map((item) => (
          <NavItem
            key={item.href}
            item={item}
            sessionCount={sessionCount}
            attentionCount={attentionCount}
            unreadCount={item.href === "/sessions" ? counts.totalUnread : 0}
          />
        ))}

        {/* Active Sessions — inline after Sessions, before Analytics */}
        {recentActive.length > 0 && (
          <div className="flex flex-col items-center gap-0.5 py-1 my-0.5">
            <div className="w-5 border-t border-emerald-500/20 mb-0.5" />
            {recentActive.map((s) => {
              const displayName = getSessionDisplayName(s, sessionDisplayNames);
              const isAttention = needsAttention(s);
              const isViewing = currentSessionId === s.id;
              const unreadCount = counts.bySession[s.id] ?? 0;
              return (
                <NavLink
                  key={s.id}
                  to={`/sessions/${s.id}`}
                  className={cn(
                    "group relative flex items-center justify-center w-10 h-8 rounded-lg transition-all duration-200",
                    isViewing ? "bg-emerald-500/[0.12]" : "hover:bg-emerald-500/10"
                  )}
                >
                  {isViewing && (
                    <div className="absolute -left-[6px] top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                  )}
                  <Monitor
                    className={cn(
                      "h-4 w-4 transition-all duration-200",
                      isAttention
                        ? "text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.6)]"
                        : "text-emerald-400 drop-shadow-[0_0_4px_rgba(16,185,129,0.5)]",
                      isAttention && "pulse-live"
                    )}
                  />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] rounded-full bg-amber-500 text-[9px] font-bold text-amber-950 flex items-center justify-center px-1 leading-none shadow-[0_0_8px_rgba(245,158,11,0.45)]">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                  <span className="absolute left-full ml-2.5 px-2.5 py-1.5 rounded-md bg-popover border border-border text-xs text-popover-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 shadow-lg shadow-black/20 max-w-[200px]">
                    <span className="font-medium text-emerald-400">{displayName}</span>
                    {unreadCount > 0 && (
                      <span className="block text-[10px] text-amber-400 mt-0.5">
                        {unreadCount} unread notification{unreadCount === 1 ? "" : "s"}
                      </span>
                    )}
                    <span className="block text-[10px] text-muted-foreground mt-0.5 truncate">
                      {s.cwd}
                    </span>
                  </span>
                </NavLink>
              );
            })}
            <div className="w-5 border-t border-emerald-500/20 mt-0.5" />
          </div>
        )}

        {navAfter.map((item) => (
          <NavItem
            key={item.href}
            item={item}
            sessionCount={0}
            attentionCount={0}
            unreadCount={0}
          />
        ))}
      </nav>

      {/* Bottom section */}
      <div className="flex flex-col items-center gap-1 pb-3">
        {/* Settings */}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              "group relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200",
              isActive
                ? "text-cyan-400 bg-cyan-500/[0.12]"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <div className="absolute -left-[6px] top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-gradient-to-b from-cyan-400 to-cyan-600 shadow-[0_0_8px_rgba(6,182,212,0.4)]" />
              )}
              <Settings
                className={cn(
                  "h-[18px] w-[18px] transition-colors",
                  isActive ? "text-cyan-400" : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              <NavTooltip label="Settings" />
            </>
          )}
        </NavLink>

        {/* Status */}
        <div className="flex flex-col items-center gap-1 pt-1">
          <div className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.5)] pulse-live" />
          <span className="text-[9px] text-muted-foreground/50 font-mono">0.1</span>
        </div>
      </div>
    </aside>
  );
}
