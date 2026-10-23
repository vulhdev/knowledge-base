---
name: knowledge-base:release-beta
description: Release a beta version of the package from the dev branch. Use when the user says "release beta", "tạo bản beta", "publish beta", or wants to ship the current dev state for testing before merging to main.
---

# knowledge-base:release-beta

Publish a beta release from the `dev` branch to npm with the `beta` dist-tag and create a GitHub pre-release.

## Prerequisites

- Must be on the `dev` branch
- `NPM_TOKEN` secret must be set on the repository
- Working directory must be clean (no uncommitted changes)

## Steps

### 1. Verify branch

```bash
git branch --show-current
```

If not on `dev`, stop and tell the user: "Beta releases must be cut from the `dev` branch. Switch to `dev` first."

### 2. Ensure dev is up to date

```bash
git fetch origin
git status
```

If behind `origin/dev`, ask: "Your local `dev` is behind remote. Pull first? (`git pull origin dev`)"

### 3. Determine the next beta version

Read the current version from `package.json`.

Apply this logic:
- If current version is `x.y.z` (stable) → next beta is `x.y.(z+1)-beta.1`
- If current version is `x.y.z-beta.N` → next beta is `x.y.z-beta.(N+1)`

Show the proposed version to the user and ask for confirmation before proceeding.

### 4. Bump version

```bash
npm version <proposed-version> --no-git-tag-version
```

Then stage and commit:

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to <version>"
```

### 5. Tag and push

```bash
git tag -a v<version> -m "v<version>"
git push origin dev --follow-tags
```

Use `-a` (annotated tag) so that `--follow-tags` includes the tag in the same push as the branch. This sends one atomic push event to GitHub, preventing duplicate workflow runs.

### 6. Wait for CI

The `Release Beta` GitHub Actions workflow will trigger automatically on the `v*-beta*` tag and will:
- Run lint + tests + build
- Publish to npm with `--tag beta`
- Create a GitHub pre-release

Tell the user: "Tag pushed. CI is running — monitor at: `https://github.com/<owner>/<repo>/actions`"

### 7. Verify publish

After CI completes, confirm the beta is live:

```bash
npm dist-tag ls @vulhdev/knowledge-base
```

Expected output should include:
```
beta: <version>
latest: <stable-version>
```

## Installing the beta

Users can install the beta with:

```bash
npm install @vulhdev/knowledge-base@beta
```

## Promoting beta to stable

When the beta is stable and ready for production, see the standard release process:
1. Merge `dev` → `main`
2. Tag `vx.y.z` on `main`
3. CI publishes with `--tag latest`
