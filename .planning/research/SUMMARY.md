# Project Research Summary

**Project:** playwright-healer
**Domain:** AI-driven Playwright test remediation GitHub Action (agent + browser automation + PR bot)
**Researched:** 2026-04-24
**Confidence:** HIGH

---

## Executive Summary

playwright-healer closes the loop from flake detection to validated fix: it ingests Playwright JSON reports on every CI run, tracks rolling per-test health on a dedicated `playwright-healer-state` branch, and when a test crosses configurable thresholds it dispatches a companion healer workflow. That workflow uses the Claude Agent SDK with the Playwright MCP to reproduce the failure live, diagnose the root cause, propose a minimal surgical fix in one of four fix classes (selectors, waits/timing, assertions, slow-test optimizations), validate the fix by re-running the test N times, and open a PR or structured issue. No adjacent tool (Currents, Buildkite, Datadog, GitHub Copilot) does all four pipeline stages — detection, diagnosis, validated fix, and PR — in a single self-hosted, bring-your-own-key package.

**Packaging correction (overrides PROJECT.md Key Decision #6):** The action must be packaged as a **composite action**, not a bundled JS action via ncc. The Claude Agent SDK spawns a platform-specific native binary and resolves it via `import.meta.url` at runtime. Bundlers redirect this into a virtual path where the binary does not exist. vercel/ncc issue #1297 was closed as "not planned" for Node 24, and GitHub forces node24 by June 2, 2026. The composite action pattern — `npm ci --production` at runtime — is confirmed by Anthropic's own `claude-code-action`. This is the correct packaging approach and is not negotiable.

The primary risks are security (four architecturally-binding pitfalls must be addressed before agent code is written), trust erosion (PRs without validation re-runs will be ignored or reverted), and unbounded cost (agent loops without `maxTurns` and `maxBudgetUsd` can exhaust API budget in a single run against a persistently failing test). All three risks have clear mitigations that must be built into the foundation, not retrofitted.

---

## Key Findings

### Recommended Stack

See `STACK.md` for full details, versions, and integration code.

**Core technologies:**

| Technology | Version | Purpose |
|------------|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | 0.2.119 | Agent loop: tool use, MCP orchestration, token budget enforcement |
| `@playwright/mcp` | 0.0.70 | Browser-driving tool surface for the agent (first-party Microsoft) |
| `@actions/core` | 3.0.1 | Input parsing, secret masking, annotations |
| `@actions/github` | 9.1.1 | Pre-authenticated Octokit for GITHUB_TOKEN operations |
| `@actions/exec` | 3.0.0 | Spawn and capture Playwright re-runs |
| `@octokit/rest` | 22.0.1 | PAT-authenticated operations (workflow_dispatch, PAT PR creation) |
| `zod` | 3.25.x | Validate Playwright JSON report schema at runtime — the schema is undocumented and drifts between majors |

**Model:** `claude-sonnet-4-6` default; `claude-opus-4-7` opt-in escalation (requires SDK ≥ 0.2.111).

**Critical open question:** Whether `npm ci --production` correctly installs the platform-specific optional dep (`@anthropic-ai/claude-agent-sdk-linux-x64`) on `ubuntu-latest` without `pathToClaudeCodeExecutable` is **unverified**. This is the first thing to validate in Phase 0 before any agent code is written.

---

### Expected Features

See `FEATURES.md` for full table with complexity ratings and competitor analysis.

**Must have for v1 (table stakes):**
- Playwright JSON report parsing — without this, nothing starts
- Rolling flake/slow detection with configurable thresholds (default: 20% flake rate, 7-day window)
- Failure reproduction on a clean runner (user-provided `setup-command`, `start-command`, `base-url`)
- Structured root-cause analysis artifact — the floor guarantee even when no fix is possible
- Fix proposal for all four classes: selectors, waits/timing, assertions, slow-test optimizations
- **Validation re-runs: N passes before any PR is opened** — this is the trust mechanism; without it the action generates noise
- Safe PR opening (branch from default, rebase before open, never clobber user branches)
- Structured issue filing when no fix is found or when a test fails deterministically (deterministic fail = app bug, not a flake)
- Per-run cost bound via `max-budget-usd`
- Per-fix-class enable/disable toggles
- Dry-run mode — essential for first adoption without write permissions
- Documentation and copy-paste example workflow

**Consumer prerequisites (must be documented prominently):**
- Playwright trace artifact uploaded with `trace: 'on'` or `retain-on-failure` (not `on-first-retry`) and `upload-artifact` before the ingest step
- `actions: write` permission or a PAT (`healer-token` input) for `workflow_dispatch` to trigger downstream CI on healer PRs

**Should have (v1.x — after core validation):**
- Trace-aware analysis (reads Playwright `.zip` traces for richer diagnostic signal)
- Confidence scoring (depends on trace analysis for maximum signal quality)
- Auto-merge opt-in (depends on confidence scoring; gates on HIGH confidence + CI green)
- Stale branch rebase
- Batch healing (one PR per group of related flakes)

**Defer to v2+:**
- Cross-run pattern detection (time-of-day/day-of-week correlation)
- Cost dashboard / budget alerting across repos
- Non-GitHub CI support

**Anti-features — do not build:**
- Blind auto-merge without validation re-runs
- Healing deterministically failing tests (deterministic fail = file issue, not fix)
- Modifying non-test production code
- Running on fork PRs
- Triggering healing on every CI run (threshold gate is the guard)

---

### Architecture Approach

See `ARCHITECTURE.md` for full component diagram, data flows, and integration code.

The system is **two workflows with an async handoff**: an ingest workflow (every CI push — must be fast and cheap) and a healer workflow (triggered via `workflow_dispatch` only on threshold breach). The `workflow_dispatch` payload is self-contained; the healer never reads the state branch. This decouples the workflows and makes the healer independently testable with fixture payloads.

**Major components and build phase:**

| Component | Responsibility | Build phase |
|-----------|----------------|-------------|
| `report-parser` | Playwright JSON → typed `TestResult[]` | v0 |
| `state-branch` | `--force-with-lease` retry loop, NDJSON append, bootstrap, GC | v0 |
| `stats-writer` | Append per-run record to state branch on every CI push | v0 |
| `threshold-evaluator` | Rolling window analysis; log-only in v0, dispatch in v1 | v0 → v1 |
| `config` | Merge action.yml inputs + `.github/playwright-healer.yml`; Zod-validated | v0 |
| `loop-guard` | Commit author check, `[skip-healer]` sentinel, per-test heal cap | v0 |
| `context-bundler` | Test source, trace.zip (null if expired), blame, recent PRs | v1 |
| `app-supervisor` | Run setup/start commands; poll base-url until ready | v1 |
| `agent-runner` | Claude Agent SDK + Playwright MCP; scoped tools; budget hook | v1 |
| `fix-applier` | Apply diff; rebase onto `origin/HEAD`; re-run N times with `retries: 0` override | v1 |
| `validator` | Pass rate computation; threshold gate | v1 |
| `pr-writer` | PR creation (PAT) or issue creation (fallback) | v1 |

**Key patterns:** pre-assembled `ContextBundle` before agent loop (agent-runner is unit-testable with fixtures); `PreToolUse` budget hook (abort before budget exceeded, not mid-call); rebase-then-validate; NDJSON append-only state.

---

### Critical Pitfalls

See `PITFALLS.md` for all 10 HIGH-severity pitfalls with recovery strategies and phase mapping.

**Four architecturally-binding pitfalls — must be addressed in Phase 0 before agent code is written:**

1. **`GITHUB_TOKEN` cannot trigger CI on bot-opened PRs** — PRs opened by `GITHUB_TOKEN` receive vacuous "all checks passed" (no CI runs fire). Use a PAT or GitHub App token via the `healer-token` input for PR creation. This is a consumer requirement that must be documented prominently.

2. **`pull_request_target` is an exfiltration vector** — Never use `pull_request_target`. Real CVEs (GHSA-89qq-hgvp-x37m, CVSS 9.3) confirm active exploitation. Healer must only be triggered via `workflow_dispatch` from a trusted caller.

3. **`persist-credentials: false` must be set** — `actions/checkout` defaults to `persist-credentials: true`, storing the token in `.git/config` in the workspace. The agent runs in that same workspace. Always set `persist-credentials: false` before any agent step; authenticate separately for the git-push step.

4. **Playwright MCP filesystem scoping** — `allowedTools` must be explicit: `["mcp__playwright__*", "Read", "Grep", "Glob"]`. Never include `Bash` or filesystem write tools. Use `--allowed-origins` to restrict browser navigation to localhost and `base-url`. All page content is untrusted (prompt injection vector).

**Additional pitfalls addressed in agent system prompt and diff lint:**
- Weakened assertions (`toBe` → `toBeTruthy`) — system prompt prohibits loosening assertion specificity; diff lint blocks it
- `waitForTimeout` anti-pattern — system prompt and diff lint block fixed delays; require `waitForSelector`/`waitForLoadState`
- `nth-child` / XPath positional selectors — system prompt and diff lint require Playwright semantic locators

---

## Implications for Roadmap

The architecture research explicitly proposes a v0/v1/v2/v3 build order. Translated to roadmap phases:

### Phase 0: Security Scaffold + Observability Foundation

**Rationale:** Build and validate the most dangerous infrastructure — security boundaries and git-as-DB — at zero API cost before any agent code is written. The four binding pitfalls all land here.

**Delivers:**
- Composite `action.yml` scaffold with `healer-token` input (PAT path for PR creation)
- `persist-credentials: false` on all checkout steps
- `pull_request_target` explicitly absent from all workflow triggers
- `report-parser`, `state-branch`, `stats-writer`, `threshold-evaluator` (log-only), `config`, `loop-guard`
- State branch bootstrap protocol (first-run orphan branch creation + concurrent push retry loop)

**Validation gate before Phase 1:** Concurrent state branch write test; native SDK binary smoke test on `ubuntu-latest`; Playwright Chromium install in composite action.

**Research flag:** Standard patterns — no research phase needed.

---

### Phase 1: Manual Healer (Selectors + Waits, Manually Dispatched)

**Rationale:** Wire the healer workflow triggered manually via `workflow_dispatch` (not yet auto-dispatched). Build `agent-runner` and `fix-applier` together — they are tightly coupled through the diff format. Selectors and waits/timing are the lowest-risk fix classes to validate first.

**Delivers:**
- `context-bundler`, `app-supervisor`, `agent-runner`, `fix-applier`, `validator`, `pr-writer`
- Agent system prompt: semantic locators only, no `waitForTimeout`, no assertion weakening, MCP scoped tool list, `maxTurns` cap, `maxBudgetUsd` hard cap
- Diff lint: block `nth-child`, `waitForTimeout`, assertion relaxation before PR opens
- Path allowlist: block PRs touching files outside test directory
- Fix classes: selectors + waits/timing
- PR creation using `healer-token` (PAT) when provided; structured issue as fallback

**Research flag:** Agent system prompt structure is the highest-uncertainty deliverable — no established template for a four-stage CI remediation loop. Budget iteration time.

---

### Phase 2: Auto-Dispatch + Full Fix Classes + Issue Fallback

**Rationale:** Wire threshold evaluator to auto-dispatch. Add assertions and slow-test fix classes. Add issue fallback (deterministic fail → issue, not fix). Address validation re-run state pollution.

**Delivers:**
- Threshold evaluator switches to actual `workflow_dispatch`
- Fix classes: assertions + slow-test optimizations
- Issue fallback: deterministic fail → structured issue with RCA
- `reset-command` config input for state isolation between validation re-runs
- Deduplication: check for existing open healer PR before creating a new one

**Research flag:** Assertion fix class system prompt design — the boundary between "fix a flaky assertion" and "weaken an assertion catching a real bug" requires careful prompt engineering. Consider a research phase for this sub-topic.

---

### Phase 3: Trace Analysis + Confidence Scoring + Auto-Merge

**Rationale:** Trace analysis → confidence scoring → auto-merge is a strict dependency chain from FEATURES.md. Build in order.

**Delivers:**
- Trace-aware analysis: extract failing step + last N DOM snapshots from `trace.zip`
- Confidence scoring: fix class × re-run pass rate × trace evidence → LOW/MEDIUM/HIGH band
- Auto-merge opt-in: fires only when confidence = HIGH, CI green (via non-bot token), fix class in allow-list, no files outside test directory changed

**Research flag:** Playwright trace.zip internal format is undocumented. `npx playwright show-trace --json` is the proposed extraction path — validate before implementing.

---

### Phase 4: Batch Healing + Cross-Run Patterns

**Rationale:** Features requiring adoption history. Batch healing reduces PR spam on repos with correlated flakes. Cross-run pattern detection requires weeks of state branch data.

**Research flag:** Both features have HIGH complexity and sparse prior art. Plan a research phase before implementation.

---

### Phase Ordering Rationale

- Security scaffold before agent code: the four binding pitfalls are architectural and expensive to retrofit
- Observability before agent loop: state branch race conditions cost nothing to find without the API running
- Manual dispatch before auto-dispatch: decouples debugging the agent from debugging the trigger mechanism
- Validation re-runs before auto-merge (and PAT-triggered CI before auto-merge): every node in the trust chain must be stable before the terminal node is built
- Trace analysis → confidence scoring → auto-merge: explicit dependency chain from FEATURES.md; no shortcuts

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified against npm registry; composite action pattern confirmed against Anthropic's production `claude-code-action`; ncc Node 24 closure confirmed |
| Features | HIGH (table stakes), MEDIUM (differentiators) | Table stakes from competitor analysis of Currents, Buildkite, Datadog, Copilot Agent; differentiator estimates from public docs |
| Architecture | HIGH | Two-workflow topology, dispatch payload pattern, state branch concurrency protocol cross-referenced against GitHub Actions docs |
| Pitfalls | HIGH | Verified against official GitHub docs, Anthropic SDK docs, live CVEs (GHSA-89qq-hgvp-x37m), and community post-mortems |

**Overall confidence:** HIGH

### Gaps to Address

- **Native binary discovery on GitHub-hosted runners:** Unverified. Must be smoke-tested in Phase 0 before building the agent loop.
- **Playwright trace.zip internal format:** Not formally documented. Validate `npx playwright show-trace --json` before Phase 3.
- **Agent system prompt structure:** No established template for a four-stage CI remediation loop. Budget iteration time in Phase 1.
- **Validation re-run state pollution:** Known limitation for tests that create persistent data. Document in Phase 1; address with `reset-command` in Phase 2.

---

## Sources

### Primary (HIGH confidence)
- `STACK.md` — composite action pattern, SDK versions, token architecture, JSON report schema
- `FEATURES.md` — table stakes matrix, competitor analysis, MVP definition, anti-features
- `ARCHITECTURE.md` — component diagram, data flows, concurrency model, build order
- `PITFALLS.md` — 10 HIGH-severity pitfalls, recovery strategies, phase mapping
- [Claude Agent SDK TypeScript Reference](https://code.claude.com/docs/en/agent-sdk/typescript) — `query()` API, `mcpServers`, `maxBudgetUsd`, `permissionMode`
- [claude-code-action action.yml](https://github.com/anthropics/claude-code-action/blob/main/action.yml) — composite action pattern confirmed in Anthropic's own production action
- [pgai Security Advisory GHSA-89qq-hgvp-x37m](https://github.com/timescale/pgai/security/advisories/GHSA-89qq-hgvp-x37m) — `pull_request_target` exfiltration, CVSS 9.3
- [yossarian.net: actions/checkout credential leak](https://yossarian.net/til/post/actions-checkout-can-leak-github-credentials/) — `persist-credentials` default behavior
- [vercel/ncc issue #1297](https://github.com/vercel/ncc/issues/1297) — closed as not planned for Node 24

### Secondary (MEDIUM confidence)
- [Currents.dev Flaky Tests](https://docs.currents.dev/dashboard/tests/flaky-tests) — rolling window patterns
- [Datadog Test Visibility](https://docs.datadoghq.com/tests/flaky_management/) — 20× retry confirmation pattern
- [Buildkite Test Engine](https://buildkite.com/platform/test-engine/) — quarantine and monitor types
- [GitHub Copilot coding agent](https://github.blog/news-insights/product-news/github-copilot-meet-the-new-coding-agent/) — self-healing before PR pattern

---

*Research completed: 2026-04-24*
*Ready for roadmap: yes*
