import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  GitBranch,
  KeyRound,
  Loader2,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { describeProvider, FALLBACK_PROVIDER_OPTIONS } from "../../lib/providerCapabilities";
import { getProviderPresentation } from "../../lib/providerPresentation";
import { cn } from "../../lib/utils";
import type {
  EnvSet,
  ProviderId,
  ProviderInfo,
  ValidateGitResult,
  ValidateSessionResult,
  Workspace,
} from "../../types/api";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface CreateSessionDialogProps {
  onSessionCreated?: () => void;
  children?: React.ReactNode;
}

function parseArgsInput(input: string): { args: string[]; error?: string } {
  const text = input.trim();
  if (!text) {
    return { args: [] };
  }

  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escapeNext = false;

  for (const ch of text) {
    if (escapeNext) {
      current += ch;
      escapeNext = false;
      continue;
    }

    if (ch === "\\") {
      escapeNext = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (escapeNext) {
    current += "\\";
  }

  if (quote) {
    return { args: [], error: "Unclosed quote in arguments" };
  }

  if (current.length > 0) {
    args.push(current);
  }

  return { args };
}

export function CreateSessionDialog({ onSessionCreated, children }: CreateSessionDialogProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [providerOptions, setProviderOptions] = useState<ProviderInfo[]>([
    ...FALLBACK_PROVIDER_OPTIONS,
  ]);

  // Form state
  const [provider, setProvider] = useState<ProviderId>("claude-code");
  const [dangerousMode, setDangerousMode] = useState(false);
  const [sessionMode, setSessionMode] = useState<"new" | "resume">("new");
  const [providerSessionId, setProviderSessionId] = useState("");
  const [providerResumeMode, setProviderResumeMode] = useState<"resume" | "fork">("resume");
  const [cwdMode, setCwdMode] = useState<"type" | "workspace">("type");
  const [cwd, setCwd] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [args, setArgs] = useState("");
  const [advancedExpanded, setAdvancedExpanded] = useState(true);

  // Worktree
  const [worktreeExpanded, setWorktreeExpanded] = useState(false);
  const [useWorktree, setUseWorktree] = useState(false);
  const [branch, setBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(false);

  // Env sets
  const [envSetsExpanded, setEnvSetsExpanded] = useState(false);
  const [selectedEnvSetIds, setSelectedEnvSetIds] = useState<Set<string>>(new Set());

  // Loaded data
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [envSets, setEnvSets] = useState<EnvSet[]>([]);

  // Validation state
  const [validating, setValidating] = useState(false);
  const [sessionValidation, setSessionValidation] = useState<ValidateSessionResult | null>(null);
  const [gitValidation, setGitValidation] = useState<ValidateGitResult | null>(null);
  const [validatingGit, setValidatingGit] = useState(false);
  const cwdDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gitDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load workspaces and env sets on dialog open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void (async () => {
      const [workspaceResult, envSetResult, providerResult] = await Promise.allSettled([
        api.getWorkspaces(),
        api.getEnvSets(),
        api.getProviders(),
      ]);

      if (cancelled) {
        return;
      }

      if (workspaceResult.status === "fulfilled") {
        setWorkspaces(workspaceResult.value.workspaces);
        if (workspaceResult.value.workspaces.length > 0) {
          setCwdMode("workspace");
          setSelectedWorkspaceId(workspaceResult.value.workspaces[0].id);
        }
      } else {
        toast.error("Failed to load workspaces");
      }

      if (envSetResult.status === "fulfilled") {
        setEnvSets(envSetResult.value.envSets);
      } else {
        toast.error("Failed to load environment sets");
      }

      if (providerResult.status === "fulfilled" && providerResult.value.providers.length > 0) {
        setProviderOptions(providerResult.value.providers);
        setProvider((currentProvider) => {
          const exists = providerResult.value.providers.some(
            (option) => option.id === currentProvider
          );
          return exists ? currentProvider : providerResult.value.providers[0].id;
        });
      } else {
        setProviderOptions([...FALLBACK_PROVIDER_OPTIONS]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const selectedProvider = providerOptions.find((option) => option.id === provider);
  const supportsDangerousMode = selectedProvider?.capabilities.supportsDangerousMode === true;
  const providerLaunchHints = selectedProvider?.launchHints;
  const providerResumeCommands = providerLaunchHints?.resumeCommands;

  useEffect(() => {
    if (!supportsDangerousMode && dangerousMode) {
      setDangerousMode(false);
    }
  }, [dangerousMode, supportsDangerousMode]);

  useEffect(() => {
    if (sessionMode === "resume") {
      setUseWorktree(false);
      setWorktreeExpanded(false);
    }
  }, [sessionMode]);

  // Effective CWD based on mode
  const effectiveCwd =
    cwdMode === "workspace"
      ? workspaces.find((ws) => ws.id === selectedWorkspaceId)?.path || ""
      : cwd;

  // Validate session on CWD change
  const validateCwd = useCallback(async (path: string) => {
    if (!path) {
      setSessionValidation(null);
      return;
    }
    setValidating(true);
    try {
      const result = await api.validateSession({ cwd: path });
      setSessionValidation(result);
    } catch {
      setSessionValidation(null);
    } finally {
      setValidating(false);
    }
  }, []);

  // Debounced CWD validation
  useEffect(() => {
    if (cwdDebounceRef.current) clearTimeout(cwdDebounceRef.current);
    if (!effectiveCwd) {
      setSessionValidation(null);
      return;
    }
    cwdDebounceRef.current = setTimeout(() => validateCwd(effectiveCwd), 500);
    return () => {
      if (cwdDebounceRef.current) clearTimeout(cwdDebounceRef.current);
    };
  }, [effectiveCwd, validateCwd]);

  // Validate git on branch change
  const validateGitBranch = useCallback(
    async (path: string, branchName: string, shouldCreate: boolean) => {
      if (!(path && branchName)) {
        setGitValidation(null);
        return;
      }
      setValidatingGit(true);
      try {
        const result = await api.validateGit({
          cwd: path,
          branch: branchName,
          createBranch: shouldCreate,
        });
        setGitValidation(result);
      } catch {
        setGitValidation(null);
      } finally {
        setValidatingGit(false);
      }
    },
    []
  );

  // Debounced git validation
  useEffect(() => {
    if (!useWorktree) {
      setGitValidation(null);
      return;
    }
    if (gitDebounceRef.current) clearTimeout(gitDebounceRef.current);
    if (!branch) {
      setGitValidation(null);
      return;
    }
    gitDebounceRef.current = setTimeout(
      () => validateGitBranch(effectiveCwd, branch, createBranch),
      500
    );
    return () => {
      if (gitDebounceRef.current) clearTimeout(gitDebounceRef.current);
    };
  }, [branch, createBranch, effectiveCwd, useWorktree, validateGitBranch]);

  const toggleEnvSet = (id: string) => {
    setSelectedEnvSetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Determine if create is allowed
  const hasValidationErrors = sessionValidation && !sessionValidation.valid;
  const hasGitErrors =
    sessionMode === "new" && useWorktree && gitValidation && !gitValidation.valid;
  const requiresProviderSessionId =
    sessionMode === "resume" && providerSessionId.trim().length === 0;
  const canCreate =
    effectiveCwd &&
    !validating &&
    !validatingGit &&
    !hasValidationErrors &&
    !hasGitErrors &&
    !requiresProviderSessionId;

  const handleCreate = async () => {
    if (!effectiveCwd) {
      toast.error("Working directory is required");
      return;
    }

    try {
      const parsedArgs = parseArgsInput(args);
      if (parsedArgs.error) {
        toast.error(parsedArgs.error);
        return;
      }

      setCreating(true);
      const { session } = await api.createSession({
        provider,
        cwd: effectiveCwd,
        args: parsedArgs.args.length > 0 ? parsedArgs.args : undefined,
        dangerousMode,
        envSetIds: selectedEnvSetIds.size > 0 ? Array.from(selectedEnvSetIds) : undefined,
        providerResume:
          sessionMode === "resume"
            ? {
                providerSessionId: providerSessionId.trim(),
                mode: providerResumeMode,
              }
            : undefined,
        worktree:
          sessionMode === "new" && useWorktree && branch ? { branch, createBranch } : undefined,
      });

      toast.success("Session created successfully");
      setOpen(false);
      resetForm();
      onSessionCreated?.();
      setTimeout(() => navigate(`/sessions/${session.id}`), 300);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setProvider("claude-code");
    setDangerousMode(false);
    setSessionMode("new");
    setProviderSessionId("");
    setProviderResumeMode("resume");
    setCwdMode("type");
    setCwd("");
    setSelectedWorkspaceId("");
    setArgs("");
    setAdvancedExpanded(true);
    setUseWorktree(false);
    setBranch("");
    setCreateBranch(false);
    setSelectedEnvSetIds(new Set());
    setSessionValidation(null);
    setGitValidation(null);
    setWorktreeExpanded(false);
    setEnvSetsExpanded(false);
  };

  const dangerousFlags = (() => {
    if (!dangerousMode) {
      return [];
    }
    return providerLaunchHints?.dangerousModeFlags ?? [];
  })();

  const providerResumePreview = (() => {
    if (sessionMode !== "resume" || !providerResumeCommands?.resume) {
      return undefined;
    }
    const id = providerSessionId.trim() || "<provider-session-id>";
    const template =
      providerResumeMode === "fork"
        ? (providerResumeCommands.fork ?? providerResumeCommands.resume)
        : providerResumeCommands.resume;
    return template.split("{id}").join(id);
  })();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button className="bg-cyan-600 hover:bg-cyan-700 text-white border-0">
            <Plus className="h-4 w-4 mr-1.5" />
            New Session
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="border-border bg-popover max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Session</DialogTitle>
          <DialogDescription className="text-muted-foreground/60">
            Start a new provider session in tmux.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Provider *
            </span>
            <div className="grid gap-2">
              {providerOptions.map((option) => {
                const providerVisual = getProviderPresentation(option.id);
                const ProviderIcon = providerVisual.icon;
                const isSelected = provider === option.id;
                const capabilityPills = [
                  {
                    label: option.capabilities.nativeHooks ? "Native Hooks" : "No Native Hooks",
                    active: option.capabilities.nativeHooks,
                  },
                  {
                    label:
                      option.capabilities.policyChannel === "input-preflight"
                        ? "Input Preflight Policy"
                        : "Hook Policy Channel",
                    active: option.capabilities.policyChannel !== "none",
                  },
                  {
                    label:
                      option.capabilities.metricsChannel === "transcript"
                        ? "Transcript Metrics"
                        : option.capabilities.metricsChannel === "pty"
                          ? "PTY Metrics"
                          : "No Metrics",
                    active: option.capabilities.metricsChannel !== "none",
                  },
                ];

                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setProvider(option.id)}
                    className={cn(
                      "group rounded-xl border p-3 text-left transition-all",
                      isSelected
                        ? "border-primary/45 bg-gradient-to-r from-primary/14 via-primary/6 to-transparent shadow-[0_8px_20px_rgba(0,0,0,0.12)]"
                        : "border-border/80 bg-muted/20 hover:border-border hover:bg-muted/35"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border",
                          providerVisual.className
                        )}
                      >
                        <ProviderIcon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">
                            {option.label}
                          </span>
                          <span className="rounded-full border border-border/70 bg-background/70 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                            {option.runtime}
                          </span>
                          {option.capabilities.nativeHooks && (
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                              Recommended
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {describeProvider(option)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {capabilityPills.map((pill) => (
                            <span
                              key={`${option.id}-${pill.label}`}
                              className={cn(
                                "rounded-full border px-1.5 py-0.5 text-[10px]",
                                pill.active
                                  ? "border-primary/25 bg-primary/10 text-primary"
                                  : "border-border/70 bg-background/60 text-muted-foreground"
                              )}
                            >
                              {pill.label}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div
                        className={cn(
                          "mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                          isSelected
                            ? "border-primary/50 bg-primary/15 text-primary"
                            : "border-border/70 text-transparent group-hover:border-primary/25"
                        )}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Session Mode
            </span>
            <div className="flex gap-1 bg-muted/40 rounded-md p-0.5">
              <button
                type="button"
                onClick={() => setSessionMode("new")}
                className={`flex-1 text-xs px-2.5 py-1.5 rounded transition-all ${
                  sessionMode === "new"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                New Session
              </button>
              <button
                type="button"
                onClick={() => setSessionMode("resume")}
                className={`flex-1 text-xs px-2.5 py-1.5 rounded transition-all ${
                  sessionMode === "resume"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Resume by ID
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              {sessionMode === "new"
                ? "Start a new provider conversation inside a CodePiper-managed tmux session."
                : "Attach a new CodePiper runtime to an existing provider conversation/session ID."}
            </p>
          </div>

          {/* Working Directory */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Working Directory *
              </span>
              {workspaces.length > 0 && (
                <div className="flex gap-1 bg-muted/40 rounded-md p-0.5">
                  <button
                    type="button"
                    onClick={() => setCwdMode("type")}
                    className={`text-[10px] px-2 py-0.5 rounded transition-all ${
                      cwdMode === "type"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Type Path
                  </button>
                  <button
                    type="button"
                    onClick={() => setCwdMode("workspace")}
                    className={`text-[10px] px-2 py-0.5 rounded transition-all ${
                      cwdMode === "workspace"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Workspace
                  </button>
                </div>
              )}
            </div>

            {cwdMode === "type" ? (
              <Input
                placeholder="/path/to/project"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                className="border-border bg-muted/30 font-mono text-sm placeholder:text-muted-foreground/30"
              />
            ) : (
              <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
                <SelectTrigger className="border-border bg-muted/30">
                  <SelectValue placeholder="Select a workspace..." />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.id}>
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-3 w-3 text-cyan-400" />
                        <span>{ws.name}</span>
                        <span className="text-muted-foreground/50 text-xs font-mono ml-1">
                          {ws.path}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Validation indicator */}
            <ValidationIndicator validating={validating} result={sessionValidation} />
          </div>

          {sessionMode === "resume" && (
            <div className="border border-cyan-500/20 rounded-lg p-3 space-y-3 bg-cyan-500/[0.04]">
              <div className="grid gap-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Provider Session ID *
                </span>
                <Input
                  placeholder={providerResumeCommands?.idPlaceholder ?? "provider session id"}
                  value={providerSessionId}
                  onChange={(e) => setProviderSessionId(e.target.value)}
                  className="border-border bg-background/70 font-mono text-sm"
                />
                {requiresProviderSessionId && (
                  <span className="text-[11px] text-red-400">
                    Provider session ID is required in Resume mode.
                  </span>
                )}
              </div>

              <div className="grid gap-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Resume Strategy
                </span>
                <Select
                  value={providerResumeMode}
                  onValueChange={(value) => setProviderResumeMode(value as "resume" | "fork")}
                >
                  <SelectTrigger className="border-border bg-background/70">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resume">Resume existing thread/session</SelectItem>
                    <SelectItem value="fork">Fork from that thread/session</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground/70">
                  {providerResumeCommands?.resume
                    ? providerResumeMode === "fork"
                      ? providerResumeCommands.fork
                        ? `Uses \`${providerResumeCommands.fork}\`.`
                        : `Uses \`${providerResumeCommands.resume}\` (provider does not expose a dedicated fork command).`
                      : `Uses \`${providerResumeCommands.resume}\`.`
                    : "Provider resume command preview unavailable for this provider."}
                </p>
              </div>
            </div>
          )}

          {/* Git Worktree (collapsible, visible when isGitRepo) */}
          {sessionMode === "new" && sessionValidation?.isGitRepo && (
            <div className="border border-border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setWorktreeExpanded(!worktreeExpanded)}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {worktreeExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <GitBranch className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-xs font-medium text-foreground">Git Worktree</span>
                </div>
                {sessionValidation.gitInfo && (
                  <span className="text-[10px] font-mono text-muted-foreground/60">
                    {sessionValidation.gitInfo.currentBranch}
                  </span>
                )}
              </button>

              {worktreeExpanded && (
                <div className="border-t border-border px-3 py-3 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useWorktree}
                      onChange={(e) => setUseWorktree(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-xs text-muted-foreground">
                      Use Git Worktree (isolated branch work)
                    </span>
                  </label>

                  {useWorktree && (
                    <div className="space-y-3 pl-5">
                      <div>
                        <span className="text-[10px] font-medium text-muted-foreground mb-1 block">
                          Branch
                        </span>
                        <Input
                          placeholder="feature/my-branch"
                          value={branch}
                          onChange={(e) => setBranch(e.target.value)}
                          className="bg-background border-border font-mono text-xs h-8"
                          list="branch-suggestions"
                        />
                        {sessionValidation.gitInfo?.branches && (
                          <datalist id="branch-suggestions">
                            {sessionValidation.gitInfo.branches.map((b) => (
                              <option key={b} value={b} />
                            ))}
                          </datalist>
                        )}
                      </div>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={createBranch}
                          onChange={(e) => setCreateBranch(e.target.checked)}
                          className="rounded border-border"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          Create branch if it doesn't exist
                        </span>
                      </label>

                      {/* Git validation */}
                      <GitValidationIndicator validating={validatingGit} result={gitValidation} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Environment Sets (collapsible) */}
          {envSets.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setEnvSetsExpanded(!envSetsExpanded)}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {envSetsExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <KeyRound className="h-3.5 w-3.5 text-violet-400" />
                  <span className="text-xs font-medium text-foreground">Environment Sets</span>
                </div>
                {selectedEnvSetIds.size > 0 && (
                  <span className="text-[10px] font-mono text-violet-400/80">
                    {selectedEnvSetIds.size} selected
                  </span>
                )}
              </button>

              {envSetsExpanded && (
                <div className="border-t border-border px-3 py-3 space-y-2">
                  {envSets.map((es) => (
                    <label key={es.id} className="flex items-center gap-2.5 cursor-pointer py-1">
                      <input
                        type="checkbox"
                        checked={selectedEnvSetIds.has(es.id)}
                        onChange={() => toggleEnvSet(es.id)}
                        className="rounded border-border"
                      />
                      <div className="min-w-0">
                        <span className="text-xs text-foreground">{es.name}</span>
                        {es.description && (
                          <span className="text-[10px] text-muted-foreground/60 ml-2">
                            {es.description}
                          </span>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvancedExpanded(!advancedExpanded)}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                {advancedExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-xs font-medium text-foreground">Advanced Options</span>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/60">
                args + dangerous + preview
              </span>
            </button>

            {advancedExpanded && (
              <div className="border-t border-border px-3 py-3 space-y-3">
                <div className="grid gap-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Arguments (optional)
                  </span>
                  <Input
                    placeholder="--model opus --verbose"
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    className="border-border bg-muted/30 font-mono text-sm placeholder:text-muted-foreground/30"
                  />
                  <p className="text-[11px] text-muted-foreground/70">
                    Supports quoted values, e.g. <code>--prompt \"hello world\"</code>.
                  </p>
                </div>

                <div className="border border-amber-500/40 rounded-lg p-3 space-y-2 bg-amber-500/5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dangerousMode}
                      disabled={!supportsDangerousMode}
                      onChange={(event) => setDangerousMode(event.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-xs font-medium text-amber-300">Dangerous Mode</span>
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    {supportsDangerousMode
                      ? "Bypasses CodePiper policy checks and enables provider-native dangerous mode flags for this session."
                      : "This provider does not support dangerous mode."}
                  </p>
                  {dangerousFlags.length > 0 && (
                    <p className="text-[11px] text-amber-200/90 font-mono">
                      Effective flags: {dangerousFlags.join(" ")}
                    </p>
                  )}
                </div>

                {providerResumePreview && (
                  <div className="border border-cyan-500/25 rounded-lg p-3 bg-cyan-500/[0.06]">
                    <p className="text-[11px] text-muted-foreground mb-1">
                      Provider resume preview
                    </p>
                    <p className="text-[11px] font-mono text-cyan-200/90 break-all">
                      {providerResumePreview}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={creating}
            className="border-border"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || !canCreate}
            className="bg-cyan-600 hover:bg-cyan-700 text-white border-0"
          >
            {creating ? "Creating..." : "Create Session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ValidationIndicator({
  validating,
  result,
}: {
  validating: boolean;
  result: ValidateSessionResult | null;
}) {
  if (validating) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground/60">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-[11px]">Validating...</span>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="space-y-1">
      {result.errors.map((err) => (
        <div key={err} className="flex items-center gap-1.5 text-red-400">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="text-[11px]">{err}</span>
        </div>
      ))}
      {result.warnings.map((warn) => (
        <div key={warn} className="flex items-center gap-1.5 text-amber-400">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="text-[11px]">{warn}</span>
        </div>
      ))}
      {result.valid && result.errors.length === 0 && (
        <div className="flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          <span className="text-[11px]">
            Directory valid
            {result.isGitRepo && " (git repository)"}
          </span>
        </div>
      )}
    </div>
  );
}

function GitValidationIndicator({
  validating,
  result,
}: {
  validating: boolean;
  result: ValidateGitResult | null;
}) {
  if (validating) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground/60">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-[11px]">Checking branch...</span>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="space-y-1">
      {result.errors.map((err) => (
        <div key={err} className="flex items-center gap-1.5 text-red-400">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="text-[11px]">{err}</span>
        </div>
      ))}
      {result.warnings.map((warn) => (
        <div key={warn} className="flex items-center gap-1.5 text-amber-400">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="text-[11px]">{warn}</span>
        </div>
      ))}
      {result.valid && result.errors.length === 0 && (
        <div className="flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          <span className="text-[11px]">Branch ready</span>
        </div>
      )}
    </div>
  );
}
