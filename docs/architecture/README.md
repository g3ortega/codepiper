# Architecture Documentation

System architecture, design decisions, and architectural patterns for CodePiper.

## Documents

- **[Overview](overview.md)** - High-level system architecture
- **[Enhancements](enhancements.md)** - Current architecture hardening backlog for publish readiness

## Key Components

### Core Architecture
- **Daemon** - Long-running process managing sessions
- **CLI Client** - Command-line interface for user interaction
- **Providers** - Pluggable session providers (currently Claude Code and Codex via tmux)
- **Event Bus** - SQLite-based event distribution system

### Data Flow

```text
codepiper CLI ──> Unix socket ──┐
                                ├──> Daemon API ──> SessionManager ──> tmux providers
Web dashboard ──> HTTP /api ────┘        |                |
                  WS /ws ───────────> WebSocket ──> PTY stream to browser
                                         |
                                    SQLite (persist first)
                                      - sessions, events
                                      - policies, audit
                                      - analytics, workflows
```

1. CLI sends commands to daemon via Unix socket (trusted, no auth).
2. Web dashboard sends via HTTP API (auth + origin + CSRF gates) and receives PTY via WebSocket.
3. Daemon manages sessions through provider registry (tmux runtime).
4. Hook events and transcript data are persisted to SQLite before processing.
5. WebSocket fans out real-time PTY output and session events to connected clients.

### Key Design Decisions
- **Tmux-based provider runtime** - real PTY behavior and recovery/adoption semantics
- **SQLite-backed event bus + persistence** - minimal runtime dependencies
- **Unix socket first API** - local-first, secure by default
- **Layered HTTP security** - origin validation, auth/MFA, CSRF, rate limiting for browser paths
- **Capability-driven provider UX** - provider feature exposure follows `/providers` metadata

## Architecture Principles

1. **Local-first** - Unix socket by default, SSH tunneling or reverse proxy for remote
2. **Zero dependencies** - SQLite for persistence and pub/sub
3. **Provider abstraction** - Pluggable session backends via capability contract
4. **Event-driven** - Asynchronous event bus for loose coupling
5. **Security in depth** - Transport (socket permissions, origin gates), auth (password + MFA), authorization (policy engine), data (encrypted env sets, billing isolation)
