# playwright-healer

## What This Is

A reusable GitHub Action that watches Playwright test health across CI runs and auto-heals flaky, failing, or slow tests. When a test crosses configurable thresholds, a companion workflow uses the Claude Agent SDK driving the Playwright MCP to reproduce the failure, diagnose the root cause, propose a fix, validate it by re-running the test, and open a PR. When it can't propose a fix, it files a structured GitHub issue with root-cause analysis and debugging hints.

It's aimed at teams that already use Playwright in GitHub Actions and are tired of manually triaging flakes: they drop the action into a workflow, point it at their app start commands, and let the healer do first-pass triage while they sleep.

## Core Value

**A flaky Playwright test should result in a reviewable PR (or a structured issue) without a human reading logs.** Everything else — thresholds, fix classes, auto-merge, model choice — is tunable. The one non-negotiable is that the action reliably converts a detected flake/slowness pattern into a concrete, validated artifact a maintainer can act on.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. Hypotheses until shipped. -->

- [ ] Ship as a reusable GitHub Action consumable from any Playwright repo via `uses:` in a workflow
- [ ] Ingest Playwright JSON reports at the end of each CI run and append a rolling stats record to a dedicated `playwright-healer-state` branch in the consuming repo
- [ ] Detect "consistently flaky" and "consistently slow" tests against configurable thresholds (flake rate over window, duration regression vs baseline)
- [ ] When a test crosses threshold, trigger a companion healer workflow via `workflow_dispatch` (non-blocking, separate run)
- [ ] Healer workflow checks out the repo and starts the app via user-provided action inputs: `setup-command`, `start-command`, `test-command`, `base-url`
- [ ] Drive Claude Agent SDK (TypeScript) with the Playwright MCP to reproduce the suspect test and produce a root-cause analysis
- [ ] Agent can propose fixes in four classes for v1: (a) selectors/locators, (b) waits/timing, (c) assertions, (d) slow-test optimizations
- [ ] Validate proposed fixes by re-running the affected test N times; require configurable pass-rate threshold before opening a PR
- [ ] Open a PR with the fix, the root-cause summary, validation evidence (pass count out of N), and a confidence band
- [ ] Support opt-in auto-merge for high-confidence fix classes when CI is green; otherwise request human review
- [ ] When no fix can be proposed, open a structured GitHub issue with root-cause analysis, reproduction notes, and debugging hints
- [ ] Expose a minimum config surface via `action.yml` (commands, thresholds, fix-class toggles, auto-merge policy, Anthropic API key secret)
- [ ] Ship with documentation and a working example workflow so a new consumer can adopt in one PR

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **Non-Playwright test frameworks (Cypress, WebdriverIO, Jest UI tests)** — the Playwright MCP is central to the diagnosis loop; supporting other frameworks is a different product
- **Non-GitHub CI (GitLab, CircleCI, Buildkite)** — v1 leans hard on GitHub Actions + GitHub API for PRs/issues/state; porting is v2+
- **Fixing application bugs (non-test code logic errors)** — v1 scopes fixes to the four test-flakiness classes above; logic bugs are outside the healer's trust envelope and get issues instead
- **External state storage (S3, Supabase, custom backends)** — the dedicated-branch approach keeps the action zero-infra; external stores are a later option if needed
- **A hosted SaaS service** — shipping as a self-hosted Action avoids data-handling liability and lets users bring their own Anthropic key
- **Auto-merge by default** — auto-merge is opt-in only; the safe default is a review-requested PR
- **Blind (unvalidated) PRs** — every proposed fix must be validated by re-running the test before a PR is opened; we trade speed for signal
- **Per-test owner @-mentions in v1** — deferred; issues are the v1 notification channel to keep scope tight
- **Non-TypeScript agent runtime (Python Agent SDK)** — we ship a composite action that runs TypeScript via Node; the TS Agent SDK gives the cleanest adoption path; Python SDK is not used
- **Bundling the action into a single `dist/index.js` via `ncc` or similar** — overridden by research: the Claude Agent SDK resolves a platform-specific native binary via `import.meta.url`, which bundlers break, and `ncc` will not support Node 24 (GitHub-mandated June 2, 2026). We ship as a composite action with `npm ci --production` at runtime, matching Anthropic's own `claude-code-action` pattern

