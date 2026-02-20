import { useInfiniteEvents } from "../../hooks/useInfiniteEvents";
import { extractMessages, type Message } from "../../lib/formatting";
import { formatRelativeTime } from "../../lib/utils";

interface LogsViewProps {
  sessionId: string;
}

export function LogsView({ sessionId }: LogsViewProps) {
  const { events, loading, loadingMore, hasMore, sentinelRef } = useInfiniteEvents({
    sessionId,
    source: "transcript",
    order: "desc",
  });

  // extractMessages returns ASC order; reverse to show newest first
  const messages = extractMessages(events).reverse();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          <span className="text-sm">Loading conversation...</span>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-muted-foreground">No messages yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3 md:p-4">
      {messages.map((message, idx) => (
        <MessageCard key={`${message.timestamp.getTime()}-${idx}`} message={message} />
      ))}

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

      {!hasMore && messages.length > 0 && (
        <div className="text-center py-3">
          <span className="text-xs text-muted-foreground/40">All messages loaded</span>
        </div>
      )}
    </div>
  );
}

interface MessageCardProps {
  message: Message;
}

function MessageCard({ message }: MessageCardProps) {
  const getRoleStyle = (role: string): string => {
    switch (role) {
      case "user":
        return "border-cyan-500/15 bg-cyan-500/[0.03]";
      case "assistant":
        return "border-violet-500/15 bg-violet-500/[0.03]";
      default:
        return "border-amber-500/15 bg-amber-500/[0.03]";
    }
  };

  const getRoleColor = (role: string): string => {
    switch (role) {
      case "user":
        return "text-cyan-400";
      case "assistant":
        return "text-violet-400";
      default:
        return "text-amber-400";
    }
  };

  return (
    <div className={`rounded-lg border p-3 md:p-4 ${getRoleStyle(message.role)}`}>
      <div className="flex items-start justify-between mb-2">
        <span className={`text-xs font-semibold capitalize ${getRoleColor(message.role)}`}>
          {message.role}
        </span>
        <span className="text-[11px] text-muted-foreground/50">
          {formatRelativeTime(message.timestamp)}
        </span>
      </div>
      <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed">{message.content}</div>
      {message.tokens && (
        <div className="mt-2 text-[11px] text-muted-foreground/40 font-mono">
          {message.tokens.prompt} prompt &middot; {message.tokens.completion} completion
        </div>
      )}
    </div>
  );
}
