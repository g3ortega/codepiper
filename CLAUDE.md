# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Instruction Sources

- Root and scoped `AGENTS.md` files define workflow rules, invariants, and verification expectations.
- This `CLAUDE.md` file is the deep architecture and subsystem reference.
- Keep root/scoped AGENTS concise; keep broad architecture detail here.

## Project Overview

**CodePiper** is a remote orchestrator for managing multiple live interactive coding-agent sessions. Built with **Bun + TypeScript**.

> **Meta note:** This project is sometimes developed from within CodePiper itself — Claude Code
> sessions orchestrated by CodePiper, building CodePiper. Inception-style self-hosting is not
> the default workflow, but when it happens, it's a powerful dogfooding loop.

Currently supports **Claude Code** and **Codex CLI** via tmux integration.

Key capabilities:
- Spawn and resume multiple concurrent provider sessions
- Web dashboard with real-time terminal view, conversation rendering, and analytics
- Permission policy engine with auto-approval/denial via tmux keystrokes
- Transcript tailing with crash-safe byte-offset resumption
- Workflow orchestration via YAML/JSON DSL
- Token usage tracking and cost estimation
- Single-user authentication with TOTP MFA
- Git integration per session

## Architecture

### Packages

```
packages/
├── core/              # Shared types, event bus, config, errors
├── daemon/            # Long-running process: API server, DB, sessions, workflows, auth
├── cli/               # CLI client (user-facing commands + internal hook-forward)
├── providers/
│   └── claude-code/   # Claude Code overlay/settings provider (Codex is registry-defined in daemon)
└── web/               # React dashboard (Vite + Tailwind + shadcn/ui + Recharts + xterm.js)
```

### Daemon (`packages/daemon/`)

- **API server**: HTTP over Unix socket (`/tmp/codepiper.sock`) + optional HTTP port for web dashboard
- **Database**: SQLite via `bun:sqlite` — 19 tables with foreign key constraints
- **Sessions**: Provider registry with tmux runtime and per-provider capabilities
- **WebSocket**: Streaming events and terminal output on port 9999
- **Auth**: Single-user password + TOTP MFA with rate limiting
- **Analytics**: Token tracking, cost estimation, model distribution

### Provider Interface

```typescript
interface Provider {
  id: ProviderId;
  startSession(opts: { id, cwd, env, args?, model?, billingMode? }): Promise<SessionHandle>;
  sendText(sessionId, text): Promise<void>;
  sendKeys(sessionId, keys): Promise<void>;
  stopSession(sessionId): Promise<void>;
  onEvent(cb): void;
  switchModel?(sessionId, model): Promise<void>;
  getCurrentModel?(sessionId): string | undefined;
}
```

Implemented providers:
- `claude-code`: native hooks + transcript tailing + model switching
- `codex`: no native hooks, tmux input preflight policy channel (workflow `wait` types that depend on hook events and transcript `extract` are rejected at validation time)

### Data Flow

**Session lifecycle:**
1. Daemon generates UUID session ID
2. Environment prepared: env sets merged, billing mode applied, `ANTHROPIC_API_KEY`/`CLAUDECODE` scrubbed
3. Settings overlay generated with hooks configuration
4. TmuxSession created: `tmux new-session -d -s codepiper-<uuid>`
5. **Session persisted to database** via `db.createSession()` (after successful tmux spawn)

**Event ingestion:**
- Claude Code hooks → structured events (SessionStart, Notification, PermissionRequest, Stop)
- Transcript tailer → JSONL parsing with byte-offset tracking
- Tmux capture-pane → terminal output polling for web dashboard
- Statusline (optional) → session state snapshots

**Permission auto-handling:**
1. PermissionRequest hook arrives → PolicyEngine evaluates
2. Decision stored in database + audit log
3. If "allow" or "deny": tmux send-keys automatically ("1"+Enter or "2"+Enter)
4. If "ask": waits for manual user response

For no-hook providers (e.g. Codex), daemon enforces policy on terminal input channels (`terminal_input` / `terminal_keys`) before dispatch. If policy default is `ask` with no matching rule, input is allowed; explicit `ask` matches are blocked (provider cannot render interactive approval prompt).

## Tmux Integration

**Why tmux?** Ink's `ink-text-input` treats programmatic `\r\n` as newline characters, not submit triggers. Tmux provides a real PTY where `tmux send-keys` is indistinguishable from physical keyboard input.

- Session name: `codepiper-<uuid>`
- Input: `tmux send-keys -t codepiper-<uuid> -l "text"` (literal text)
- Special keys: `tmux send-keys -t codepiper-<uuid> Enter`
- Output: `tmux capture-pane -t codepiper-<uuid> -p -e`
- Resize: `tmux resize-window -t codepiper-<uuid> -x <cols> -y <rows>` (NOT `resize-pane`)
- Cleanup: `tmux kill-session -t codepiper-<uuid>`
- **Recommends tmux 3.0+** (checked via `codepiper doctor`, warns if older)

