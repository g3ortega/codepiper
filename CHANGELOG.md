# Changelog

All notable changes to CodePiper are documented here.

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-02-21

### Added
- Added `test:onboarding-smoke` scenario test to validate first-run auth onboarding end-to-end (bootstrap password, MFA setup, and final authenticated state).
- Added onboarding smoke coverage to release smoke gate to catch onboarding regressions before publishing.

### Fixed
- Fixed MFA setup screen retry/race behavior that could leave onboarding stuck on “Generating authenticator QR code...”.
- Improved setup page MFA retry behavior so failed attempts can be retried cleanly without refresh.

## [0.2.0] - 2026-02-21

### Added
- First-run bootstrap password flow for web onboarding when no password exists.
- CLI password rotation generator (`codepiper auth reset-password --generate`).
- Onboarding-aware auth status signals (`onboardingPending`) across daemon and web auth state.

### Changed
- Enforced MFA-first onboarding flow for initial web sign-in.
- Improved onboarding and production docs for bootstrap password, remote origin allowlisting, and CSRF/WS origin controls.
- Updated setup/login UI copy and recovery flow for clearer first-run guidance.

### Fixed
- Added QR generation timeout with manual-key fallback to prevent MFA setup hangs on constrained VPS environments.
- Hardened MFA setup handling in API/UI paths with explicit failure and retry behavior.

## [0.1.4] - 2026-02-20

### Fixed
- Normalized npm `bin` path (`bin/codepiper`) to prevent npm publish auto-correction.

## [0.1.3] - 2026-02-20

### Fixed
- Hardened npm trusted-publishing workflow to avoid stale auth token bleed in CI.
- Added a valid top-level CLI `bin` shim (`bin/codepiper`) for npm compatibility.
- Improved package metadata description for npm listing clarity.

### Changed
- Expanded release checklist with Bun manual publish notes and npm-vs-GitHub-registry guidance.
