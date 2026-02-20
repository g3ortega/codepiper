import { LayoutDashboard, Monitor, Plus, Settings, Shield } from "lucide-react";
import { useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useNotifications } from "@/contexts/NotificationContext";
import { useTheme } from "@/contexts/ThemeContext";
import { buildSessionDisplayNameMap, getSessionDisplayName } from "@/lib/sessionPresentation";
import { useSessions } from "../../lib/hooks/useSessions";
import { cn, isActiveSession, needsAttention } from "../../lib/utils";
import { CreateSessionDialog } from "../sessions/CreateSessionDialog";

const tabs = [
  { name: "Home", href: "/", icon: LayoutDashboard },
  { name: "Sessions", href: "/sessions", icon: Monitor },
  { name: "new", href: "#new", icon: Plus }, // placeholder — handled specially
  { name: "Policies", href: "/policies", icon: Shield },
  { name: "More", href: "/settings", icon: Settings },
];

interface MobileNavProps {
  keyboardOpen?: boolean;
}

export function MobileNav({ keyboardOpen = false }: MobileNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const currentSessionId = location.pathname.match(/^\/sessions\/([^/]+)/)?.[1];
  const { sessions } = useSessions();
  const { counts } = useNotifications();

  const recentActive = useMemo(() => {
    return sessions
      .filter(isActiveSession)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [sessions]);
  const sessionDisplayNames = useMemo(() => buildSessionDisplayNameMap(sessions), [sessions]);

  const activeCount = recentActive.length;
  const sessionBadgeCount = counts.totalUnread > 0 ? counts.totalUnread : activeCount;
  const navSurfaceClass =
    theme.mode === "dark" ? "bg-card/95 backdrop-blur-xl" : "bg-card border-border/90";

  return (
    <nav
      className={cn(
        "md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border pb-safe transition-transform duration-200 ease-out",
        navSurfaceClass,
        keyboardOpen
          ? "translate-y-[calc(100%+1.5rem)] opacity-0 pointer-events-none"
          : "translate-y-0 opacity-100"
      )}
    >
      {/* Active session switcher strip */}
      {recentActive.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/[0.03] border-b border-emerald-500/10 overflow-x-auto scrollbar-none">
          {recentActive.map((s) => {
            const displayName = getSessionDisplayName(s, sessionDisplayNames);
            const isAttention = needsAttention(s);
            const isViewing = currentSessionId === s.id;
            const unreadCount = counts.bySession[s.id] ?? 0;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => navigate(`/sessions/${s.id}`)}
                className={cn(
                  "flex items-center gap-1.5 shrink-0 min-h-[28px] px-2.5 rounded-full border active:scale-95 transition-all",
                  isViewing
                    ? "bg-emerald-500/15 border-emerald-400/30 shadow-[0_0_8px_rgba(16,185,129,0.15)]"
                    : "bg-card/60 border-border/40"
                )}
              >
                <Monitor
                  className={cn(
                    "h-3 w-3 shrink-0",
                    isAttention
                      ? "text-amber-400 drop-shadow-[0_0_3px_rgba(251,191,36,0.6)]"
                      : "text-emerald-400 drop-shadow-[0_0_3px_rgba(16,185,129,0.5)]",
                    isAttention && "pulse-live"
                  )}
                />
                {unreadCount > 0 && (
                  <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-semibold leading-none text-amber-950 shadow-[0_0_8px_rgba(245,158,11,0.4)]">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
                <span
                  className={cn(
                    "text-[10px] font-medium max-w-[72px] truncate",
                    isViewing ? "text-emerald-300" : "text-muted-foreground"
                  )}
                >
                  {displayName}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          // Special "New Session" center button
          if (tab.name === "new") {
            return (
              <CreateSessionDialog key="new-session">
                <button
                  type="button"
                  className="flex items-center justify-center w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-600 text-white shadow-lg shadow-cyan-500/25 active:scale-95 transition-transform"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </CreateSessionDialog>
            );
          }

          return (
            <NavLink
              key={tab.href}
              to={tab.href}
              end={tab.href === "/"}
              className={({ isActive }) =>
                cn(
                  "relative flex flex-col items-center justify-center gap-0.5 w-14 h-14 transition-colors",
                  isActive ? "text-cyan-400" : "text-muted-foreground active:text-foreground"
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-[2px] rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.5)]" />
                  )}
                  <div className="relative">
                    <tab.icon className="h-5 w-5" />
                    {tab.name === "Sessions" && sessionBadgeCount > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] rounded-full bg-cyan-500 text-[9px] font-bold text-cyan-950 flex items-center justify-center px-1 leading-none">
                        {sessionBadgeCount > 99 ? "99+" : sessionBadgeCount}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-medium">{tab.name}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
