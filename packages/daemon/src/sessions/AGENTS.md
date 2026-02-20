# AGENTS.md (sessions)

Local guidance for `packages/daemon/src/sessions/*`.

## Scope
- Applies to session lifecycle, tmux/PTY integration, transcript ingestion, and policy evaluation internals.
- Follow root `AGENTS.md` first; this file adds stricter local rules.

## Local Invariants
- Preserve session lifecycle correctness across create, adopt, resume, stop, kill, and natural exit.
- Preserve cleanup behavior on teardown paths:
  - stop transcript tailers and update offsets safely,
  - remove in-memory session state,
  - clean secret-bearing runtime artifacts.
- Keep environment hardening intact:
  - no sensitive env leakage into tmux sessions,
  - billing-mode key scrubbing behavior must remain correct.
- Keep transcript processing crash-resilient:
  - byte-offset correctness and resume behavior must not regress.
- Keep policy evaluation deterministic:
  - priority and first-match semantics,
  - fallback/default action behavior.
- Use `tmux resize-window` behavior; do not switch resize semantics that break detached sessions.

## Change Expectations
1. Reproduce or explain the behavior with file references.
2. Make the smallest safe fix in this subtree.
3. Add or update tests in this subtree for changed behavior.
4. If behavior affects API contracts, sync with `packages/daemon/src/api/AGENTS.md`.

## Verification (Minimum)
- `bun test packages/daemon/src/sessions`

## Verification (When Relevant)
- Session manager changes:
  - `bun test packages/daemon/src/sessions/sessionManager.test.ts`
  - `bun test packages/daemon/src/sessions/sessionManager.ws.test.ts`
  - `bun test packages/daemon/src/sessions/sessionManager.inputQueue.test.ts`
- Tmux integration changes:
  - `bun test packages/daemon/src/sessions/tmuxSession.test.ts`
- Transcript pipeline changes:
  - `bun test packages/daemon/src/sessions/transcriptTailer.test.ts`
  - `bun test packages/daemon/src/sessions/transcriptManager.test.ts`
  - `bun test packages/daemon/src/sessions/transcriptRecovery.test.ts`
- Policy engine changes:
  - `bun test packages/daemon/src/sessions/policyEngine.test.ts`
  - `bun test packages/daemon/src/sessions/policyMatcher.test.ts`
