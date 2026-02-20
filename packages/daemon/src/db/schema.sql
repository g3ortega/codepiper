-- sessions table
-- Stores session metadata and state
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  pid INTEGER,
  pty_cols INTEGER,
  pty_rows INTEGER,
  transcript_path TEXT,
  metadata_json TEXT
);

-- Index for filtering sessions by status
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

-- Index for filtering sessions by provider
CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider);

-- events table
-- Stores all events from various sources (PTY, hooks, transcript, statusline)
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Index for querying events by session
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);

-- Index for querying events by session and id (for "since" queries)
CREATE INDEX IF NOT EXISTS idx_events_session_id_id ON events(session_id, id);

-- Index for filtering events by type
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

-- Index for filtering events by source
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);

-- session_notifications table
-- Durable user-facing notifications derived from provider events
CREATE TABLE IF NOT EXISTS session_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_event_id INTEGER,
  title TEXT NOT NULL,
  body TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  read_source TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_event_id) REFERENCES events(id) ON DELETE SET NULL
);

-- Index for unread-per-session queries
CREATE INDEX IF NOT EXISTS idx_session_notifications_session_read
  ON session_notifications(session_id, read_at);

-- Index for newest-first inbox queries
CREATE INDEX IF NOT EXISTS idx_session_notifications_created_desc
  ON session_notifications(created_at DESC);

-- Index for event-type filters
CREATE INDEX IF NOT EXISTS idx_session_notifications_event_created
  ON session_notifications(event_type, created_at DESC);

-- Index for notification dedupe lookup by source event
CREATE INDEX IF NOT EXISTS idx_session_notifications_source_event_type
  ON session_notifications(source_event_id, event_type);

-- session_notification_prefs table
-- Per-session notification preference overrides
CREATE TABLE IF NOT EXISTS session_notification_prefs (
  session_id TEXT PRIMARY KEY,
  enabled INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- push_subscriptions table
-- Web Push subscriptions for background notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_updated_at
  ON push_subscriptions(updated_at DESC);

-- transcript_offsets table
-- Stores byte offsets for crash-safe transcript tailing
CREATE TABLE IF NOT EXISTS transcript_offsets (
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  last_line_hash TEXT,
  PRIMARY KEY (session_id, path),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- policies table
-- Stores permission policies for programmatic control
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  rules_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Index for filtering policies by session
CREATE INDEX IF NOT EXISTS idx_policies_session ON policies(session_id);

-- Index for ordering policies by priority
CREATE INDEX IF NOT EXISTS idx_policies_priority ON policies(priority DESC);

-- policy_decisions table
-- Audit log for all policy decisions
CREATE TABLE IF NOT EXISTS policy_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_id INTEGER,
  policy_id TEXT,
  tool_name TEXT NOT NULL,
  args_json TEXT,
  decision TEXT NOT NULL,
  reason TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE SET NULL
);

-- Index for querying decisions by session
CREATE INDEX IF NOT EXISTS idx_policy_decisions_session ON policy_decisions(session_id);

-- Index for querying decisions by timestamp
CREATE INDEX IF NOT EXISTS idx_policy_decisions_timestamp ON policy_decisions(timestamp);

-- workflows table
-- Stores workflow definitions
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  definition_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- workflow_executions table
-- Stores workflow execution state and history
CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_message TEXT,
  context_json TEXT,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

-- Index for querying executions by workflow
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON workflow_executions(workflow_id);

-- Index for filtering executions by status
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status);

-- workflow_steps table
-- Stores individual workflow step execution state
CREATE TABLE IF NOT EXISTS workflow_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  result_json TEXT,
  error_message TEXT,
  FOREIGN KEY (execution_id) REFERENCES workflow_executions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

-- Index for querying steps by execution
CREATE INDEX IF NOT EXISTS idx_workflow_steps_execution ON workflow_steps(execution_id);

-- Index for querying steps by session
CREATE INDEX IF NOT EXISTS idx_workflow_steps_session ON workflow_steps(session_id);

-- token_usage table
-- Stores token usage data with cache metrics for cost tracking
-- Separating from events table provides 85% storage savings and 10-300x query speedup
CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_id INTEGER,
  timestamp INTEGER NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL,
  actual_cost_usd REAL,
  cost_difference_usd REAL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);

-- Index for querying token usage by session
CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);

-- Index for querying token usage by timestamp
CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp);

-- Index for querying token usage by model
CREATE INDEX IF NOT EXISTS idx_token_usage_model ON token_usage(model);

-- Index for aggregate queries (session + timestamp)
CREATE INDEX IF NOT EXISTS idx_token_usage_session_timestamp ON token_usage(session_id, timestamp);

