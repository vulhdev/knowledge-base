---
name: release
description: Cuts a new release for this package — updates CHANGELOG.md, bumps the version with npm version, syncs the version into .claude-plugin/plugin.json and .claude-plugin/marketplace.json, and pushes the commit(s) + tag to origin. Trigger this whenever the user asks to release, publish, or cut a new version of this package — e.g. "release a patch", "bump the minor version", "cut v1.17.0", "phát hành bản vá lỗi", "release major version", "ship this as a new version". Takes exactly one argument: `major`, `minor`, or `patch`.
---

# Release

Cuts an official release of this package end-to-end: changelog, version bump, plugin manifest sync, and push. This is the single tool for shipping a new version — doing these steps by hand is error-prone, since it's easy to forget to sync `.claude-plugin/plugin.json` or `marketplace.json` to the new version, or to push without `--follow-tags` so the tag never reaches GitHub.

Invoked as `/release <major|minor|patch>` — the bump type is the skill argument, `$ARGUMENTS`.

Because this skill ends with a real `git push origin --follow-tags`, treat being invoked by name with a valid argument as the user's explicit authorization to carry out every step below — don't stop partway to re-confirm the push itself. Do stop and explain clearly if any precondition in step 1 or the safety gate in step 2 fails; those exist specifically to catch the cases where running to completion would be wrong.

## 0. Validate the argument

If `$ARGUMENTS` is empty or not exactly one of `major`, `minor`, `patch`, use AskUserQuestion to ask which bump type is wanted before doing anything else.

## 1. Preconditions — abort immediately if any of these fail

Run these checks before touching any file:

```bash
git branch --show-current
```
Must print `main`. If it doesn't, stop and tell the user releases only run from `main` — do not release from another branch, and do not switch branches automatically on their behalf.

```bash
git status --short
```
Must be empty. If there are uncommitted changes, stop and ask the user to commit or stash them first — `npm version` will refuse to run on a dirty tree anyway, so there's no point proceeding further.

```bash
git fetch origin main --quiet && git rev-list --count HEAD..origin/main
```
Should print `0`. If local `main` is behind `origin/main`, stop and tell the user to pull first — otherwise the final push may be rejected or the branches may diverge.

## 2. Run the safety gate

```bash
npm run lint && npm test
```
If either fails, stop here and report the failure verbatim. Do not touch the changelog or bump the version on top of code that doesn't build or pass tests.

## 3. Compute the next version

Read the current version from `package.json`:
```bash
node -p "require('./package.json').version"
```
Compute the next one yourself, following semver, since you need it before `npm version` actually runs:

- `patch` — bump the third number: `1.16.6` → `1.16.7`
- `minor` — bump the second number, reset patch to 0: `1.16.6` → `1.17.0`
- `major` — bump the first number, reset minor and patch to 0: `1.16.6` → `2.0.0`

Nothing else touches `package.json`'s version between now and step 5, so as long as you run `npm version` with the same bump type validated in step 0, the tag it creates will match this number.

## 4. Update CHANGELOG.md

Read `CHANGELOG.md`. It follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): each release is a `## [X.Y.Z] — YYYY-MM-DD` heading, with `### Added` / `### Changed` / `### Fixed` subsections, entries formatted as `- **short bold title** — description`.

- If `## [Unreleased]` already has entries under it, those *are* the changelog for this release — move them under the new version heading rather than regenerating anything.
- If `## [Unreleased]` is empty (or the section is missing), find what actually shipped since the last release and draft the entries yourself:
  ```bash
  git describe --tags --abbrev=0
  git log <last-tag>..HEAD --no-merges --pretty=format:'%h %s'
  ```
  For anything non-obvious from the commit subject, read the actual change (`git show <hash>`) rather than guessing. Match the voice of the existing entries — user-facing, specific, and explaining *why* a change matters when that isn't obvious from the title alone (see the existing entries in the file for the level of detail expected).
- Insert the new section directly below `## [Unreleased]`, dated with today's actual date:
  ```bash
  date +%Y-%m-%d
  ```
  Leave `## [Unreleased]` present but empty above it, ready for the next round of changes.

Commit just this file — `npm version` requires a clean working tree, so the changelog has to land first:
```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for vX.Y.Z"
```

## 5. Bump the version

```bash
npm version <major|minor|patch>
```
Use the exact bump type validated in step 0. This updates `package.json`/`package-lock.json`, creates the release commit, and creates the `vX.Y.Z` tag — matching the version computed in step 3.

## 6. Sync the plugin manifests

Update both files to the version now in `package.json`:

- `.claude-plugin/plugin.json` — the `"version"` field
- `.claude-plugin/marketplace.json` — the top-level `"version"` field, **and** add or update a `"version"` field on the `knowledge-base` entry inside `"plugins"`, so the per-plugin version doesn't silently drift from the marketplace catalog version

Commit them together:
```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: sync plugin manifests to vX.Y.Z"
```

## 7. Push

```bash
git push origin --follow-tags
```
This pushes both commits made in this run plus the `vX.Y.Z` tag in one go.

## 8. Report

Tell the user the new version number, summarize the CHANGELOG entries that were added, and confirm the tag was pushed.
