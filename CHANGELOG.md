# Changelog

All notable changes to CodePiper are documented here.

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
