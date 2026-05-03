# Changelog

All notable changes to playwright-healer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

**Core pipeline**

- Two-workflow hybrid: ingest workflow appends per-run stats to a dedicated
  `playwright-healer-state` branch (NDJSON, append-only, `--force-with-lease`
  retry loop + retention GC); healer workflow is dispatched via `workflow_dispatch`
  when thresholds are breached.
- Playwright JSON report parser with Zod graceful degrade (ING-01..04).
- Rolling-window flake rate detection + p95 slow-regression detection (DET-01..03).
- Markdown job summary + `::warning::` annotations per detection (DET-04).
- LLM-agent heal loop: Playwright MCP + read-only file tools (`Read`, `Grep`, `Glob`);
  `Bash`/`Write`/`Edit` never granted.
- Structured diff proposal with `fixClass` classification, applied outside agent loop.
- Diff-lint pass blocks `waitForTimeout`, positional selectors, weakened assertions,
  and files outside test directories (defense-in-depth; FIX-06).
- Post-fix validation: re-runs tests N times after patch; rejects if pass rate below
  threshold (FIX-04).
- PR writer opens `[playwright-healer] Fix flaky <title>` PRs with reasoning band.
- Issue fallback: opens structured diagnosis issue when validation or diff-lint blocks
  the fix.
- Fix classes: selectors, waits, assertions, slow (enable_* flags, all default-OFF).

**Auto-merge gate**

- `enable_auto_merge` input (default `false`). When enabled, uses GitHub's native
  auto-merge API with a four-condition trust gate: post-fix validation pass rate,
  fix class within allowed set, no forbidden patterns in diff, no security-contract
  violations.
- Soft-fail on any GitHub API error (auto-merge not set — falls back to manual merge).
- `[skip-healer]` sentinel preserved through auto-merge PRs (T-05-06).

**Multi-provider support**

- Provider input: `anthropic` (preview), `gemini` (supported), `github` (supported), `ollama` (preview).
- Per-provider default models: anthropic → `claude-sonnet-4-6`, gemini → `gemini-2.5-pro`,
  github → `openai/gpt-4.1`, ollama → `llama3.1`.
- Tool-naming contract: `mcp__playwright__*` canonical form; adapters translate at
  call site (gemini → single underscore; github/ollama → native JSON-schema).

**Security scaffold**

- `persist-credentials: false` on all `actions/checkout` steps.
- No `pull_request_target` trigger used anywhere in this action (SEC-02).
- Allowed-tools list explicitly enforced at action boundary (SEC-01).
- PAT required for PR creation + dispatch (`GITHUB_TOKEN` cannot trigger downstream
  CI on bot-opened PRs — GitHub's recursion guard).
- Playwright MCP `--allowed-origins` scoped to `base_url` + localhost.
- Zod-validated dispatch payload at action boundary (D-18).
- Security contract audit invariant: no `mcp__playwright__*` inline literals in source
  (D-13); shared allow-lists exported from `src/healer/forbidden-patterns.ts` (D-17).

**Packaging**

- Composite GitHub Action, not bundled JS. `npm ci --production` runs at runtime.
  Reason: Claude Agent SDK spawns a platform-specific native binary that ncc/esbuild
  break; matches Anthropic's own `claude-code-action` pattern.
- Node 24 (GitHub-mandated default from 2026-06-02; ncc WONTFIX).

### Deferred (coming in v0.1.1 or v0.2)

- **Live SC#2 auto-merge happy-path demo evidence**: Phase 5's live auto-merge demo
  requires branch protection + `allow_auto_merge` on a public repo (unavailable on
  GitHub Free User-owned private repos). Evidence will be captured once this repo is
  public and branch protection is enabled. See
  `tests/fixture-app/uat-evidence-live-auto-merge.md` once available.
- **T-05-06 SKIP_SENTINEL live verification**: deferred alongside SC#2.
- **App-code fix capability**: v0.2 work; playwright-healer v0.1.x heals test code only.
- **v2 trace-aware confidence bands**: deferred (TRC-03); requires Playwright trace
  analysis not yet implemented.

[Unreleased]: https://github.com/Sacharified/playwright-healer/compare/HEAD...HEAD
