# Requirements: playwright-healer

**Defined:** 2026-04-24
**Core Value:** A flaky Playwright test should result in a reviewable PR (or a structured issue) without a human reading logs.

> Each requirement is one capability. "The action does X" is the user story — where "the user" is the consuming-repo maintainer adopting this action in their CI.

---

## v1 Requirements

### Packaging & Distribution (PKG)

- [x] **PKG-01
**: The action ships as a composite GitHub Action (`runs.using: composite` in `action.yml`), not a bundled JS action
- [x] **PKG-02
**: `npm ci --production` runs as the first composite step so the Claude Agent SDK's native binary is installed on the runner (no bundling)
- [ ] **PKG-03**: The repo publishes at least one immutable version tag (`v0.1.0`, `v1`) that consumers can pin in `uses:`
- [ ] **PKG-04**: The repo includes a `.github/workflows/self-test.yml` that exercises the action against a fixture Playwright repo on `ubuntu-latest` on every push to main
- [ ] **PKG-05**: Consumers can adopt the action in one PR by copying an example workflow from the repo's README

### Configuration (CFG)

- [x] **CFG-01
**: `action.yml` exposes inputs for all user-provided commands: `setup-command`, `start-command`, `test-command`, `base-url`
- [x] **CFG-02
**: `action.yml` exposes secret inputs: `api-key` (inference-provider API key; required unless `provider=ollama` — per-provider enforcement via Zod `superRefine`, added in Phase 01.1 — formerly `anthropic-api-key`), `healer-token` (PAT or App token, required for PR creation and `workflow_dispatch`), `github-token` (defaults to built-in)
- [x] **CFG-03**: `action.yml` exposes tunable thresholds: `flake-rate-threshold` (default 0.2 = 20%), `flake-window-days` (default 7), `slow-regression-pct` (default 1.5 = 50% slower), `rerun-count` (default 10), `rerun-pass-rate` (default 0.9 = 9/10), `max-budget-usd` (default 2.00), `max-turns` (default 30)
- [ ] **CFG-04**: `action.yml` exposes per-fix-class toggles: `enable-selector-fixes`, `enable-wait-fixes`, `enable-assertion-fixes`, `enable-slow-fixes` (all default true)
- [x] **CFG-05
**: `action.yml` exposes a mode input: `mode` = `ingest` | `heal` | `dry-run` — each step in a consumer workflow specifies which phase it runs
- [x] **CFG-06**: An optional `.github/playwright-healer.yml` config file in the consuming repo overrides action.yml inputs; the action merges both with action.yml winning
- [x] **CFG-07**: All merged config is validated with Zod; invalid config fails the action with a clear error, not a crash

### Report Ingestion (ING)

- [x] **ING-01**: The `ingest` mode locates a Playwright JSON report by pattern (`report-path` input, default `test-results/results.json`) and parses it into typed records
- [x] **ING-02**: The parser extracts per-test: file path, test title, outcome (passed/failed/flaky/timed-out), duration, retries, error messages, trace attachment path
- [x] **ING-03**: The parser validates the report against a runtime Zod schema; an unrecognized shape produces a diagnostic warning (not a crash) and the run is still recorded as "report-unreadable"
- [x] **ING-04**: The parser is shard-aware — if the report reflects a single shard of a sharded run, the record is marked with shard metadata so detection can deduplicate across shards

### State Branch (STA)

- [x] **STA-01**: On first use in a consuming repo, the action creates an orphan `playwright-healer-state` branch if it does not exist; subsequent runs clone this branch only
- [x] **STA-02**: The action appends new stats records as NDJSON (one JSON object per line) to a path like `runs/YYYY/MM/DD.ndjson` — append-only, no in-place updates
- [x] **STA-03**: Pushes to the state branch use `--force-with-lease` and a retry loop on conflict (rebase onto latest remote, re-apply, retry up to N times)
- [x] **STA-04**: Concurrent ingest steps from overlapping CI runs never lose records — verified by a concurrent-write integration test
- [x] **STA-05**: The action runs periodic GC on the state branch: records older than `retention-days` (default 90) are dropped in a rewrite commit

### Detection & Dispatch (DET)

