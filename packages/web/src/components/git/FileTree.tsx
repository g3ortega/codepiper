import {
  ChevronDown,
  ChevronRight,
  Circle,
  FileDiff,
  FileMinus,
  FilePlus,
  FileQuestion,
  FileText,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { GitDiffStatEntry, GitStatusEntry } from "@/types/api";

interface FileTreeProps {
  staged: GitStatusEntry[];
  unstaged: GitStatusEntry[];
  untracked: GitStatusEntry[];
  commitFiles?: GitDiffStatEntry[];
  branchFiles?: GitDiffStatEntry[];
  branchBase?: string;
  selectedFile: string | null;
  onSelectFile: (
    path: string,
    context: "staged" | "unstaged" | "untracked" | "commit" | "branch"
  ) => void;
  onStage?: (paths: string[]) => void;
  onUnstage?: (paths: string[]) => void;
}

function statusIcon(status: string) {
  switch (status) {
    case "M":
      return <FileDiff className="h-3.5 w-3.5 text-amber-400" />;
    case "A":
      return <FilePlus className="h-3.5 w-3.5 text-emerald-400" />;
    case "D":
      return <FileMinus className="h-3.5 w-3.5 text-red-400" />;
    case "?":
      return <FileQuestion className="h-3.5 w-3.5 text-muted-foreground/60" />;
    default:
      return <FileText className="h-3.5 w-3.5 text-muted-foreground/60" />;
  }
}

function fileName(path: string) {
  return path.split("/").pop() || path;
}

function fileDir(path: string) {
  const parts = path.split("/");
  if (parts.length <= 1) return "";
  return `${parts.slice(0, -1).join("/")}/`;
}

interface SectionProps {
  title: string;
  count: number;
  defaultOpen?: boolean;
  accentColor: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

function Section({
  title,
  count,
  defaultOpen = true,
  accentColor,
  children,
  action,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (count === 0) return null;

  return (
    <div>
      <button
        type="button"
        className="flex items-center justify-between w-full px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span>{title}</span>
          <span
            className={cn(
              "ml-1 min-w-[18px] h-[16px] rounded-full text-[9px] font-bold flex items-center justify-center px-1",
              accentColor
            )}
          >
            {count}
          </span>
        </div>
        {action && open && (
          // biome-ignore lint/a11y/useKeyWithClickEvents: nested action
          // biome-ignore lint/a11y/noStaticElementInteractions: nested action
          <span onClick={(e) => e.stopPropagation()}>{action}</span>
        )}
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

export function FileTree({
  staged,
  unstaged,
  untracked,
  commitFiles,
  branchFiles,
  branchBase,
  selectedFile,
  onSelectFile,
  onStage,
  onUnstage,
}: FileTreeProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <Section
        title="Staged"
        count={staged.length}
        accentColor="bg-emerald-500/20 text-emerald-400"
        action={
          onUnstage && staged.length > 0 ? (
            <button
              type="button"
              className="text-[9px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border/60 hover:bg-accent/50 transition-colors"
              onClick={() => onUnstage(staged.map((f) => f.path))}
            >
              Unstage all
            </button>
          ) : null
        }
      >
        {staged.map((file) => (
          <FileRow
            key={`staged-${file.path}`}
            path={file.path}
            status={file.indexStatus}
            selected={selectedFile === file.path}
            onClick={() => onSelectFile(file.path, "staged")}
            actionLabel="−"
            onAction={onUnstage ? () => onUnstage([file.path]) : undefined}
          />
        ))}
      </Section>

      <Section
        title="Changes"
        count={unstaged.length}
        accentColor="bg-amber-500/20 text-amber-400"
        action={
          onStage && unstaged.length > 0 ? (
            <button
              type="button"
              className="text-[9px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border/60 hover:bg-accent/50 transition-colors"
              onClick={() => onStage(unstaged.map((f) => f.path))}
            >
              Stage all
            </button>
          ) : null
        }
      >
        {unstaged.map((file) => (
          <FileRow
            key={`unstaged-${file.path}`}
            path={file.path}
            status={file.workTreeStatus}
            selected={selectedFile === file.path}
            onClick={() => onSelectFile(file.path, "unstaged")}
            actionLabel="+"
            onAction={onStage ? () => onStage([file.path]) : undefined}
          />
        ))}
      </Section>

      <Section
        title="Untracked"
        count={untracked.length}
        defaultOpen={false}
        accentColor="bg-muted/50 text-muted-foreground"
        action={
          onStage && untracked.length > 0 ? (
            <button
              type="button"
              className="text-[9px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border/60 hover:bg-accent/50 transition-colors"
              onClick={() => onStage(untracked.map((f) => f.path))}
            >
              Stage all
            </button>
          ) : null
        }
      >
        {untracked.map((file) => (
          <FileRow
            key={`untracked-${file.path}`}
            path={file.path}
            status="?"
            selected={selectedFile === file.path}
            onClick={() => onSelectFile(file.path, "untracked")}
            actionLabel="+"
            onAction={onStage ? () => onStage([file.path]) : undefined}
          />
        ))}
      </Section>

      {commitFiles && commitFiles.length > 0 && (
        <Section
          title="Changed Files"
          count={commitFiles.length}
          accentColor="bg-cyan-500/20 text-cyan-400"
        >
          {commitFiles.map((file) => (
            <FileRow
              key={`commit-${file.path}`}
              path={file.path}
              status="M"
              selected={selectedFile === file.path}
              onClick={() => onSelectFile(file.path, "commit")}
              stat={{ additions: file.additions, deletions: file.deletions }}
            />
          ))}
        </Section>
      )}

      {branchFiles && branchFiles.length > 0 && (
        <Section
          title={`vs ${branchBase ?? "base"}`}
          count={branchFiles.length}
          accentColor="bg-violet-500/20 text-violet-400"
        >
          {branchFiles.map((file) => (
            <FileRow
              key={`branch-${file.path}`}
              path={file.path}
              status={
                file.deletions > 0 && file.additions === 0
                  ? "D"
                  : file.additions > 0 && file.deletions === 0
                    ? "A"
                    : "M"
              }
              selected={selectedFile === file.path}
              onClick={() => onSelectFile(file.path, "branch")}
              stat={{ additions: file.additions, deletions: file.deletions }}
            />
          ))}
        </Section>
      )}

      {staged.length === 0 &&
        unstaged.length === 0 &&
        untracked.length === 0 &&
        (!commitFiles || commitFiles.length === 0) &&
        (!branchFiles || branchFiles.length === 0) && (
          <div className="flex items-center justify-center h-32 text-muted-foreground/50">
            <div className="text-center">
              <Circle className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">Clean working tree</p>
            </div>
          </div>
        )}
    </div>
  );
}

interface FileRowProps {
  path: string;
  status: string;
  selected: boolean;
  onClick: () => void;
  actionLabel?: string;
  onAction?: () => void;
  stat?: { additions: number; deletions: number };
}

function FileRow({ path, status, selected, onClick, actionLabel, onAction, stat }: FileRowProps) {
  return (
    <button
      type="button"
      className={cn(
        "group flex items-center gap-2 w-full px-3 py-1 text-left text-xs transition-colors",
        selected
          ? "bg-cyan-500/10 text-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      )}
      onClick={onClick}
    >
      <span className="shrink-0 flex items-center overflow-hidden">{statusIcon(status)}</span>
      <span className="flex-1 min-w-0 overflow-clip whitespace-nowrap text-ellipsis" title={path}>
        {fileDir(path) && (
          <span className="text-muted-foreground/40 text-[10px]">{fileDir(path)}</span>
        )}
        <span className="font-medium">{fileName(path)}</span>
      </span>
      {stat && (
        <span className="text-[10px] font-mono shrink-0">
          {stat.additions > 0 && <span className="text-emerald-400">+{stat.additions}</span>}
          {stat.additions > 0 && stat.deletions > 0 && (
            <span className="text-muted-foreground/30"> </span>
          )}
          {stat.deletions > 0 && <span className="text-red-400">−{stat.deletions}</span>}
        </span>
      )}
      {onAction && actionLabel && (
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 shrink-0 w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold border border-border/60 hover:bg-accent/80 transition-all"
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
        >
          {actionLabel}
        </button>
      )}
    </button>
  );
}
