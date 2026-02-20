# Contributing to CodePiper

Thanks for contributing.

This repository is a Bun + TypeScript monorepo with a daemon (`packages/daemon`), CLI (`packages/cli`), shared core (`packages/core`), provider adapters (`packages/providers/*`), and web dashboard (`packages/web`).

## Before You Start

1. Read `AGENTS.md` for workflow rules and verification requirements.
2. Read `CLAUDE.md` for architecture context.
3. Check open explorations in `.explorations/` when changing behavior-heavy flows.

## Local Setup

```bash
bun install
bun link
codepiper doctor
```

Core runtime prerequisites:

- Bun `>=1.3.5`
- tmux `>=3.0`
- Claude Code and/or Codex CLI (depending on provider you test)

## Development Workflow

1. Create a branch from `main`.
2. Implement the smallest safe change that solves the root issue.
3. Add or update tests in the same change.
4. Update docs in the same PR when behavior or contracts change.
5. Run verification commands before opening a PR.

## Required Checks

Run these before submitting:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run typecheck:strict
bun test
bun run --cwd packages/web lint
bun run --cwd packages/web build
bun run security:secrets
bun run pack:check:fast
```

For dependency security validation (requires registry access):

```bash
bun run security:deps
```

## PR Guidelines

- Keep PRs focused and reviewable.
- Include risk notes for session lifecycle, auth/security, and API contract changes.
- Include test evidence (command list + outcomes).
- Include doc updates for any user-visible behavior changes.
- Prefer additive compatibility for API payload evolution.

## Documentation Guidelines

- User-facing behavior: `README.md`
- Architecture and subsystem detail: `CLAUDE.md`
- API contracts: `docs/api/*`
- Operations/runbooks: `docs/operations/*`
- Exploratory design work: `.explorations/<topic>/EXPLORATION.md`
- Local archive notes (untracked): `.local-exclude/docs-historical/*`

## Security

If you find a security vulnerability, do not open a public issue first. Follow `SECURITY.md`.