- [x] **DET-01**: A threshold evaluator runs at the end of `ingest` mode and computes per-test rolling metrics: flake rate over `flake-window-days`, p50/p95 duration, duration regression vs baseline
- [x] **DET-02**: A test is a flake candidate when: `flake_rate >= flake-rate-threshold` AND `run_count >= 10` (need enough data) AND no existing open healer PR for this test
- [x] **DET-03**: A test is a slow candidate when: `p95_duration_pct_increase >= slow-regression-pct` over the rolling window AND has not been recently healed
- [x] **DET-04**: In `log-only` dispatch mode (default for v0 rollout), detections are written to the action's step summary but no dispatch fires — lets consumers validate thresholds before enabling healing
- [ ] **DET-05**: In live dispatch mode, when a test crosses threshold, the action fires `workflow_dispatch` on a configurable healer-workflow file (default `.github/workflows/playwright-healer.yml`) with a self-contained JSON payload: commit SHA, test file, test title, fix-class hint, recent run stats
- [ ] **DET-06**: Dispatch uses the `healer-token` PAT (not `GITHUB_TOKEN`) so the eventual healer PR's CI will actually run
- [ ] **DET-07**: A concurrency group keyed on test file + test title prevents two simultaneous dispatches for the same test

### Security & Loop Prevention (SEC)

- [x] **SEC-01
**: Every `actions/checkout` step in the action sets `persist-credentials: false` so the token is never written into `.git/config` inside the runner workspace (guards against agent filesystem reads)
- [x] **SEC-02
**: Neither the ingest nor heal workflows define a `pull_request_target` trigger, ever — enforced by a CI lint in this repo's own workflows
- [ ] **SEC-03**: The Playwright MCP is launched with `--allowed-origins` constraining navigation to `base-url` + `http://localhost:*`
- [ ] **SEC-04**: The Claude Agent SDK is configured with an explicit `allowedTools` list: `["mcp__playwright__*", "Read", "Grep", "Glob"]`. `Bash`, `Write`, `Edit`, and other tools are not in that list; fix application happens outside the agent loop
- [x] **SEC-05**: Before dispatching a heal, loop-guard checks: (a) the triggering commit's author is not `playwright-healer-bot`, (b) the triggering commit message does not contain `[skip-healer]`, (c) the per-test heal count in the state branch is below `max-heals-per-test-per-week` (default 3)
- [x] **SEC-06
**: The action never logs the values of `api-key` (renamed from `anthropic-api-key` in 01.1), `healer-token`, or `github-token`; `@actions/core.setSecret` is called on each at startup. `setSecret('')` is a no-op, so the Ollama empty-api-key path preserves the branchless D-07 ordering.
- [x] **SEC-07
**: The action does not phone home (no telemetry HTTP calls); outbound HTTP calls are restricted to the selected provider's API (`api.anthropic.com`, `generativelanguage.googleapis.com` for Gemini, or the configured `api-endpoint` for Ollama) + `api.github.com`.

### Healer Runtime & Context (HEA)

- [ ] **HEA-01**: The healer workflow checks out the commit SHA from the dispatch payload (not `HEAD`) so the fix targets the version that actually failed
- [ ] **HEA-02**: An app-supervisor step runs `setup-command`, then `start-command` in the background, then polls `base-url` until a 200 OK response is received or a `startup-timeout-seconds` (default 120) elapses
- [ ] **HEA-03**: If the app-supervisor times out, the healer exits with a structured error and files an issue instead of attempting healing
- [ ] **HEA-04**: A context-bundler assembles, before the agent runs: (a) the full text of the failing test file, (b) the relative paths of files the test imports (one hop), (c) `git blame` for the failing test, (d) the Playwright trace.zip path if present, else `null`, (e) the last N error messages from recent reports
- [ ] **HEA-05**: When the trace.zip is missing or expired, the agent is invoked with a trace-free system-prompt variant that requires reproducing the failure live via Playwright MCP
- [ ] **HEA-06**: All healer workspace state (process handles, temp files) is cleaned up on every exit path (success, failure, timeout)

### Agent & Fix Application (FIX)