## Claude Code Integration

### Three integration surfaces

1. **Hooks** (primary control plane) — SessionStart, Notification, PermissionRequest, Stop
2. **Transcript tailing** — JSONL from `transcript_path`, byte-offset resumption via SQLite
3. **Statusline** (optional) — heartbeat + metadata after assistant messages

### Settings overlay pattern

Per-session overlay file generated at spawn time:
- `claude --settings /path/to/overlay.json`
- Overlay configures hooks to call `codepiper hook-forward`
- Env vars passed: `CODEPIPER_UNIX_SOCK`, `CODEPIPER_SESSION`, `CODEPIPER_SECRET`

## Billing Modes

**Subscription** (default): Scrubs `ANTHROPIC_API_KEY` → Max plan billing. For interactive use.
**API**: Preserves `ANTHROPIC_API_KEY` → pay-per-token. **Required for automated workflows** per Anthropic ToS.
**Always scrubbed**: `CLAUDECODE` (controls session nesting, not billing).

See `LEGAL_NOTICE.md` for compliance details.

## Database Schema (SQLite)

19 tables defined in `packages/daemon/src/db/schema.sql`:

| Category | Tables |
|----------|--------|
| Core | `sessions`, `events`, `transcript_offsets` |
| Policy | `policies`, `policy_decisions`, `policy_sets`, `policy_set_members`, `session_policy_sets` |
| Workflows | `workflows`, `workflow_executions`, `workflow_steps` |
| Analytics | `token_usage`, `model_switches`, `transcript_content` |
| Settings | `workspaces`, `env_sets`, `daemon_settings` |
| Auth | `auth_config`, `auth_sessions` |

**Design principle:** Persist first, process later. All state persisted to SQLite before processing.

## Daemon API

The API is accessed via Unix socket (CLI) or HTTP (web dashboard, prefixed with `/api`).

### Sessions (11 endpoints)
- `GET /sessions` — list all sessions
- `POST /sessions` — create session (`provider`, `cwd`, optional `dangerousMode`, billingMode/env/worktree)
- `GET /sessions/:id` — session details
- `POST /sessions/:id/stop` — graceful stop
- `POST /sessions/:id/kill` — force kill
- `POST /sessions/:id/resume` — resume stopped session
- `POST /sessions/:id/send` — send text (`{ text, newline? }`)
- `POST /sessions/:id/keys` — send key sequences (`{ keys: ["ctrl+c"] }`)
- `GET /sessions/:id/output` — current terminal capture
- `POST /sessions/:id/resize` — resize terminal
- `POST /sessions/:id/upload-image` — upload image for context

### Providers (1 endpoint)
- `GET /providers` — list provider runtime/capability metadata (for UI/CLI introspection)

### Model (2 endpoints, Claude Code only)
- `GET /sessions/:id/model`, `PUT /sessions/:id/model`

### Policies (5 endpoints)
- `GET /policies`, `POST /policies`, `GET /policies/:id`, `PUT /policies/:id`, `DELETE /policies/:id`

### Policy Sets (8 endpoints)
- CRUD: `GET /policy-sets`, `POST /policy-sets`, `GET /policy-sets/:id`, `PUT /policy-sets/:id`, `DELETE /policy-sets/:id`
- Members: `POST /policy-sets/:id/policies`, `DELETE /policy-sets/:id/policies/:policyId`
- Audit: `GET /policy-decisions`

### Session Policy Sets (4 endpoints)
- `GET /sessions/:id/policy-sets`, `POST /sessions/:id/policy-sets`
- `DELETE /sessions/:id/policy-sets/:setId`
- `GET /sessions/:id/effective-policies`

### Session Policies (2 endpoints)
- `GET /sessions/:id/policy`, `PUT /sessions/:id/policy`

### Events & Hooks
- `GET /sessions/:id/events` — all events with optional `?source=` filter
- `POST /hooks/claude` — hook event ingestion

### Analytics (7 endpoints)
- `GET /analytics/overview`, `/activity-timeline`, `/token-usage`, `/tokens-by-model`
- `GET /analytics/sessions-by-provider`, `/tool-usage`, `/policy-decisions`

### Git (9 endpoints, per session)
- `GET /sessions/:id/git/status`, `/git/branches`, `/git/log`, `/git/diff`, `/git/file`, `/git/file-raw`, `/git/diff-stat`
- `POST /sessions/:id/git/stage`, `/git/unstage`

