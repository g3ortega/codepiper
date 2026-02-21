# @codepiper/daemon

The daemon package is the core API server for CodePiper, managing multiple interactive CLI sessions with full policy enforcement, analytics, workflow orchestration, and an embedded web dashboard.

## Features

- **HTTP API** — Unix socket + optional HTTP port for web dashboard
- **WebSocket streaming** — Real-time PTY output and events
- **Session management** — Create, control, and monitor concurrent sessions
- **Tmux integration** — Real TTY for Claude Code via tmux sessions
- **Hooks ingestion** — Structured events from Claude Code (SessionStart, Notification, PermissionRequest, Stop)
- **Transcript tailing** — JSONL parsing with crash-safe byte-offset resumption
- **Policy engine** — Rule-based permission decisions with glob pattern matching
- **Policy sets** — Named groups of policies applied to sessions as a unit
- **Analytics** — Token usage, model distribution, cost estimation, tool usage
- **Workflows** — Multi-session orchestration with YAML/JSON DSL
- **Web dashboard** — React SPA served from daemon (embedded)
- **SQLite persistence** — All state survives daemon restarts

## Runtime Dependencies

| Dependency | Minimum | Required for |
|------------|---------|--------------|
| `bun` | 1.3.5+ | Daemon runtime |
| `tmux` | 3.0+ | Managed provider sessions |
| `claude` CLI and/or `codex` CLI | latest | Spawning provider sessions |
| `git` | latest | Git routes and worktree operations |

Optional:
- HTTPS origin + VAPID keys for remote/mobile web push.
- External STT command binary for `/sessions/:id/terminal/transcribe`.

## Architecture

```
packages/daemon/
├── src/
│   ├── main.ts                          # Daemon entry point
│   ├── api/
│   │   ├── server.ts                    # HTTP/WS server (Bun.serve)
│   │   ├── routes.ts                    # Core route handlers
│   │   ├── hooks.ts                     # Claude Code hook handler
│   │   ├── policyRoutes.ts              # Individual policy CRUD
│   │   ├── policySetRoutes.ts           # Policy set endpoints
│   │   ├── analyticsRoutes.ts           # Analytics aggregation
│   │   ├── workflowRoutes.ts            # Workflow management
│   │   ├── authRoutes.ts                # Authentication endpoints
│   │   ├── gitRoutes.ts                 # Git operations per session
│   │   ├── terminalRoutes.ts            # Terminal upload/image endpoints
│   │   ├── settingsRoutes.ts            # Daemon settings endpoints
│   │   ├── workspaceRoutes.ts           # Workspace CRUD
│   │   ├── envSetRoutes.ts              # Encrypted env set CRUD
│   │   ├── validationRoutes.ts          # Input validation endpoints
│   │   ├── validation.ts                # Shared validation helpers
│   │   └── ws.ts                        # WebSocket manager
│   ├── config/
│   │   └── pricing.ts                   # Model pricing configuration
│   ├── db/
│   │   ├── db.ts                        # Database class (bun:sqlite)
│   │   └── schema.sql                   # DDL for all tables
│   ├── sessions/
│   │   ├── sessionManager.ts            # Session lifecycle + default set auto-apply
│   │   ├── ptyProcess.ts                # Bun PTY wrapper
│   │   ├── tmuxSession.ts               # Tmux session wrapper
│   │   ├── transcriptTailer.ts          # JSONL transcript tailing
│   │   ├── transcriptManager.ts         # Multi-session transcript coordinator
│   │   ├── transcriptParser.ts          # Event parsing/normalization
│   │   ├── policyEngine.ts              # Rule evaluation engine
│   │   ├── policyMatcher.ts             # Glob pattern matching
│   │   ├── policyTypes.ts               # Policy type definitions
│   │   └── auditLogger.ts              # Decision audit logging
│   └── workflows/
│       ├── workflowRunner.ts            # Execution engine
│       ├── workflowParser.ts            # YAML/JSON DSL parser
│       ├── workflowValidator.ts         # Workflow definition validation
│       ├── workflowTypes.ts             # Type definitions
│       ├── waitConditionPoller.ts       # Wait condition polling
│       ├── resultExtractor.ts           # Result extraction from transcripts
│       └── contextManager.ts            # Variable management between steps
```

