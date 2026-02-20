# Release Checklist

Maintainer checklist for shipping a new `codepiper` npm release safely.

## Scope

Use this checklist for any public npm release from `main`.

## 1) Pre-Release (Local)

1. Confirm clean tree:

```bash
git status --short
```

2. Ensure version/changelog are ready:

- Update `package.json` version (`codepiper` package version).
- Update `CHANGELOG.md` with release notes.

3. Run the full gate:

```bash
bun run check
bun run --cwd packages/web build
bun run security:check
bun run pack:check
bun run pack:smoke
```

4. Validate install paths in a clean environment:

- npm global install path
- source checkout path

5. Validate target architectures before publishing:

- Linux `x64` (required)
- Linux `arm64` (required)
- macOS `arm64` (required)

Minimum smoke commands per target:

```bash
bun --version
tmux -V
codepiper doctor
codepiper daemon --help
```

## 2) Git Preparation

1. Merge release-ready changes into `main`.
2. Tag release:

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

Tag push triggers `.github/workflows/release.yml` preflight + package artifact.

## 3) GitHub Release Workflow

Manual publish flow:

1. Open **Actions → Release**.
2. Run workflow:
   - `publish_to_npm`: `true`
   - `npm_dist_tag`: `latest` (or `next` for canary)
3. Ensure jobs pass:
   - `preflight`
   - `package`
   - `publish-npm`

The workflow uploads the npm tarball artifact + SHA256.

## 4) Post-Publish Validation

1. Verify published version:

```bash
npm view codepiper version
```

2. Validate fresh install from npm:

```bash
npm i -g codepiper@X.Y.Z
codepiper doctor
```

3. Start daemon and run smoke:

```bash
codepiper daemon --web
```

4. Confirm docs/version links if needed (README, changelog, release notes).

## 5) Rollback / Incident Response

If release is bad:

1. Do **not** unpublish stable versions unless absolutely necessary.
2. Deprecate bad version:

```bash
npm deprecate codepiper@X.Y.Z "Critical issue: use >=X.Y.Z+1"
```

3. Ship a hotfix patch (`X.Y.Z+1`) with explicit notes.
4. If tag was pushed in error and package not published, remove tag:

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
```

## 6) Release Workflow Requirements

Repository settings needed for npm publish job:

1. npm package is configured with a **Trusted Publisher** for this repository/workflow.
2. Publish job keeps `id-token: write` permission enabled.
3. Optional protected environment `npm-publish` for manual approval.
4. Branch protection on `main` with CI required checks.

## 7) Notes

- Bun is required on the host; npm package does not bundle Bun runtime.
- Keep `packages/web/dist` healthy in release checks (packaging guard enforces this).
- Runtime tarballs intentionally exclude demo/example sources (`*.example.ts`, `**/example.ts`, `**/demo.ts`).
- Trusted publishing runtime must satisfy: Node `>=22.14.0`, npm `>=11.5.1`.
- `pack:smoke` requires npm registry connectivity to resolve package dependencies.
- If platform support changes, update:
  - `README.md` platform matrix
  - `docs/operations/faq.md`
  - `docs/operations/production-deployment.md`