## Context

**Technical environment:**
- The consuming repo runs Playwright in GitHub Actions and produces a Playwright JSON report per run
- The consuming repo must be able to start its app under test via a shell command (dev server, preview build, or containerized stack)
- The action needs an inference-provider API key (`api-key` input — any of Anthropic, Gemini, or Ollama per the Phase 01.1 multi-provider surface). Ollama localhost may omit the key; Anthropic and Gemini require it (enforced by Zod `superRefine`). The action uses `GITHUB_TOKEN` for low-scope operations (reading the report, writing stats to the state branch) but requires a PAT or GitHub App token (`healer-token` input) for PR creation and `workflow_dispatch` — PRs opened by `GITHUB_TOKEN` do not trigger downstream CI (GitHub's recursion guard), which would defeat the validation loop

**Key tooling:**
- **LLM agent loop (TypeScript)** — provider-specific adapter selected via the `provider` input (`anthropic` → Claude Agent SDK, `gemini` → `@google/genai` with experimental MCP, `ollama` → native function-calling via an MCP bridge). Handles tool use, MCP connection, and the reasoning passes for root-cause analysis and fix generation. Adapters land in Phase 3.
- **Playwright MCP (`@playwright/mcp`)** — gives the agent a browser-driving tool surface identical to what a human debugger would use (navigate, click, query DOM, read console, inspect network)
- **GitHub Actions toolkit (`@actions/core`, `@actions/github`, `@octokit`)** — for reading inputs, making PRs/issues, triggering workflow_dispatch
- **Dedicated `playwright-healer-state` branch** — rolling JSON stats stored in a protected branch in the consuming repo; durable, diffable, zero-infra

**Prior work / references:**
- Playwright's first-party "retry" and "trace" features handle *detection* of flakes well, but don't close the loop to a fix
- Existing "test flake dashboards" (CurrentsDev, Buildkite Test Engine) are observability plays; playwright-healer is a remediation play that writes code
- The Claude Agent SDK + Playwright MCP pattern is well-suited: the MCP surface is designed for exactly this kind of interactive browser reasoning

**Known issues to address:**
- **Cost control** — every healing pass runs an agent loop and re-runs tests. Need sane defaults and a per-run budget cap
- **Fix drift** — a fix on an old commit SHA may not apply cleanly to main. The healer always rebases onto the default branch before PR
- **Permission surface** — writing to a dedicated branch, opening PRs, and dispatching workflows is a broad token scope. Clear docs on minimum permissions, with a PAT path for orgs that restrict `GITHUB_TOKEN`
- **Test isolation** — re-running a test N times to validate a fix must happen in a clean environment that matches CI, or the validation is worthless

## Constraints

- **Tech stack (action):** TypeScript, Node 24 (GitHub Actions default from June 2, 2026), `@actions/core` + `@actions/github`; shipped as a **composite action** that runs `npm ci --production` at runtime — no bundling. Confirmed against Anthropic's own `claude-code-action` pattern; ncc/esbuild break the Agent SDK's native-binary resolution
- **Tech stack (agent):** Claude Agent SDK (TS) + Playwright MCP — locked in Key Decisions; not revisiting without strong reason
- **Runtime environment:** GitHub Actions runners (ubuntu-latest baseline); must not assume self-hosted infra
- **State storage:** dedicated git branch in the consuming repo; zero-infra requirement rules out external stores for v1
- **Trust boundary:** action never merges PRs without either (a) passing validation re-runs AND opt-in auto-merge config, or (b) human approval
- **Cost:** each healing pass must have a bounded token budget; agent loop can't run unbounded. Target: a healing run of a single test should cost well under $1 in API fees on defaults
- **Compatibility:** supports current Playwright major versions; does not attempt to paper over incompatible Playwright API changes
- **Security:** `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` handled via standard GH Actions secrets; no logging of secrets; no telemetry home-calling

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Target a reusable GitHub Action, not a private tool or SaaS | Maximum leverage — one build, many consumers; avoids data-handling liability; users bring their own API key | — Pending |
| Claude Agent SDK (TypeScript) as the default agent layer | Native MCP support, tool-use ergonomics, default model `claude-sonnet-4-6` with `claude-opus-4-7` opt-in for hard cases | — Pending |
| Multi-provider support (Anthropic, Gemini, Ollama) via a `provider` input — added in Phase 01.1 | Reusable action shouldn't demand an Anthropic subscription; users pick the provider they already have access to. Adapters normalize tool-naming (`mcp__*` canonical → `mcp_*` for Gemini, native function names for Ollama). Adapters land in Phase 3; input surface lands now so CI runs without any Anthropic key. | ✓ Decision-locked 2026-04-25 |
| Hybrid trigger: stats every run + threshold-dispatched healer workflow | Non-blocking main CI, scales past single-run context, fits the reusable-action model | — Pending |
| Store rolling flake/speed history on a dedicated git branch in the consuming repo | Durable, diffable, zero-infra; avoids artifact retention limits and external-store burden | — Pending |
| Consuming repo exposes start commands via `action.yml` inputs (`setup-command`, `start-command`, `test-command`, `base-url`) | Explicit beats convention; documentable and predictable across diverse repos | — Pending |
| Package as a **composite GitHub Action** (not bundled JS, not Docker) | Flipped by research: Claude Agent SDK spawns a platform-specific native binary via `import.meta.url` that bundlers break; ncc won't support Node 24 (GH-mandated June 2, 2026). `npm ci --production` at runtime matches Anthropic's own `claude-code-action` | ✓ Research-validated |
| Require a PAT or GitHub App token (`healer-token` input) for PR creation and `workflow_dispatch` | PRs opened by `GITHUB_TOKEN` receive vacuous "all checks passed" (no CI fires) due to GitHub's recursion guard — this would defeat the validation loop. PAT is the documented path for consumer repos | ✓ Research-validated |
| Security scaffolding (composite `action.yml`, `persist-credentials: false`, no `pull_request_target`, scoped MCP tools) must ship in Phase 0 before any agent code | Four HIGH-severity pitfalls are architectural: credential leaks, fork-PR exfiltration, token-in-workspace, and agent filesystem scoping. All are expensive to retrofit and cheap to get right upfront | ✓ Research-validated |
| Build order: v0 observability (stats + state-branch + threshold evaluator in log-only mode) ships before v1 agent loop | De-risks the git-as-DB concurrency model at zero API cost before expensive agent code is built on top of it | ✓ Research-validated |
| v1 fix scope: selectors, waits/timing, assertions, slow tests (all four) | These cover the vast majority of Playwright flake causes; logic bugs explicitly out of scope | — Pending |
| Every fix must be validated by re-running the test N times before PR | Trading speed for signal; unvalidated PRs become noise and erode trust in the action | — Pending |
| Auto-merge is opt-in per repo and per fix class; default is review-requested | Reusable action must be safe by default; auto-merge is a power-user feature | — Pending |
| Fallback for unfixable cases is a structured GitHub issue (not owner @-mentions in v1) | Keeps v1 scope tight; issues route through existing triage workflows | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-27 — Phase 01.3 complete (TEST-01 satisfied — `phase1-self-test.yml` runs end-to-end green on a clean ubuntu-latest fork: Scenarios 4+5 now read the dispatcher's redacted markdown via composite-action output `dry-run-summary` instead of the per-step `$GITHUB_STEP_SUMMARY`; Scenario 1 pre-registers the canary with the runner masker via `::add-mask::` before `uses: ./`; verify-log-mask Job B filters the registration step's own command echo. Run 25022284855 — all 7 jobs success; 253 local tests pass; new Test Hygiene (TEST) category in REQUIREMENTS.md). Phase 01.2 complete (path-resolved tsx; hyphenated `INPUT_*` env vars survive the spawn). Phase 02 complete since 2026-04-25. Next: Phase 03 SC-1/SC-3 live re-attempt.*
