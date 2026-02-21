# API Documentation

Primary API reference for the CodePiper daemon.

## HTTP API

All endpoints are available over Unix socket (`/tmp/codepiper.sock`) and optionally via HTTP when started with `--web --port <port>`. When using the HTTP server, all API routes are prefixed with `/api` (e.g., `/api/sessions`). On the Unix socket, no prefix is needed.

### Health & Version

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/version` | Version information |

`GET /health` returns:
```json
{
  "status": "ok",
  "zombieSessionCount": 0
}
```

- `zombieSessionCount` counts sessions marked `RUNNING`/`STARTING` in DB that have no active in-memory runtime and no live tmux session.

### Session Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions` | List all sessions |
| `POST` | `/sessions` | Create new session |
| `GET` | `/sessions/:id` | Get session details |
| `PUT` | `/sessions/:id/name` | Set or clear custom session display name |
| `POST` | `/sessions/:id/stop` | Stop session gracefully (Ctrl+D, SIGTERM) |
| `POST` | `/sessions/:id/kill` | Force kill session (SIGKILL) |
| `POST` | `/sessions/:id/resume` | Reopen a stopped/crashed session via provider-native resume |
| `POST` | `/sessions/:id/recover` | Recover an orphaned live tmux session (re-adopt) |

**Create session:**
```json
POST /sessions
{
  "provider": "claude-code",
  "cwd": "/path/to/repo",
  "billingMode": "subscription",
  "dangerousMode": false,
  "envSetIds": ["dev-env"],
  "providerResume": {
    "providerSessionId": "019c7285-ba64-7462-bbfc-4227f3e24e88",
    "mode": "resume"
  },
  "env": { "CUSTOM_VAR": "value" },
  "args": ["--verbose"]
}
```

**Set/clear custom session name:**
```json
PUT /sessions/:id/name
{ "name": "Operator Alpha" }
```

Use `null` (or empty string) to clear the custom name and fall back to auto-generated labels.

### Session Input

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions/:id/send` | Send text to session |
| `POST` | `/sessions/:id/keys` | Send key sequences |
| `POST` | `/sessions/:id/upload-image` | Upload image for session context |

**Send text:**
```json
POST /sessions/:id/send
{ "text": "Hello world", "newline": true }
```

**Send keys:**
```json
POST /sessions/:id/keys
{ "keys": ["ctrl+c", "enter"] }
```

### Session Terminal

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions/:id/output` | Get current terminal output (tmux capture-pane) |
| `POST` | `/sessions/:id/resize` | Resize terminal (updates tmux pane dimensions) |
| `GET` | `/sessions/:id/terminal/info` | Get terminal mode, scroll position, and history size |
| `POST` | `/sessions/:id/terminal/mode` | Set terminal mode (`interactive`, `scroll`) |
| `POST` | `/sessions/:id/terminal/scroll` | Scroll history (`up`, `down`, page, edge) |
| `POST` | `/sessions/:id/terminal/search` | Search in terminal history |
| `POST` | `/sessions/:id/terminal/transcribe` | Speech-to-text transcription for uploaded audio |

**Resize:**
```json
POST /sessions/:id/resize
{ "cols": 120, "rows": 40 }
```

**Set mode:**
```json
POST /sessions/:id/terminal/mode
{ "mode": "scroll" }
```

**Scroll:**
```json
POST /sessions/:id/terminal/scroll
{ "direction": "up", "lines": 5 }
```

### Model Switching

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions/:id/model` | Get current model plus provider model-switch capability |
| `PUT` | `/sessions/:id/model` | Switch model (claude-code only) |

**Switch model:**
```json
PUT /sessions/:id/model
{ "model": "opus" }
```

`PUT /sessions/:id/model` returns `409` when the session provider does not support model switching
(e.g. Codex). `GET` always returns capability metadata:

```json
{
  "model": "claude-sonnet-4-5",
  "provider": "claude-code",
  "supportsModelSwitch": true
}
```

### Events & Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions/:id/events` | Get session events (query params: `source`, `type`, `since`, `limit`) |

