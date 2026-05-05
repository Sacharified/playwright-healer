# playwright-healer

A reusable GitHub Action that auto-heals flaky, failing, or slow Playwright tests using an LLM agent + Playwright MCP. Opens validated PRs or structured issues for each detected problem. Three-provider input surface (`openrouter | github | ollama`): OpenRouter fronts Anthropic, Google, OpenAI, Meta, and other cloud models behind one OpenAI-compatible endpoint; GitHub Models offers a $0 free tier; Ollama covers self-hosted localhost.

## Where to look

- **`.planning/PROJECT.md`** — Core value, scope, Key Decisions, constraints. Start here.
- **`.planning/REQUIREMENTS.md`** — 69 v1 REQ-IDs across 12 categories, with phase traceability.
- **`.planning/ROADMAP.md`** — 6 phases in dependency order. Per-phase goals, success criteria, REQ-ID mapping.
- **`.planning/STATE.md`** — Current phase, progress, last-updated.
- **`.planning/research/SUMMARY.md`** — Research findings summary. Links to STACK / FEATURES / ARCHITECTURE / PITFALLS.
- **`.planning/research/STACK.md`** — Current versions of `@anthropic-ai/claude-agent-sdk`, `@playwright/mcp`, `@actions/*`, Octokit, Zod.
- **`.planning/research/PITFALLS.md`** — 10 HIGH-severity pitfalls. Four are architecturally binding (Phase 1).
- **`.planning/config.json`** — GSD workflow config (mode: yolo, granularity: standard, parallelization: true).
- **`src/shared/types.ts`** — `NdjsonRecord`, `NdjsonTestEntry`, `Detection` type definitions (Phase 02).
- **`src/shared/state-branch.ts`** — All git ops on `playwright-healer-state` branch via an isolated `/tmp` worktree; `--force-with-lease` retry loop, append-only NDJSON, retention GC (Phase 02).
- **`src/shared/loop-guard.ts`** — `shouldSkipIngest()` SEC-05 fork-PR / bot-author / `[skip-healer]` sentinel checks (Phase 02).
- **`src/ingest/report-parser.ts`** — Playwright JSON → `NdjsonTestEntry[]` with Zod graceful degrade (ING-01..04) (Phase 02).
- **`src/ingest/threshold-evaluator.ts`** — Pure function: `NdjsonRecord[]` → `Detection[]`; rolling-window flake-rate + p95 slow-regression (DET-01..03) (Phase 02).
- **`src/ingest/summary-writer.ts`** — Markdown table → `core.summary`; per-detection `::warning::` annotation; log-only (DET-04) (Phase 02).
- **`.planning/phases/02-ingest-state-branch-detection/02-RESEARCH.md`** — 14 plan-ready patterns for Phase 02 implementation (state branch concurrency, shard dedup, GC, etc.).

## Key architectural facts

- **Composite GitHub Action**, not bundled JS. The Claude Agent SDK spawns a platform-specific native binary that `ncc`/`esbuild` break. `npm ci --production` runs at runtime. Matches Anthropic's own `claude-code-action` pattern.
- **Node 24** — GitHub-mandated default from 2026-06-02. `ncc` doesn't support it (issue #1297 closed WONTFIX). Confirms the composite-action choice.
- **Two-workflow hybrid**: an ingest step in the consumer's existing CI appends per-run stats to a dedicated `playwright-healer-state` branch (NDJSON, append-only, `--force-with-lease` retry loop). When thresholds are breached, a separate healer workflow is dispatched via `workflow_dispatch`.
- **PAT required for PR creation and dispatch** — `GITHUB_TOKEN` cannot trigger downstream CI on bot-opened PRs (GitHub's recursion guard). Consumers provide a `healer_token` input.
- **Action input naming**: all inputs are snake_case (`api_key`, `healer_token`, `flake_rate_threshold`, …). This keeps the `INPUT_*` env vars that `core.getInput()` reads as clean POSIX identifiers (no hyphen survival quirks across `npx → tsx → node` spawns).
- **Three-provider input surface** (Phase 01.1 superseded by Phase 01.4): `provider` accepts `openrouter | github | ollama` (default `openrouter`). The `api_key` input is generic and is NOT `required: true` at the runner-level `getInput` call — Zod `superRefine` enforces presence per-provider (Ollama localhost may omit the key). Per-provider default models live in `src/shared/config.ts` `DEFAULT_MODELS`; default HTTP endpoints in `DEFAULT_ENDPOINTS`. Adapter code lives under `src/healer/adapters/` (`openrouter.ts` and `github.ts` implemented; `ollama.ts` is a throw-on-call stub).
- **OpenRouter adapter**: OpenAI-compatible chat completions against `https://openrouter.ai/api/v1`. Auth = OpenRouter API key passed via `api_key`. Per-call USD cost comes back on every response in `usage.cost` (the legacy `usage: { include: true }` opt-in is deprecated; usage is always returned). Both `max_turns` AND `max_budget_usd` are enforced as pre-call gates. Models are slash-prefixed (e.g. `anthropic/claude-sonnet-4.6`, `google/gemini-2.5-pro`, `openai/gpt-4.1`). Note OpenRouter's slug uses a DOT (`4.6`) where Anthropic's native SDK uses a hyphen (`4-6`) — these MUST NOT be confused. Tool names are passed in raw MCP form (`browser_navigate`, …); audit invariant runs on the canonical `mcp__playwright__<name>` form so D-13 stays intact. Optional attribution headers `HTTP-Referer` and `X-OpenRouter-Title` are sent per OpenRouter convention.
- **GitHub Models adapter**: OpenAI-compatible chat completions against `https://models.github.ai/inference`. Auth = GitHub PAT with `models:read` scope passed via `api_key`. Free tier suits dev — cost is reported as `$0` (no per-token billing on free tier); only `max_turns` enforces the agent budget. Tool names are passed in raw MCP form (`browser_navigate`, …); audit invariant still runs on the canonical `mcp__playwright__<name>` form so the D-13 inline-literal ban is preserved.
- **Tool-naming contract**: `src/shared/security-contract.ts` `ALLOWED_TOOLS` holds the Anthropic-canonical form (`mcp__server__tool`, double underscore). Provider adapters translate at the call site — `openrouter` and `github` pass raw MCP names (`browser_*`) as OpenAI function names; `ollama` will use native JSON-schema function names via an MCP bridge. Inline literals of these names remain banned (D-13).
- **Default model per provider**: openrouter → `anthropic/claude-sonnet-4.6` (Claude via OpenRouter), github → `openai/gpt-4.1`, ollama → `llama3.1`. Do not downgrade to retired 3.x Claude models. (gpt-4.1-mini was tried first on github but produced patches with miscounted hunk headers that `git apply` rejected; gpt-4.1 fixes that and stays inside the same free tier.)
- **Security non-negotiables**: `persist-credentials: false` on all checkout steps; no `pull_request_target` trigger ever; Playwright MCP `--allowed-origins` scoped to `base_url` + localhost; agent `allowedTools` explicitly `["mcp__playwright__*", "Read", "Grep", "Glob"]` (never `Bash`/`Write`/`Edit`) — adapters may rename the `mcp__*` entries per provider syntax but the intent (Playwright MCP + read-only file tools only) is invariant.
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
