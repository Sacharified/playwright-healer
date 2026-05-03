# Release Process

This document covers the tag-day mechanics for playwright-healer releases. The tag strategy mirrors `actions/checkout`: an immutable `v0.1.0` tag for SHA-pinned consumers alongside a moving `v1` alias that consumers can pin for "latest 0.1.x" stability.

## Overview

Two tags are maintained:

- **`v0.1.0`** (immutable) — created once, never moved. Consumers who pin `uses: Sacharified/playwright-healer@v0.1.0` are permanently frozen to this SHA. This is the correct choice for locked production environments.
- **`v1`** (moving alias) — re-pointed with `git tag -f v1 <SHA>` on every 0.1.x patch. Consumers who pin `uses: Sacharified/playwright-healer@v1` automatically receive the latest 0.1.x release on their next run.

## Preparing a release

Before tagging, update `CHANGELOG.md` to move entries from `[Unreleased]` into a new `[X.Y.Z]` section:

1. Find the `## [Unreleased]` heading at the top of `CHANGELOG.md`.
2. Add a new `## [X.Y.Z] - YYYY-MM-DD` section below it containing all current unreleased entries.
3. Set the date to today's date.
4. Leave the `## [Unreleased]` section empty (or remove its subsections so it's a clean placeholder).
5. Add a comparison URL at the bottom of the file (see the link footer pattern already in `CHANGELOG.md`).

Commit the CHANGELOG update before tagging:

```bash
git add CHANGELOG.md
git commit -m "docs(06): prepare CHANGELOG for v0.1.0 release"
```

## Creating the v0.1.0 tag

```bash
# 1. Ensure main is clean and CI is green
git checkout main
git pull --ff-only

# 2. Create immutable v0.1.0 tag
git tag -a v0.1.0 -m "playwright-healer v0.1.0

First public release. Two-workflow ingest + dispatch + heal pipeline.
Multi-provider: Anthropic, Gemini, GitHub Models, Ollama.
Auto-merge gate (Phase 5). See CHANGELOG.md for full notes."
```

## Creating/re-pointing the v1 moving alias

```bash
# 3. Create (or re-point) the moving v1 alias
git tag -f v1 v0.1.0

# 4. Push both tags
git push origin v0.1.0
git push origin v1 --force   # --force because v1 already exists (or will be re-used on patches)
```

**Cache note:** After pushing `v1 --force`, tag promotion takes effect on the next GitHub Actions runner cache refresh (usually within 1 run). No consumer action is required. GitHub Actions resolves the `@v1` alias to the new SHA on each consumer's next workflow run — the cache key includes the resolved SHA, so a re-pointed alias automatically invalidates the previous cache entry.

## Creating the GitHub Release

After both tags are pushed, create a GitHub Release from `v0.1.0`:

```bash
gh release create v0.1.0 \
  --title "playwright-healer v0.1.0" \
  --notes-file CHANGELOG.md \
  --draft
# Review draft in the GitHub UI, then publish
gh release edit v0.1.0 --draft=false
```

The `--notes-file CHANGELOG.md` flag uses the full CHANGELOG as release notes. Consumers who browse the GitHub Releases page will see the formatted entry.

## Future patch releases (v0.1.1+)

For each patch release, repeat the same pattern with an incremented version number:

```bash
# After landing a patch commit on main:
git tag -a v0.1.1 -m "playwright-healer v0.1.1 — <description>"
git tag -f v1 v0.1.1
git push origin v0.1.1
git push origin v1 --force
```

Then create a GitHub Release from `v0.1.1` using the same `gh release create` pattern above.

## When to re-point v1

Re-point `v1` on every stable patch release. Do not re-point `v1` to pre-release tags or release candidates — consumers who pin `@v1` expect stable, merged code.

The pattern:

```
v0.1.0 released  →  v1 = v0.1.0
v0.1.1 released  →  v1 = v0.1.1
v0.1.2 released  →  v1 = v0.1.2
v0.2.0 released  →  v2 = v0.2.0  (v1 stays at last 0.1.x)
```

Minor version bumps (v0.2.0) introduce a new `v2` alias. The `v1` alias remains frozen at the last 0.1.x for consumers who haven't opted into the minor bump.