**Query parameters for events:**
- `source` — Filter by source: `hook`, `transcript`, `pty`, `statusline`
- `type` — Filter by event type
- `since` — Return events after this event ID
- `limit` — Max events to return

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/notifications` | List notifications (global or filtered) |
| `GET` | `/notifications/counts` | Get unread counts (global + per session) |
| `POST` | `/notifications/:id/read` | Mark one notification as read (idempotent) |
| `POST` | `/notifications/read` | Bulk mark notifications as read |
| `GET` | `/notifications/push/status` | Get daemon web-push runtime status |
| `POST` | `/notifications/push/test` | Trigger a test push notification to stored subscriptions |
| `GET` | `/notifications/push/subscriptions` | List stored web-push subscriptions |
| `PUT` | `/notifications/push/subscriptions` | Upsert a web-push subscription |
| `DELETE` | `/notifications/push/subscriptions` | Remove a web-push subscription by endpoint |
| `GET` | `/sessions/:id/notifications/prefs` | Get per-session notification preference override |
| `PUT` | `/sessions/:id/notifications/prefs` | Set per-session notification preference override |

**Query parameters for notifications (`GET /notifications`):**
- `sessionId` — Filter by session ID
- `eventType` — Filter by notification event type (e.g. `session.turn_completed`)
- `unreadOnly` — `true` or `false`
- `before` — Cursor (`id < before`)
- `limit` — Max rows, `1..200`

**Mark single notification read:**
```json
POST /notifications/:id/read
{ "readSource": "click" }
```

**Mark notifications read in bulk:**
```json
POST /notifications/read
{ "sessionId": "session-uuid", "readSource": "open_session" }
```

**Set session notification prefs:**
```json
PUT /sessions/:id/notifications/prefs
{ "enabled": false }
```

**Upsert push subscription:**
```json
PUT /notifications/push/subscriptions
{
  "endpoint": "https://push.example/...",
  "expirationTime": 1800000000000,
  "keys": {
    "p256dh": "<public-key>",
    "auth": "<auth-secret>"
  }
}
```

**Get push runtime status:**
```json
GET /notifications/push/status
{
  "status": {
    "enabled": false,
    "configured": false,
    "publicKey": null,
    "reasons": [
      "feature_disabled"
    ]
  }
}
```

**Send test push notification:**
```json
POST /notifications/push/test
{ "title": "CodePiper test notification", "body": "Push delivery is working." }
```

**Delete push subscription:**
```json
DELETE /notifications/push/subscriptions
{ "endpoint": "https://push.example/..." }
```

Push delivery is daemon-side and optional. It runs only when:
- `CODEPIPER_PUSH_ENABLED=1`
- `CODEPIPER_PUSH_PUBLIC_KEY` and `CODEPIPER_PUSH_PRIVATE_KEY` are configured
- one or more web-push subscriptions are stored

Push is attempted for every created session notification (`notification:created`). Notification
creation still follows daemon/session notification settings and event defaults.

For web enrollment, `VITE_PUSH_PUBLIC_KEY` should match `CODEPIPER_PUSH_PUBLIC_KEY`.
Platform caveats:
- Push/system notifications require secure context (`https://` or `localhost`).
- iOS/iPadOS web push typically requires Home Screen installed web app context.
- Cross-device/mobile push requires the dashboard origin to be reachable over HTTPS from the target device.
- Local-only `127.0.0.1` deployments limit push reachability to the same local browser context.

### Hooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/hooks/claude` | Claude Code hook callback endpoint |