### Terminal (5 endpoints, per session)
- `GET /sessions/:id/terminal/info` — pane mode, scroll position, history size
- `POST /sessions/:id/terminal/mode` — enter/exit copy-mode
- `POST /sessions/:id/terminal/scroll` — scroll up/down/page
- `POST /sessions/:id/terminal/search` — search in terminal history
- `POST /sessions/:id/terminal/transcribe` — speech-to-text transcription for uploaded audio

### Workflows (10 endpoints)
- CRUD: `GET /workflows`, `POST /workflows`, `GET /workflows/:id`, `DELETE /workflows/:id`
- Execution: `POST /workflows/:id/execute`, `GET /workflows/:id/executions`
- Nested execution routes: `GET /workflows/:id/executions/:execId`, `POST /workflows/:id/executions/:execId/cancel`
- Execution ID routes: `GET /workflows/executions/:execId`, `POST /workflows/executions/:execId/cancel`

### Auth (11 endpoints)
- `GET /auth/status`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`
- `POST /auth/password`, `POST /auth/mfa/setup`, `/mfa/verify`
- `GET /auth/sessions`, `POST /auth/sessions/revoke-all`
- CLI-only: `POST /auth/cli/reset-password`, `/cli/reset-mfa`
- Onboarding requires password + MFA before issuing normal auth sessions (`mfaSetupRequired` state).

### Settings (13 endpoints)
- Daemon: `GET /settings/daemon`, `PUT /settings/daemon`, `POST /settings/daemon/restart`
  - Daemon settings include session preservation, fallback policy action (`ask|deny`), SSH agent forwarding, and terminal feature rollout flags/canaries
- Workspaces: `GET /workspaces`, `POST /workspaces`, `GET /workspaces/:id`, `PUT /workspaces/:id`, `DELETE /workspaces/:id`
- Env Sets: `GET /env-sets`, `POST /env-sets`, `GET /env-sets/:id`, `PUT /env-sets/:id`, `DELETE /env-sets/:id`

### Validation (2 endpoints)
- `POST /sessions/validate`, `POST /sessions/validate-git`

### Infrastructure
- `GET /health`, `GET /version`
- `GET /ws` — WebSocket upgrade

## CLI Commands

User-facing commands + 1 internal:

| Command | Description |
|---------|-------------|
| `auth` | Authentication management (status, reset-password, reset-mfa, sessions, revoke-all) |
| `daemon` | Daemon lifecycle (start, stop, status) |
| `start` | Start a new session |
| `stop` | Graceful session stop |
| `kill` | Force kill session |
| `resize` | Resize session terminal |
| `sessions` | List all sessions |
| `attach` | Attach to session (interactive or follow mode) |
| `send` | Send text to session |
| `keys` | Send key sequences (ctrl+c, enter, arrows, etc.) |
| `slash` | Execute slash command |
| `tail` | Tail session output log |
| `model` | Get/switch Claude Code model |
| `policy` | Manage policies (list, get, create, update, delete, toggle, default) |
| `policy-set` | Manage policy sets (list, get, create, update, delete, add/remove-policy) |
| `audit` | View policy decision audit log |
| `analytics` | View analytics (overview, sessions, tools, costs, activity) |
| `providers` | List supported providers and daemon-reported capabilities |
| `workspace` | Manage workspaces (CRUD) |
| `env-set` | Manage encrypted environment sets (CRUD) |
| `logs` | View event logs |
| `doctor` | Diagnostics (tmux/provider binaries, API key checks) |
| `workflow` | Manage workflows (create, list, show, run, status, cancel, logs) |
| `hook-forward` | *Internal:* Forward hook events from Claude Code to daemon |

## Web Dashboard

React SPA served by the daemon when started with `--web`:

- **Dashboard** — Session overview, active count, total messages, tokens
- **Sessions** — List/create/stop sessions, terminal view, conversation view
- **Analytics** — Token usage charts, model distribution, cache hit rate, cost estimation
- **Workflows** — Create and execute multi-session workflows
- **Policies** — Policy CRUD, policy sets, audit log
- **Settings** — Workspaces, environment sets, daemon settings
- **Auth** — Login and MFA setup (rendered as gate overlay, not a routed page)

Terminal uses xterm.js with tmux output polling plus cursor metadata sync. **Critical**: convert `\n` → `\r\n` before `term.write()`.

Key components:
- `TerminalView.tsx` — Terminal display, cursor/state rendering, scroll/search controls, desktop-first keyboard passthrough, wheel/touch handlers
- `InputBar.tsx` — Explicit input surface for touch/mobile paths
- `attachmentUtils.ts` — Shared image validation/extraction helpers for desktop terminal and mobile input paths
- `useInfiniteEvents.ts` — Shared infinite scroll hook (cursor pagination, IntersectionObserver, optional polling)

Build: `bun run build:web`
Run: `bun run daemon:web` or `bun run daemon -- --web --port 3456`

## Development

### Setup

```bash
bun install
```

### Running

```bash
bun run daemon                    # CLI-only (Unix socket)
bun run daemon:web                # With web dashboard on port 3000
bun run daemon -- --web --port 3456  # Custom port
```

### Testing

```bash
bun test                          # All tests
bun test --coverage               # With coverage
bun test --watch                  # Watch mode
bun test packages/core            # Specific package
```

### Git Worktree Workflow

Use worktrees for isolated feature/review work without disrupting the main checkout:

```bash
# Create worktree with new branch
git worktree add ../codepiper-worktrees/<name> -b <branch-name>

