# AGENTS.md

Operational guidance for coding agents working in this repository.

## Scope
- Root guidance for the whole monorepo.
- Follow the nearest `AGENTS.md` in the active working directory path.
- If custom fallback doc names (for example `AGENTS.override.md`) are configured in Codex settings, treat those as additional instruction files.
- Keep this file focused on durable rules and verification commands, not long architecture prose.

## What Goes Where
- `AGENTS.md` (root): durable workflow rules, non-negotiable invariants, and verification expectations.
- `CLAUDE.md`: architecture detail, subsystem behavior, and deep implementation context.
- `README.md`: user-facing behavior, setup, and CLI usage.
- `docs/api/*`: endpoint contracts and payload examples.
- `.explorations/*`: design research, alternatives, and trade-off writeups.
- Do not duplicate large endpoint lists or volatile implementation detail in root `AGENTS.md`.

## First Steps
1. Read `CLAUDE.md` for architecture, constraints, and conventions.
2. Read `README.md` for user-facing behavior and CLI/API expectations.
3. Check `git status --short` and do not revert unrelated user changes.
4. Identify impacted package(s): `packages/daemon`, `packages/cli`, `packages/web`, `packages/core`, `packages/providers/*`.
5. If work is exploratory, create/update `.explorations/<topic>/EXPLORATION.md`.

## Engineering Priorities
1. Security and data-leak prevention.
2. Session lifecycle correctness and crash resilience.
3. API/CLI contract consistency.
4. Backward compatibility for existing behavior.
5. Code clarity and test coverage for changed paths.

## Architecture Pointers
- Runtime center: `packages/daemon/src/main.ts`, `packages/daemon/src/api/server.ts`.
- Session lifecycle authority: `packages/daemon/src/sessions/sessionManager.ts`.
- DB and schema authority: `packages/daemon/src/db/db.ts`, `packages/daemon/src/db/schema.sql`.
- Provider capabilities and policy channel behavior: `packages/daemon/src/providers/registry.ts`.
- For full architecture context, read `CLAUDE.md` before non-trivial changes.

## Non-Negotiable Invariants
- Never log secrets (`ANTHROPIC_API_KEY`, hook secrets, decrypted env vars, auth secrets).
- Preserve billing-mode isolation (`subscription` must not leak API keys to sessions).
- Keep hook auth mandatory (`X-CodePiper-Secret`) and hook payload validation strict.
- In daemon server paths, do not allow unauthenticated hook ingestion.
- Preserve permission decision compatibility (`allow|deny|ask`, including legacy compatibility behavior where applicable).
- Maintain no-hook provider policy enforcement on input channels (`send`/`keys` and WS input paths).
- Preserve session cleanup semantics for stop/kill/natural exit and restart adoption paths.
- Use parameterized DB queries only; keep FK and migration behavior intact.
- Keep endpoint validation and status code behavior consistent unless explicitly changing the contract.
- Prefer additive compatibility when changing API payload shapes.

## High-Risk Areas (Review Carefully)
- `packages/daemon/src/sessions/`
- `packages/daemon/src/api/hooks.ts`
- `packages/daemon/src/auth/`
- `packages/daemon/src/db/`
- `packages/cli/src/commands/hook-forward.ts`
- `packages/cli/src/commands/logs.ts`

## Required Delivery Pattern
1. Reproduce or verify the issue with code references.
2. Implement the smallest safe fix that solves root cause.
3. Add/adjust tests in the same change.
4. Run targeted tests first, then broader package checks.
5. Summarize exactly what changed, what was verified, and what remains.

## Verification Commands

### Core gate
- `bun run format:check`
- `bun run lint`
- `bun run typecheck`
- `bun run typecheck:strict`
- `bun test`
- `bun run check` (full gate; use for broad or high-risk changes)

### Targeted areas
- Sessions/policy/transcripts:
  - `bun test packages/daemon/src/sessions`
- API/hooks/routes:
  - `bun test packages/daemon/src/api`
- Auth/security:
  - `bun test packages/daemon/src/auth`
- DB/persistence:
  - `bun test packages/daemon/src/db`
- CLI commands:
  - `bun test packages/cli/src/commands/hook-forward.test.ts`
  - `bun test packages/cli/src/commands/logs.test.ts`
- Web changes:
  - `bun run --cwd packages/web lint`
  - `bun run --cwd packages/web build`

### Scenario/ops scripts (when relevant)
- See `scripts/README.md` for scenario, stress, and integration scripts.
- Run relevant scripts from `scripts/tests/*` when changing behavior those scripts cover.

## Known Gotchas to Preserve
- Hook stdout can become model context in some flows; do not print noisy output from hook-forward paths.
- Use `tmux resize-window` (not `resize-pane`) for detached-session correctness.
- Preserve terminal newline handling required by xterm rendering paths.

## Exploration Workflow (Required)
- Use `.explorations/<topic>/EXPLORATION.md` for exploratory or design-heavy work.
- Keep explorations independent per topic (kebab-case directory names).
- Include:
  - Problem statement and scope.
  - Evidence (files/tests/commands observed).
  - Options and trade-offs.
  - Chosen approach and rollback/risk notes.
  - Clear “ready for implementation” criteria.
- When exploration graduates to implementation, reference it in the change summary/PR and keep docs aligned.

## Documentation Hygiene
- If behavior changes, update related docs/tests in the same PR.
- Keep `README.md` and `CLAUDE.md` consistent with real behavior.
- For API changes, update docs under `docs/api/` in the same change.
- Use visual aids when they improve clarity:
  - Prefer ASCII diagrams for simple/local flows.
  - Use Mermaid for complex, multi-actor, or stateful flows.

## Optional Scoped Guidance
- If root instructions grow too large, split subsystem-specific rules into local `AGENTS.md` files near:
  - `packages/daemon/src/sessions/`
  - `packages/daemon/src/api/`
  - `packages/cli/src/commands/`
- Keep local files short and focused on local invariants and test commands.
