# Production Deployment Guide

This guide is for Linux/macOS hosts running CodePiper for day-to-day use with reliable startup, HTTPS access, and push support.

## 1) Platform and Architecture Targets

CodePiper target matrix:

| OS | Architecture | Status |
|----|--------------|--------|
| Linux | `x64` | Supported |
| Linux | `arm64` | Supported |
| macOS | `arm64` | Supported |
| macOS | `x64` | Supported |

Notes:

- Windows should run through WSL.
- Bun compatibility follows Bun upstream platform support.
- CI smoke currently runs on `ubuntu-latest` (Linux x64) and `macos-14` (Apple Silicon).
- Run the validation checklist in section 11 on additional target architectures before each release.

## 2) Runtime Dependencies

Required:

- Bun `>=1.3.5`
- tmux `>=3.0`
- At least one provider CLI: `claude` and/or `codex`

Optional:

- `git` for Git routes/worktree features
- HTTPS + VAPID keys for cross-device push notifications

## 3) Install Paths (npm vs source)

### Recommended: npm global install

```bash
npm i -g codepiper
codepiper doctor
```

Important:

- npm package includes CodePiper files and prebuilt web assets.
- Bun runtime is required on host and is not bundled.

### Source install (contributors/dev)

```bash
bun install
bun link
bun run build:web
codepiper doctor
```

## 4) Production Topology

Keep daemon bound to localhost and expose through a reverse proxy:

```text
Internet / LAN
    |
    v
TLS Reverse Proxy (Nginx/Caddy/Traefik)
    |
    v
127.0.0.1:3000  (codepiper daemon --web)
```

Why:

- default localhost binding is safer,
- TLS termination + headers handled in proxy,
- easier multi-device access.

## 5) Environment Variables

Core:

- `CODEPIPER_HTTP_PORT` (or `codepiper daemon --web --port`)
- `CODEPIPER_WS_PORT` (only needed for custom WS transport setups)
- `CODEPIPER_DB_PATH` (optional custom DB location)
- `CODEPIPER_SOCKET` (optional custom Unix socket path)

Security/proxy:

- `CODEPIPER_ALLOWED_ORIGINS` — comma-separated hostnames trusted for WebSocket upgrades and
  browser-originated state-changing API requests (CSRF gate). Required when the dashboard is
  accessed from a non-localhost domain (reverse proxy, Cloudflare Tunnel, etc.).
  Accepts bare hostnames (`app.example.com`) or full origins (`https://app.example.com`);
  the scheme is stripped and only the hostname is matched.
  Localhost (`127.0.0.1`, `::1`, `localhost`) is always allowed implicitly.
- `CODEPIPER_FORCE_SECURE_COOKIES=1` behind TLS-terminating proxy
- `CODEPIPER_TRUST_PROXY_HEADERS=1` when proxy forwards client IP headers and `X-Forwarded-Proto` (for secure-cookie inference)

Authentication onboarding note:

- On first startup with web enabled and no password configured, CodePiper generates a bootstrap password.
- The password is shown only when daemon stdout is a TTY (to avoid leaking secrets into service logs).
- In non-interactive service startup flows, generate/rotate from CLI:
  - `codepiper auth reset-password --generate`

How `CODEPIPER_ALLOWED_ORIGINS` protects the daemon:

```text
Browser (app.example.com)
    |
    |  Origin: https://app.example.com
    v
TLS Reverse Proxy ──────────────────────> Daemon (127.0.0.1:3000)
                                            |
                                            ├── WebSocket /ws upgrade
                                            |   └── rejectNonLocalOrigin()
                                            |       hostname ∈ {localhost, ALLOWED_ORIGINS}? ── yes → upgrade
                                            |                                                   no  → 403
                                            |
                                            └── POST/PUT/PATCH/DELETE /api/*
                                                └── rejectCrossSiteApiRequest()
                                                    Origin matches target? ── yes → allow
                                                    hostname ∈ ALLOWED_ORIGINS? ── yes → allow
                                                                                   no  → 403
```

Example — Cloudflare Tunnel to `codepiper.example.com`:

```bash
CODEPIPER_ALLOWED_ORIGINS=codepiper.example.com
CODEPIPER_FORCE_SECURE_COOKIES=1
CODEPIPER_TRUST_PROXY_HEADERS=1
```

Push (optional):

- `CODEPIPER_PUSH_ENABLED=1`
- `CODEPIPER_PUSH_PUBLIC_KEY=<base64url>`
- `CODEPIPER_PUSH_PRIVATE_KEY=<base64url>`
- `CODEPIPER_PUSH_SUBJECT=mailto:ops@example.com` (or HTTPS URL)
- `VITE_PUSH_PUBLIC_KEY` should match daemon public key for enrollment UX consistency

## 6) systemd Service (Linux)

Create `/etc/systemd/system/codepiper.service`:

```ini
[Unit]
Description=CodePiper Daemon
After=network.target

[Service]
Type=simple
User=codepiper
Group=codepiper
Environment=HOME=/home/codepiper
Environment=CODEPIPER_HTTP_PORT=3000
Environment=CODEPIPER_ALLOWED_ORIGINS=codepiper.example.com
Environment=CODEPIPER_FORCE_SECURE_COOKIES=1
Environment=CODEPIPER_TRUST_PROXY_HEADERS=1
ExecStart=/usr/local/bin/codepiper daemon --web
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now codepiper
sudo systemctl status codepiper
```

## 7) Nginx Reverse Proxy Example

Daemon env (must include the proxy hostname):

```bash
CODEPIPER_ALLOWED_ORIGINS=codepiper.example.com
CODEPIPER_FORCE_SECURE_COOKIES=1
CODEPIPER_TRUST_PROXY_HEADERS=1
```

```nginx
server {
  listen 443 ssl http2;
  server_name codepiper.example.com;

  ssl_certificate     /etc/letsencrypt/live/codepiper.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/codepiper.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /ws {
    proxy_pass http://127.0.0.1:3000/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## 8) Release/Upgrade Workflow

Recommended upgrade path:

1. `npm i -g codepiper@latest`
2. restart service (`systemctl restart codepiper`)
3. run smoke checks:

```bash
codepiper doctor
codepiper daemon status
curl -sS http://127.0.0.1:3000/api/health
```

## 9) Backup and Restore

Back up at minimum:

- `~/.codepiper/codepiper.db`
- any local environment/config files used to launch daemon

Restore by replacing DB and restarting daemon.

## 10) Security Hardening Checklist

1. Keep daemon on localhost only.
2. Require HTTPS at proxy edge.
3. Keep MFA enabled for all web users.
4. Restrict `CODEPIPER_ALLOWED_ORIGINS` to exact trusted hostnames.
5. Rotate credentials and VAPID keys via secret manager.
6. Run `bun run security:secrets` and `bun run security:deps` in CI.
7. Avoid running daemon as root.

## 11) Validation Checklist for Linux Hosts

```bash
bun --version
tmux -V
codepiper doctor
codepiper daemon --help
```

If deploying to both `linux/x64` and `linux/arm64`, run the same smoke checklist on each architecture before tagging a release.
