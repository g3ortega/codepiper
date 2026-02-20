# FAQ

## Installation

### Does `npm i -g codepiper` include Bun?

No. Bun is required on the host and is not bundled in the npm tarball.

### Should I install from npm or source?

- Use npm for normal usage and production deployments.
- Use source checkout when contributing or modifying internals.

### Is Windows supported?

Direct Windows support is not primary yet. Use WSL for Windows environments.

## Platform and Architecture

### What platforms are targeted?

Current release target matrix:

| OS | Architectures |
|----|---------------|
| Linux | `x64`, `arm64` |
| macOS | `arm64`, `x64` |

CI smoke currently covers Linux x64, Linux arm64, and macOS arm64; run the deployment checklist on other target architectures before release.

### Can I run this on Linux laptops, servers, and VPCs?

Yes. Common production pattern:

1. Run `codepiper daemon --web` on Linux host.
2. Keep daemon bound to localhost.
3. Expose through TLS reverse proxy or SSH tunnel.

## Providers and Features

### Do Claude Code and Codex have the same capabilities?

No. Claude Code has native hooks/transcript features that Codex does not currently provide.

See:

- `README.md` provider capability table
- `docs/features/provider-capability-matrix.md`

### Why are some tabs/sections hidden for Codex sessions?

Capability-based UI. Features that depend on native hooks/transcripts are hidden when unsupported.

## Sessions and Data

### Where is state stored?

Default: `~/.codepiper/codepiper.db` (SQLite) plus local runtime files under `~/.codepiper/`.

### Can I keep sessions across daemon restarts?

Yes. Session preservation and adoption/recovery flows are supported.

### Can I use multiple devices?

Yes. This is a core use case:

- keep sessions running on one machine
- monitor/respond from web dashboard on another device

## Security

### Is MFA required?

Yes for onboarding in web flow: password setup plus MFA setup/verification.

### Is local API access authenticated?

Unix socket access is local-user trusted. Browser HTTP routes enforce auth when configured.

### How do I reset MFA if locked out?

Use CLI:

```bash
codepiper auth reset-mfa
```

## Notifications

### Why do in-app notifications work but push does not?

Push needs all of:

1. browser support,
2. notification permission granted,
3. daemon VAPID keys configured,
4. secure context (HTTPS or localhost).

Use **Push delivery health** in settings and `Test push` to diagnose.

## Deployment

### Is CodePiper meant for direct public internet exposure?

Not directly. Recommended:

1. keep daemon local (`127.0.0.1`),
2. front with TLS reverse proxy,
3. enforce auth + MFA,
4. keep `CODEPIPER_ALLOWED_ORIGINS` strict.

See `docs/operations/production-deployment.md`.