Receives JSON payloads from `codepiper hook-forward` for events:
- `SessionStart` — Captures session_id, transcript_path, cwd, model
- `Notification` — permission_prompt, idle_prompt, auth_success
- `PermissionRequest` — Returns allow/deny/ask decision JSON
- `Stop` — Marks turn completed and, when daemon notifications are enabled, creates `session.turn_completed`

### Policies (Individual)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/policies` | List all policies |
| `POST` | `/policies` | Create a new policy |
| `GET` | `/policies/:id` | Get policy by ID |
| `PUT` | `/policies/:id` | Update a policy |
| `DELETE` | `/policies/:id` | Delete a policy |

**Per-session policy (legacy):**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions/:id/policy` | Get session's direct policy |
| `PUT` | `/sessions/:id/policy` | Set session's direct policy |

**Create policy:**
```json
POST /policies
{
  "id": "uuid",
  "name": "Allow Reads",
  "description": "Allow all read operations",
  "enabled": true,
  "priority": 10,
  "rules": [
    { "id": "rule-1", "action": "allow", "tool": ["Read", "Glob", "Grep"] },
    { "id": "rule-2", "action": "deny", "tool": "Bash" }
  ]
}
```

### Policy Sets

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/policy-sets` | List all policy sets (with member/session counts) |
| `POST` | `/policy-sets` | Create a new policy set |
| `GET` | `/policy-sets/:id` | Get policy set with full policy details |
| `PUT` | `/policy-sets/:id` | Update policy set metadata |
| `DELETE` | `/policy-sets/:id` | Delete policy set (cascades session bindings) |

**Create policy set:**
```json
POST /policy-sets
{
  "id": "uuid",
  "name": "Production Rules",
  "description": "Standard production permission set",
  "isDefault": true,
  "policyIds": ["policy-id-1", "policy-id-2"]
}
```

**Response:**
```json
{
  "policySet": {
    "id": "uuid",
    "name": "Production Rules",
    "description": "Standard production permission set",
    "is_default": 1,
    "created_at": 1739600000,
    "updated_at": 1739600000,
    "policies": [...]
  }
}
```

### Policy Set Membership

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/policy-sets/:id/policies` | Add a policy to a set |
| `DELETE` | `/policy-sets/:id/policies/:policyId` | Remove a policy from a set |

**Add policy to set:**
```json
POST /policy-sets/:id/policies
{ "policyId": "policy-uuid" }
```

### Session Policy Sets

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions/:id/policy-sets` | Get policy sets applied to session |
| `POST` | `/sessions/:id/policy-sets` | Apply a policy set to session |
| `DELETE` | `/sessions/:id/policy-sets/:setId` | Remove a policy set from session |
| `GET` | `/sessions/:id/effective-policies` | Get resolved policy list (direct + sets + global, deduplicated) |

**Apply set to session:**
```json
POST /sessions/:id/policy-sets
{ "policySetId": "set-uuid" }
```

### Policy Decisions (Audit Log)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/policy-decisions` | List policy decisions across all sessions |

**Query parameters:**
- `sessionId` — Filter by session
- `decision` — Filter by decision: `allow`, `deny`, `ask`
- `limit` — Max results (default: 100)

**Response:**
```json
{
  "decisions": [
    {
      "id": 1,
      "sessionId": "session-uuid",
      "policyId": "policy-uuid",
      "toolName": "Bash",
      "args": { "command": "rm -rf /" },
      "decision": "deny",
      "reason": "Destructive operation blocked",
      "timestamp": "YYYY-MM-DDTHH:mm:ss.sssZ"
    }
  ]
}
```

### Analytics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/analytics/overview` | Dashboard summary (active sessions, total tokens, cost, cache rate) |
| `GET` | `/analytics/activity-timeline` | Activity over time (query: `days`, default 7) |
| `GET` | `/analytics/tokens-by-model` | Token usage breakdown by model |
| `GET` | `/analytics/token-usage` | Token usage over time (query: `days`, default 7) |
| `GET` | `/analytics/sessions-by-provider` | Session count by provider |
| `GET` | `/analytics/tool-usage` | Tool usage frequency |
| `GET` | `/analytics/policy-decisions` | Policy decision breakdown (allow/deny/ask counts) |

