import { Database as BunDatabase, type SQLQueryBindings } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProviderId, SessionHandle, SessionStatus } from "@codepiper/core";

/**
 * Event source types
 */
export type EventSource = "pty" | "hook" | "transcript" | "statusline";

/**
 * Database event record
 */
export interface EventRecord {
  id: number;
  sessionId: string;
  timestamp: Date;
  source: EventSource;
  type: string;
  payload: unknown;
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
  createdAt: Date;
  readAt: Date | null;
  readSource: string | null;
}

export interface InsertSessionNotificationParams {
  sessionId: string;
  provider: string;
  eventType: string;
  sourceEventId?: number;
  title: string;
  body?: string;
  payload: Record<string, unknown>;
  createdAt?: Date;
  readAt?: Date;
  readSource?: string;
}

export interface InsertSessionNotificationResult {
  id: number;
  inserted: boolean;
}

export interface ListSessionNotificationsOptions {
  sessionId?: string;
  eventType?: string;
  unreadOnly?: boolean;
  before?: number;
  limit?: number;
}

export interface MarkSessionNotificationsReadOptions {
  sessionId?: string;
  readSource?: string;
  readAt?: Date;
}

export interface SessionNotificationCounts {
  totalUnread: number;
  bySession: Record<string, number>;
}

