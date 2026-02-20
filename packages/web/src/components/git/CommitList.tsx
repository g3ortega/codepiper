import { GitCommitHorizontal } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { GitLogEntry } from "@/types/api";

interface CommitListProps {
  commits: GitLogEntry[];
  selectedCommit: string | null;
  onSelectCommit: (hash: string) => void;
}

export function CommitList({ commits, selectedCommit, onSelectCommit }: CommitListProps) {
  if (commits.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground/50">
        <p className="text-xs">No commits found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      {commits.map((commit) => (
        <button
          key={commit.hash}
          type="button"
          className={cn(
            "flex items-start gap-2 px-3 py-2 text-left text-xs transition-colors border-b border-border/30 last:border-b-0",
            selectedCommit === commit.hash
              ? "bg-cyan-500/10 text-foreground"
              : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          )}
          onClick={() => onSelectCommit(commit.hash)}
        >
          <GitCommitHorizontal className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/50" />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[10px] text-cyan-400/70 shrink-0">
                {commit.shortHash}
              </span>
              <span className="font-medium truncate">{commit.message}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/50">
              <span>{commit.author}</span>
              <span>&middot;</span>
              <span>{formatRelativeTime(commit.date)}</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
