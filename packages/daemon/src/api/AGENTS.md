# AGENTS.md (api)

Local guidance for `packages/daemon/src/api/*`.

## Scope
- Applies to HTTP routes, WebSocket protocol handling, input validation, auth boundaries, and API contract behavior.
- Follow root `AGENTS.md` first; this file adds API-specific constraints.

## Local Invariants
- Preserve endpoint validation and status-code semantics unless a contract change is intentional and documented.
- Keep hook endpoint authentication enforced (`X-CodePiper-Secret`) in daemon server paths.
- Preserve no-hook provider policy preflight on all terminal input channels:
  - HTTP `send`/`keys`
  - WebSocket `pty_input`/`pty_key`/`pty_paste`
- Keep security controls intact:
  - request size limits,
  - WS message validation/rate limiting,
  - auth/CSRF/session checks where applicable.
- Keep API payload evolution additive when possible; avoid breaking CLI/web consumers.
- Do not introduce secret logging in route or server handlers.

## Change Expectations
1. Identify route(s) and contract surface impacted.
2. Implement the smallest safe fix.
3. Update tests for status codes, payload shape, and edge paths.
4. If API behavior changes, update docs under `docs/api/*` in the same change.

## Verification (Minimum)
- `bun test packages/daemon/src/api`

## Verification (When Relevant)
- Hook contract/auth changes:
  - `bun test packages/daemon/src/api/hooks.test.ts`
  - `bun test packages/daemon/src/api/hooks.permission.test.ts`
  - `bun test packages/daemon/src/api/hooks.integration.test.ts`
- Input policy routing changes:
  - `bun test packages/daemon/src/api/routes.inputPolicy.test.ts`
- WebSocket protocol/limits changes:
  - `bun test packages/daemon/src/api/ws.test.ts`
  - `bun test packages/daemon/src/api/server.test.ts`
- Route contract changes (policies/workflows/settings/workspaces/env-sets):
  - `bun test packages/daemon/src/api/policyRoutes.test.ts`
  - `bun test packages/daemon/src/api/policySetRoutes.test.ts`
  - `bun test packages/daemon/src/api/workflowRoutes.test.ts`
  - `bun test packages/daemon/src/api/settingsRoutes.test.ts`
  - `bun test packages/daemon/src/api/workspaceRoutes.test.ts`
  - `bun test packages/daemon/src/api/envSetRoutes.test.ts`