### Daemon Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/settings/daemon` | Get daemon-wide settings |
| `PUT` | `/settings/daemon` | Update one or more daemon settings |
| `POST` | `/settings/daemon/restart` | Request daemon restart |

**Update daemon settings:**
```json
PUT /settings/daemon
{
  "preserveSessions": true,
  "defaultPolicyAction": "ask",
  "forwardSshAuthSock": true,
  "codexHostAccessProfileEnabled": false,
  "notificationsEnabled": true,
  "systemNotificationsEnabled": false,
  "notificationSoundsEnabled": true,
  "notificationEventDefaults": {
    "session.turn_completed": true
  },
  "notificationSoundMap": {
    "session.turn_completed": "chime"
  },
  "terminalFeatures": {
    "wsPtyPasteEnabled": true,
    "latencyProbesEnabled": true,
    "diagnosticsPanelEnabled": false,
    "codexAppServerSpikeEnabled": false
  }
}
```

**Validation rules:**
- `preserveSessions`, `forwardSshAuthSock`, and `codexHostAccessProfileEnabled` must be booleans
- `notificationsEnabled`, `systemNotificationsEnabled`, and `notificationSoundsEnabled` must be booleans
- `defaultPolicyAction` must be `"ask"` or `"deny"`
- `notificationEventDefaults` must be an object with boolean values
- `notificationSoundMap` must be an object with string values
- `terminalFeatures.*Enabled` must be booleans
- `terminalFeatures.*CanaryPercent` is optional/legacy and must be a number in `[0, 100]` when provided

**Behavior notes:**
- `defaultPolicyAction` applies only when no policy rule matches
- `forwardSshAuthSock` only affects **new** sessions (existing sessions keep current env)
- `codexHostAccessProfileEnabled` only affects **new Codex sessions** and sets runtime args to `--sandbox danger-full-access -a on-request`
- `notificationsEnabled` controls whether notifications are produced/rendered by clients
- `systemNotificationsEnabled` and `notificationSoundsEnabled` are client behavior flags persisted daemon-wide
- Dashboard rollout controls are boolean-only for single-user deployments; canary percent fields are retained only for backward compatibility
- Codex app-server scaffold is currently metadata-only (`tmux-cli-fallback`)
- Restart endpoint responds with `202 Accepted` and schedules daemon restart asynchronously

