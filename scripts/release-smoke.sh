#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[release-smoke] install dependencies (frozen lockfile)"
bun install --frozen-lockfile

run_step() {
  local step="$1"
  echo "[release-smoke] run: $step"
  bun run "$step"
}

run_step format:check
run_step lint
run_step typecheck
run_step typecheck:strict
run_step test
if [[ "${RUN_ONBOARDING_SMOKE:-0}" == "1" ]]; then
  run_step test:onboarding-smoke
else
  echo "[release-smoke] skip: test:onboarding-smoke (set RUN_ONBOARDING_SMOKE=1 to enable)"
fi
run_step security:secrets
run_step build:web
run_step pack:check:fast
run_step pack:smoke:fast

echo "[release-smoke] verify CLI help"
bun run cli --help >/dev/null

echo "[release-smoke] all checks passed"
