# Provider Capability Matrix (Codex vs Claude Code)

This matrix clarifies what is currently available per provider in CodePiper.

## Session and Runtime Capabilities

| Capability | Claude Code | Codex | Notes |
|------------|-------------|-------|-------|
| Runtime transport | Yes | Yes | Both run inside tmux sessions (`codepiper-<session-id>`). |
| Native hook events | Yes | No | Claude uses native hooks (`SessionStart`, `Notification`, `PermissionRequest`, `Stop`). |
| Policy channel | `native-hooks` | `input-preflight` | Codex is enforced on send/keys/ws input preflight path. |
| Dangerous mode support | Yes | Yes | Provider-native dangerous flags are applied for both providers. |
| Provider resume by session ID | Yes | Yes | Resume/fork mode supported for both providers. |
| Tmux recover (adopt active runtime) | Yes | Yes | Both support tmux re-adoption when runtime is alive. |
| Transcript tailing | Yes | No | Claude transcript JSONL path supports richer structured ingestion. |
| Model switch API | Yes | No | `GET/PUT /sessions/:id/model` is provider-capability gated. |
| Token/cost analytics fidelity | High | Partial | Claude is transcript-driven; Codex metrics are PTY-derived. |
| Session detail `logs/events` tabs | Yes | No | Web UI hides unsupported tabs when provider lacks hook/transcript channels. |

## Workflow Compatibility

| Workflow Feature | Claude Code | Codex | Notes |
|------------------|-------------|-------|-------|
| Session steps | Yes | Yes | Core workflow execution works for both. |
| Wait conditions based on native hook events | Yes | Limited | Hook-dependent wait types are rejected for Codex sessions. |
| Transcript extraction (`extract`) | Yes | No | Codex currently does not provide transcript-based extraction channel. |
| Retry / conditional / parallel orchestration | Yes | Yes | Control-flow features are provider-agnostic. |

## Practical Guidance

- Use **Claude Code** when you need native hook-driven approvals, transcript extraction, and model switching.
- Use **Codex** when you prefer Codex runtime flow with preflight policy enforcement and tmux-managed session control.
- For mixed-provider workflows, design steps so Codex branches do not depend on hook-derived wait/extract semantics.
