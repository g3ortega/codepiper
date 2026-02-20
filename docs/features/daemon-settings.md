# Daemon Settings

Daemon settings are global, persisted in `daemon_settings` (single row) and exposed via `GET/PUT /settings/daemon`.

## Available Settings

| Setting | Type | Default | Purpose |
|---|---|---:|---|
| `preserveSessions` | boolean | `false` | Keep active tmux sessions alive across daemon restarts |
| `defaultPolicyAction` | `"ask" \| "deny"` | `"ask"` | Fallback action when no permission policy rule matches |
| `forwardSshAuthSock` | boolean | `true` | Forward `SSH_AUTH_SOCK` and `SSH_AGENT_PID` to new sessions |
| `codexHostAccessProfileEnabled` | boolean | `false` | Launch new Codex sessions with host-access runtime profile (`--sandbox danger-full-access -a on-request`) |
| `terminalFeatures.wsPtyPasteEnabled` | boolean | `true` | Enable WebSocket `pty_paste` transport |
| `terminalFeatures.latencyProbesEnabled` | boolean | `true` | Enable terminal latency metrics collection |
| `terminalFeatures.diagnosticsPanelEnabled` | boolean | `false` | Enable hidden terminal diagnostics overlay |
| `terminalFeatures.codexAppServerSpikeEnabled` | boolean | `false` | Enable Codex app-server spike enrollment metadata (runtime scaffold, no transport switch yet) |
| `terminalFeatures.*CanaryPercent` | integer `0..100` | `100/100/0` | Legacy rollout fields retained for compatibility (dashboard uses boolean toggles only) |

## Policies And Restrictions

1. `defaultPolicyAction` cannot be `"allow"`; only `"ask"` or `"deny"` are accepted.
2. Fallback policy is used only when no explicit policy rule matches.
3. `forwardSshAuthSock` forwards only env pointers (`SSH_AUTH_SOCK`, `SSH_AGENT_PID`), not private keys.
4. `forwardSshAuthSock` applies only to sessions created after the setting change.
5. `codexHostAccessProfileEnabled` affects only new Codex sessions and is ignored when a session is started with `--dangerous`.
6. Terminal canary fields are still validated/clamped to `0..100` for compatibility, but UI rollout is boolean-only.
7. `codexAppServerSpikeEnabled` is intentionally enable/disable only (no canary percentage).
8. `codexAppServerSpikeEnabled` currently gates enrollment metadata only; Codex runtime remains tmux CLI in this phase.
9. Feature toggle writes are immediate in DB, but daemon restart may be required for full operational effect.
10. Restart requests are asynchronous (`POST /settings/daemon/restart` returns `202`).

## Codex Scaffold Rationale

The Codex app-server spike is a provider-integration scaffold that currently records enrollment metadata and does not switch runtime transport. We removed canary percentage controls for this flag and kept a simple boolean toggle:

- CodePiper is a single-user/self-hosted daemon, so staged canary percentages do not provide meaningful safety gates for this setting.
- The current spike is a no-op transport scaffold; users should make an explicit on/off choice rather than rely on probabilistic rollout behavior.

## Operational Notes

- Settings are available in the dashboard under **Settings → Daemon**.
- Settings updates are also available over CLI/API clients via the daemon HTTP API.
- The daemon startup migration ensures new settings columns exist on older databases.
