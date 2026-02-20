/**
 * API types matching the daemon's API responses
 */

export type KnownProviderId = "claude-code" | "codex";
export type ProviderId = KnownProviderId | (string & {});

export interface ProviderCapabilities {
  nativeHooks: boolean;
  supportsDangerousMode: boolean;
  supportsModelSwitch: boolean;
  supportsTranscriptTailing: boolean;
  supportsTmuxAdoption: boolean;
  policyChannel: "native-hooks" | "input-preflight" | "none";
  metricsChannel: "transcript" | "pty" | "none";
}

export interface ProviderResumeCommandHints {
  resume: string;
  fork?: string;
  idPlaceholder?: string;
}

export interface ProviderLaunchHints {
  dangerousModeFlags: string[];
  resumeCommands?: ProviderResumeCommandHints;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  runtime: "tmux" | "pty";
  capabilities: ProviderCapabilities;
  launchHints?: ProviderLaunchHints;
}

export interface HealthStatus {
  status: string;
  zombieSessionCount?: number;
}

export interface Session {
  id: string;
  provider: ProviderId;
  cwd: string;
  status: "STARTING" | "RUNNING" | "NEEDS_PERMISSION" | "NEEDS_INPUT" | "STOPPED" | "CRASHED";
  createdAt: string;
  updatedAt: string;
  pid?: number;
  ptyRows?: number;
  ptyCols?: number;
  transcriptPath?: string;
  metadata?: Record<string, unknown>;
}

export interface Event {
  id: number;
  sessionId: string;
  timestamp: string;
  source: "pty" | "hook" | "transcript" | "statusline";
  type: string;
  payload: Record<string, unknown>;
}

export interface NotificationListQuery {
  sessionId?: string;
  eventType?: string;
  unreadOnly?: boolean;
  before?: number;
  limit?: number;
}

export interface SessionNotificationRecord {
  id: number;
  sessionId: string;
  provider: string;
  eventType: string;
  sourceEventId: number | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
  readSource: string | null;
}

export interface SessionNotificationCounts {
  totalUnread: number;
  bySession: Record<string, number>;
}

export interface SessionNotificationPrefsRecord {
  sessionId: string;
  enabled: boolean | null;
  updatedAt: string;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushSubscriptionRecord {
  endpoint: string;
  expirationTime: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PushDeliveryStatus {
  enabled: boolean;
  configured: boolean;
  reasons: string[];
  publicKey?: string | null;
}

export interface PushTestResult {
  attempted: number;
  delivered: number;
  expired: number;
  failed: number;
  skipped: boolean;
  reason?: "not_available" | "no_subscriptions";
}

export interface CreateSessionRequest {
  provider: ProviderId;
  cwd: string;
  env?: Record<string, string>;
  args?: string[];
  billingMode?: "subscription" | "api";
  dangerousMode?: boolean;
  envSetIds?: string[];
  providerResume?: {
    providerSessionId: string;
    mode?: "resume" | "fork";
  };
  worktree?: {
    branch: string;
    createBranch: boolean;
    startPoint?: string;
  };
}

export interface UpdateSessionNameRequest {
  name: string | null;
}

export interface SendTextRequest {
  text: string;
  newline?: boolean;
}

export interface SendKeysRequest {
  keys: string[];
}

export interface EventsQuery {
  since?: number;
  before?: number;
  limit?: number;
  source?: string;
  type?: string;
  order?: "asc" | "desc";
}

export interface TokenUsage {
  id: number;
  sessionId: string;
  timestamp: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
}

export interface Policy {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  sessionId?: string;
  rules: PolicyRule[];
  createdAt: string;
  updatedAt: string;
}

export interface PolicyRule {
  id: string;
  action: "allow" | "deny" | "ask";
  tool?: string | string[];
  args?: Record<string, string | string[]>;
  cwd?: string | string[];
  session?: string | string[];
  reason?: string;
}

export interface PolicySet {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  policies: Policy[];
  policyCount: number;
  sessionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PolicySetSummary {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  policyCount: number;
  sessionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyDecision {
  id: number;
  sessionId: string;
  eventId?: number;
  policyId?: string;
  toolName: string;
  args?: Record<string, unknown>;
  decision: "allow" | "deny" | "ask";
  reason?: string;
  timestamp: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  definition: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  error?: string;
  context?: Record<string, unknown>;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnvSet {
  id: string;
  name: string;
  description?: string;
  maskedVars: Record<string, string>;
  varCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DaemonTerminalFeaturesSettings {
  wsPtyPasteEnabled: boolean;
  latencyProbesEnabled: boolean;
  diagnosticsPanelEnabled: boolean;
  codexAppServerSpikeEnabled: boolean;
  wsPtyPasteCanaryPercent: number;
  latencyProbesCanaryPercent: number;
  diagnosticsPanelCanaryPercent: number;
}

export interface DaemonSettings {
  preserveSessions: boolean;
  defaultPolicyAction: "ask" | "deny";
  forwardSshAuthSock: boolean;
  codexHostAccessProfileEnabled: boolean;
  terminalFeatures: DaemonTerminalFeaturesSettings;
  notificationsEnabled: boolean;
  systemNotificationsEnabled: boolean;
  notificationSoundsEnabled: boolean;
  notificationEventDefaults: Record<string, boolean>;
  notificationSoundMap: Record<string, string>;
  updatedAt: string;
}

export interface ValidateSessionRequest {
  cwd: string;
}

export interface ValidateSessionResult {
  valid: boolean;
  directoryExists: boolean;
  isGitRepo: boolean;
  errors: string[];
  warnings: string[];
  gitInfo?: {
    repoRoot: string;
    currentBranch: string;
    hasUncommittedChanges: boolean;
    branches: string[];
  };
}

export interface ValidateGitRequest {
  cwd: string;
  branch: string;
  createBranch: boolean;
}

export interface ValidateGitResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  branchExists: boolean;
  branchCheckedOut: boolean;
  checkedOutIn?: string;
  uncommittedChanges: boolean;
}

export interface GitStatusEntry {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  isUntracked: boolean;
  isRenamed: boolean;
  origPath?: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export interface GitDiffStatEntry {
  path: string;
  additions: number;
  deletions: number;
}

export type TerminalMode = "interactive" | "scroll" | "search";

export interface TerminalInfo {
  mode: TerminalMode;
  cols: number;
  rows: number;
  scrollPosition?: number;
  historySize?: number;
}
