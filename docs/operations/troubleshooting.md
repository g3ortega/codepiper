# Troubleshooting

This guide covers the most common install/runtime problems for CodePiper on Linux and macOS.

## Fast Triage

Run these first:

```bash
codepiper doctor
codepiper daemon status
```

If the daemon is running with web enabled, also check:

```bash
curl -sS http://127.0.0.1:3000/api/health
```

## Install and Runtime Basics

### `codepiper` installed but command fails with `/usr/bin/env: bun: No such file or directory`

Cause: npm installed CodePiper, but Bun is not installed locally.

Fix:

```bash
curl -fsSL https://bun.sh/install | bash
bun --version
```

Then retry:

```bash
codepiper doctor
```

### `tmux command not found` or sessions fail to start

Cause: tmux is missing.

Fix:

```bash
# Debian/Ubuntu
sudo apt-get update && sudo apt-get install -y tmux

# Fedora/RHEL
sudo dnf install -y tmux

# Alpine
sudo apk add tmux

# macOS (Homebrew)
brew install tmux
```

Verify:

```bash
tmux -V
```

### `Socket /tmp/codepiper.sock is already in use`

Cause: another daemon is already running, or a stale socket exists.

Fix:

```bash
codepiper daemon stop
codepiper daemon status
```

If status still shows stopped but socket remains, start again:

```bash
codepiper daemon
```

CodePiper will remove stale sockets safely when possible.

### Daemon starts but web UI is blank/missing assets

Cause: source checkout without built web assets.

Fix (source installs only):

```bash
bun run build:web
codepiper daemon --web
```

For npm installs, `packages/web/dist` is expected to already be packaged.

## Provider Issues

### `claude` or `codex` not found

Cause: provider CLI is not installed in PATH.

Fix:

- Claude Code: <https://code.claude.com/docs/en/installation>
- Codex CLI: <https://developers.openai.com/codex>

Then rerun:

```bash
codepiper doctor
```

### Session appears stuck after daemon restart

Try recovery:

```bash
codepiper sessions
```

Then use the **Recover** action in the web session UI for that session ID.

If tmux runtime no longer exists, start a new session.

## Notifications and Push

### Push test says `0/1 subscriptions reached` or `failed`

Check all of the following:

1. `CODEPIPER_PUSH_ENABLED=1` is set for daemon.
2. Both `CODEPIPER_PUSH_PUBLIC_KEY` and `CODEPIPER_PUSH_PRIVATE_KEY` are set.
3. Web app has notification permission granted.
4. Browser/device supports Web Push in current context.
5. Deployment is HTTPS (or local `localhost` context for local testing).

Inspect runtime status in **Settings → Notifications → Push delivery health**.

### iOS/iPadOS push not firing

Typical requirements:

1. App opened as a Home Screen installed web app.
2. Notifications allowed in iOS settings.
3. HTTPS origin reachable from device.

## Linux Server / VPC Access

### Remote users cannot connect directly

By default, daemon web and WS bind to `127.0.0.1` for safety.

Use one of these:

1. SSH tunnel (recommended for private ops).
2. Reverse proxy (Nginx/Caddy/Traefik) on same host to expose HTTPS.

Do not bind CodePiper directly to public interfaces without an explicit proxy/TLS/auth design.

### Reverse proxy works but terminal stream is broken

Cause: WebSocket upgrade route `/ws` is not proxied correctly.

Fix: ensure proxy forwards both HTTP `/api/*` and WebSocket `/ws` with upgrade headers.

See: `docs/operations/production-deployment.md`.

## Auth and Onboarding

### Onboarding loops or blocks login

New installs require both:

1. Password setup
2. MFA (TOTP) setup + verify

MFA reset is CLI-only:

```bash
codepiper auth reset-mfa
```

## Still Blocked?

Collect this before opening an issue:

```bash
codepiper doctor
codepiper daemon status
bun --version
tmux -V
```

Include your platform + architecture (for example `linux/arm64` or `linux/x64`).
