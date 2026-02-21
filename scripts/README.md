# Scripts Directory

This directory contains test scripts and utilities for the CodePiper project.

## Structure

- **tests/** - Test scripts for validation and verification
- **utils/** - Utility scripts for maintenance and operations
- **bench/** - Benchmark scripts for transport and performance experiments

## Test Scripts

### Validation Tests
- `critical-analysis.ts` - Comprehensive critical path testing
- `input-validation.ts` - API input validation tests
- `session-cleanup.ts` - Database cleanup verification
- `stress-test.ts` - Stress testing and resource leak detection

### Integration Tests
- `e2e-claude-code.ts` - End-to-end Claude Code integration test
- `e2e.ts` - General end-to-end test
- `sqlite-eventbus-integration.ts` - SQLite EventBus integration test
- `onboarding-smoke.ts` - From-scratch auth onboarding smoke (bootstrap password -> login -> MFA setup -> MFA verify)

## Benchmark Scripts

- `bench/ws-transport-bench.ts` - Compares WebSocket full-frame, patch, and binary transport modes, plus runtime-comparable latency probes (`key->echo`, `scroll->paint`, `reconnect->resync`)
  - Optional `--bun-pty-prototype` runs an experimental Bun-native PTY throughput probe (non-default, benchmark-only).

## Utility Scripts

- `cleanup-zombie-sessions.sh` - Manual cleanup of zombie tmux sessions
- `E2E_PERMISSION_TEST.sh` - Permission testing script

## Release and Packaging Scripts

- `check-packaging.mjs` - Tarball allowlist/size guard (`bun run pack:check`, `bun run pack:check:fast`)
- `pack-runtime-smoke.mjs` - Isolated npm tarball install + CLI runtime smoke (`bun run pack:smoke`, `bun run pack:smoke:fast`) (requires npm registry connectivity)
- `release-smoke.sh` - Full release preflight (format/lint/type/test/security/build/pack checks)

## Running Tests

```bash
# From project root
bun run scripts/tests/critical-analysis.ts
bun run scripts/tests/stress-test.ts
bun run scripts/tests/input-validation.ts

# All tests
bun run scripts/tests/critical-analysis.ts && \
bun run scripts/tests/stress-test.ts && \
bun run scripts/tests/input-validation.ts && \
bun run scripts/tests/session-cleanup.ts

# Transport benchmark
bun run bench:ws-transport

# Include runtime telemetry snapshot correlation (single snapshot or full
# `window.__codepiperTerminalTransportTelemetry` JSON export)
bun run bench:ws-transport -- --runtime-telemetry ./tmp/terminal-telemetry.json

# Emit machine-readable JSON summary
bun run bench:ws-transport -- --json

# Persist a versioned benchmark artifact with git metadata
bun run bench:ws-transport:artifact

# Persist artifact to a custom directory/label
bun run bench:ws-transport -- --artifact-dir ./benchmarks/ws-transport --artifact-label nightly

# Include experimental Bun PTY prototype probe
bun run bench:ws-transport:bun-pty-prototype
```

## Utility Usage

```bash
# Cleanup zombie sessions
bash scripts/utils/cleanup-zombie-sessions.sh

# Permission test
bash scripts/utils/E2E_PERMISSION_TEST.sh
```