### Workflows

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/workflows` | List all workflows |
| `POST` | `/workflows` | Create a workflow |
| `GET` | `/workflows/:id` | Get workflow details |
| `DELETE` | `/workflows/:id` | Delete a workflow |
| `POST` | `/workflows/:id/execute` | Execute a workflow |
| `GET` | `/workflows/:id/executions` | List executions for a workflow |
| `GET` | `/workflows/:id/executions/:execId` | Get execution details |
| `POST` | `/workflows/:id/executions/:execId/cancel` | Cancel a running execution |

**Create workflow:**
```json
POST /workflows
{
  "name": "review-pipeline",
  "description": "Sequential code review",
  "definition": {
    "steps": [
      {
        "name": "review",
        "type": "session",
        "provider": "claude-code",
        "cwd": "/path/to/repo",
        "prompt": "Review the latest changes",
        "wait_for": "stop"
      }
    ]
  }
}
```

## WebSocket API

### Connection

```
ws://127.0.0.1:9999/ws
```

The WebSocket server runs on a dedicated TCP port (default 9999, configurable via `CODEPIPER_WS_PORT`).

### Protocol

Subscribe to topics by sending JSON:
```json
{ "op": "subscribe", "topic": "session:<id>:pty" }
```

Unsubscribe:
```json
{ "op": "unsubscribe", "topic": "session:<id>:pty" }
```

### Topics

| Topic | Data | Description |
|-------|------|-------------|
| `session:<id>:pty` | Terminal output (ANSI) | Real-time PTY output from tmux |
| `session:<id>:events` | Hook events (JSON) | Structured events from hooks |
| `sessions` | Session status changes | Session lifecycle updates |

### Message Format

```json
{
  "topic": "session:abc-123:pty",
  "type": "pty_output",
  "data": "<ANSI content>"
}
```

## Authentication

### Unix Socket (Default)
- Socket permissions restrict to current user
- Secret token in `~/.codepiper/secrets.json` (chmod 600)

### Web Auth Flow (HTTP `/api/*`)
- `GET /auth/status` returns `setupRequired`, `mfaEnabled`, `mfaSetupRequired`, `onboardingPending`, `authenticated`.
- First-run onboarding is mandatory bootstrap-password sign-in + MFA:
  1. Daemon auto-generates a secure bootstrap password on first web startup when auth is unconfigured.
  2. `POST /auth/login` with that password returns `mfaSetupRequired: true` and an onboarding cookie.
  3. `POST /auth/mfa/setup` returns QR/secret for authenticator enrollment.
  4. `POST /auth/mfa/verify` completes onboarding and issues the normal auth session.
- During onboarding, no normal auth session is issued until MFA verification succeeds.
- MFA disable is CLI-only via `POST /auth/cli/reset-mfa` (Unix socket route).
- CLI password rotation supports generated secrets via `POST /auth/cli/reset-password` with body `{ "generate": true }`.
- If MFA is not enabled at password-reset time, onboarding is marked pending again before next sign-in.

Cookie security notes:
- Auth cookies are `HttpOnly` + `SameSite=Strict`.
- `Secure` is set automatically for HTTPS requests.
- `CODEPIPER_FORCE_SECURE_COOKIES=1` can force secure cookies behind TLS-terminating proxies.
- `CODEPIPER_TRUST_PROXY_HEADERS=1` enables trusted proxy header extraction from
  `X-Forwarded-For`/`X-Real-IP` (rate limiting) and `X-Forwarded-Proto`/`Forwarded` (secure-cookie inference).

Origin validation:
- WebSocket upgrades are gated by `Origin` header — only `localhost` and hostnames in `CODEPIPER_ALLOWED_ORIGINS` are accepted (prevents Cross-Site WebSocket Hijacking).
- Browser-originated state-changing requests (`POST`/`PUT`/`PATCH`/`DELETE`) on `/api/*` routes are gated by `Origin`/`Referer` — must match the target origin or an allowed hostname (CSRF mitigation).
- Non-browser clients (no `Origin`/`Referer` header) are not affected.

### Remote Access (SSH Tunneling)
```bash
ssh -L 8080:localhost:8080 remote-host
```

## Input Validation

All API endpoints validate input and return appropriate status codes:

- **201 Created** — Resource created successfully
- **400 Bad Request** — Invalid input (malformed JSON, missing fields)
- **404 Not Found** — Resource not found
- **405 Method Not Allowed** — Wrong HTTP method for endpoint
- **500 Internal Server Error** — Server error

### Validation Rules

- **cwd**: Must be absolute path, max 4096 chars, no null bytes
- **text**: Max 1MB
- **keys**: Array of strings, max 100 items
- **env**: Object, max 1000 variables
- **args**: Array of strings, max 100 items

## Client Libraries

### Bun/TypeScript
```typescript
const response = await fetch("http://localhost/sessions", {
  unix: "/tmp/codepiper.sock",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    provider: "claude-code",
    cwd: "/path/to/repo"
  })
});
```

### cURL
```bash
curl --unix-socket /tmp/codepiper.sock \
  -X POST http://localhost/sessions \
  -H "Content-Type: application/json" \
  -d '{"provider":"claude-code","cwd":"/tmp"}'
```