- [ ] **FIX-01**: The agent loop is driven by a provider-specific adapter selected via the `provider` input (`anthropic`, `gemini`, or `ollama` — added in Phase 01.1). Per-provider default models (can be overridden via `model` input): `anthropic` → `claude-sonnet-4-6` (`claude-opus-4-7` available for hard cases), `gemini` → `gemini-2.5-pro`, `ollama` → `llama3.1`. The adapter contract (tool allow-listing, budget accounting, streaming event shape) is provider-agnostic; see `src/shared/config.ts` `DEFAULT_MODELS` and `src/shared/security-contract.ts` for the canonical tool-naming form. Do not downgrade to retired Claude 3.x models.
- [ ] **FIX-02**: The agent is constrained by `maxTurns` (default 30) and a `maxBudgetUsd` enforced via a `PreToolUse` hook that aborts before exceeding budget rather than mid-call
- [ ] **FIX-03**: The agent's system prompt forbids: `waitForTimeout`, `nth-child`/positional XPath selectors, weakening assertions (`toBe` → `toBeTruthy`), modifying files outside the test directory
- [ ] **FIX-04**: The agent returns a structured proposal: `{ rootCause, fixClass, diff, rationale }`. The diff is applied to a working branch by the fix-applier — the agent itself does not have `Write` or `Edit` tools
- [ ] **FIX-05**: The fix-applier rebases the working branch onto `origin/$(default_branch)` before applying the diff, so stale SHAs don't produce merge conflicts downstream
- [ ] **FIX-06**: A diff-lint pass runs after the patch applies and fails the healer (without opening a PR) if the diff contains: `waitForTimeout`, positional selectors, relaxed assertion matchers, or touches any path outside the configured test-paths
- [ ] **FIX-07**: The healer supports all four fix classes: selectors, waits/timing, assertions, slow-test optimizations, each with its own system-prompt section; classes can be individually disabled via CFG-04
- [ ] **FIX-08**: When the agent returns "no fix proposable" or its proposal fails diff-lint, the healer transitions to issue-fallback (PRI-03)

### Validation (VAL)

- [ ] **VAL-01**: After the fix is applied, the healer re-runs the targeted test exactly `rerun-count` times with `retries: 0` (overriding any project retry config so individual pass/fail is visible)
- [ ] **VAL-02**: The validator records each re-run's outcome + duration and computes a pass rate
- [ ] **VAL-03**: A fix is accepted only when `pass_rate >= rerun-pass-rate` (default 9/10); below that, the healer transitions to issue-fallback
- [ ] **VAL-04**: Validation re-runs run against the same app instance the reproduction used; the healer does not restart the app between reruns in v1 (known limitation — documented for consumers)
- [ ] **VAL-05**: Validation results (run-by-run pass/fail + timings) are captured in a single `VALIDATION.md` artifact that ends up in both the PR description and the run's step summary

### PR & Issue Output (PRI)

- [ ] **PRI-01**: A successful validated fix becomes a PR opened by the `healer-token` identity, titled `[playwright-healer] Fix flaky <test title>`, with base = default branch and head = `playwright-healer/<test-slug>-<short-sha>`
- [ ] **PRI-02**: The PR description includes: root cause summary, fix class, validation pass rate, cost spent, links to the triggering run and relevant trace (if any), and a `Signed-off: playwright-healer-bot` footer
- [ ] **PRI-03**: When no fix can be proposed, fails validation, or the app cannot start, a structured GitHub issue is opened instead, titled `[playwright-healer] <test title> is unhealable`, with root cause, reproduction steps, and suggested manual debugging direction
- [ ] **PRI-04**: Before opening a PR or issue, the action queries for existing open PRs/issues with the same test identifier and updates the existing one (adding a comment with new evidence) rather than creating duplicates
- [ ] **PRI-05**: A test that fails deterministically (0/N reruns pass on the unmodified code) is classified as a probable application bug and routed to issue-fallback, never to a PR — fixing a real regression silently is the most dangerous failure mode
- [ ] **PRI-06**: Every bot commit message contains `[skip-healer]` so the loop-guard will not attempt to heal changes the bot itself made

### Auto-merge (MRG)

- [ ] **MRG-01**: Auto-merge is opt-in via `enable-auto-merge: true` in action inputs or repo config (default false)
- [ ] **MRG-02**: An auto-merge decision fires only when: validation pass rate ≥ `auto-merge-pass-rate` (default 1.0 = 10/10), fix class is in `auto-merge-fix-classes` allow-list (default `["selectors"]`), and the diff touches only paths inside the configured test directory
- [ ] **MRG-03**: When conditions hold, the action calls `gh pr merge --auto --squash` (or Octokit equivalent) so GitHub merges the PR once CI passes; it never merges without CI having passed
- [ ] **MRG-04**: Auto-merge decisions are logged to the run summary with the reasoning band (all conditions + "matched" / "blocked by X")

