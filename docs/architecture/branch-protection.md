# Branch Protection Baseline

Use these GitHub branch protection settings before public release.

## Target Branches

- `main`
- `master` (if still used)

## Required Rules

- Require pull request before merging
- Require at least 1 approving review
- Dismiss stale pull request approvals when new commits are pushed
- Require status checks to pass before merging
- Require branches to be up to date before merging
- Restrict force pushes
- Prevent branch deletion

## Required Status Checks

- `quality` (from `.github/workflows/ci.yml`)

## Recommended Rules

- Require conversation resolution before merging
- Require signed commits (if your org enforces commit signing)
- Restrict direct pushes to administrators only when possible

## Verification

After configuring rules, open a test pull request and confirm:

- Merge is blocked when `quality` fails
- Merge is blocked without an approval
- Merge is blocked when branch is behind base
