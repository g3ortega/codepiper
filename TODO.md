# TODO

Planned work and known improvements for CodePiper.

## Web Dashboard

- [ ] E2E tests (Playwright)
- [ ] Virtual scrolling for large session lists (if needed beyond pagination)
- [ ] Accessibility audit (keyboard navigation, ARIA, screen reader)
- [ ] Export analytics to CSV
- [ ] Workflow execution sequence visualization
- [ ] Monaco editor for workflow YAML/JSON editing
- [ ] Visual policy rule builder

## Notifications

- [x] Add "Send test notification" action (daemon endpoint + settings button) for end-to-end push/system validation

## Session Management

- [ ] Configurable cleanup schedule (periodic, not just on daemon startup)
- [ ] Per-session "writable roots" (restrict file access scope)
- [ ] Denylist patterns for `.env`, secrets, credentials
- [ ] Session tagging and search

## Infrastructure

- [ ] `/metrics` endpoint for Prometheus monitoring
- [x] Health check includes zombie session count
- [ ] Docker containerization
- [x] CI quality + security pipeline (GitHub Actions)
- [x] Production deployment guide
- [ ] Release workflow dry-run + first publish validation
- [x] Linux arm64 CI smoke path
- [x] npm Trusted Publishing (OIDC) migration (remove long-lived NPM token)
- [x] CONTRIBUTING.md

## Testing

- [ ] E2E tests with real Claude Code instance (requires API key)
- [ ] Load testing for concurrent sessions

## Performance

- [ ] Tmux control mode for structured output (replace capture-pane polling)
- [ ] WebSocket-based terminal streaming (replace HTTP polling)
- [ ] Reduce process spawns per poll tick (currently ~10/sec/session)
- [ ] Connection pooling for multi-session scenarios

## Documentation

- [x] API reference with request/response examples (`docs/api/`)
- [x] Architecture diagrams (`docs/architecture/`)
- [x] Troubleshooting guide
- [x] FAQ
