import { AlertTriangle, ArrowLeft, GitBranch, History, RefreshCw, TreePalm } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { GitDiffStatEntry, GitLogEntry, GitStatusEntry } from "@/types/api";
import { BranchSelector } from "./BranchSelector";
import { CommitList } from "./CommitList";
import { DiffViewer } from "./DiffViewer";
import { FileTree } from "./FileTree";

interface GitViewProps {
  sessionId: string;
  cwd: string;
}

type Mode = "working-tree" | "commits";
type FileContext = "staged" | "unstaged" | "untracked" | "commit" | "branch";

export function GitView({ sessionId }: GitViewProps) {
  const [mode, setMode] = useState<Mode>("working-tree");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState("");

  // Working tree state
  const [status, setStatus] = useState<GitStatusEntry[]>([]);

  // Commits state
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<GitDiffStatEntry[]>([]);

  // Diff state
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [_fileContext, setFileContext] = useState<FileContext>("unstaged");
  const [originalContent, setOriginalContent] = useState("");
  const [modifiedContent, setModifiedContent] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [originalRef, setOriginalRef] = useState<string | undefined>();
  const [modifiedRef, setModifiedRef] = useState<string | undefined>();

  // Branch comparison state
  const [branches, setBranches] = useState<string[]>([]);
  const [baseBranch, setBaseBranch] = useState<string | null>(() => {
    return localStorage.getItem(`codepiper:git:baseBranch:${sessionId}`) || null;
  });
  const [branchFiles, setBranchFiles] = useState<GitDiffStatEntry[]>([]);

  // Mobile: show diff panel
  const [showDiff, setShowDiff] = useState(false);

  const staged = status.filter((f) => f.indexStatus && !f.isUntracked);
  const unstaged = status.filter((f) => f.workTreeStatus && !f.isUntracked);
  const untracked = status.filter((f) => f.isUntracked);

  const loadStatus = useCallback(async () => {
    try {
      const res = await api.getGitStatus(sessionId);
      setStatus(res.status);
      setBranch(res.branch);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load git status";
      setError(msg);
    }
  }, [sessionId]);

  const loadCommits = useCallback(async () => {
    try {
      const res = await api.getGitLog(sessionId, 100);
      setCommits(res.log);
    } catch (err) {
      console.error("Failed to load git log:", err);
    }
  }, [sessionId]);

  const loadBranches = useCallback(async () => {
    try {
      const res = await api.getGitBranches(sessionId);
      setBranches(res.branches);
    } catch {
      // not critical
    }
  }, [sessionId]);

  const loadBranchFiles = useCallback(
    async (base: string) => {
      try {
        const res = await api.getGitDiffStat(sessionId, "HEAD", base);
        setBranchFiles(res.files);
      } catch {
        setBranchFiles([]);
        toast.error(`Failed to compare against "${base}"`);
      }
    },
    [sessionId]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadStatus(), loadCommits(), loadBranches()]);
    setLoading(false);
  }, [loadStatus, loadCommits, loadBranches]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Auto-refresh status every 5s
  useEffect(() => {
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  const handleBaseChange = useCallback(
    (branch: string | null) => {
      setBaseBranch(branch);
      if (branch) {
        localStorage.setItem(`codepiper:git:baseBranch:${sessionId}`, branch);
      } else {
        localStorage.removeItem(`codepiper:git:baseBranch:${sessionId}`);
      }
      setSelectedFile(null);
      setShowDiff(false);
    },
    [sessionId]
  );

  // Load branch diff files when baseBranch changes
  useEffect(() => {
    if (baseBranch) {
      loadBranchFiles(baseBranch);
    } else {
      setBranchFiles([]);
    }
  }, [baseBranch, loadBranchFiles]);

  // Validate stored baseBranch against available branches
  useEffect(() => {
    if (baseBranch && branches.length > 0 && !branches.includes(baseBranch)) {
      toast.info(`Branch "${baseBranch}" no longer exists`);
      handleBaseChange(null);
    }
  }, [baseBranch, branches, handleBaseChange]);

  // Load diff when file is selected
  const loadFileDiff = useCallback(
    async (filePath: string, context: FileContext, commitHash?: string) => {
      setDiffLoading(true);
      setDiffError(null);
      try {
        // Resolve the original and modified refs based on context
        let origRef: string | undefined;
        let modRef: string;
        switch (context) {
          case "branch":
            origRef = baseBranch ?? undefined;
            modRef = "HEAD";
            break;
          case "commit":
            origRef = commitHash ? `${commitHash}^` : undefined;
            modRef = commitHash ?? "HEAD";
            break;
          case "staged":
            origRef = "HEAD";
            modRef = ":0";
            break;
          case "untracked":
            origRef = undefined;
            modRef = "WORKING_TREE";
            break;
          default:
            // Unstaged: index vs working tree
            origRef = ":0";
            modRef = "WORKING_TREE";
            break;
        }

        setOriginalRef(origRef);
        setModifiedRef(modRef);

        const emptyFile = { content: "" };

        const fetchBothSides = async () => {
          let origFailed = false;
          let modFailed = false;

          const [origContent, modContent] = await Promise.all([
            origRef
              ? api.getGitFile(sessionId, origRef, filePath).catch((err) => {
                  console.error(`Failed to load original (${origRef}):`, err);
                  origFailed = true;
                  return emptyFile;
                })
              : emptyFile,
            api.getGitFile(sessionId, modRef, filePath).catch((err) => {
              console.error(`Failed to load modified (${modRef}):`, err);
              modFailed = true;
              return emptyFile;
            }),
          ]);

          return { origContent, modContent, origFailed, modFailed };
        };

        let result = await fetchBothSides();

        // Auto-retry once if both sides failed (handles transient failures)
        if (result.origFailed && result.modFailed) {
          await new Promise((r) => setTimeout(r, 200));
          result = await fetchBothSides();
        }

        setOriginalContent(result.origContent.content);
        setModifiedContent(result.modContent.content);

        // If both sides failed after retry, surface the error
        if (result.origFailed && result.modFailed) {
          const msg = "Failed to load file content from both sides";
          setDiffError(msg);
          toast.error(msg);
        } else if (result.modFailed && context !== "untracked") {
          toast.error(`Failed to load modified version (${modRef})`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load diff";
        console.error("Failed to load diff:", err);
        setDiffError(msg);
        toast.error(msg);
        setOriginalContent("");
        setModifiedContent("");
      } finally {
        setDiffLoading(false);
      }
    },
    [sessionId, baseBranch]
  );

  const handleSelectFile = useCallback(
    (path: string, context: FileContext) => {
      setSelectedFile(path);
      setFileContext(context);
      setDiffError(null);
      setShowDiff(true);
      loadFileDiff(path, context, selectedCommit || undefined);
    },
    [loadFileDiff, selectedCommit]
  );

  const handleSelectCommit = useCallback(
    async (hash: string) => {
      setSelectedCommit(hash);
      setSelectedFile(null);
      setShowDiff(false);
      try {
        const res = await api.getGitDiffStat(sessionId, hash);
        setCommitFiles(res.files);
      } catch (err) {
        console.error("Failed to load commit files:", err);
        setCommitFiles([]);
      }
    },
    [sessionId]
  );

  const handleStage = useCallback(
    async (paths: string[]) => {
      try {
        await api.stageFiles(sessionId, paths);
        await loadStatus();
        toast.success(`Staged ${paths.length} file${paths.length > 1 ? "s" : ""}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to stage files");
      }
    },
    [sessionId, loadStatus]
  );

  const handleUnstage = useCallback(
    async (paths: string[]) => {
      try {
        await api.unstageFiles(sessionId, paths);
        await loadStatus();
        toast.success(`Unstaged ${paths.length} file${paths.length > 1 ? "s" : ""}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to unstage files");
      }
    },
    [sessionId, loadStatus]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          <span className="text-sm">Loading git info...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <TreePalm className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground mb-1">Not a git repository</p>
          <p className="text-xs text-muted-foreground/50">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-3 md:px-4 py-2 bg-muted/20">
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center rounded-lg border border-border/60 bg-muted/30 p-0.5">
            <button
              type="button"
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                mode === "working-tree"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => {
                setMode("working-tree");
                setSelectedCommit(null);
                setCommitFiles([]);
                setSelectedFile(null);
                setShowDiff(false);
              }}
            >
              Changes
            </button>
            <button
              type="button"
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                mode === "commits"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => {
                setMode("commits");
                setSelectedFile(null);
                setShowDiff(false);
              }}
            >
              <History className="h-3 w-3 inline mr-1" />
              Commits
            </button>
          </div>

          {/* Branch */}
          {branch && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="h-3 w-3" />
              <span className="font-mono">{branch}</span>
            </div>
          )}

          {/* Base branch selector */}
          {branch && branches.length > 1 && (
            <BranchSelector
              branches={branches}
              currentBranch={branch}
              selectedBase={baseBranch}
              onSelectBase={handleBaseChange}
            />
          )}
        </div>

        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent/50"
          onClick={() => {
            loadAll();
            toast.success("Refreshed");
          }}
        >
          <RefreshCw className="h-3 w-3" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 flex">
        {/* Left panel: file list or commit list */}
        <div
          className={cn(
            "border-r border-border/60 flex flex-col overflow-hidden",
            // On mobile: full width when diff is not shown, hidden when diff is shown
            showDiff
              ? "hidden md:flex md:w-[280px] lg:w-[320px]"
              : "w-full md:w-[280px] lg:w-[320px]",
            "shrink-0"
          )}
        >
          {mode === "working-tree" ? (
            baseBranch ? (
              <FileTree
                staged={[]}
                unstaged={[]}
                untracked={[]}
                branchFiles={branchFiles}
                branchBase={baseBranch}
                selectedFile={selectedFile}
                onSelectFile={(path) => {
                  setSelectedFile(path);
                  setFileContext("branch");
                  setShowDiff(true);
                  loadFileDiff(path, "branch");
                }}
              />
            ) : (
              <FileTree
                staged={staged}
                unstaged={unstaged}
                untracked={untracked}
                selectedFile={selectedFile}
                onSelectFile={handleSelectFile}
                onStage={handleStage}
                onUnstage={handleUnstage}
              />
            )
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              <CommitList
                commits={commits}
                selectedCommit={selectedCommit}
                onSelectCommit={handleSelectCommit}
              />
              {selectedCommit && commitFiles.length > 0 && (
                <div className="border-t border-border/60 flex-shrink-0 max-h-[40%] overflow-y-auto">
                  <FileTree
                    staged={[]}
                    unstaged={[]}
                    untracked={[]}
                    commitFiles={commitFiles}
                    selectedFile={selectedFile}
                    onSelectFile={(path) => {
                      setSelectedFile(path);
                      setFileContext("commit");
                      setShowDiff(true);
                      loadFileDiff(path, "commit", selectedCommit);
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right panel: diff viewer */}
        <div className={cn("flex-1 min-w-0 flex flex-col", !showDiff && "hidden md:flex")}>
          {/* Mobile back button */}
          {showDiff && (
            <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-muted/10">
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => {
                  setShowDiff(false);
                  setSelectedFile(null);
                }}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
              {selectedFile && (
                <span className="text-xs font-mono text-muted-foreground/70 truncate">
                  {selectedFile}
                </span>
              )}
            </div>
          )}

          {selectedFile && !diffLoading && diffError ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-yellow-500/60" />
                <p className="text-sm text-muted-foreground mb-2">{diffError}</p>
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-md bg-accent/50 hover:bg-accent text-foreground transition-colors"
                  onClick={() => {
                    if (selectedFile) {
                      loadFileDiff(selectedFile, _fileContext, selectedCommit || undefined);
                    }
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : selectedFile && !diffLoading ? (
            <div className="flex-1 min-h-0">
              <DiffViewer
                original={originalContent}
                modified={modifiedContent}
                filePath={selectedFile}
                sessionId={sessionId}
                originalRef={originalRef}
                modifiedRef={modifiedRef}
              />
            </div>
          ) : diffLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                <span className="text-sm">Loading diff...</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground/40">
              <div className="text-center">
                <FileDiffIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">
                  {mode === "commits" && !selectedCommit
                    ? "Select a commit to view changes"
                    : "Select a file to view diff"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FileDiffIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role="img"
      aria-label="File diff"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 15h6" />
      <path d="M12 12v6" />
    </svg>
  );
}
