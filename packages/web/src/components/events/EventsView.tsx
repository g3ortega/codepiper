import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useInfiniteEvents } from "../../hooks/useInfiniteEvents";
import { formatRelativeTime } from "../../lib/utils";

interface EventsViewProps {
  sessionId: string;
}

export function EventsView({ sessionId }: EventsViewProps) {
  const { events, loading, loadingMore, hasMore, sentinelRef } = useInfiniteEvents({
    sessionId,
    order: "desc",
  });
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

  const toggleEvent = (eventId: number) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const getSourceStyle = (source: string) => {
    switch (source) {
      case "hook":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "transcript":
        return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
      case "pty":
        return "bg-violet-500/10 text-violet-400 border-violet-500/20";
      case "statusline":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      default:
        return "bg-muted/50 text-muted-foreground border-border";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          <span className="text-sm">Loading events...</span>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-muted-foreground">No events yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 p-3 md:p-4">
      {events.map((event) => {
        const isExpanded = expandedEvents.has(event.id);
        const payload =
          typeof event.payload === "string"
            ? event.payload
            : JSON.stringify(event.payload, null, 2);

        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: toggle is mouse-only convenience
          // biome-ignore lint/a11y/noStaticElementInteractions: toggle is mouse-only convenience
          <div
            key={event.id}
            className="rounded-lg border border-border bg-muted/30 cursor-pointer overflow-hidden transition-colors hover:bg-accent/50"
            onClick={() => toggleEvent(event.id)}
          >
            <div className="flex items-center justify-between px-3 md:px-4 py-2.5">
              <div className="flex items-center gap-2 md:gap-2.5 min-w-0">
                <ChevronRight
                  className={`h-3 w-3 text-muted-foreground/40 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${getSourceStyle(event.source)}`}
                >
                  {event.source}
                </span>
                <span className="text-xs md:text-sm font-medium truncate">{event.type}</span>
              </div>
              <span className="text-[10px] md:text-[11px] text-muted-foreground/50 shrink-0 ml-2">
                {formatRelativeTime(event.timestamp)}
              </span>
            </div>

            {isExpanded && (
              <div className="border-t border-border/60 px-3 md:px-4 py-3">
                <pre className="text-xs bg-muted/80 p-3 rounded-lg overflow-x-auto font-mono text-muted-foreground/80">
                  {payload}
                </pre>
              </div>
            )}
          </div>
        );
      })}

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-1" />

      {loadingMore && (
        <div className="flex items-center justify-center py-4">
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
            <span className="text-sm">Loading more...</span>
          </div>
        </div>
      )}

      {!hasMore && events.length > 0 && (
        <div className="text-center py-3">
          <span className="text-xs text-muted-foreground/40">All events loaded</span>
        </div>
      )}
    </div>
  );
}