export interface SessionNotificationPrefsRecord {
  sessionId: string;
  enabled: boolean | null;
  updatedAt: Date;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  expirationTime: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertPushSubscriptionParams {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  expirationTime?: number | null;
}

/**
 * Session creation parameters
 */
export interface CreateSessionParams {
  id: string;
  provider: ProviderId;
  cwd: string;
  status: SessionStatus;
  pid?: number;
  ptyRows?: number;
  ptyCols?: number;
  transcriptPath?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Session update parameters
 */
export interface UpdateSessionParams {
  status?: SessionStatus;
  pid?: number;
  ptyRows?: number;
  ptyCols?: number;
  transcriptPath?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Session list filter options
 */
export interface ListSessionsOptions {
  status?: SessionStatus;
  provider?: ProviderId;
}

/**
 * Event insertion parameters
 */
export interface InsertEventParams {
  sessionId: string;
  source: EventSource;
  type: string;
  payload: unknown;
  timestamp?: Date;
}

/**
 * Event query options
 */
export interface GetEventsOptions {
  since?: number;
  before?: number;
  limit?: number;
  type?: string;
  source?: EventSource;
  order?: "asc" | "desc";
}

/**
 * Transcript offset record
 */
export interface TranscriptOffset {
  byteOffset: number;
  lastLineHash: string | null;
}

/**
 * Policy record
 */
export interface PolicyRecord {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  sessionId?: string;
  rules: PolicyRule[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Policy rule
 */
export interface PolicyRule {
  id: string;
  action: "allow" | "deny" | "ask";
  tool?: string | string[];
  args?: Record<string, string | string[]>;
  cwd?: string | string[];
  session?: string | string[];
  reason?: string;
}

/**
 * Policy creation parameters
 */
export interface CreatePolicyParams {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  sessionId?: string;
  rules: PolicyRule[];
}

/**
 * Policy update parameters
 */
export interface UpdatePolicyParams {
  name?: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  rules?: PolicyRule[];
}

/**
 * Policy list filter options
 */
export interface ListPoliciesOptions {
  sessionId?: string;
  enabled?: boolean;
}

/**
 * Policy decision record (audit log)
 */
export interface PolicyDecisionRecord {
  id: number;
  sessionId: string;
  eventId?: number;
  policyId?: string;
  toolName: string;
  args?: Record<string, unknown>;
  decision: "allow" | "deny" | "ask";
  reason?: string;
  timestamp: Date;
}

/**
 * Policy decision insertion parameters
 */
export interface InsertPolicyDecisionParams {
  sessionId: string;
  eventId?: number;
  policyId?: string;
  toolName: string;
  args?: Record<string, unknown>;
  decision: "allow" | "deny" | "ask";
  reason?: string;
  timestamp?: Date;
}

/**
 * Policy decision query options
 */
export interface GetPolicyDecisionsOptions {
  since?: number;
  limit?: number;
  decision?: "allow" | "deny" | "ask";
}

/**
 * Policy set record
 */
export interface PolicySetRecord {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Policy set summary (with counts from joins)
 */
export interface PolicySetSummary {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  policyCount: number;
  sessionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Policy set creation parameters
 */
export interface CreatePolicySetParams {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  policyIds?: string[];
}

/**
 * Policy set update parameters
 */
export interface UpdatePolicySetParams {
  name?: string;
  description?: string;
  isDefault?: boolean;
}

/**
 * Token usage record
 */
export interface TokenUsageRecord {
  id: number;
  sessionId: string;
  eventId?: number;
  timestamp: Date;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  costDifferenceUsd?: number;
}

/**
 * Token usage insertion parameters
 */
export interface InsertTokenUsageParams {
  sessionId: string;
  eventId?: number;
  timestamp?: Date;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  costDifferenceUsd?: number;
}

/**
 * Token usage query options
 */
export interface GetTokenUsageOptions {
  since?: Date;
  until?: Date;
  limit?: number;
  model?: string;
}

/**
 * Model switch record
 */
export interface ModelSwitchRecord {
  id: number;
  sessionId: string;
  timestamp: Date;
  fromModel?: string;
  toModel: string;
  reason?: string;
}

/**
 * Model switch insertion parameters
 */
export interface InsertModelSwitchParams {
  sessionId: string;
  timestamp?: Date;
  fromModel?: string;
  toModel: string;
  reason?: string;
}

/**
 * Transcript content record
 */
export interface TranscriptContentRecord {
  id: number;
  sessionId: string;
  eventId?: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

/**
 * Transcript content insertion parameters
 */
export interface InsertTranscriptContentParams {
  sessionId: string;
  eventId?: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
}

/**
 * Transcript content query options
 */
export interface GetTranscriptContentOptions {
  since?: Date;
  until?: Date;
  limit?: number;
  role?: "user" | "assistant" | "system";
}

/**
 * Workspace record
 */
export interface WorkspaceRecord {
  id: string;
  name: string;
  path: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Workspace creation parameters
 */
export interface CreateWorkspaceParams {
  id: string;
  name: string;
  path: string;
}

/**
 * Workspace update parameters
 */
export interface UpdateWorkspaceParams {
  name?: string;
  path?: string;
}

/**
 * Env set record (with masked values)
 */
export interface EnvSetRecord {
  id: string;
  name: string;
  description?: string;
  maskedVars: Record<string, string>;
  varCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Env set creation parameters
 */
export interface CreateEnvSetParams {
  id: string;
  name: string;
  description?: string;
  vars: Record<string, string>;
}

/**
 * Env set update parameters
 */
export interface UpdateEnvSetParams {
  name?: string;
  description?: string;
  vars?: Record<string, string>;
}

/**
 * Auth config record
 */
export interface AuthConfigRecord {
  passwordHash: string;
  totpSecretEncrypted: string | null;
  totpEnabled: boolean;
  mfaSetupPending: boolean;
  onboardingTokenHash: string | null;
  onboardingTokenExpiresAt: number | null;
  recoveryCodesEncrypted: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Auth session record
 */
export interface AuthSessionRecord {
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Daemon settings record
 */
export interface DaemonTerminalFeatureSettings {
  wsPtyPasteEnabled: boolean;
  latencyProbesEnabled: boolean;
  diagnosticsPanelEnabled: boolean;
  codexAppServerSpikeEnabled: boolean;
  wsPtyPasteCanaryPercent: number;
  latencyProbesCanaryPercent: number;
  diagnosticsPanelCanaryPercent: number;
}

export interface DaemonSettingsRecord {
  preserveSessions: boolean;
  defaultPolicyAction: "ask" | "deny";
  forwardSshAuthSock: boolean;
  codexHostAccessProfileEnabled: boolean;
  terminalFeatures: DaemonTerminalFeatureSettings;
  notificationsEnabled: boolean;
  systemNotificationsEnabled: boolean;
  notificationSoundsEnabled: boolean;
  notificationEventDefaults: Record<string, boolean>;
  notificationSoundMap: Record<string, string>;
  updatedAt: Date;
}

/**
 * Database interface for session and event management
 */
export interface IDatabase {
  init(): Promise<void>;
  close(): void;

  // Session operations
  createSession(params: CreateSessionParams): void;
  getSession(id: string): SessionHandle | undefined;
  updateSession(id: string, params: UpdateSessionParams): void;
  deleteSession(id: string): void;
  listSessions(options?: ListSessionsOptions): SessionHandle[];
  cleanupOldSessions(olderThanMs: number): number;

  // Event operations
  insertEvent(params: InsertEventParams): number;
  getEventsBySessionId(sessionId: string, options?: GetEventsOptions): EventRecord[];

  // Session notification operations
  insertSessionNotification(params: InsertSessionNotificationParams): number;
  insertSessionNotificationWithStatus(
    params: InsertSessionNotificationParams
  ): InsertSessionNotificationResult;
  listSessionNotifications(options?: ListSessionNotificationsOptions): SessionNotificationRecord[];
  getSessionNotificationCounts(): SessionNotificationCounts;
  markSessionNotificationRead(notificationId: number, readSource?: string, readAt?: Date): boolean;
  markSessionNotificationsRead(options?: MarkSessionNotificationsReadOptions): number;
  getSessionNotificationPrefs(sessionId: string): SessionNotificationPrefsRecord;
  setSessionNotificationPrefs(
    sessionId: string,
    enabled: boolean | null
  ): SessionNotificationPrefsRecord;
  listPushSubscriptions(): PushSubscriptionRecord[];
  upsertPushSubscription(params: UpsertPushSubscriptionParams): PushSubscriptionRecord;
  deletePushSubscription(endpoint: string): boolean;

  // Transcript offset operations
  getTranscriptOffset(sessionId: string, path: string): TranscriptOffset;
  updateTranscriptOffset(sessionId: string, path: string, offset: TranscriptOffset): void;

  // Policy operations
  createPolicy(params: CreatePolicyParams): void;
  getPolicy(id: string): PolicyRecord | undefined;
  updatePolicy(id: string, params: UpdatePolicyParams): void;
  deletePolicy(id: string): void;
  listPolicies(options?: ListPoliciesOptions): PolicyRecord[];

  // Policy decision operations (audit log)
  insertPolicyDecision(params: InsertPolicyDecisionParams): number;
  getPolicyDecisionsBySessionId(
    sessionId: string,
    options?: GetPolicyDecisionsOptions
  ): PolicyDecisionRecord[];

  // Policy set operations
  createPolicySet(params: CreatePolicySetParams): void;
  getPolicySet(id: string): PolicySetRecord | undefined;
  updatePolicySet(id: string, params: UpdatePolicySetParams): void;
  deletePolicySet(id: string): void;
  listPolicySets(): PolicySetSummary[];
  addPolicyToSet(setId: string, policyId: string): void;
  removePolicyFromSet(setId: string, policyId: string): void;
  getPolicySetMembers(setId: string): PolicyRecord[];
  applyPolicySetToSession(sessionId: string, setId: string): void;
  removePolicySetFromSession(sessionId: string, setId: string): void;
  getSessionPolicySets(sessionId: string): PolicySetSummary[];
  getEffectivePolicies(sessionId: string): PolicyRecord[];
  getDefaultPolicySet(): PolicySetRecord | undefined;

  // Token usage operations
  insertTokenUsage(params: InsertTokenUsageParams): number;
  getTokenUsageBySessionId(sessionId: string, options?: GetTokenUsageOptions): TokenUsageRecord[];
  getTotalTokensBySessionId(sessionId: string): {
    totalTokens: number;
    totalCost: number;
    byModel: Record<string, { tokens: number; cost: number }>;
  };

  // Model switch operations
  insertModelSwitch(params: InsertModelSwitchParams): number;
  getModelSwitchesBySessionId(sessionId: string): ModelSwitchRecord[];

  // Transcript content operations
  insertTranscriptContent(params: InsertTranscriptContentParams): number;
  getTranscriptContentBySessionId(
    sessionId: string,
    options?: GetTranscriptContentOptions
  ): TranscriptContentRecord[];

  // Workspace operations
  createWorkspace(params: CreateWorkspaceParams): void;
  getWorkspace(id: string): WorkspaceRecord | undefined;
  updateWorkspace(id: string, params: UpdateWorkspaceParams): void;
  deleteWorkspace(id: string): void;
  listWorkspaces(): WorkspaceRecord[];

  // Env set operations
  createEnvSet(params: CreateEnvSetParams): void;
  getEnvSet(id: string): EnvSetRecord | undefined;
  updateEnvSet(id: string, params: UpdateEnvSetParams): void;
  deleteEnvSet(id: string): void;
  listEnvSets(): EnvSetRecord[];
  decryptEnvSetVars(id: string): Record<string, string>;

  // Auth operations
  hasAuthConfig(): boolean;
  getAuthConfig(): AuthConfigRecord | null;
  createAuthConfig(
    passwordHash: string,
    options?: {
      mfaSetupPending?: boolean;
      onboardingTokenHash?: string | null;
      onboardingTokenExpiresAt?: number | null;
    }
  ): void;
  updateAuthPassword(passwordHash: string): void;
  updateAuthTotp(
    encryptedSecret: string | null,
    enabled: boolean,
    recoveryCodes: string | null
  ): void;
  updateAuthOnboardingState(
    mfaSetupPending: boolean,
    onboardingTokenHash: string | null,
    onboardingTokenExpiresAt: number | null
  ): void;
  createAuthSession(
    tokenHash: string,
    ip: string | null,
    userAgent: string | null,
    expiresAt: number
  ): void;
  getAuthSession(tokenHash: string): AuthSessionRecord | null;
  touchAuthSession(tokenHash: string, newExpiresAt: number): void;
  deleteAuthSession(tokenHash: string): void;
  deleteAllAuthSessions(): void;
  listAuthSessions(): AuthSessionRecord[];
  cleanupExpiredAuthSessions(): number;

  // Daemon settings operations
  getDaemonSettings(): DaemonSettingsRecord;
  updateDaemonSettings(params: {
    preserveSessions?: boolean;
    defaultPolicyAction?: "ask" | "deny";
    forwardSshAuthSock?: boolean;
    codexHostAccessProfileEnabled?: boolean;
    terminalFeatures?: Partial<DaemonTerminalFeatureSettings>;
    notificationsEnabled?: boolean;
    systemNotificationsEnabled?: boolean;
    notificationSoundsEnabled?: boolean;
    notificationEventDefaults?: Record<string, boolean>;
    notificationSoundMap?: Record<string, string>;
  }): void;

  // Utility (for testing)
  query(sql: string): unknown[];
}

/**
 * SQLite-backed database implementation
 */
export class Database implements IDatabase {
  public readonly db: BunDatabase;
  private schemaPath: string;

  constructor(dbPath: string = ":memory:") {
    this.db = new BunDatabase(dbPath);
    this.schemaPath = join(dirname(__filename), "schema.sql");

    // Enable foreign keys
    this.db.run("PRAGMA foreign_keys = ON");
  }

  /**
   * Initialize database schema
   */
  async init(): Promise<void> {
    const schema = readFileSync(this.schemaPath, "utf-8");
    this.db.exec(schema);

    // Migrate: add default_policy_action column to daemon_settings (for existing databases)
    try {
      this.db.exec(
        "ALTER TABLE daemon_settings ADD COLUMN default_policy_action TEXT NOT NULL DEFAULT 'ask'"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("duplicate column name")) {
        throw new Error(`Failed to migrate daemon_settings table: ${msg}`);
      }
    }

    const daemonSettingsMigrations = [
      "ALTER TABLE daemon_settings ADD COLUMN forward_ssh_auth_sock INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE daemon_settings ADD COLUMN codex_host_access_profile_enabled INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE daemon_settings ADD COLUMN terminal_ws_pty_paste_enabled INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE daemon_settings ADD COLUMN terminal_latency_probes_enabled INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE daemon_settings ADD COLUMN terminal_diagnostics_panel_enabled INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE daemon_settings ADD COLUMN terminal_codex_app_server_spike_enabled INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE daemon_settings ADD COLUMN terminal_ws_pty_paste_canary_percent INTEGER NOT NULL DEFAULT 100",
      "ALTER TABLE daemon_settings ADD COLUMN terminal_latency_probes_canary_percent INTEGER NOT NULL DEFAULT 100",
      "ALTER TABLE daemon_settings ADD COLUMN terminal_diagnostics_panel_canary_percent INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE daemon_settings ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE daemon_settings ADD COLUMN system_notifications_enabled INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE daemon_settings ADD COLUMN notification_sounds_enabled INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE daemon_settings ADD COLUMN notification_event_defaults_json TEXT NOT NULL DEFAULT '{}'",
      "ALTER TABLE daemon_settings ADD COLUMN notification_sound_map_json TEXT NOT NULL DEFAULT '{}'",
    ] as const;

    for (const migration of daemonSettingsMigrations) {
      try {
        this.db.exec(migration);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("duplicate column name")) {
          throw new Error(`Failed to migrate daemon_settings table: ${msg}`);
        }
      }
    }

    const authConfigMigrations = [
      "ALTER TABLE auth_config ADD COLUMN mfa_setup_pending INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE auth_config ADD COLUMN onboarding_token_hash TEXT",
      "ALTER TABLE auth_config ADD COLUMN onboarding_token_expires_at INTEGER",
    ] as const;

    for (const migration of authConfigMigrations) {
      try {
        this.db.exec(migration);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("duplicate column name")) {
          throw new Error(`Failed to migrate auth_config table: ${msg}`);
        }
      }
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Execute raw query (for testing)
   */
  query(sql: string): unknown[] {
    return this.db.query(sql).all();
  }

  /**
   * Create a new session
   */
  createSession(params: CreateSessionParams): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, provider, cwd, status, created_at, updated_at,
        pid, pty_cols, pty_rows, transcript_path, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.id,
      params.provider,
      params.cwd,
      params.status,
      now,
      now,
      params.pid ?? null,
      params.ptyCols ?? null,
      params.ptyRows ?? null,
      params.transcriptPath ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null
    );
  }

  /**
   * Get session by ID
   */
  getSession(id: string): SessionHandle | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `);

    const row = stmt.get(id) as any;
    if (!row) return undefined;

    return this.mapRowToSessionHandle(row);
  }

  /**
   * Update session fields
   */
  updateSession(id: string, params: UpdateSessionParams): void {
    const updates: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (params.status !== undefined) {
      updates.push("status = ?");
      values.push(params.status);
    }
    if (params.pid !== undefined) {
      updates.push("pid = ?");
      values.push(params.pid);
    }
    if (params.ptyRows !== undefined) {
      updates.push("pty_rows = ?");
      values.push(params.ptyRows);
    }
    if (params.ptyCols !== undefined) {
      updates.push("pty_cols = ?");
      values.push(params.ptyCols);
    }
    if (params.transcriptPath !== undefined) {
      updates.push("transcript_path = ?");
      values.push(params.transcriptPath);
    }
    if (params.metadata !== undefined) {
      updates.push("metadata_json = ?");
      values.push(JSON.stringify(params.metadata));
    }

    // Always update updated_at
    updates.push("updated_at = ?");
    values.push(Date.now());

    if (updates.length === 1) {
      // Only updated_at changed, still execute
    }

    values.push(id);

    const sql = `UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    stmt.run(...values);
  }

  /**
   * Delete session
   */
  deleteSession(id: string): void {
    const stmt = this.db.prepare("DELETE FROM sessions WHERE id = ?");
    stmt.run(id);
  }

  /**
   * Clean up old STOPPED or CRASHED sessions
   * @param olderThanMs - Delete sessions older than this many milliseconds
   * @returns Number of sessions deleted
   */
  cleanupOldSessions(olderThanMs: number): number {
    const cutoffTimestamp = Date.now() - olderThanMs;

    const stmt = this.db.prepare(`
      DELETE FROM sessions
      WHERE (status = 'STOPPED' OR status = 'CRASHED')
        AND updated_at < ?
    `);

    const result = stmt.run(cutoffTimestamp);
    return result.changes;
  }

  /**
   * List sessions with optional filters
   */
  listSessions(options: ListSessionsOptions = {}): SessionHandle[] {
    let sql = "SELECT * FROM sessions WHERE 1=1";
    const values: SQLQueryBindings[] = [];

    if (options.status) {
      sql += " AND status = ?";
      values.push(options.status);
    }
    if (options.provider) {
      sql += " AND provider = ?";
      values.push(options.provider);
    }

    sql += " ORDER BY created_at DESC";

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values) as any[];

    return rows.map((row) => this.mapRowToSessionHandle(row));
  }

  /**
   * Insert a new event
   */
  insertEvent(params: InsertEventParams): number {
    const timestamp = params.timestamp ?? new Date();
    const stmt = this.db.prepare(`
      INSERT INTO events (session_id, ts, source, type, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.sessionId,
      timestamp.getTime(),
      params.source,
      params.type,
      JSON.stringify(params.payload)
    );

    // Get last inserted row id
    const result = this.db.query("SELECT last_insert_rowid() as id").get() as { id: number };
    return result.id;
  }

  /**
   * Get events for a session with optional filters
   */
  getEventsBySessionId(sessionId: string, options: GetEventsOptions = {}): EventRecord[] {
    let sql = "SELECT * FROM events WHERE session_id = ?";
    const values: SQLQueryBindings[] = [sessionId];

    if (options.since !== undefined) {
      sql += " AND id > ?";
      values.push(options.since);
    }
    if (options.before !== undefined) {
      sql += " AND id < ?";
      values.push(options.before);
    }
    if (options.type) {
      sql += " AND type = ?";
      values.push(options.type);
    }
    if (options.source) {
      sql += " AND source = ?";
      values.push(options.source);
    }

    const order = options.order === "desc" ? "DESC" : "ASC";
    sql += ` ORDER BY id ${order}`;

    if (options.limit) {
      sql += " LIMIT ?";
      values.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values) as any[];

    return rows.map((row) => this.mapRowToEventRecord(row));
  }

  /**
   * Insert a user-facing session notification
   */
  insertSessionNotification(params: InsertSessionNotificationParams): number {
    return this.insertSessionNotificationWithStatus(params).id;
  }

  /**
   * Insert a user-facing session notification and report whether it was inserted.
   * When sourceEventId is present, treat (sourceEventId, eventType) as idempotent.
   */
  insertSessionNotificationWithStatus(
    params: InsertSessionNotificationParams
  ): InsertSessionNotificationResult {
    const sourceEventId = this.normalizeSourceEventId(params.sourceEventId);
    if (sourceEventId !== null) {
      const existingId = this.findSessionNotificationIdBySourceEvent(
        sourceEventId,
        params.eventType
      );
      if (existingId !== null) {
        return { id: existingId, inserted: false };
      }
    }

    const createdAt = params.createdAt ?? new Date();
    const stmt = this.db.prepare(`
      INSERT INTO session_notifications (
        session_id,
        provider,
        event_type,
        source_event_id,
        title,
        body,
        payload_json,
        created_at,
        read_at,
        read_source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.sessionId,
      params.provider,
      params.eventType,
      sourceEventId,
      params.title,
      params.body ?? null,
      JSON.stringify(params.payload),
      createdAt.getTime(),
      params.readAt ? params.readAt.getTime() : null,
      params.readSource ?? null
    );

    const result = this.db.query("SELECT last_insert_rowid() as id").get() as { id: number };
    return { id: result.id, inserted: true };
  }

  /**
   * List session notifications with optional filters
   */
  listSessionNotifications(
    options: ListSessionNotificationsOptions = {}
  ): SessionNotificationRecord[] {
    let sql = "SELECT * FROM session_notifications WHERE 1=1";
    const values: SQLQueryBindings[] = [];

    if (options.sessionId) {
      sql += " AND session_id = ?";
      values.push(options.sessionId);
    }

    if (options.eventType) {
      sql += " AND event_type = ?";
      values.push(options.eventType);
    }

    if (options.unreadOnly) {
      sql += " AND read_at IS NULL";
    }

    if (options.before !== undefined) {
      sql += " AND id < ?";
      values.push(options.before);
    }

    sql += " ORDER BY id DESC";

    if (options.limit !== undefined) {
      const rawLimit = Number.isFinite(options.limit) ? options.limit : 0;
      const normalizedLimit = Math.max(0, Math.min(Math.floor(rawLimit), 200));
      sql += " LIMIT ?";
      values.push(normalizedLimit);
    }

    const rows = this.db.prepare(sql).all(...values) as any[];
    return rows.map((row) => this.mapRowToSessionNotificationRecord(row));
  }

  /**
   * Get unread notification counts globally and by session
   */
  getSessionNotificationCounts(): SessionNotificationCounts {
    const totalRow = this.db
      .prepare(
        `
          SELECT COUNT(*) as count
          FROM session_notifications
          WHERE read_at IS NULL
        `
      )
      .get() as any;

    const bySessionRows = this.db
      .prepare(
        `
          SELECT session_id, COUNT(*) as count
          FROM session_notifications
          WHERE read_at IS NULL
          GROUP BY session_id
        `
      )
      .all() as any[];

    const bySession: Record<string, number> = {};
    for (const row of bySessionRows) {
      bySession[row.session_id] = Number(row.count ?? 0);
    }

    return {
      totalUnread: Number(totalRow?.count ?? 0),
      bySession,
    };
  }

  /**
   * Mark one notification as read (idempotent)
   */
  markSessionNotificationRead(
    notificationId: number,
    readSource: string = "click",
    readAt: Date = new Date()
  ): boolean {
    const result = this.db
      .prepare(
        `
          UPDATE session_notifications
          SET read_at = ?, read_source = ?
          WHERE id = ? AND read_at IS NULL
        `
      )
      .run(readAt.getTime(), readSource, notificationId);

    return result.changes > 0;
  }

  /**
   * Mark notifications as read in bulk (idempotent)
   */
  markSessionNotificationsRead(options: MarkSessionNotificationsReadOptions = {}): number {
    let sql = `
      UPDATE session_notifications
      SET read_at = ?, read_source = ?
      WHERE read_at IS NULL
    `;
    const values: SQLQueryBindings[] = [
      (options.readAt ?? new Date()).getTime(),
      options.readSource ?? "bulk",
    ];

    if (options.sessionId) {
      sql += " AND session_id = ?";
      values.push(options.sessionId);
    }

    const result = this.db.prepare(sql).run(...values);
    return result.changes;
  }

  private normalizeSourceEventId(sourceEventId: unknown): number | null {
    if (!Number.isInteger(sourceEventId) || (sourceEventId as number) <= 0) {
      return null;
    }
    return sourceEventId as number;
  }

  private findSessionNotificationIdBySourceEvent(
    sourceEventId: number,
    eventType: string
  ): number | null {
    const row = this.db
      .prepare(
        `
          SELECT id
          FROM session_notifications
          WHERE source_event_id = ? AND event_type = ?
          ORDER BY id ASC
          LIMIT 1
        `
      )
      .get(sourceEventId, eventType) as { id?: unknown } | null;

    if (!(row && Number.isInteger(row.id))) {
      return null;
    }

    return row.id as number;
  }

  /**
   * Get per-session notification preference override
   */
  getSessionNotificationPrefs(sessionId: string): SessionNotificationPrefsRecord {
    const row = this.db
      .prepare(
        `
          SELECT session_id, enabled, updated_at
          FROM session_notification_prefs
          WHERE session_id = ?
        `
      )
      .get(sessionId) as any;

    if (!row) {
      return {
        sessionId,
        enabled: null,
        updatedAt: new Date(0),
      };
    }

    return {
      sessionId: row.session_id,
      enabled: row.enabled === null ? null : row.enabled !== 0,
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Upsert per-session notification preference override
   */
  setSessionNotificationPrefs(
    sessionId: string,
    enabled: boolean | null
  ): SessionNotificationPrefsRecord {
    const now = Date.now();
    this.db
      .prepare(
        `
          INSERT INTO session_notification_prefs (session_id, enabled, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            enabled = excluded.enabled,
            updated_at = excluded.updated_at
        `
      )
      .run(sessionId, enabled === null ? null : enabled ? 1 : 0, now);

    return {
      sessionId,
      enabled,
      updatedAt: new Date(now),
    };
  }

  listPushSubscriptions(): PushSubscriptionRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT endpoint, p256dh, auth, expiration_time, created_at, updated_at
          FROM push_subscriptions
          ORDER BY updated_at DESC
        `
      )
      .all() as any[];

    return rows.map((row) => this.mapRowToPushSubscriptionRecord(row));
  }

  upsertPushSubscription(params: UpsertPushSubscriptionParams): PushSubscriptionRecord {
    const now = Date.now();
    this.db
      .prepare(
        `
          INSERT INTO push_subscriptions (
            endpoint,
            p256dh,
            auth,
            expiration_time,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            expiration_time = excluded.expiration_time,
            updated_at = excluded.updated_at
        `
      )
      .run(
        params.endpoint,
        params.keys.p256dh,
        params.keys.auth,
        params.expirationTime ?? null,
        now,
        now
      );

    const row = this.db
      .prepare(
        `
          SELECT endpoint, p256dh, auth, expiration_time, created_at, updated_at
          FROM push_subscriptions
          WHERE endpoint = ?
        `
      )
      .get(params.endpoint) as any;

    return this.mapRowToPushSubscriptionRecord(row);
  }

  deletePushSubscription(endpoint: string): boolean {
    const result = this.db
      .prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
      .run(endpoint);
    return result.changes > 0;
  }

  /**
   * Get transcript offset for a session and path
   */
  getTranscriptOffset(sessionId: string, path: string): TranscriptOffset {
    const stmt = this.db.prepare(`
      SELECT byte_offset, last_line_hash
      FROM transcript_offsets
      WHERE session_id = ? AND path = ?
    `);

    const row = stmt.get(sessionId, path) as any;

    if (!row) {
      return { byteOffset: 0, lastLineHash: null };
    }

    return {
      byteOffset: row.byte_offset,
      lastLineHash: row.last_line_hash,
    };
  }

  /**
   * Update transcript offset for a session and path
   */
  updateTranscriptOffset(sessionId: string, path: string, offset: TranscriptOffset): void {
    const stmt = this.db.prepare(`
      INSERT INTO transcript_offsets (session_id, path, byte_offset, last_line_hash)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, path) DO UPDATE SET
        byte_offset = excluded.byte_offset,
        last_line_hash = excluded.last_line_hash
    `);

    stmt.run(sessionId, path, offset.byteOffset, offset.lastLineHash);
  }

  /**
   * Map database row to SessionHandle
   */
  private mapRowToSessionHandle(row: any): SessionHandle {
    return {
      id: row.id,
      provider: row.provider as ProviderId,
      cwd: row.cwd,
      status: row.status as SessionStatus,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      pid: row.pid ?? undefined,
      ptyRows: row.pty_rows ?? undefined,
      ptyCols: row.pty_cols ?? undefined,
      transcriptPath: row.transcript_path ?? undefined,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    };
  }

  /**
   * Map database row to EventRecord
   */
  private mapRowToEventRecord(row: any): EventRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      timestamp: new Date(row.ts),
      source: row.source as EventSource,
      type: row.type,
      payload: JSON.parse(row.payload_json),
    };
  }

  /**
   * Map database row to SessionNotificationRecord
   */
  private mapRowToSessionNotificationRecord(row: any): SessionNotificationRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      provider: row.provider,
      eventType: row.event_type,
      sourceEventId: row.source_event_id ?? null,
      title: row.title,
      body: row.body ?? null,
      payload: JSON.parse(row.payload_json),
      createdAt: new Date(row.created_at),
      readAt: row.read_at == null ? null : new Date(row.read_at),
      readSource: row.read_source ?? null,
    };
  }

  private mapRowToPushSubscriptionRecord(row: any): PushSubscriptionRecord {
    return {
      endpoint: row.endpoint,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth,
      },
      expirationTime:
        row.expiration_time === null || row.expiration_time === undefined
          ? null
          : Number(row.expiration_time),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Create a new policy
   */
  createPolicy(params: CreatePolicyParams): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO policies (
        id, name, description, enabled, priority, session_id, rules_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.id,
      params.name,
      params.description ?? null,
      (params.enabled ?? true) ? 1 : 0,
      params.priority ?? 0,
      params.sessionId ?? null,
      JSON.stringify(params.rules),
      now,
      now
    );
  }

  /**
   * Get policy by ID
   */
  getPolicy(id: string): PolicyRecord | undefined {
    const stmt = this.db.prepare("SELECT * FROM policies WHERE id = ?");
    const row = stmt.get(id) as any;
    if (!row) return undefined;
    return this.mapRowToPolicyRecord(row);
  }

  /**
   * Update policy fields
   */
  updatePolicy(id: string, params: UpdatePolicyParams): void {
    const updates: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (params.name !== undefined) {
      updates.push("name = ?");
      values.push(params.name);
    }
    if (params.description !== undefined) {
      updates.push("description = ?");
      values.push(params.description);
    }
    if (params.enabled !== undefined) {
      updates.push("enabled = ?");
      values.push(params.enabled ? 1 : 0);
    }
    if (params.priority !== undefined) {
      updates.push("priority = ?");
      values.push(params.priority);
    }
    if (params.rules !== undefined) {
      updates.push("rules_json = ?");
      values.push(JSON.stringify(params.rules));
    }

    // Always update updated_at
    updates.push("updated_at = ?");
    values.push(Date.now());

    if (updates.length === 1) {
      // Only updated_at changed, still execute
    }

    values.push(id);

    const sql = `UPDATE policies SET ${updates.join(", ")} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    stmt.run(...values);
  }

  /**
   * Delete policy
   */
  deletePolicy(id: string): void {
    const stmt = this.db.prepare("DELETE FROM policies WHERE id = ?");
    stmt.run(id);
  }

  /**
   * List policies with optional filters
   */
  listPolicies(options: ListPoliciesOptions = {}): PolicyRecord[] {
    let sql = "SELECT * FROM policies WHERE 1=1";
    const values: SQLQueryBindings[] = [];

    if (options.sessionId !== undefined) {
      if (options.sessionId === null) {
        sql += " AND session_id IS NULL";
      } else {
        sql += " AND session_id = ?";
        values.push(options.sessionId);
      }
    }
    if (options.enabled !== undefined) {
      sql += " AND enabled = ?";
      values.push(options.enabled ? 1 : 0);
    }

    sql += " ORDER BY priority DESC, created_at DESC";

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values) as any[];

    return rows.map((row) => this.mapRowToPolicyRecord(row));
  }

  /**
   * Insert a policy decision (audit log)
   */
  insertPolicyDecision(params: InsertPolicyDecisionParams): number {
    const timestamp = params.timestamp ?? new Date();
    const stmt = this.db.prepare(`
      INSERT INTO policy_decisions (
        session_id, event_id, policy_id, tool_name, args_json, decision, reason, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.sessionId,
      params.eventId ?? null,
      params.policyId ?? null,
      params.toolName,
      params.args ? JSON.stringify(params.args) : null,
      params.decision,
      params.reason ?? null,
      timestamp.getTime()
    );

    // Get last inserted row id
    const result = this.db.query("SELECT last_insert_rowid() as id").get() as { id: number };
    return result.id;
  }

  /**
   * Get policy decisions for a session
   */
  getPolicyDecisionsBySessionId(
    sessionId: string,
    options: GetPolicyDecisionsOptions = {}
  ): PolicyDecisionRecord[] {
    let sql = "SELECT * FROM policy_decisions WHERE session_id = ?";
    const values: SQLQueryBindings[] = [sessionId];

    if (options.since !== undefined) {
      sql += " AND id > ?";
      values.push(options.since);
    }
    if (options.decision) {
      sql += " AND decision = ?";
      values.push(options.decision);
    }

    sql += " ORDER BY id ASC";

    if (options.limit) {
      sql += " LIMIT ?";
      values.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values) as any[];

    return rows.map((row) => this.mapRowToPolicyDecisionRecord(row));
  }

  /**
   * Map database row to PolicyRecord
   */
  private mapRowToPolicyRecord(row: any): PolicyRecord {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      enabled: row.enabled === 1,
      priority: row.priority,
      sessionId: row.session_id ?? undefined,
      rules: JSON.parse(row.rules_json),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Map database row to PolicyDecisionRecord
   */
  private mapRowToPolicyDecisionRecord(row: any): PolicyDecisionRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      eventId: row.event_id ?? undefined,
      policyId: row.policy_id ?? undefined,
      toolName: row.tool_name,
      args: row.args_json ? JSON.parse(row.args_json) : undefined,
      decision: row.decision,
      reason: row.reason ?? undefined,
      timestamp: new Date(row.timestamp),
    };
  }

  // ─── Policy Set Operations ─────────────────────────────────────────

  createPolicySet(params: CreatePolicySetParams): void {
    const now = Date.now();

    // If setting as default, clear any existing default first
    if (params.isDefault) {
      this.db.prepare("UPDATE policy_sets SET is_default = 0 WHERE is_default = 1").run();
    }

    this.db
      .prepare(
        `INSERT INTO policy_sets (id, name, description, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(params.id, params.name, params.description ?? null, params.isDefault ? 1 : 0, now, now);

    // Add initial member policies
    if (params.policyIds?.length) {
      const addStmt = this.db.prepare(
        `INSERT OR IGNORE INTO policy_set_members (policy_set_id, policy_id, added_at)
         VALUES (?, ?, ?)`
      );
      for (const policyId of params.policyIds) {
        addStmt.run(params.id, policyId, now);
      }
    }
  }

  getPolicySet(id: string): PolicySetRecord | undefined {
    const row = this.db.prepare("SELECT * FROM policy_sets WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return this.mapRowToPolicySetRecord(row);
  }

  updatePolicySet(id: string, params: UpdatePolicySetParams): void {
    const updates: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (params.name !== undefined) {
      updates.push("name = ?");
      values.push(params.name);
    }
    if (params.description !== undefined) {
      updates.push("description = ?");
      values.push(params.description);
    }
    if (params.isDefault !== undefined) {
      // Clear existing default if setting this one
      if (params.isDefault) {
        this.db.prepare("UPDATE policy_sets SET is_default = 0 WHERE is_default = 1").run();
      }
      updates.push("is_default = ?");
      values.push(params.isDefault ? 1 : 0);
    }

    updates.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE policy_sets SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }

  deletePolicySet(id: string): void {
    this.db.prepare("DELETE FROM policy_sets WHERE id = ?").run(id);
  }

  listPolicySets(): PolicySetSummary[] {
    const rows = this.db
      .prepare(
        `SELECT ps.*,
                COUNT(DISTINCT psm.policy_id) as policy_count,
                COUNT(DISTINCT sps.session_id) as session_count
         FROM policy_sets ps
         LEFT JOIN policy_set_members psm ON ps.id = psm.policy_set_id
         LEFT JOIN session_policy_sets sps ON ps.id = sps.policy_set_id
         GROUP BY ps.id
         ORDER BY ps.name`
      )
      .all() as any[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      isDefault: row.is_default === 1,
      policyCount: row.policy_count,
      sessionCount: row.session_count,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  addPolicyToSet(setId: string, policyId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO policy_set_members (policy_set_id, policy_id, added_at)
         VALUES (?, ?, ?)`
      )
      .run(setId, policyId, Date.now());
  }

  removePolicyFromSet(setId: string, policyId: string): void {
    this.db
      .prepare("DELETE FROM policy_set_members WHERE policy_set_id = ? AND policy_id = ?")
      .run(setId, policyId);
  }

  getPolicySetMembers(setId: string): PolicyRecord[] {
    const rows = this.db
      .prepare(
        `SELECT p.* FROM policies p
         JOIN policy_set_members psm ON p.id = psm.policy_id
         WHERE psm.policy_set_id = ?
         ORDER BY p.priority DESC, p.name`
      )
      .all(setId) as any[];

    return rows.map((row) => this.mapRowToPolicyRecord(row));
  }

  applyPolicySetToSession(sessionId: string, setId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO session_policy_sets (session_id, policy_set_id, applied_at)
         VALUES (?, ?, ?)`
      )
      .run(sessionId, setId, Date.now());
  }

  removePolicySetFromSession(sessionId: string, setId: string): void {
    this.db
      .prepare("DELETE FROM session_policy_sets WHERE session_id = ? AND policy_set_id = ?")
      .run(sessionId, setId);
  }

  getSessionPolicySets(sessionId: string): PolicySetSummary[] {
    const rows = this.db
      .prepare(
        `SELECT ps.*,
                COUNT(DISTINCT psm.policy_id) as policy_count,
                (SELECT COUNT(*) FROM session_policy_sets WHERE policy_set_id = ps.id) as session_count
         FROM policy_sets ps
         JOIN session_policy_sets sps ON ps.id = sps.policy_set_id
         LEFT JOIN policy_set_members psm ON ps.id = psm.policy_set_id
         WHERE sps.session_id = ?
         GROUP BY ps.id
         ORDER BY ps.name`
      )
      .all(sessionId) as any[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      isDefault: row.is_default === 1,
      policyCount: row.policy_count,
      sessionCount: row.session_count,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  getEffectivePolicies(sessionId: string): PolicyRecord[] {
    // 1. Direct per-session policies
    const directPolicies = this.listPolicies({ sessionId, enabled: true });

    // 2. Policies from applied policy sets
    const setPolicyRows = this.db
      .prepare(
        `SELECT DISTINCT p.* FROM policies p
         JOIN policy_set_members psm ON p.id = psm.policy_id
         JOIN session_policy_sets sps ON psm.policy_set_id = sps.policy_set_id
         WHERE sps.session_id = ? AND p.enabled = 1`
      )
      .all(sessionId) as any[];
    const setPolicies = setPolicyRows.map((row) => this.mapRowToPolicyRecord(row));

    // 3. Global policies (session_id IS NULL)
    const globalPolicies = this.listPolicies({ sessionId: null as any, enabled: true });

    // Deduplicate: direct > set > global (order determines precedence for same ID)
    const seen = new Set<string>();
    const all: PolicyRecord[] = [];
    for (const policy of [...directPolicies, ...setPolicies, ...globalPolicies]) {
      if (!seen.has(policy.id)) {
        seen.add(policy.id);
        all.push(policy);
      }
    }

    // Sort by priority DESC (PolicyEngine also sorts, but this keeps the output consistent)
    all.sort((a, b) => b.priority - a.priority);
    return all;
  }

  getDefaultPolicySet(): PolicySetRecord | undefined {
    const row = this.db.prepare("SELECT * FROM policy_sets WHERE is_default = 1").get() as any;
    if (!row) return undefined;
    return this.mapRowToPolicySetRecord(row);
  }

  private mapRowToPolicySetRecord(row: any): PolicySetRecord {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      isDefault: row.is_default === 1,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Insert token usage record
   */
  insertTokenUsage(params: InsertTokenUsageParams): number {
    const timestamp = params.timestamp ?? new Date();
    const stmt = this.db.prepare(`
      INSERT INTO token_usage (
        session_id, event_id, timestamp, model,
        prompt_tokens, completion_tokens,
        cache_creation_input_tokens, cache_read_input_tokens,
        total_tokens, estimated_cost_usd, actual_cost_usd, cost_difference_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.sessionId,
      params.eventId ?? null,
      timestamp.getTime(),
      params.model,
      params.promptTokens,
      params.completionTokens,
      params.cacheCreationInputTokens ?? 0,
      params.cacheReadInputTokens ?? 0,
      params.totalTokens,
      params.estimatedCostUsd ?? null,
      params.actualCostUsd ?? null,
      params.costDifferenceUsd ?? null
    );

    const result = this.db.query("SELECT last_insert_rowid() as id").get() as { id: number };
    return result.id;
  }

  /**
   * Get token usage records for a session
   */
  getTokenUsageBySessionId(
    sessionId: string,
    options: GetTokenUsageOptions = {}
  ): TokenUsageRecord[] {
    let sql = "SELECT * FROM token_usage WHERE session_id = ?";
    const values: SQLQueryBindings[] = [sessionId];

    if (options.since) {
      sql += " AND timestamp >= ?";
      values.push(options.since.getTime());
    }
    if (options.until) {
      sql += " AND timestamp <= ?";
      values.push(options.until.getTime());
    }
    if (options.model) {
      sql += " AND model = ?";
      values.push(options.model);
    }

    sql += " ORDER BY timestamp ASC";

    if (options.limit) {
      sql += " LIMIT ?";
      values.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values) as any[];

    return rows.map((row) => this.mapRowToTokenUsageRecord(row));
  }

  /**
   * Get total tokens and cost by session
   */
  getTotalTokensBySessionId(sessionId: string): {
    totalTokens: number;
    totalCost: number;
    byModel: Record<string, { tokens: number; cost: number }>;
  } {
    const stmt = this.db.prepare(`
      SELECT
        model,
        SUM(total_tokens) as total_tokens,
        SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)) as total_cost
      FROM token_usage
      WHERE session_id = ?
      GROUP BY model
    `);

    const rows = stmt.all(sessionId) as any[];

    const byModel: Record<string, { tokens: number; cost: number }> = {};
    let totalTokens = 0;
    let totalCost = 0;

    for (const row of rows) {
      const tokens = row.total_tokens || 0;
      const cost = row.total_cost || 0;

      byModel[row.model] = { tokens, cost };
      totalTokens += tokens;
      totalCost += cost;
    }

    return { totalTokens, totalCost, byModel };
  }

  /**
   * Insert model switch record
   */
  insertModelSwitch(params: InsertModelSwitchParams): number {
    const timestamp = params.timestamp ?? new Date();
    const stmt = this.db.prepare(`
      INSERT INTO model_switches (
        session_id, timestamp, from_model, to_model, reason
      ) VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.sessionId,
      timestamp.getTime(),
      params.fromModel ?? null,
      params.toModel,
      params.reason ?? null
    );

    const result = this.db.query("SELECT last_insert_rowid() as id").get() as { id: number };
    return result.id;
  }

  /**
   * Get model switches for a session
   */
  getModelSwitchesBySessionId(sessionId: string): ModelSwitchRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM model_switches
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(sessionId) as any[];
    return rows.map((row) => this.mapRowToModelSwitchRecord(row));
  }

  /**
   * Insert transcript content record
   */
  insertTranscriptContent(params: InsertTranscriptContentParams): number {
    const timestamp = params.timestamp ?? new Date();
    const stmt = this.db.prepare(`
      INSERT INTO transcript_content (
        session_id, event_id, role, content, timestamp
      ) VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.sessionId,
      params.eventId ?? null,
      params.role,
      params.content,
      timestamp.getTime()
    );

    const result = this.db.query("SELECT last_insert_rowid() as id").get() as { id: number };
    return result.id;
  }

  /**
   * Get transcript content for a session
   */
  getTranscriptContentBySessionId(
    sessionId: string,
    options: GetTranscriptContentOptions = {}
  ): TranscriptContentRecord[] {
    let sql = "SELECT * FROM transcript_content WHERE session_id = ?";
    const values: SQLQueryBindings[] = [sessionId];

    if (options.since) {
      sql += " AND timestamp >= ?";
      values.push(options.since.getTime());
    }
    if (options.until) {
      sql += " AND timestamp <= ?";
      values.push(options.until.getTime());
    }
    if (options.role) {
      sql += " AND role = ?";
      values.push(options.role);
    }

    sql += " ORDER BY timestamp ASC";

    if (options.limit) {
      sql += " LIMIT ?";
      values.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values) as any[];

    return rows.map((row) => this.mapRowToTranscriptContentRecord(row));
  }

  /**
   * Map database row to TokenUsageRecord
   */
  private mapRowToTokenUsageRecord(row: any): TokenUsageRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      eventId: row.event_id ?? undefined,
      timestamp: new Date(row.timestamp),
      model: row.model,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      cacheCreationInputTokens: row.cache_creation_input_tokens,
      cacheReadInputTokens: row.cache_read_input_tokens,
      totalTokens: row.total_tokens,
      estimatedCostUsd: row.estimated_cost_usd ?? undefined,
      actualCostUsd: row.actual_cost_usd ?? undefined,
      costDifferenceUsd: row.cost_difference_usd ?? undefined,
    };
  }

  /**
   * Map database row to ModelSwitchRecord
   */
  private mapRowToModelSwitchRecord(row: any): ModelSwitchRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      timestamp: new Date(row.timestamp),
      fromModel: row.from_model ?? undefined,
      toModel: row.to_model,
      reason: row.reason ?? undefined,
    };
  }

  /**
   * Map database row to TranscriptContentRecord
   */
  private mapRowToTranscriptContentRecord(row: any): TranscriptContentRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      eventId: row.event_id ?? undefined,
      role: row.role as "user" | "assistant" | "system",
      content: row.content,
      timestamp: new Date(row.timestamp),
    };
  }

  // ─── Workspace Operations ──────────────────────────────────────────

  createWorkspace(params: CreateWorkspaceParams): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(params.id, params.name, params.path, now, now);
  }

  getWorkspace(id: string): WorkspaceRecord | undefined {
    const row = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return this.mapRowToWorkspaceRecord(row);
  }

  updateWorkspace(id: string, params: UpdateWorkspaceParams): void {
    const updates: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (params.name !== undefined) {
      updates.push("name = ?");
      values.push(params.name);
    }
    if (params.path !== undefined) {
      updates.push("path = ?");
      values.push(params.path);
    }

    updates.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE workspaces SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }

  deleteWorkspace(id: string): void {
    this.db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  }

  listWorkspaces(): WorkspaceRecord[] {
    const rows = this.db.prepare("SELECT * FROM workspaces ORDER BY name ASC").all() as any[];
    return rows.map((row) => this.mapRowToWorkspaceRecord(row));
  }

  private mapRowToWorkspaceRecord(row: any): WorkspaceRecord {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // ─── Env Set Operations ────────────────────────────────────────────

  private encryptionKey: Buffer | null = null;

  private getEncryptionKey(): Buffer {
    if (this.encryptionKey) return this.encryptionKey;
    // Lazy-load encryption module
    const { getOrCreateEncryptionKey } = require("../crypto/encryption");
    this.encryptionKey = getOrCreateEncryptionKey();
    // biome-ignore lint/style/noNonNullAssertion: assigned on the line above
    return this.encryptionKey!;
  }

  createEnvSet(params: CreateEnvSetParams): void {
    const now = Date.now();
    const { encryptVars } = require("../crypto/encryption");
    const key = this.getEncryptionKey();
    const encryptedJson = encryptVars(params.vars, key);

    this.db
      .prepare(
        `INSERT INTO env_sets (id, name, description, encrypted_vars_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(params.id, params.name, params.description ?? null, encryptedJson, now, now);
  }

  getEnvSet(id: string): EnvSetRecord | undefined {
    const row = this.db.prepare("SELECT * FROM env_sets WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return this.mapRowToEnvSetRecord(row);
  }

  updateEnvSet(id: string, params: UpdateEnvSetParams): void {
    const updates: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (params.name !== undefined) {
      updates.push("name = ?");
      values.push(params.name);
    }
    if (params.description !== undefined) {
      updates.push("description = ?");
      values.push(params.description);
    }
    if (params.vars !== undefined) {
      const { encryptVars } = require("../crypto/encryption");
      const key = this.getEncryptionKey();
      updates.push("encrypted_vars_json = ?");
      values.push(encryptVars(params.vars, key));
    }

    updates.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE env_sets SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }

  deleteEnvSet(id: string): void {
    this.db.prepare("DELETE FROM env_sets WHERE id = ?").run(id);
  }

  listEnvSets(): EnvSetRecord[] {
    const rows = this.db.prepare("SELECT * FROM env_sets ORDER BY name ASC").all() as any[];
    return rows.map((row) => this.mapRowToEnvSetRecord(row));
  }

  decryptEnvSetVars(id: string): Record<string, string> {
    const row = this.db
      .prepare("SELECT encrypted_vars_json FROM env_sets WHERE id = ?")
      .get(id) as any;
    if (!row) throw new Error(`Env set not found: ${id}`);

    const { decryptVars } = require("../crypto/encryption");
    const key = this.getEncryptionKey();
    return decryptVars(row.encrypted_vars_json, key);
  }

  // ─── Auth Operations ───────────────────────────────────────────────

  hasAuthConfig(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM auth_config").get() as any;
    return row.count > 0;
  }

  getAuthConfig(): AuthConfigRecord | null {
    const row = this.db.prepare("SELECT * FROM auth_config WHERE id = 1").get() as any;
    if (!row) return null;
    return {
      passwordHash: row.password_hash,
      totpSecretEncrypted: row.totp_secret_encrypted ?? null,
      totpEnabled: row.totp_enabled === 1,
      mfaSetupPending: row.mfa_setup_pending === 1,
      onboardingTokenHash: row.onboarding_token_hash ?? null,
      onboardingTokenExpiresAt:
        typeof row.onboarding_token_expires_at === "number"
          ? row.onboarding_token_expires_at
          : null,
      recoveryCodesEncrypted: row.recovery_codes_encrypted ?? null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  createAuthConfig(
    passwordHash: string,
    options: {
      mfaSetupPending?: boolean;
      onboardingTokenHash?: string | null;
      onboardingTokenExpiresAt?: number | null;
    } = {}
  ): void {
    const now = Date.now();
    const mfaSetupPending = options.mfaSetupPending ?? false;
    const onboardingTokenHash = options.onboardingTokenHash ?? null;
    const onboardingTokenExpiresAt = options.onboardingTokenExpiresAt ?? null;
    this.db
      .prepare(
        `INSERT INTO auth_config (
          id,
          password_hash,
          mfa_setup_pending,
          onboarding_token_hash,
          onboarding_token_expires_at,
          created_at,
          updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        passwordHash,
        mfaSetupPending ? 1 : 0,
        onboardingTokenHash,
        onboardingTokenExpiresAt,
        now,
        now
      );
  }

  updateAuthPassword(passwordHash: string): void {
    this.db
      .prepare("UPDATE auth_config SET password_hash = ?, updated_at = ? WHERE id = 1")
      .run(passwordHash, Date.now());
  }

  updateAuthTotp(
    encryptedSecret: string | null,
    enabled: boolean,
    recoveryCodes: string | null
  ): void {
    this.db
      .prepare(
        `UPDATE auth_config SET
          totp_secret_encrypted = ?,
          totp_enabled = ?,
          recovery_codes_encrypted = ?,
          updated_at = ?
         WHERE id = 1`
      )
      .run(encryptedSecret, enabled ? 1 : 0, recoveryCodes, Date.now());
  }

  updateAuthOnboardingState(
    mfaSetupPending: boolean,
    onboardingTokenHash: string | null,
    onboardingTokenExpiresAt: number | null
  ): void {
    this.db
      .prepare(
        `UPDATE auth_config SET
          mfa_setup_pending = ?,
          onboarding_token_hash = ?,
          onboarding_token_expires_at = ?,
          updated_at = ?
         WHERE id = 1`
      )
      .run(mfaSetupPending ? 1 : 0, onboardingTokenHash, onboardingTokenExpiresAt, Date.now());
  }

  createAuthSession(
    tokenHash: string,
    ip: string | null,
    userAgent: string | null,
    expiresAt: number
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO auth_sessions (token_hash, created_at, expires_at, last_used_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(tokenHash, now, expiresAt, now, ip, userAgent);
  }

  getAuthSession(tokenHash: string): AuthSessionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM auth_sessions WHERE token_hash = ?")
      .get(tokenHash) as any;
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      ipAddress: row.ip_address ?? null,
      userAgent: row.user_agent ?? null,
    };
  }

  touchAuthSession(tokenHash: string, newExpiresAt: number): void {
    this.db
      .prepare("UPDATE auth_sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?")
      .run(Date.now(), newExpiresAt, tokenHash);
  }

  deleteAuthSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
  }

  deleteAllAuthSessions(): void {
    this.db.prepare("DELETE FROM auth_sessions").run();
  }

  listAuthSessions(): AuthSessionRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM auth_sessions ORDER BY last_used_at DESC")
      .all() as any[];
    return rows.map((row) => ({
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      ipAddress: row.ip_address ?? null,
      userAgent: row.user_agent ?? null,
    }));
  }

  cleanupExpiredAuthSessions(): number {
    const result = this.db
      .prepare("DELETE FROM auth_sessions WHERE expires_at < ?")
      .run(Date.now());
    return result.changes;
  }

  // ─── Daemon Settings Operations ──────────────────────────────────

  getDaemonSettings(): DaemonSettingsRecord {
    const row = this.db.prepare("SELECT * FROM daemon_settings WHERE id = 1").get() as any;
    if (!row) {
      return {
        preserveSessions: false,
        defaultPolicyAction: "ask",
        forwardSshAuthSock: true,
        codexHostAccessProfileEnabled: false,
        terminalFeatures: {
          wsPtyPasteEnabled: true,
          latencyProbesEnabled: true,
          diagnosticsPanelEnabled: false,
          codexAppServerSpikeEnabled: false,
          wsPtyPasteCanaryPercent: 100,
          latencyProbesCanaryPercent: 100,
          diagnosticsPanelCanaryPercent: 0,
        },
        notificationsEnabled: false,
        systemNotificationsEnabled: false,
        notificationSoundsEnabled: true,
        notificationEventDefaults: {},
        notificationSoundMap: {},
        updatedAt: new Date(),
      };
    }
    return {
      preserveSessions: row.preserve_sessions === 1,
      defaultPolicyAction: row.default_policy_action === "deny" ? "deny" : "ask",
      forwardSshAuthSock: row.forward_ssh_auth_sock !== 0,
      codexHostAccessProfileEnabled: row.codex_host_access_profile_enabled !== 0,
      terminalFeatures: {
        wsPtyPasteEnabled: row.terminal_ws_pty_paste_enabled !== 0,
        latencyProbesEnabled: row.terminal_latency_probes_enabled !== 0,
        diagnosticsPanelEnabled: row.terminal_diagnostics_panel_enabled !== 0,
        codexAppServerSpikeEnabled: row.terminal_codex_app_server_spike_enabled !== 0,
        wsPtyPasteCanaryPercent: this.normalizeCanaryPercent(
          row.terminal_ws_pty_paste_canary_percent,
          100
        ),
        latencyProbesCanaryPercent: this.normalizeCanaryPercent(
          row.terminal_latency_probes_canary_percent,
          100
        ),
        diagnosticsPanelCanaryPercent: this.normalizeCanaryPercent(
          row.terminal_diagnostics_panel_canary_percent,
          0
        ),
      },
      notificationsEnabled: row.notifications_enabled !== 0,
      systemNotificationsEnabled: row.system_notifications_enabled !== 0,
      notificationSoundsEnabled: row.notification_sounds_enabled !== 0,
      notificationEventDefaults: this.parseBooleanRecord(row.notification_event_defaults_json),
      notificationSoundMap: this.parseStringRecord(row.notification_sound_map_json),
      updatedAt: new Date(row.updated_at),
    };
  }

  updateDaemonSettings(params: {
    preserveSessions?: boolean;
    defaultPolicyAction?: "ask" | "deny";
    forwardSshAuthSock?: boolean;
    codexHostAccessProfileEnabled?: boolean;
    terminalFeatures?: Partial<DaemonTerminalFeatureSettings>;
    notificationsEnabled?: boolean;
    systemNotificationsEnabled?: boolean;
    notificationSoundsEnabled?: boolean;
    notificationEventDefaults?: Record<string, boolean>;
    notificationSoundMap?: Record<string, string>;
  }): void {
    const now = Date.now();
    const existing = this.db.prepare("SELECT id FROM daemon_settings WHERE id = 1").get();
    const normalizedTerminalFeatures = params.terminalFeatures
      ? {
          wsPtyPasteEnabled:
            params.terminalFeatures.wsPtyPasteEnabled !== undefined
              ? params.terminalFeatures.wsPtyPasteEnabled
              : undefined,
          latencyProbesEnabled:
            params.terminalFeatures.latencyProbesEnabled !== undefined
              ? params.terminalFeatures.latencyProbesEnabled
              : undefined,
          diagnosticsPanelEnabled:
            params.terminalFeatures.diagnosticsPanelEnabled !== undefined
              ? params.terminalFeatures.diagnosticsPanelEnabled
              : undefined,
          codexAppServerSpikeEnabled:
            params.terminalFeatures.codexAppServerSpikeEnabled !== undefined
              ? params.terminalFeatures.codexAppServerSpikeEnabled
              : undefined,
          wsPtyPasteCanaryPercent:
            params.terminalFeatures.wsPtyPasteCanaryPercent !== undefined
              ? this.normalizeCanaryPercent(params.terminalFeatures.wsPtyPasteCanaryPercent, 100)
              : undefined,
          latencyProbesCanaryPercent:
            params.terminalFeatures.latencyProbesCanaryPercent !== undefined
              ? this.normalizeCanaryPercent(params.terminalFeatures.latencyProbesCanaryPercent, 100)
              : undefined,
          diagnosticsPanelCanaryPercent:
            params.terminalFeatures.diagnosticsPanelCanaryPercent !== undefined
              ? this.normalizeCanaryPercent(
                  params.terminalFeatures.diagnosticsPanelCanaryPercent,
                  0
                )
              : undefined,
        }
      : undefined;

    if (!existing) {
      const terminalFeatures = {
        wsPtyPasteEnabled: normalizedTerminalFeatures?.wsPtyPasteEnabled ?? true,
        latencyProbesEnabled: normalizedTerminalFeatures?.latencyProbesEnabled ?? true,
        diagnosticsPanelEnabled: normalizedTerminalFeatures?.diagnosticsPanelEnabled ?? false,
        codexAppServerSpikeEnabled: normalizedTerminalFeatures?.codexAppServerSpikeEnabled ?? false,
        wsPtyPasteCanaryPercent: normalizedTerminalFeatures?.wsPtyPasteCanaryPercent ?? 100,
        latencyProbesCanaryPercent: normalizedTerminalFeatures?.latencyProbesCanaryPercent ?? 100,
        diagnosticsPanelCanaryPercent:
          normalizedTerminalFeatures?.diagnosticsPanelCanaryPercent ?? 0,
      };
      this.db
        .prepare(
          `INSERT INTO daemon_settings (
            id,
            preserve_sessions,
            default_policy_action,
            forward_ssh_auth_sock,
            codex_host_access_profile_enabled,
            terminal_ws_pty_paste_enabled,
            terminal_latency_probes_enabled,
            terminal_diagnostics_panel_enabled,
            terminal_codex_app_server_spike_enabled,
            terminal_ws_pty_paste_canary_percent,
            terminal_latency_probes_canary_percent,
            terminal_diagnostics_panel_canary_percent,
            notifications_enabled,
            system_notifications_enabled,
            notification_sounds_enabled,
            notification_event_defaults_json,
            notification_sound_map_json,
            updated_at
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          params.preserveSessions ? 1 : 0,
          params.defaultPolicyAction ?? "ask",
          params.forwardSshAuthSock === undefined ? 1 : params.forwardSshAuthSock ? 1 : 0,
          params.codexHostAccessProfileEnabled ? 1 : 0,
          terminalFeatures.wsPtyPasteEnabled ? 1 : 0,
          terminalFeatures.latencyProbesEnabled ? 1 : 0,
          terminalFeatures.diagnosticsPanelEnabled ? 1 : 0,
          terminalFeatures.codexAppServerSpikeEnabled ? 1 : 0,
          terminalFeatures.wsPtyPasteCanaryPercent,
          terminalFeatures.latencyProbesCanaryPercent,
          terminalFeatures.diagnosticsPanelCanaryPercent,
          params.notificationsEnabled ? 1 : 0,
          params.systemNotificationsEnabled ? 1 : 0,
          params.notificationSoundsEnabled === undefined
            ? 1
            : params.notificationSoundsEnabled
              ? 1
              : 0,
          this.toJsonRecord(params.notificationEventDefaults, "boolean"),
          this.toJsonRecord(params.notificationSoundMap, "string"),
          now
        );
    } else {
      const updates: string[] = [];
      const values: SQLQueryBindings[] = [];

      if (params.preserveSessions !== undefined) {
        updates.push("preserve_sessions = ?");
        values.push(params.preserveSessions ? 1 : 0);
      }

      if (params.defaultPolicyAction !== undefined) {
        updates.push("default_policy_action = ?");
        values.push(params.defaultPolicyAction);
      }

      if (params.forwardSshAuthSock !== undefined) {
        updates.push("forward_ssh_auth_sock = ?");
        values.push(params.forwardSshAuthSock ? 1 : 0);
      }

      if (params.codexHostAccessProfileEnabled !== undefined) {
        updates.push("codex_host_access_profile_enabled = ?");
        values.push(params.codexHostAccessProfileEnabled ? 1 : 0);
      }

      if (normalizedTerminalFeatures?.wsPtyPasteEnabled !== undefined) {
        updates.push("terminal_ws_pty_paste_enabled = ?");
        values.push(normalizedTerminalFeatures.wsPtyPasteEnabled ? 1 : 0);
      }

      if (normalizedTerminalFeatures?.latencyProbesEnabled !== undefined) {
        updates.push("terminal_latency_probes_enabled = ?");
        values.push(normalizedTerminalFeatures.latencyProbesEnabled ? 1 : 0);
      }

      if (normalizedTerminalFeatures?.diagnosticsPanelEnabled !== undefined) {
        updates.push("terminal_diagnostics_panel_enabled = ?");
        values.push(normalizedTerminalFeatures.diagnosticsPanelEnabled ? 1 : 0);
      }

      if (normalizedTerminalFeatures?.codexAppServerSpikeEnabled !== undefined) {
        updates.push("terminal_codex_app_server_spike_enabled = ?");
        values.push(normalizedTerminalFeatures.codexAppServerSpikeEnabled ? 1 : 0);
      }

      if (normalizedTerminalFeatures?.wsPtyPasteCanaryPercent !== undefined) {
        updates.push("terminal_ws_pty_paste_canary_percent = ?");
        values.push(normalizedTerminalFeatures.wsPtyPasteCanaryPercent);
      }

      if (normalizedTerminalFeatures?.latencyProbesCanaryPercent !== undefined) {
        updates.push("terminal_latency_probes_canary_percent = ?");
        values.push(normalizedTerminalFeatures.latencyProbesCanaryPercent);
      }

      if (normalizedTerminalFeatures?.diagnosticsPanelCanaryPercent !== undefined) {
        updates.push("terminal_diagnostics_panel_canary_percent = ?");
        values.push(normalizedTerminalFeatures.diagnosticsPanelCanaryPercent);
      }

      if (params.notificationsEnabled !== undefined) {
        updates.push("notifications_enabled = ?");
        values.push(params.notificationsEnabled ? 1 : 0);
      }

      if (params.systemNotificationsEnabled !== undefined) {
        updates.push("system_notifications_enabled = ?");
        values.push(params.systemNotificationsEnabled ? 1 : 0);
      }

      if (params.notificationSoundsEnabled !== undefined) {
        updates.push("notification_sounds_enabled = ?");
        values.push(params.notificationSoundsEnabled ? 1 : 0);
      }

      if (params.notificationEventDefaults !== undefined) {
        updates.push("notification_event_defaults_json = ?");
        values.push(this.toJsonRecord(params.notificationEventDefaults, "boolean"));
      }

      if (params.notificationSoundMap !== undefined) {
        updates.push("notification_sound_map_json = ?");
        values.push(this.toJsonRecord(params.notificationSoundMap, "string"));
      }

      updates.push("updated_at = ?");
      values.push(now);

      this.db
        .prepare(`UPDATE daemon_settings SET ${updates.join(", ")} WHERE id = 1`)
        .run(...values);
    }
  }

  private normalizeCanaryPercent(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }
    const rounded = Math.round(value);
    if (rounded < 0) {
      return 0;
    }
    if (rounded > 100) {
      return 100;
    }
    return rounded;
  }

  private parseBooleanRecord(value: unknown): Record<string, boolean> {
    if (typeof value !== "string" || value.trim() === "") {
      return {};
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
        return {};
      }
      const result: Record<string, boolean> = {};
      for (const [key, entry] of Object.entries(parsed)) {
        if (typeof entry === "boolean") {
          result[key] = entry;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  private parseStringRecord(value: unknown): Record<string, string> {
    if (typeof value !== "string" || value.trim() === "") {
      return {};
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
        return {};
      }
      const result: Record<string, string> = {};
      for (const [key, entry] of Object.entries(parsed)) {
        if (typeof entry === "string") {
          result[key] = entry;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  private toJsonRecord(
    value: Record<string, unknown> | undefined,
    itemType: "boolean" | "string"
  ): string {
    if (!(value && typeof value === "object" && !Array.isArray(value))) {
      return "{}";
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (itemType === "boolean" && typeof entry === "boolean") {
        normalized[key] = entry;
      } else if (itemType === "string" && typeof entry === "string") {
        normalized[key] = entry;
      }
    }

    return JSON.stringify(normalized);
  }

  private mapRowToEnvSetRecord(row: any): EnvSetRecord {
    const { decryptVars, maskValue } = require("../crypto/encryption");
    const key = this.getEncryptionKey();

    let maskedVars: Record<string, string> = {};
    let varCount = 0;
    try {
      const plainVars = decryptVars(row.encrypted_vars_json, key);
      varCount = Object.keys(plainVars).length;
      for (const [k, v] of Object.entries(plainVars)) {
        maskedVars[k] = maskValue(v);
      }
    } catch {
      // If decryption fails, return empty masked vars
      maskedVars = {};
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      maskedVars,
      varCount,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