### Documentation (DOC)

- [ ] **DOC-01**: README explains the two-workflow architecture (ingest in main CI, heal dispatched separately) with a sequence diagram
- [ ] **DOC-02**: README includes a copy-paste example `playwright.yml` (consumer's test workflow) and `playwright-healer.yml` (the heal workflow) that a consumer can adapt in < 15 minutes
- [ ] **DOC-03**: README calls out the consumer prerequisites prominently: Playwright `trace: 'on'` or `retain-on-failure`, `upload-artifact` step, `actions: write` on ingest workflow OR a `healer-token` PAT
- [ ] **DOC-04**: README documents the required token scopes and the exact reason `GITHUB_TOKEN` alone doesn't work (citing GitHub's recursion guard)
- [ ] **DOC-05**: The repo includes a CHANGELOG and a `SECURITY.md` with a vulnerability reporting process

### Test Hygiene (TEST)

- [x] **TEST-01
**: `phase1-self-test.yml` runs end-to-end green on a fresh `ubuntu-latest` runner with no pre-existing test-design bugs — every scenario's assertion mechanism matches GitHub Actions' actual semantics (e.g., no reliance on per-step `$GITHUB_STEP_SUMMARY` for cross-step assertions; canary-mask tests pre-register the canary with the runner masker before the step header is emitted)

---

## v2 Requirements

Deferred. Not in the v1 roadmap.

### Trace-aware Analysis (TRC)

- **TRC-01**: The context-bundler extracts structured data from `trace.zip` (failing step, last N DOM snapshots, network HAR) using `npx playwright show-trace --json`
- **TRC-02**: The agent's system prompt surfaces trace-derived evidence explicitly, improving root-cause fidelity
- **TRC-03**: Confidence scoring upgrades from the v1 heuristic (fix class × pass rate × path scope) to a trace-aware band (LOW/MEDIUM/HIGH) that gates auto-merge

### Batch & Pattern Detection (PAT)

- **PAT-01**: Batch healing: group related flakes into a single PR when they share a locator, test fixture, or change pattern
- **PAT-02**: Cross-run pattern detection: surface "test X always fails on Sunday nights" / "test Y slow only on ubuntu-22.04" correlations
- **PAT-03**: Stale healer-branch rebase: daemon-style rebase of open healer PRs onto fresh default-branch commits

### Observability & Cost (OBS)

- **OBS-01**: Per-repo cost dashboard surfaced via step summaries or a GitHub Deployments integration
- **OBS-02**: Slack / webhook notification option for healed tests and unhealable tests

### Non-GitHub CI (EXT)

- **EXT-01**: Support for GitLab CI, CircleCI, Buildkite as the host CI — healer logic stays but the trigger, state, and PR surfaces abstract behind a provider interface

---

## Out of Scope

Explicitly excluded. Documented so they don't creep back in.

