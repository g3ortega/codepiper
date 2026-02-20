# CodePiper Documentation

This directory is the canonical index for publish-facing product, architecture, API, and operations documentation.

## Start Here

1. [Root README](../README.md) - install, run, CLI, dashboard overview.
2. [CLAUDE.md](../CLAUDE.md) - architecture and subsystem map.
3. [API Reference](api/README.md) - endpoint contracts and payloads.

## Product and Feature Docs

- [Provider Capability Matrix (Codex vs Claude Code)](features/provider-capability-matrix.md)
- [Daemon Settings](features/daemon-settings.md)
- [Theme System](features/theme-system.md)
- [Provider Extensibility](features/provider-extensibility.md)

## Operations Docs

- [Troubleshooting](operations/troubleshooting.md)
- [FAQ](operations/faq.md)
- [Production Deployment](operations/production-deployment.md)
- [Release Checklist](operations/release-checklist.md)

## API Docs

- [API Overview](api/README.md)

## Architecture Docs

- [Architecture Index](architecture/README.md)
- [System Overview](architecture/overview.md)
- [Enhancements](architecture/enhancements.md)
- [Branch Protection Baseline](architecture/branch-protection.md)

## Runtime, Packaging, and Security

- [Root README prerequisites](../README.md#prerequisites)
- [Daemon runtime dependencies](../packages/daemon/README.md#runtime-dependencies)
- [Production Deployment](operations/production-deployment.md)
- [Troubleshooting](operations/troubleshooting.md)
- [FAQ](operations/faq.md)
- [Release Checklist](operations/release-checklist.md)
- [Security Policy](../SECURITY.md)
- Packaging checks:
  - `bun run pack:check`
  - `bun run pack:smoke`
  - `bun run security:secrets`
  - `bun run security:deps`
    - Uses configured Bun scanner when present; otherwise falls back to `bun audit` (registry/network access required for full signal).

## Contributing

- [Contributing Guide](../CONTRIBUTING.md)
- [Agent Workflow Rules](../AGENTS.md)

## Historical Archive

Legacy implementation writeups and superseded deep dives are intentionally kept out of tracked docs and stored in local-only archives (git excluded).

If you need to preserve temporary implementation notes locally, use a directory under `.local-exclude/`.

When docs conflict, prioritize:

1. `README.md`
2. `CLAUDE.md`
3. Current code behavior
