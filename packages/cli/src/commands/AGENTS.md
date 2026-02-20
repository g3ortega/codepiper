# AGENTS.md (cli commands)

Local guidance for `packages/cli/src/commands/*`.

## Scope
- Applies to CLI command behavior, daemon API integration, output/error UX, and command-level compatibility.
- Follow root `AGENTS.md` first; this file adds command-surface constraints.

## Local Invariants
- Preserve CLI/API contract compatibility for existing commands and flags unless intentionally changed.
- Keep daemon Unix-socket interaction behavior stable (error handling, connection failures, response parsing).
- `hook-forward` invariants:
  - require expected `CODEPIPER_*` environment variables,
  - preserve permission decision normalization (`allow|deny|ask` + legacy compatibility),
  - keep stdout behavior strict (no noisy output; `ask` should remain silent),
  - preserve deny exit-code semantics.
- `logs` invariants:
  - keep query parameter compatibility with daemon routes,
  - preserve follow/tail behavior and output format expectations.
- Never print secrets in CLI logs/errors.

## Change Expectations
1. Reproduce command behavior change with exact command examples.
2. Make the smallest safe fix.
3. Add/update command tests in the same change.
4. If API contract assumptions change, coordinate updates in `packages/daemon/src/api/*` and docs.

## Verification (Minimum)
- `bun test packages/cli/src/commands`

## Verification (When Relevant)
- Hook-forward changes:
  - `bun test packages/cli/src/commands/hook-forward.test.ts`
- Logs changes:
  - `bun test packages/cli/src/commands/logs.test.ts`
- Session I/O command changes:
  - `bun test packages/cli/src/commands/send.test.ts`
  - `bun test packages/cli/src/commands/keys.test.ts`
  - `bun test packages/cli/src/commands/start.test.ts`
  - `bun test packages/cli/src/commands/attach.test.ts`
  - `bun test packages/cli/src/commands/sessions.test.ts`