## API Endpoints

All endpoints are served on the Unix socket without prefix, and on HTTP with `/api` prefix.

### Session Management (11 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/version` | Version info |
| `GET` | `/sessions` | List all sessions |
| `POST` | `/sessions` | Create new session |
| `GET` | `/sessions/:id` | Get session details |
| `POST` | `/sessions/:id/stop` | Graceful stop |
| `POST` | `/sessions/:id/kill` | Force kill |
| `POST` | `/sessions/:id/resume` | Resume stopped session |
| `POST` | `/sessions/:id/send` | Send text input |
| `POST` | `/sessions/:id/keys` | Send key sequences |
| `POST` | `/sessions/:id/upload-image` | Upload image for session |

### Session Terminal & Model (4 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions/:id/output` | Current terminal output |
| `POST` | `/sessions/:id/resize` | Resize terminal |
| `GET` | `/sessions/:id/model` | Get current model |
| `PUT` | `/sessions/:id/model` | Switch model |

### Events (1 endpoint)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions/:id/events` | Get events (filterable by source, type, since, limit) |

### Hooks (1 endpoint)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/hooks/claude` | Hook callback from Claude Code |

### Policies (7 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/policies` | List policies |
| `POST` | `/policies` | Create policy |
| `GET` | `/policies/:id` | Get policy |
| `PUT` | `/policies/:id` | Update policy |
| `DELETE` | `/policies/:id` | Delete policy |
| `GET` | `/sessions/:id/policy` | Get session policy |
| `PUT` | `/sessions/:id/policy` | Set session policy |

### Policy Sets (12 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/policy-sets` | List policy sets |
| `POST` | `/policy-sets` | Create set |
| `GET` | `/policy-sets/:id` | Get set with policies |
| `PUT` | `/policy-sets/:id` | Update set |
| `DELETE` | `/policy-sets/:id` | Delete set |
| `POST` | `/policy-sets/:id/policies` | Add policy to set |
| `DELETE` | `/policy-sets/:id/policies/:pid` | Remove policy from set |
| `GET` | `/sessions/:id/policy-sets` | Get session's sets |
| `POST` | `/sessions/:id/policy-sets` | Apply set to session |
| `DELETE` | `/sessions/:id/policy-sets/:sid` | Remove set from session |
| `GET` | `/sessions/:id/effective-policies` | Resolved policy list |
| `GET` | `/policy-decisions` | Audit log |

### Analytics (7 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/analytics/overview` | Dashboard summary |
| `GET` | `/analytics/activity-timeline` | Activity over time |
| `GET` | `/analytics/tokens-by-model` | Token breakdown by model |
| `GET` | `/analytics/token-usage` | Token usage over time |
| `GET` | `/analytics/sessions-by-provider` | Sessions by provider |
| `GET` | `/analytics/tool-usage` | Tool usage frequency |
| `GET` | `/analytics/policy-decisions` | Decision breakdown |

### Workflows (8 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/workflows` | List workflows |
| `POST` | `/workflows` | Create workflow |
| `GET` | `/workflows/:id` | Get workflow |
| `DELETE` | `/workflows/:id` | Delete workflow |
| `POST` | `/workflows/:id/execute` | Execute workflow |
| `GET` | `/workflows/:id/executions` | List executions |
| `GET` | `/workflows/:id/executions/:eid` | Get execution |
| `POST` | `/workflows/:id/executions/:eid/cancel` | Cancel execution |

### Auth (11 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/status` | Auth status |
| `POST` | `/auth/setup` | Initial setup fallback (manual password + MFA required next) |
| `POST` | `/auth/login` | Login |
| `POST` | `/auth/logout` | Logout |
| `POST` | `/auth/password` | Change password |
| `POST` | `/auth/mfa/setup` | Setup MFA |
| `POST` | `/auth/mfa/verify` | Verify MFA (also completes onboarding) |
| `GET` | `/auth/sessions` | List auth sessions |
| `POST` | `/auth/sessions/revoke-all` | Revoke all sessions |
| `POST` | `/auth/cli/reset-password` | CLI password reset |
| `POST` | `/auth/cli/reset-mfa` | CLI MFA reset |

