# Architecture Enhancements Backlog

This file tracks near-term architecture hardening items that improve publish readiness without large rewrites.

## 1. Provider Capability-Driven UX (In Progress)

Goal:
- Ensure session-level UI reflects provider capabilities from daemon metadata.

Status:
- Session detail tabs are now capability-aware (`logs/events` hidden when provider lacks hook/transcript channels).
- Shared web fallback capability catalog introduced to reduce drift.

Next:
- Expand capability gating to additional provider-specific actions if new providers add differentiated feature sets.

## 2. Documentation Drift Reduction (In Progress)

Goal:
- Keep architecture docs factual and source-of-truth linked.

Actions:
- Keep deep behavior in `CLAUDE.md`.
- Keep user-facing flows in `README.md`.
- Keep API payload contracts in `docs/api/*`.
- Keep this file focused on actionable enhancement backlog only.

## 3. Coverage Hardening for Publish-Critical Routes (Planned)

Current coverage is healthy overall, but these route groups are relatively under-covered and should be improved:
- `packages/daemon/src/api/gitRoutes.ts`
- `packages/daemon/src/api/terminalRoutes.ts`
- `packages/daemon/src/api/validationRoutes.ts`

Priority:
- Add contract tests for edge/error semantics before broad external adoption.

## 4. Packaging Smoke Validation (In Progress)

Goal:
- Add deterministic smoke checks that validate npm tarball runtime assumptions (Bun present, web dist included, CLI entrypoint resolves correctly).

Status:
- Added `pack:smoke` / `pack:smoke:fast` scripts (`scripts/pack-runtime-smoke.mjs`) that:
  - build and pack the npm tarball,
  - install it in an isolated global prefix,
  - verify packaged web assets exist,
  - execute installed `codepiper` CLI help flows.
- Wired into `release:smoke` via `pack:smoke:fast`.

Next:
- Add an optional CI lane that runs `pack:smoke:fast` in a network-enabled environment before publish.

## 5. Provider Onboarding Documentation (In Progress)

Goal:
- Make adding a new TUI straightforward and predictable.

Deliverables:
- Provider capability contract doc.
- Step-by-step checklist for daemon/web/CLI integration and required tests.
- Explicit mapping of capability flags to visible UI affordances.

## 6. Theme Extension Verification (Planned)

Goal:
- Keep adding themes easy while preserving readability/accessibility.

Actions:
- Add lightweight visual QA checklist for contrast, terminal palette parity, and component surface opacity across themes.