# Work in the worktree (independent working directory, shared git history)
cd ../codepiper-worktrees/<name>
# ... make changes, commit ...

# Rebase onto latest main (main may have advanced)
git rebase main

# Create a merge-ready branch (from main worktree)
git -C /path/to/main-worktree branch <merge-branch> <commit-sha>

# Cleanup
git worktree remove /path/to/worktree
git branch -d <worktree-branch>    # delete the worktree's branch
# <merge-branch> remains for PR/merge into main
```

**Key rules:**
- A branch checked out in one worktree cannot be checked out in another
- To create branches from another worktree's commits, use `git -C <path> branch <name> <sha>`
- Worktrees share reflog, stash, and remote tracking — only the working directory is separate

### Code Quality (Biome)

```bash
bun run lint                      # Check
bun run lint:fix                  # Auto-fix
bun run format                    # Format
bun run pre-commit                # lint:fix + typecheck + strict typecheck + test
```

Biome config: double quotes, semicolons, 2-space indent, 100 char line width, ES5 trailing commas.

### Key Simulation

```
Enter: \r or \n          Ctrl+C: \x03        Ctrl+D: \x04
Tab: \t                  Escape: \x1b        Ctrl+R: \x12
Arrow up: \x1b[A         Arrow down: \x1b[B
Arrow right: \x1b[C      Arrow left: \x1b[D
```

## Security

- **Unix socket** by default — restricted to current user
- **Auth**: Password (Argon2 hash) + TOTP MFA onboarding required before normal login sessions
- **Rate limiting** on login attempts
- **Environment encryption** (AES-GCM) for stored env sets
- **Input validation** on all API endpoints
- **Policy audit log** for all permission decisions
- **Remote access**: Recommended via SSH port forwarding, not direct exposure

## Known Issues & Gotchas

1. **Hook stdout**: Claude Code processes hook stdout as context for some events. Print nothing unless explicitly needed.
2. **Permission patterns**: Known docs issues around pattern syntax. Test defensively.
3. **Bun compile**: Dynamic imports can fail in `bun build --compile`. Use static imports for core providers.
4. **Task list sharing**: `CLAUDE_CODE_TASK_LIST_ID` env var shares task lists across sessions.
5. **Tmux resize**: Use `resize-window`, NOT `resize-pane` (detached sessions constrain pane to window size).
6. **xterm.js CRLF**: `tmux capture-pane` outputs LF only; must convert to CRLF before `term.write()`.

## Exploration Workflow

Feature explorations live in `.explorations/` (git-ignored). Multiple explorations may run
concurrently. Each gets its own namespaced directory.

```
.explorations/
├── tmux-modes/            # Example: tmux terminal modes feature
│   ├── EXPLORATION.md     # Research findings, design options, trade-offs
│   ├── spike/             # Throwaway prototype code
│   └── notes/             # Raw research notes, links, transcripts
├── control-mode/          # Example: another concurrent exploration
│   ├── EXPLORATION.md
│   └── spike/
└── ...
```

**Conventions:**
- One directory per feature, named descriptively (kebab-case)
- `EXPLORATION.md` is the primary deliverable per exploration
- Multiple explorations can be active simultaneously — keep them independent
- When an exploration graduates to implementation, reference it in the PR, then delete
- Explorations are local-only — they never enter version control

## Documentation Visuals

When writing or updating docs:

- Prefer ASCII diagrams for simple/local flows (short pipelines, basic component relationships).
- Use Mermaid for complex flows (multi-actor sequences, branching state behavior, lifecycle timelines).
- Keep diagrams close to the section they explain, and ensure labels match real file/module names.

## References

- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code Settings](https://code.claude.com/docs/en/settings)
- [Bun PTY API](https://bun.com/blog/bun-v1.3.5)
- [Tmux Manual](https://www.man7.org/linux/man-pages/man1/tmux.1.html)
- [Tmux Control Mode](https://github.com/tmux/tmux/wiki/Control-Mode)
- [Tmux Advanced Use](https://github.com/tmux/tmux/wiki/Advanced-Use)
