# playwright-healer

A reusable GitHub Action that auto-heals flaky, failing, or slow Playwright tests using Claude Agent SDK + Playwright MCP. Opens validated PRs or structured issues for each detected problem.

## Where to look

- **`.planning/PROJECT.md`** — Core value, scope, Key Decisions, constraints. Start here.
- **`.planning/REQUIREMENTS.md`** — 69 v1 REQ-IDs across 12 categories, with phase traceability.
- **`.planning/ROADMAP.md`** — 6 phases in dependency order. Per-phase goals, success criteria, REQ-ID mapping.
- **`.planning/STATE.md`** — Current phase, progress, last-updated.
- **`.planning/research/SUMMARY.md`** — Research findings summary. Links to STACK / FEATURES / ARCHITECTURE / PITFALLS.
- **`.planning/research/STACK.md`** — Current versions of `@anthropic-ai/claude-agent-sdk`, `@playwright/mcp`, `@actions/*`, Octokit, Zod.
- **`.planning/research/PITFALLS.md`** — 10 HIGH-severity pitfalls. Four are architecturally binding (Phase 1).
- **`.planning/config.json`** — GSD workflow config (mode: yolo, granularity: standard, parallelization: true).

## Key architectural facts

- **Composite GitHub Action**, not bundled JS. The Claude Agent SDK spawns a platform-specific native binary that `ncc`/`esbuild` break. `npm ci --production` runs at runtime. Matches Anthropic's own `claude-code-action` pattern.
- **Node 24** — GitHub-mandated default from 2026-06-02. `ncc` doesn't support it (issue #1297 closed WONTFIX). Confirms the composite-action choice.
- **Two-workflow hybrid**: an ingest step in the consumer's existing CI appends per-run stats to a dedicated `playwright-healer-state` branch (NDJSON, append-only, `--force-with-lease` retry loop). When thresholds are breached, a separate healer workflow is dispatched via `workflow_dispatch`.
- **PAT required for PR creation and dispatch** — `GITHUB_TOKEN` cannot trigger downstream CI on bot-opened PRs (GitHub's recursion guard). Consumers provide a `healer-token` input.
- **Default model**: `claude-sonnet-4-6`. Opus 4.7 available via input for hard cases. Do not downgrade to 3.x models — they are retired.
- **Security non-negotiables**: `persist-credentials: false` on all checkout steps; no `pull_request_target` trigger ever; Playwright MCP `--allowed-origins` scoped to `base-url` + localhost; Claude Agent SDK `allowedTools` explicitly `["mcp__playwright__*", "Read", "Grep", "Glob"]` (never `Bash`/`Write`/`Edit`).
- **Fix application is outside the agent loop**: the agent returns a structured diff proposal; the fix-applier (not the agent) rebases and applies the patch; a diff-lint pass blocks `waitForTimeout`, positional selectors, and weakened assertions as defense-in-depth.

## Phase order (do not reorder without research justification)

1. **Security Scaffold + Composite Packaging** — locks the four binding security controls before any agent code
2. **Ingest + State Branch + Log-Only Detection** — validates git-as-DB concurrency at zero API cost
3. **Manual Healer (Selectors + Waits + Issue Fallback)** — full pipeline, manually dispatched
4. **Auto-Dispatch + Full Fix Classes + Deduplication** — threshold-triggered live dispatch
5. **Auto-Merge** — opt-in, trust-chain gated
6. **Documentation + Release** — README, example workflows, self-test, version tag

## GSD workflow commands

This project was initialized with GSD. Next step: `/gsd-plan-phase 1` to plan Phase 1.

Other commands you may use mid-project: `/gsd-discuss-phase <N>`, `/gsd-execute-phase <N>`, `/gsd-next`, `/gsd-progress`.

---

**Source of truth:** when `.planning/` and this file disagree, `.planning/` wins.