| Feature | Reason |
|---------|--------|
| Bundled JS action (`ncc`/`esbuild`) | Claude Agent SDK resolves native binaries via `import.meta.url`; bundlers break it. `ncc` also dropped Node 24 support |
| Python Agent SDK | TypeScript SDK pairs cleanly with the JS-ecosystem composite action; Python is a different product |
| Non-Playwright frameworks (Cypress, WebdriverIO, Jest UI) | Playwright MCP is central to the reproduction loop; other frameworks are different products |
| Fixing application logic bugs | Deterministic failures route to issues; silent app-bug "fixes" are the highest-trust risk |
| External state stores (S3, Supabase, custom DB) | Dedicated-branch gives durable, zero-infra state; external stores add adoption friction |
| Hosted SaaS | Self-hosted action avoids data-handling liability and lets consumers bring their own API key |
| Auto-merge enabled by default | Must be opt-in; safe default is review-requested PR |
| Blind (unvalidated) PRs | Every fix must validate with N re-runs or we erode trust |
| Running on fork PRs | `pull_request_target` is an exfiltration vector; secrets aren't available in fork PRs anyway |
| Healing on every CI run | Threshold gate is the noise guard; unconditional healing would spam PRs |
| `waitForTimeout`, positional selectors, weakened assertions in proposed fixes | Anti-patterns — blocked by both system prompt AND diff-lint as defense-in-depth |
| Owner @-mentions via `git blame` in v1 | Deferred; issues are the v1 notification channel to keep scope tight |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PKG-01 | Phase 1 | Complete |
| PKG-02 | Phase 1 | Complete |
| PKG-03 | Phase 6 | Pending |
| PKG-04 | Phase 6 | Pending |
| PKG-05 | Phase 6 | Pending |
| CFG-01 | Phase 1 | Pending |
| CFG-02 | Phase 1 | Complete |
| CFG-03 | Phase 2 | Complete |
| CFG-04 | Phase 3 | Pending |
| CFG-05 | Phase 1 | Pending |
| CFG-06 | Phase 2 | Complete |
| CFG-07 | Phase 2 | Complete |
| ING-01 | Phase 2 | Complete |
| ING-02 | Phase 2 | Complete |
| ING-03 | Phase 2 | Complete |
| ING-04 | Phase 2 | Complete |
| STA-01 | Phase 2 | Complete |
| STA-02 | Phase 2 | Complete |
| STA-03 | Phase 2 | Complete |
| STA-04 | Phase 2 | Complete |
| STA-05 | Phase 2 | Complete |
| DET-01 | Phase 2 | Complete |
| DET-02 | Phase 2 | Complete |
| DET-03 | Phase 2 | Complete |
| DET-04 | Phase 2 | Complete |
| DET-05 | Phase 4 | Pending |
| DET-06 | Phase 4 | Pending |
| DET-07 | Phase 4 | Pending |
| SEC-01 | Phase 1 | Pending |
| SEC-02 | Phase 1 | Pending |
| SEC-03 | Phase 3 | Pending |
| SEC-04 | Phase 3 | Pending |
| SEC-05 | Phase 2 | Complete |
| SEC-06 | Phase 1 | Pending |
| SEC-07 | Phase 1 | Pending |
| HEA-01 | Phase 3 | Pending |
| HEA-02 | Phase 3 | Pending |
| HEA-03 | Phase 3 | Pending |
| HEA-04 | Phase 3 | Pending |
| HEA-05 | Phase 3 | Pending |
| HEA-06 | Phase 3 | Pending |
| FIX-01 | Phase 3 | Pending |
| FIX-02 | Phase 3 | Pending |
| FIX-03 | Phase 3 | Pending |
| FIX-04 | Phase 3 | Pending |
| FIX-05 | Phase 3 | Pending |
| FIX-06 | Phase 3 | Pending |
| FIX-07 | Phase 4 | Pending |
| FIX-08 | Phase 3 | Pending |
| VAL-01 | Phase 3 | Pending |
| VAL-02 | Phase 3 | Pending |
| VAL-03 | Phase 3 | Pending |
| VAL-04 | Phase 3 | Pending |
| VAL-05 | Phase 3 | Pending |
| PRI-01 | Phase 3 | Pending |
| PRI-02 | Phase 3 | Pending |
| PRI-03 | Phase 3 | Pending |
| PRI-04 | Phase 4 | Pending |
| PRI-05 | Phase 3 | Pending |
| PRI-06 | Phase 3 | Pending |
| MRG-01 | Phase 5 | Pending |
| MRG-02 | Phase 5 | Pending |
| MRG-03 | Phase 5 | Pending |
| MRG-04 | Phase 5 | Pending |
| DOC-01 | Phase 6 | Pending |
| DOC-02 | Phase 6 | Pending |
| DOC-03 | Phase 6 | Pending |
| DOC-04 | Phase 6 | Pending |
| DOC-05 | Phase 6 | Pending |
| TEST-01 | Phase 01.3 | Complete |

**Coverage:**
- v1 requirements: **70** total (across 13 categories)
- Mapped to phases: **70** (100%)
- Unmapped: **0**

Note: The metadata block previously stated "67 total (across 11 categories)" — the actual count is now 70 across 13 categories (PKG, CFG, ING, STA, DET, SEC, HEA, FIX, VAL, PRI, MRG, DOC, TEST). The TEST category was added in Phase 01.3 to track CI test-design correctness invariants surfaced when prior phases unmasked latent test-design bugs.

---

*Requirements defined: 2026-04-24*
*Last updated: 2026-04-24 — traceability table populated during roadmap creation*
