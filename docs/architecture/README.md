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
1. CLI sends commands to Daemon via Unix socket
2. Daemon manages sessions through Providers
3. Events flow through SQLite Event Bus
4. WebSocket streams real-time output to clients

### Key Design Decisions
- **Tmux-based provider runtime** - real PTY behavior and recovery/adoption semantics
- **SQLite-backed event bus + persistence** - minimal runtime dependencies
- **Unix socket first API** - local-first, secure by default
- **Capability-driven provider UX** - provider feature exposure follows `/providers` metadata

## Architecture Principles

1. **Local-first** - Unix socket by default, SSH tunneling for remote
2. **Zero dependencies** - SQLite for persistence and pub/sub
3. **Provider abstraction** - Pluggable session backends
4. **Event-driven** - Asynchronous event bus for loose coupling
5. **Security** - Billing mode handling (subscription/api), permission policies, audit logging
