# Security Policy

## Supported Versions

Security fixes are applied to the latest development line.

| Version | Supported |
|---------|-----------|
| `main`  | Yes |
| older branches/tags | No |

## Reporting a Vulnerability

Please report vulnerabilities privately using GitHub Security Advisories:

- Go to `Security` tab in the repository
- Click `Report a vulnerability`
- Include reproduction steps, impact, and affected paths

Do not open a public issue for undisclosed vulnerabilities.

## What We Treat as Security-Sensitive

- Authentication/session handling (`packages/daemon/src/auth`)
- Hook ingestion and secret validation (`packages/daemon/src/api/hooks.ts`)
- Policy enforcement and audit paths (`packages/daemon/src/sessions`, `packages/daemon/src/api/inputPolicy.ts`)
- Encrypted env storage and secret handling (`packages/daemon/src/crypto`)
- Database migrations and integrity constraints (`packages/daemon/src/db`)

## Built-in Security Checks

Run locally:

```bash
bun run security:secrets
bun run security:deps
```

CI enforces:

- Dependency vulnerability scanning (`bun run security:deps`)
- Secret leak scanning (`bun run security:secrets`)
- Format/lint/type/test/build gates
- Packaging allowlist verification (`bun run pack:check:fast`)

## Secure Development Expectations

- Never log plaintext secrets or credentials.
- Keep hook authentication (`X-CodePiper-Secret`) mandatory.
- Preserve policy semantics (`allow|deny|ask`) and no-hook provider input preflight checks.
- Prefer additive API changes and strict request validation.