-- model_switches table
-- Tracks model changes for monitoring and debugging
CREATE TABLE IF NOT EXISTS model_switches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  from_model TEXT,
  to_model TEXT NOT NULL,
  reason TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Index for querying model switches by session
CREATE INDEX IF NOT EXISTS idx_model_switches_session ON model_switches(session_id);

-- Index for querying model switches by timestamp
CREATE INDEX IF NOT EXISTS idx_model_switches_timestamp ON model_switches(timestamp);

-- transcript_content table
-- Stores full transcript text separately from events for efficient storage
-- Optional table for full-text search and content analysis
CREATE TABLE IF NOT EXISTS transcript_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_id INTEGER,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);

-- Index for querying transcript content by session
CREATE INDEX IF NOT EXISTS idx_transcript_content_session ON transcript_content(session_id);

-- Index for querying transcript content by timestamp
CREATE INDEX IF NOT EXISTS idx_transcript_content_timestamp ON transcript_content(timestamp);

-- Index for querying transcript content by role
CREATE INDEX IF NOT EXISTS idx_transcript_content_role ON transcript_content(role);

-- policy_sets table
-- Named groups of policies that can be applied as a unit to sessions
CREATE TABLE IF NOT EXISTS policy_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Ensure at most one default policy set
CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_sets_default
  ON policy_sets(is_default) WHERE is_default = 1;

-- policy_set_members table (M:N: policy_sets <-> policies)
-- Links policies into sets
CREATE TABLE IF NOT EXISTS policy_set_members (
  policy_set_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (policy_set_id, policy_id),
  FOREIGN KEY (policy_set_id) REFERENCES policy_sets(id) ON DELETE CASCADE,
  FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE
);

-- Index for reverse lookup: which sets contain a given policy
CREATE INDEX IF NOT EXISTS idx_psm_policy ON policy_set_members(policy_id);

-- session_policy_sets table (M:N: sessions <-> policy_sets)
-- Binds policy sets to sessions
CREATE TABLE IF NOT EXISTS session_policy_sets (
  session_id TEXT NOT NULL,
  policy_set_id TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, policy_set_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (policy_set_id) REFERENCES policy_sets(id) ON DELETE CASCADE
);

-- Index for reverse lookup: which sessions use a given set
CREATE INDEX IF NOT EXISTS idx_sps_set ON session_policy_sets(policy_set_id);

-- workspaces table
-- Saved directories for quick session creation
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Ensure workspace names are unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_name ON workspaces(name);

-- Index for path lookups
CREATE INDEX IF NOT EXISTS idx_workspaces_path ON workspaces(path);

-- env_sets table
-- Named collections of encrypted environment variables
CREATE TABLE IF NOT EXISTS env_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  encrypted_vars_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Ensure env set names are unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_env_sets_name ON env_sets(name);

-- auth_config table
-- Single-user authentication configuration (at most one row)
CREATE TABLE IF NOT EXISTS auth_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  totp_secret_encrypted TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  mfa_setup_pending INTEGER NOT NULL DEFAULT 0,
  onboarding_token_hash TEXT,
  onboarding_token_expires_at INTEGER,
  recovery_codes_encrypted TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- auth_sessions table
-- Active login sessions (bearer tokens, hashed)
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT
);

-- Index for expiry cleanup
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

-- daemon_settings table
-- Single-row table for daemon-level configuration (like auth_config)
CREATE TABLE IF NOT EXISTS daemon_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  preserve_sessions INTEGER NOT NULL DEFAULT 0,
  default_policy_action TEXT NOT NULL DEFAULT 'ask',
  forward_ssh_auth_sock INTEGER NOT NULL DEFAULT 1,
  codex_host_access_profile_enabled INTEGER NOT NULL DEFAULT 0,
  terminal_ws_pty_paste_enabled INTEGER NOT NULL DEFAULT 1,
  terminal_latency_probes_enabled INTEGER NOT NULL DEFAULT 1,
  terminal_diagnostics_panel_enabled INTEGER NOT NULL DEFAULT 0,
  terminal_codex_app_server_spike_enabled INTEGER NOT NULL DEFAULT 0,
  terminal_ws_pty_paste_canary_percent INTEGER NOT NULL DEFAULT 100,
  terminal_latency_probes_canary_percent INTEGER NOT NULL DEFAULT 100,
  terminal_diagnostics_panel_canary_percent INTEGER NOT NULL DEFAULT 0,
  notifications_enabled INTEGER NOT NULL DEFAULT 0,
  system_notifications_enabled INTEGER NOT NULL DEFAULT 0,
  notification_sounds_enabled INTEGER NOT NULL DEFAULT 1,
  notification_event_defaults_json TEXT NOT NULL DEFAULT '{}',
  notification_sound_map_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