Security notes:
- First web daemon start auto-generates a secure bootstrap password if none exists.
- First-run onboarding is mandatory sign-in with that password + MFA before normal auth sessions are issued.
- `mfaSetupRequired` is only true when a valid onboarding token cookie is present for that request.
- CLI password resets re-enter MFA onboarding when MFA is not currently enabled.
- MFA disable is CLI-only via `/auth/cli/reset-mfa`.

### Git (9 endpoints, per session)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions/:id/git/status` | Git status |
| `GET` | `/sessions/:id/git/log` | Git log |
| `GET` | `/sessions/:id/git/diff` | Git diff |
| `GET` | `/sessions/:id/git/diff-stat` | Diff stats |
| `GET` | `/sessions/:id/git/file` | File content |
| `GET` | `/sessions/:id/git/file-raw` | Raw file content |
| `GET` | `/sessions/:id/git/branches` | List branches |
| `POST` | `/sessions/:id/git/stage` | Stage files |
| `POST` | `/sessions/:id/git/unstage` | Unstage files |

### Settings (13 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/workspaces` | List workspaces |
| `POST` | `/workspaces` | Create workspace |
| `GET` | `/workspaces/:id` | Get workspace |
| `PUT` | `/workspaces/:id` | Update workspace |
| `DELETE` | `/workspaces/:id` | Delete workspace |
| `GET` | `/env-sets` | List env sets |
| `POST` | `/env-sets` | Create env set |
| `GET` | `/env-sets/:id` | Get env set |
| `PUT` | `/env-sets/:id` | Update env set |
| `DELETE` | `/env-sets/:id` | Delete env set |
| `GET` | `/settings/daemon` | Get daemon settings |
| `PUT` | `/settings/daemon` | Update daemon settings |
| `POST` | `/settings/daemon/restart` | Restart daemon process |

### Terminal (5 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions/:id/terminal/info` | Get terminal mode, scroll position, and dimensions |
| `POST` | `/sessions/:id/terminal/mode` | Set terminal mode (`interactive` / `scroll`) |
| `POST` | `/sessions/:id/terminal/scroll` | Scroll terminal |
| `POST` | `/sessions/:id/terminal/search` | Search terminal |
| `POST` | `/sessions/:id/terminal/transcribe` | Transcribe uploaded audio (voice fallback path) |

### Validation (2 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions/validate` | Validate session params |
| `POST` | `/sessions/validate-git` | Validate git directory |

### WebSocket

- `ws://127.0.0.1:9999/ws` (port configurable via `CODEPIPER_WS_PORT`)
- Topics: `session:<id>:pty`, `session:<id>:events`, `sessions`

**Total: 93 endpoints + WebSocket**

### Daemon Settings Payload

`GET /settings/daemon` and `PUT /settings/daemon` return:

```json
{
  "settings": {
    "preserveSessions": true,
    "defaultPolicyAction": "ask",
    "terminalFeatures": {
      "wsPtyPasteEnabled": true,
      "latencyProbesEnabled": true,
      "diagnosticsPanelEnabled": false,
      "wsPtyPasteCanaryPercent": 100,
      "latencyProbesCanaryPercent": 100,
      "diagnosticsPanelCanaryPercent": 0
    },
    "updatedAt": "YYYY-MM-DDTHH:mm:ss.sssZ"
  }
}
```

`POST /settings/daemon/restart` returns `202 Accepted` and schedules a daemon restart.  
Session handling during restart respects `preserveSessions`.

## Database Schema

SQLite database at `~/.codepiper/codepiper.db` with 22 tables (plus `schema_migrations` for versioning):

