# Provider Extensibility Guide

This guide documents the recommended path to add a new TUI/provider to CodePiper.

## Design Principles

1. Capability-first, not provider-name-first.
2. Additive compatibility for API payloads.
3. Keep unsupported features hidden/disabled in UI.
4. Keep provider defaults centralized to avoid drift.

```text
Provider registry capabilities
        |
        v
   GET /providers  ---> web capability helpers ---> session/create UI gating
        |
        '------> daemon contract tests
                     \
                      '-> web capability tests
```

## Capability Contract

Source of truth:
- `packages/daemon/src/providers/registry.ts`
- `GET /providers` route (`packages/daemon/src/api/routes.ts`)

Current capability fields:
- `nativeHooks`
- `supportsDangerousMode`
- `supportsModelSwitch`
- `supportsTranscriptTailing`
- `supportsTmuxAdoption`
- `policyChannel` (`native-hooks|input-preflight|none`)
- `metricsChannel` (`transcript|pty|none`)

Provider launch hint fields (for UX previews, still daemon-owned):
- `launchHints.dangerousModeFlags` (provider-native dangerous flags)
- `launchHints.resumeCommands.resume` (template with `{id}`)
- `launchHints.resumeCommands.fork` (optional template with `{id}`)
- `launchHints.resumeCommands.idPlaceholder` (optional session-id placeholder)

When adding a provider, define these fields first and treat them as your behavioral contract.

## Core Provider Typing Strategy

CodePiper separates known runtime providers from API-facing extensibility:

- `KnownProviderId` - compile-time provider IDs currently shipped (`claude-code`, `codex`).
- `ProviderId` - `KnownProviderId | string` shape for forward-compatible payloads and UI metadata.

Practical effect:
- Daemon runtime registry stays strict to known providers.
- Web/API typing can safely carry future provider IDs without breaking builds.

```text
Capability contract ownership
-----------------------------
Backend truth: daemon registry + /providers payload
Frontend fallback: providerCapabilities.ts (safe defaults only)
Behavior control: capability flags, not provider-name checks
```

## Backend Integration Steps

1. Add provider ID to core provider list.
2. Add provider definition to daemon registry:
- runtime type
- capability object
- command build logic
- optional prepare/cleanup behavior

3. Wire provider-specific session lifecycle behavior in session manager (if needed).
4. Enforce capability-driven API behavior:
- return clear `409` for unsupported operations (for example model switching).

5. Add route/manager tests for:
- create/start/stop/resume/recover
- capability-gated operations
- policy behavior for hook vs no-hook channels

## Web Integration Steps

1. Add visual presentation entry (`packages/web/src/lib/providerPresentation.ts`).
2. Update fallback provider metadata in one place:
- `packages/web/src/lib/providerCapabilities.ts`

3. Ensure UI uses capabilities, not static provider checks:
- Create-session options
- Session detail tabs/actions
- Feature flags and copy

4. Verify unknown providers degrade safely:
- readable label fallback
- conservative capabilities fallback (hide unsupported surfaces)

```text
Provider ID -> getProviderInfo
  - known provider   -> server/fallback capabilities
  - unknown provider -> conservative safe capabilities
Both paths -> getSessionDetailTabsByCapabilities -> render supported surfaces only
```

## Capability-to-UX Mapping (Current)

Session detail tabs (`packages/web/src/pages/SessionDetailPage.tsx`):
- Always: `terminal`, `git`, `policies`
- Only when provider has hooks/transcript channel: `logs`, `events`

Create session dialog (`packages/web/src/components/sessions/CreateSessionDialog.tsx`):
- Dangerous mode toggle enabled only when `supportsDangerousMode=true`.
- Dangerous/resume command previews sourced from `launchHints` (not provider ID checks).
- Provider messaging derived from capability profile.

## Testing Checklist

Minimum:
- `bun test packages/daemon/src/providers`
- `bun test packages/daemon/src/api`
- `bun test packages/daemon/src/sessions`
- `bun test packages/web/src/lib/providerCapabilities.test.ts`
- `bun run --cwd packages/web build`

Full gate before publish:
- `bun run check`
- `bun run pack:check`
- `bun run security:check`

## Common Pitfalls

- Hard-coding provider IDs in UI for behavior decisions.
- Duplicating fallback capability definitions in multiple components.
- Exposing features that provider cannot support (confusing UX).
- Forgetting capability contract tests when adding/changing fields.