| Table | Purpose |
|-------|---------|
| `sessions` | Session metadata and state |
| `events` | All events from hooks, transcript, PTY, statusline |
| `transcript_offsets` | Byte offsets for crash-safe transcript resumption |
| `policies` | Permission policy definitions |
| `policy_decisions` | Audit trail for permission decisions |
| `policy_sets` | Named groups of policies |
| `policy_set_members` | M:N join: policies ↔ sets |
| `session_policy_sets` | M:N join: sessions ↔ sets |
| `token_usage` | Token usage data with cache metrics |
| `model_switches` | Model change tracking |
| `transcript_content` | Full transcript text for search |
| `workflows` | Workflow definitions |
| `workflow_executions` | Workflow execution state |
| `workflow_steps` | Individual step execution |
| `workspaces` | Workspace configurations |
| `env_sets` | Encrypted environment variable sets |
| `auth_config` | Authentication configuration (password, MFA) |
| `auth_sessions` | Active authentication sessions |
| `daemon_settings` | Global daemon settings (single row) |
| `session_notifications` | User-facing notifications from provider events |
| `session_notification_prefs` | Per-session notification preferences |
| `push_subscriptions` | Web Push VAPID subscriptions |

## Usage

### Starting the Daemon

```bash
# Default (Unix socket only)
bun run packages/daemon/src/main.ts

# With web dashboard
bun run packages/daemon/src/main.ts --web --port 3456

# Custom socket path
CODEPIPER_SOCKET=/tmp/custom.sock bun run packages/daemon/src/main.ts
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEPIPER_SOCKET` | `/tmp/codepiper.sock` | Unix socket path |
| `CODEPIPER_DB_PATH` | `~/.codepiper/codepiper.db` | SQLite database path |
| `CODEPIPER_WS_PORT` | `9999` | WebSocket TCP port |
| `CODEPIPER_HTTP_PORT` | `3000` | HTTP port (when `--web`) |
| `CODEPIPER_ALLOWED_ORIGINS` | _unset_ | Comma-separated allowed origin hostnames for WebSocket + CSRF checks (required for non-localhost access) |
| `CODEPIPER_FORCE_SECURE_COOKIES` | `0` | Force `Secure` auth cookies (`1`) when behind TLS-terminating proxies |
| `CODEPIPER_TRUST_PROXY_HEADERS` | `0` | Trust `X-Forwarded-For`/`X-Real-IP` for client IP extraction (`1`) |
| `CODEPIPER_SECRET` | _auto-generated_ | Hook authentication secret (random hex if unset) |
| `CODEPIPER_MFA_QR_TIMEOUT_MS` | `8000` | Timeout for MFA QR generation before fallback to manual setup key |
| `CODEPIPER_API_RATE_LIMIT_MAX` | `300` | Max API requests per rate-limit window (HTTP routes) |
| `CODEPIPER_API_RATE_LIMIT_WINDOW_MS` | `10000` | Rate-limit sliding window in ms |
| `CODEPIPER_WS_PTY_PASTE` | `1` | Enable/disable `pty_paste` op (`0` disables) |
| `CODEPIPER_STT_COMMAND` | _unset_ | Optional speech-to-text command for `/terminal/transcribe` (input file path appended if `{input}` placeholder is not used) |
| `CODEPIPER_STT_COMMAND_JSON` | _unset_ | JSON array form of STT command (preferred for explicit argv) |
| `CODEPIPER_STT_TIMEOUT_MS` | `45000` | Timeout for STT command execution |
| `CODEPIPER_PUSH_ENABLED` | `0` | Enable daemon push delivery (`1`) |
| `CODEPIPER_PUSH_PUBLIC_KEY` | _unset_ | VAPID public key for daemon push |
| `CODEPIPER_PUSH_PRIVATE_KEY` | _unset_ | VAPID private key for daemon push |
| `CODEPIPER_PUSH_SUBJECT` | _unset_ | VAPID subject (`mailto:` or `https://...`) |

## Security

- **Billing mode handling** — `ANTHROPIC_API_KEY` conditionally handled per billing mode (scrubbed in subscription mode for Max plan, preserved in api mode for pay-per-token)
- **Unix socket** — Default secure local communication
- **Input validation** — All endpoints validate request bodies
- **Audit logging** — All permission decisions recorded

## Testing

```bash
bun test packages/daemon/src/
```
