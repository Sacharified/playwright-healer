# Architecture Research

**Domain:** GitHub Action — CI test health automation with AI-driven remediation
**Researched:** 2026-04-24
**Confidence:** HIGH

## System Overview

The system spans two distinct GitHub Actions workflows that run in different contexts and have an explicit, async handoff point. Understanding this two-workflow topology is the foundation of every architectural decision.

```
WORKFLOW 1: Main CI (runs on every push / PR)
┌──────────────────────────────────────────────────────────────┐
│  Consumer's existing Playwright step                          │
│  → produces: playwright-report/results.json                  │
│  → uploads:  trace.zip as artifact (required — see notes)    │
│                                                               │
│  ┌────────────────────────────────────┐                       │
│  │  uses: playwright-healer/ingest    │  ← action entrypoint  │
│  │  (ingest + stats-writer)           │                       │
│  │  1. Parse results.json             │                       │
│  │  2. Build stats record             │                       │
│  │  3. Fetch playwright-healer-state  │                       │
│  │     (bootstrap if first run)       │                       │
│  │  4. Append → stats.ndjson          │                       │
│  │  5. push --force-with-lease        │                       │
│  │  (retry up to 5× on rejection)    │                       │
│  └──────────────┬─────────────────────┘                       │
│                 │                                             │
│  ┌──────────────▼─────────────────────┐                       │
│  │  Threshold evaluator               │                       │
│  │  1. Read rolling window from branch │                       │
│  │  2. Compute flake rate / p95 drift  │                       │
│  │  3. For each breached test:         │                       │
│  │     → workflow_dispatch →           │                       │
│  │       playwright-healer-heal.yml    │                       │
│  └────────────────────────────────────┘                       │
└──────────────────────────────────────────────────────────────┘
                         │  dispatch payload (JSON)
                         ▼
WORKFLOW 2: Healer (triggered via workflow_dispatch)
┌──────────────────────────────────────────────────────────────┐
│  concurrency: healer-${{ test_id }}, cancel-in-progress: false│
│                                                               │
│  ┌───────────────────────────────────┐                        │
│  │  Context bundler                  │                        │
│  │  - checkout repo @ default branch │                        │
│  │  - load dispatch payload          │                        │
│  │  - read test source file          │                        │
│  │  - download trace.zip (artifact)  │                        │
│  │    (null if artifact expired)     │                        │
│  │  - read report fragment           │                        │
│  │  - git blame + recent PR list     │                        │
│  └──────────────┬────────────────────┘                        │
│                 │                                             │
│  ┌──────────────▼────────────────────┐                        │
│  │  Healer orchestrator              │                        │
│  │  runs: setup-command              │                        │
│  │  runs: start-command (background) │                        │
│  │  waits: base-url to respond       │                        │
│  └──────────────┬────────────────────┘                        │
│                 │                                             │
│  ┌──────────────▼────────────────────┐                        │
│  │  Agent runner                     │                        │
│  │  @anthropic-ai/claude-agent-sdk   │                        │
│  │  + @playwright/mcp (stdio)        │                        │
│  │  - reproduce failure              │                        │
│  │  - diagnose root cause            │                        │
│  │  - propose fix (one of 4 classes) │                        │
│  │  - token budget enforced via hook │                        │
│  └──────────────┬────────────────────┘                        │
│                 │                                             │
│  ┌──────────────▼────────────────────┐                        │
│  │  Fix applier + validator          │                        │
│  │  - apply diff to test file        │                        │
│  │  - rebase onto default branch     │                        │
│  │  - re-run test N times            │                        │
│  │  - compute pass rate              │                        │
│  │  - gate: pass rate ≥ threshold?   │                        │
│  └──────────────┬────────────────────┘                        │
│                 │                                             │
│  ┌──────────────▼────────────────────┐                        │
│  │  PR / Issue writer                │                        │
│  │  pass: open PR with evidence      │                        │
│  │  fail: open Issue with analysis   │                        │
│  └───────────────────────────────────┘                        │
└──────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | Interface |
|-----------|----------------|-----------|
| **Ingest / stats-writer** | Parse Playwright JSON report; build a stats record; append to `stats.ndjson` on `playwright-healer-state` branch | Input: report path, run metadata. Output: updated branch |
| **Threshold evaluator** | Read rolling window from state branch; detect flake-rate and duration-regression breaches; fire `workflow_dispatch` per breached test | Input: config thresholds, window size. Output: dispatch events or no-op |
| **Context bundler** | Assemble the agent's starting context: test source, trace zip, report fragment, blame, recent PRs | Input: dispatch payload. Output: context object passed to agent runner |
| **Healer orchestrator** | Run setup/start commands; wait for app readiness; supervise agent runner; tear down | Input: action.yml inputs. Output: fix result or failure signal |
| **Agent runner** | Run Claude Agent SDK loop with Playwright MCP; reproduce failure; diagnose; propose fix; respect token budget | Input: context bundle + prompt. Output: proposed diff + root-cause text |
| **Fix applier + validator** | Apply agent's diff; rebase onto default branch; re-run test N times; compute pass rate; gate on threshold | Input: diff, test-command. Output: validation result (pass/fail + evidence) |
| **PR / Issue writer** | Open PR with fix + evidence, or issue with analysis; handle auto-merge opt-in | Input: validation result, config. Output: PR or Issue URL |
| **Config schema** | Validate and merge action.yml inputs with `.github/playwright-healer.yml` repo config | Input: raw inputs + file. Output: typed config object |
| **State branch manager** | All git operations on `playwright-healer-state`: bootstrap on first run, fetch, append, push-with-lease, retry | Isolated module used only by ingest and threshold evaluator |

## Recommended Project Structure

```
playwright-healer/
├── action.yml                    # Ingest action entrypoint (main CI use)
├── healer-action.yml             # Healer action entrypoint (dispatched workflow)
├── dist/
│   ├── ingest/index.js           # ncc bundle: ingest + threshold + state-branch
│   └── healer/index.js           # ncc bundle: orchestrator + agent + validator + PR
├── src/
│   ├── ingest/
│   │   ├── index.ts              # Main entrypoint: parse → write → evaluate → dispatch
│   │   ├── report-parser.ts      # Playwright JSON → internal TestResult[]
│   │   ├── stats-writer.ts       # Append record to stats.ndjson on state branch
│   │   └── threshold-evaluator.ts # Rolling window analysis + dispatch trigger
│   ├── healer/
│   │   ├── index.ts              # Main entrypoint: orchestrate full heal pass
│   │   ├── context-bundler.ts    # Assemble agent context from dispatch payload
│   │   ├── app-supervisor.ts     # setup-command / start-command / readiness probe
│   │   ├── agent-runner.ts       # Claude Agent SDK + Playwright MCP wiring
│   │   ├── fix-applier.ts        # Apply diff, rebase, re-run
│   │   ├── validator.ts          # Re-run N times, compute pass rate
│   │   └── pr-writer.ts          # Open PR or Issue via Octokit
│   ├── shared/
│   │   ├── config.ts             # Config schema: merge action inputs + yml file
│   │   ├── state-branch.ts       # All git ops on playwright-healer-state
│   │   ├── types.ts              # Shared type definitions
│   │   └── loop-guard.ts         # Healing loop prevention checks
│   └── test/
│       ├── fixtures/
│       │   ├── sample-report.json      # Playwright JSON report fixture
│       │   ├── sample-trace.zip        # Trace fixture for agent tests
│       │   └── sample-stats.ndjson     # Seeded state branch fixture
│       ├── unit/
│       │   ├── report-parser.test.ts
│       │   ├── threshold-evaluator.test.ts
│       │   ├── config.test.ts
│       │   └── loop-guard.test.ts
│       ├── component/
│       │   ├── state-branch.test.ts    # Uses local bare git repo
│       │   └── fix-applier.test.ts
│       └── e2e/
│           └── healer-fixture-repo/    # Seeded repo with flaky test
├── examples/
│   ├── basic-workflow.yml        # Drop-in example for consuming repos
│   └── advanced-workflow.yml     # Full config with all options
└── .github/
    ├── workflows/
    │   └── ci.yml                # Self-tests for the action repo
    └── playwright-healer.yml     # Example config file (also the schema source)
```

### Structure Rationale

- **Two separate ncc bundles (ingest + healer):** The ingest bundle runs on every CI push; it must be small and fast. The healer bundle includes the Agent SDK, MCP client, and Octokit — it only runs during repair passes. Splitting keeps ingest startup time minimal.
- **`shared/` for cross-bundle code:** Config parsing, the state-branch manager, and loop-guard are needed by both entrypoints. Built once, imported by both.
- **`src/test/fixtures/`:** All integration tests run against static fixtures. No live Playwright, no live API calls except in nightly e2e.
- **`examples/` workflows:** Consumer adoption path is copy-paste; keeping working examples in the repo ensures they stay current.

## Data Flow

### Flow 1: Ingest (runs every CI push)

```
[Consumer CI Job]
    │
    ├─ Playwright runs → produces results.json (+ trace.zip as artifact)
    │   Consumer MUST: upload-artifact for playwright-report/ before ingest step
    │   Consumer MUST: use trace: 'on' or 'retain-on-failure' (not 'on-first-retry')
    │
    └─ playwright-healer/ingest step:
        │
        ├─ report-parser.ts
        │   Input:  results.json path (action input)
        │   Output: TestResult[] with {testId, file, title, status,
        │            durationMs, retries, errorSignature, runId, sha, ts}
        │
        ├─ state-branch.ts  [bootstrap if needed → fetch → read → append → push-with-lease]
        │   Input:  TestResult[], run metadata
        │   Action: git fetch origin playwright-healer-state
        │            IF branch does not exist (exit code 128):
        │              git checkout --orphan playwright-healer-state
        │              git rm -rf .
        │              echo "" > stats.ndjson
        │              git add stats.ndjson && git commit -m "chore: init healer state [skip-healer]"
        │              git push -u origin playwright-healer-state
        │            append NDJSON record to stats.ndjson
        │            git push --force-with-lease
        │            on rejection: re-fetch, re-append, retry (max 5, jitter)
        │   Output: updated state branch
        │
        └─ threshold-evaluator.ts
            Input:  stats.ndjson (last N days from state branch)
            Action: for each test, compute:
                     flake_rate = failed_runs / total_runs (window)
                     duration_p95 vs baseline_p95
                    if breach: call GitHub API workflow_dispatch
            Output: dispatch events (or no-op)
```

**Dispatch payload shape** (self-contained; healer never re-reads state branch to start):
```json
{
  "test_id": "tests/auth.spec.ts::Login::should redirect",
  "test_file": "tests/auth.spec.ts",
  "trigger_reason": "flake",
  "window_stats": {
    "flake_rate": 0.42,
    "run_count": 12,
    "window_days": 7
  },
  "last_failure": {
    "sha": "abc123",
    "run_url": "https://github.com/...",
    "run_id": "987654321",
    "error_signature": "TimeoutError: waiting for selector .submit-btn"
  },
  "config_snapshot": {
    "setup_command": "npm ci",
    "start_command": "npm run dev",
    "test_command": "npx playwright test",
    "base_url": "http://localhost:3000",
    "rerun_count": 5,
    "pass_rate_threshold": 0.8,
    "fix_classes": ["selectors", "waits", "assertions", "slow-tests"],
    "token_budget_usd": 1.0
  }
}
```

### Flow 2: Healer (runs on workflow_dispatch)

```
[Healer Workflow starts]
    │
    ├─ loop-guard.ts: check dispatch payload author / per-test heal count
    │   Gate: skip if heal cap reached (max 2 heals per test per 7 days)
    │
    ├─ context-bundler.ts
    │   Input:  dispatch payload
    │   Reads:  test source file (git checkout)
    │           trace.zip (download artifact by run_id)
    │             → null if artifact missing/expired (>90 days default)
    │             → agent prompt adapts: trace-free diagnostic path
    │           report fragment for this test (from artifact)
    │           git blame of test file
    │           last 5 PRs touching test file (GitHub API)
    │   Output: ContextBundle {testSource, trace, reportFragment,
    │                          blame, recentPRs, dispatchPayload}
    │           (trace is string | null; agent runner handles both cases)
    │
    ├─ app-supervisor.ts
    │   1. Run setup-command (blocking)
    │   2. Run start-command (background process, capture PID)
    │   3. Poll base-url until HTTP 200 or timeout (60s default)
    │   Failure: emit structured error; write issue; exit
    │
    ├─ agent-runner.ts
    │   Config:
    │     mcpServers: { playwright: { command: "npx", args: ["@playwright/mcp@latest"] } }
    │     allowedTools: ["mcp__playwright__*", "Read", "Grep", "Glob"]
    │     hooks: { PreToolUse: [tokenBudgetGuard] }  ← aborts if budget exceeded
    │   Prompt: structured prompt with ContextBundle injected
    │           (two prompt variants: with-trace and without-trace)
    │   Output: { diff: string, rootCause: string, fixClass: FixClass }
    │             or { noFix: true, rootCause: string }
    │
    ├─ fix-applier.ts  (only if agent returns a diff)
    │   1. Write diff to working tree
    │   2. git rebase origin/default-branch (fix drift prevention)
    │   3. Run test-command for the specific test file (--workers=1)
    │   4. Record pass/fail for each of N runs
    │   Note: validation assumes app is still running from app-supervisor
    │         app state between reruns is NOT reset (see Known Limitations)
    │   Output: ValidationResult { passCount, totalRuns, passRate }
    │
    └─ pr-writer.ts
        if passRate ≥ pass_rate_threshold:
          create branch healer/fix-{test_id_slug}-{sha}
          commit fix (message includes [skip-healer] sentinel)
          open PR with: rootCause, diff, validation evidence, confidence band
          if auto_merge enabled for fixClass AND CI green: enable auto-merge
        else (low pass rate OR noFix):
          open Issue with: rootCause, reproduction notes, debugging hints
```

### Consumer Workflow Requirements (Hard Prerequisites)

Before the ingest step can function, consuming repos must configure their workflow:

1. **Playwright JSON reporter enabled:**
   ```yaml
   # playwright.config.ts
   reporter: [['json', { outputFile: 'playwright-report/results.json' }]]
   ```

2. **Artifact upload before ingest step:**
   ```yaml
   - uses: actions/upload-artifact@v4
     if: always()
     with:
       name: playwright-report-${{ github.run_id }}
       path: playwright-report/
   ```

3. **Trace mode set to `on` or `retain-on-failure`** (not `on-first-retry`): `on-first-retry` emits a trace only after the first retry, which means the initial failure that triggers healing will have no trace.

If the artifact is missing or expired when the healer runs, `context-bundler` sets `traceZipPath: null`. The agent runner's prompt switches to a trace-free diagnostic path that relies on the error message, accessibility snapshot, and live Playwright MCP reproduction — sufficient for selector and timing fixes, less effective for race conditions.

### State Branch Update Protocol (Concurrency-Safe)

The `playwright-healer-state` branch is an orphan branch containing a single file `stats.ndjson` (append-only NDJSON, one JSON object per line per CI run). It has no commit history to protect — the entire value is in the file content.

```
BOOTSTRAP (first-ever run — branch does not exist):

git fetch origin playwright-healer-state 2>&1
→ if exit code 128 (branch not found):
    git checkout --orphan playwright-healer-state
    git rm -rf .
    echo "" > stats.ndjson
    git add stats.ndjson
    git commit -m "chore: init healer state [skip-healer]"
    git push -u origin playwright-healer-state
    (two simultaneous first-runs → one wins, one falls into retry loop below)

SAFE UPDATE SEQUENCE (retried up to 5× with exponential jitter):

1. git fetch origin playwright-healer-state
2. git checkout playwright-healer-state -- stats.ndjson
3. Append new record to stats.ndjson (local)
4. git add stats.ndjson && git commit -m "stats: run {run_id} [skip-healer]"
5. git push --force-with-lease origin playwright-healer-state
   └── On 403/non-fast-forward rejection:
       sleep(100ms * 2^attempt + jitter)
       go to step 1

CONFLICT OUTCOME:
- Two concurrent pushes → one wins, one retries
- Retry fetches winner's commit, appends on top
- Both records land; order may differ from wall-clock order (acceptable)
- After 5 failures: log warning, skip state update (non-fatal; run data lost for this push)
```

The `[skip-healer]` marker appears in two places: state-branch commits (orphan branch, never seen by ingest) and healer fix-commits (on PR branches, checked by Guard 2 in loop prevention). The orphan branch use is defense-in-depth; the PR branch use is the primary guard.

## Concurrency and Safety Model

### Problem 1: Parallel CI runs updating the state branch simultaneously

**Solution:** `--force-with-lease` retry loop (described above). No distributed lock needed — NDJSON append is commutative for analytical purposes; record order doesn't affect threshold computation.

### Problem 2: Multiple healer triggers for the same test (parallel or sequential)

**Solution:** GitHub Actions concurrency groups scoped to test ID.

```yaml
# In playwright-healer-heal.yml
concurrency:
  group: healer-${{ github.event.inputs.test_id }}
  cancel-in-progress: false   # Queue, don't cancel: second trigger is evidence
```

`cancel-in-progress: false` is deliberate: if a second dispatch arrives while one is running, it queues. The queued run will check the per-test heal count at start and may abort if the cap is already reached.

### Problem 3: Infinite healing loops

Four independent guards, all must pass:

**Guard 1 — Commit author check (ingest step):**
```typescript
// In ingest/index.ts, before doing any work:
const commitAuthor = context.payload.head_commit?.author?.email;
if (commitAuthor === 'playwright-healer[bot]@users.noreply.github.com') {
  core.info('Skipping ingest: commit is from playwright-healer bot');
  process.exit(0);
}
```

**Guard 2 — Commit message sentinel on PR commits:**
Healer fix commits include `[skip-healer]` in the commit message. Ingest checks `git log --format=%s -1` of the triggering commit for this marker. This guard applies to PR-branch commits that land on the default branch — not to state-branch commits (which are on the orphan branch and never trigger ingest). State-branch commits also carry the sentinel as defense-in-depth in case branch protection is misconfigured.

**Guard 3 — Per-test heal cap in state branch:**
The stats record includes a `heal_attempts` counter per test per rolling window. Threshold evaluator reads this before dispatching. Default cap: 2 heal attempts per test per 7-day window.

```typescript
// loop-guard.ts
export function shouldDispatchHeal(stats: TestWindowStats, config: Config): boolean {
  return stats.healAttemptsInWindow < config.maxHealAttemptsPerWindow;
}
```

**Guard 4 — Healer PR CI failure fallback:**
If the healer opens a PR and the consuming repo's CI fails on that PR, the healer never re-heals that failure. The ingest step on the healer's PR commit sees the bot author and exits early (Guard 1). If somehow a second heal triggers, Guard 3 will block it (heal cap).

### Problem 4: App startup resource contention on the runner

The healer runner must simultaneously host:
- The app under test (foreground or background process)
- A Playwright browser (Chromium, ~200MB)
- The Claude Agent SDK Node process

GitHub-hosted `ubuntu-latest` runners have 7GB RAM and 2 vCPUs. This is sufficient for most dev servers + Playwright, but the agent prompt notes to use `--workers=1` when re-running tests to avoid port conflicts. The healer workflow should recommend `runs-on: ubuntu-latest-4-core` for resource-hungry apps.

### Known Limitation: Validation Re-run State Pollution (v2 concern)

The N validation re-runs execute against the same running app instance without resetting application state. This is a real risk for tests that create data (e.g., `should create user` may fail on runs 2–N due to unique constraint violations, producing a misleading low pass rate for a correct fix).

V1 accepts this limitation and documents it. The mitigation path is a `reset-command` config input (v2) that runs between each validation re-run to restore app state. Consumer teams can also mitigate by using isolated test data (UUIDs, randomized inputs) in their test fixtures — the healer's PR description should note this when the fix class is `assertions` or the test creates persistent state.

## Architectural Patterns

### Pattern 1: Self-Contained Dispatch Payload

**What:** The `workflow_dispatch` payload includes all context the healer needs (test file, last error, config snapshot). The healer never reads the state branch.
**When to use:** Always — it decouples the two workflows and makes the healer independently testable with fixture payloads.
**Trade-offs:** Payload size limit (65KB for `workflow_dispatch` inputs). For very long stack traces, truncate the `error_signature` to a 200-char hash + first 500 chars.

### Pattern 2: Pre-assembled Context Bundle

**What:** Before the agent loop starts, all source material is assembled into a typed `ContextBundle` struct. The agent runner takes only `ContextBundle` and `Config`.
**When to use:** Makes the agent runner fully unit-testable with fixtures; no live git or GitHub API calls during the agent loop.
**Trade-offs:** Adds a bundle-assembly step that can fail independently (e.g., artifact expired); failure should emit a structured issue, not a runner crash.

```typescript
interface ContextBundle {
  testId: string;
  testFile: string;
  testSource: string;          // full file content
  reportFragment: TestResult;  // the specific test's result from JSON report
  traceZipPath: string | null; // null if artifact expired or missing
  blame: string;               // git blame output for test file
  recentPRs: PullRequestSummary[];
  dispatchPayload: HealerPayload;
}
```

When `traceZipPath` is null, the agent runner switches to a trace-free prompt variant that instructs the agent to reproduce the failure live via Playwright MCP rather than reviewing a recorded trace.

### Pattern 3: Token Budget via SDK Hook

**What:** A `PreToolUse` hook tracks cumulative token spend and throws an abort signal when the configured budget (default $1.00 / ~800K tokens at claude-3-5-haiku pricing) is approached.
**When to use:** Always — unbounded agent loops are the primary cost risk.
**Trade-offs:** Abrupt abort mid-reasoning; mitigated by checking budget before each tool call, not mid-call.

```typescript
const tokenBudgetHook: HookCallback = async (input) => {
  const usage = getAccumulatedUsage(); // tracked via PostToolUse hook
  if (estimatedCostUsd(usage) > config.tokenBudgetUsd * 0.9) {
    throw new Error('TOKEN_BUDGET_EXCEEDED');
  }
  return {};
};
```

### Pattern 4: Rebase-Then-Validate

**What:** After the agent produces a diff, the fix applier rebases onto the latest default branch commit before running validation re-runs. PR is opened from the rebased commit.
**When to use:** Always — the healer checks out a specific SHA from the dispatch payload, which may be hours behind `main` by the time validation completes.
**Trade-offs:** Rebase can fail on conflict. Conflict → fall back to issue, not another heal attempt.

### Pattern 5: NDJSON Append-Only State

**What:** `stats.ndjson` is one JSON object per line per CI run. Threshold evaluator reads only lines within the rolling window. GC: trim lines older than `window_days * 2` during the append step (before push).
**When to use:** Always — simpler than a DB, diffable in git, no external infra.
**Trade-offs:** File grows unbounded without GC; GC during append risks interleaving with another concurrent append. Mitigate: GC after successful push, not before.

## Configuration Surface

### action.yml Inputs (must be in action.yml — no config file alternative)

These are secrets or commands that must be explicit per-invocation:

| Input | Required | Default | Notes |
|-------|----------|---------|-------|
| `anthropic-api-key` | Yes (healer only) | — | Secret; never logged |
| `github-token` | Yes | `${{ github.token }}` | Needs contents:write, PRs:write, issues:write, actions:write |
| `report-path` | Yes (ingest only) | — | Path to Playwright JSON report |
| `setup-command` | Yes (healer only) | — | e.g. `npm ci` |
| `start-command` | Yes (healer only) | — | e.g. `npm run dev` (must background itself or healer wraps it) |
| `test-command` | Yes (healer only) | — | e.g. `npx playwright test` |
| `base-url` | Yes (healer only) | — | e.g. `http://localhost:3000` |
| `config-file` | No | `.github/playwright-healer.yml` | Path to repo config file |

### `.github/playwright-healer.yml` (repo-committed config)

Checked into the consuming repo; allows per-repo tuning without forking the action. All keys use kebab-case in YAML; the config module normalizes to camelCase internally.

```yaml
# Threshold settings
flake-rate-threshold: 0.3       # breach if ≥30% of runs fail in window
duration-regression-pct: 50    # breach if p95 duration grows >50% vs baseline
window-days: 7                  # rolling window for stats

# Healer settings
rerun-count: 5                  # N validation re-runs
pass-rate-threshold: 0.8        # require 80% pass rate before opening PR
max-heal-attempts-per-window: 2 # per-test circuit breaker
token-budget-usd: 1.0           # per-healing-pass budget cap

# Fix class toggles (all on by default)
fix-classes:
  selectors: true
  waits: true
  assertions: true
  slow-tests: true

# Auto-merge settings (all off by default)
auto-merge:
  enabled: false
  fix-classes:             # only merge these if CI green
    selectors: false
    waits: false
```

### Reasonable Defaults Rationale

- **30% flake rate, 7-day window:** At 30%, a test fails roughly once every 3 runs — visible enough to act on, rare enough to avoid false positives from transient infra issues.
- **5 reruns, 80% pass rate:** 4/5 passing is a strong signal. 5 runs takes ~2–3 min for most test suites.
- **$1.00 token budget:** At claude-3-5-haiku pricing (~$0.80/M input tokens), $1.00 ≈ 1M tokens — sufficient for deep reproduction + fix, generous enough to avoid premature cuts.
- **Max 2 heal attempts per window:** Prevents runaway API costs on tests that are genuinely unfixable by the four fix classes.

## Suggested Build Order (Phase Dependencies)

### v0 — Observability Only (no agent, no cost risk)
Build and validate the most dangerous infrastructure — git-as-DB — under real concurrent load before spending on agent work.

Components: `report-parser` + `stats-writer` + `state-branch` (including bootstrap) + `threshold-evaluator` (dispatch only, no healer yet) + `config` + `loop-guard`

Outcome: The action writes stats to the state branch every CI run. When thresholds breach, it logs a warning instead of dispatching. Consumers can adopt and validate the state branch behavior — including first-run bootstrap and concurrent push races.

### v1 — Manual Healer (selectors-only, no auto-merge)
Add the healer workflow, triggered manually via `workflow_dispatch` (not automatically dispatched by the ingest step). This lets you test the full healer pipeline without building the trigger.

Components: `context-bundler` + `app-supervisor` + `agent-runner` + `fix-applier` + `validator` + `pr-writer` (PR only, no issue fallback yet)

Coupling note: `agent-runner` and `fix-applier` are tightly coupled — the diff format the agent produces must match what `fix-applier` applies. They must be built and tested together.

### v2 — Automatic Dispatch + Full Fix Classes
Wire the ingest step to automatically dispatch the healer when thresholds breach. Add remaining fix classes (waits, assertions, slow-tests). Add issue fallback when no fix found. Add `reset-command` config input for validation re-run state isolation.

Components: threshold-evaluator dispatch + remaining fix classes in agent prompt + issue branch in pr-writer + `reset-command` support in fix-applier

### v3 — Auto-merge + Polish
Add opt-in auto-merge, per-test heal cap enforcement, advanced config, PAT documentation.

## Testing Strategy

### Unit Tests (pure functions, no I/O)

Run on every commit, sub-second:
- `report-parser.test.ts` — parse fixture JSON, check TestResult shape
- `threshold-evaluator.test.ts` — feed seeded NDJSON, assert correct breach detection
- `config.test.ts` — merge action inputs + yml, validate defaults, reject invalid, verify kebab-to-camelCase normalization
- `loop-guard.test.ts` — commit author patterns, heal cap edge cases

### Component Tests (local git, no GitHub API)

Run on every commit, ~10-30 seconds:
- `state-branch.test.ts` — use a local bare git repo as remote; test append, push-with-lease, retry on forced-rejection (simulate by pushing a competing commit between fetch and push); test first-run bootstrap
- `fix-applier.test.ts` — use a fixture git repo with a seeded test file; apply a known-good diff; verify rebase logic

The bare-repo approach for state-branch tests is the highest-value investment. It will catch the push-with-lease retry logic, bootstrap race conditions, GC behavior, and NDJSON corruption edge cases before any real push happens.

### Agent Tests (recorded MCP sessions, no live API)

Run in CI with recorded sessions (~1-5 minutes):
- Record a real agent + Playwright MCP session against a fixture app
- Replay the recording against agent-runner with the MCP stubbed to return recorded responses
- Assert: diff is in the expected fix class, root-cause text is non-empty, token usage is within budget
- Run both trace-present and trace-absent prompt variants

The Claude Agent SDK's message stream is async-iterable — a stub can replay recorded `AssistantMessage` and `ResultMessage` objects without calling the API.

### E2E Tests (live API, live browser, fixture repo)

Run nightly, budget-capped:
- A dedicated fixture repo (`playwright-healer-e2e-fixture`) with known-flaky tests (selector-based, timing-based)
- Full healer workflow runs against it
- Assert: PR opened, test passes in N reruns, PR body contains expected sections

Cost per run: ~$0.20–$0.50 per test (well within nightly budget).

### Integration Boundaries

| Boundary | Test Level | Stub/Fixture |
|----------|------------|--------------|
| Playwright JSON → TestResult[] | Unit | Sample JSON fixture |
| TestResult[] → stats.ndjson | Component | Local bare git repo |
| stats.ndjson → dispatch decision | Unit | Seeded NDJSON fixture |
| workflow_dispatch API call | Component | Octokit mock |
| Dispatch payload → ContextBundle | Component | Fixture artifacts |
| ContextBundle (with trace) → agent diff | Agent | Recorded MCP session |
| ContextBundle (no trace) → agent diff | Agent | Recorded MCP session, trace-free variant |
| Diff → validation pass/fail | Component | Fixture git repo |
| Validation result → PR/Issue | Component | Octokit mock |
| Full pipeline | E2E (nightly) | Fixture repo + live API |

## Anti-Patterns

### Anti-Pattern 1: Reading State Branch in the Healer Workflow

**What people do:** Healer workflow fetches `playwright-healer-state` to get test stats and determine what to fix.
**Why it's wrong:** Creates coupling between the two workflows; makes the healer non-testable without a real state branch; adds latency and another failure mode.
**Do this instead:** The dispatch payload is self-contained. The healer receives everything it needs via `workflow_dispatch` inputs.

### Anti-Pattern 2: Monolithic ncc Bundle

**What people do:** One `action.yml`, one `dist/index.js` bundle containing everything.
**Why it's wrong:** Ingest runs on every CI push for every repo. A bundle containing the Agent SDK + MCP client + Playwright adds ~50-100MB and significant startup time to every single CI run, even when no healing is needed.
**Do this instead:** Two separate bundles. Ingest bundle: report-parser + state-branch + threshold-evaluator + config (~5MB). Healer bundle: everything else (~50MB, only runs when dispatched).

### Anti-Pattern 3: Validation on the Original SHA

**What people do:** Apply fix and re-run test against the checkout SHA from the dispatch payload (which may be hours or days old).
**Why it's wrong:** Fix might pass against the old commit but fail on current main due to unrelated changes. PR opens with a fix that immediately fails CI.
**Do this instead:** Always rebase fix onto `origin/HEAD` (default branch) before validation. Rebase conflict = fallback to issue.

### Anti-Pattern 4: `cancel-in-progress: true` on Healer Workflow

**What people do:** Set `cancel-in-progress: true` to avoid running two healers for the same test simultaneously.
**Why it's wrong:** A queued second heal attempt (triggered by a subsequent CI failure) gets cancelled. The test continues to flake with no healing running.
**Do this instead:** `cancel-in-progress: false` + per-test heal cap. The second attempt queues, and when it starts it checks the heal cap and exits cleanly if the first attempt already produced a PR.

### Anti-Pattern 5: Using `permissionMode: "bypassPermissions"` in Agent Runner

**What people do:** Set bypass permissions to avoid configuring `allowedTools` for the Playwright MCP server.
**Why it's wrong:** Grants the agent access to all built-in tools including `Bash` (unrestricted shell) and `Write` (any file). In a CI runner with write access to the repo, this is a significant security risk.
**Do this instead:** Explicit `allowedTools: ["mcp__playwright__*", "Read", "Grep", "Glob"]`. The agent can browse, read test code, and drive the browser — nothing more.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| GitHub Actions | `workflow_dispatch` via Octokit `actions.createWorkflowDispatch` | Requires `actions:write` permission; async — dispatch returns 204 with no run ID |
| GitHub API (PRs/Issues) | Octokit REST: `pulls.create`, `issues.create` | Use `GITHUB_TOKEN` with minimum required scopes |
| GitHub API (Artifacts) | Octokit: `actions.listWorkflowRunArtifacts`, `actions.downloadArtifact` | Artifacts expire after 90 days by default; graceful degradation to trace-free mode |
| Anthropic API | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) | `ANTHROPIC_API_KEY` via action secret |
| Playwright MCP | stdio transport (`npx @playwright/mcp@latest`) | MCP server starts as child process; 60s connection timeout |

### Internal Module Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| ingest → state-branch | Function call (sync); returns on push success/failure | state-branch module owns all git operations including bootstrap |
| ingest → threshold-evaluator | Function call; evaluator reads from state-branch module | evaluator never touches git directly |
| threshold-evaluator → workflow_dispatch | Octokit API call | Async; no confirmation of healer run ID |
| healer entrypoint → context-bundler | Function call; bundler returns `ContextBundle \| null` | null = critical artifact missing → skip to issue |
| healer entrypoint → app-supervisor | Subprocess management; supervisor returns `AppHandle` or throws | Timeout → structured issue, no agent run |
| agent-runner → fix-applier | Returns `AgentResult { diff, rootCause, fixClass }` or `{ noFix }` | Diff is unified diff format applied via `git apply` |
| fix-applier → pr-writer | Returns `ValidationResult { passRate, evidence }` | pr-writer decides PR vs Issue based on passRate |

## Sources

- [Claude Agent SDK Overview](https://code.claude.com/docs/en/agent-sdk/overview) — confirmed MCP stdio transport pattern, `allowedTools`, `PreToolUse` hooks, session management
- [Claude Agent SDK MCP Guide](https://code.claude.com/docs/en/agent-sdk/mcp) — confirmed `mcpServers` config shape, error handling on `init` message, 60s connection timeout
- [Playwright MCP Server (microsoft/playwright-mcp)](https://github.com/microsoft/playwright-mcp) — confirmed available tools: navigate, click, trace capture, console reading, network inspection, accessibility snapshot
- [GitHub Actions Concurrency Docs](https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs) — confirmed `cancel-in-progress: false` behavior, one pending per group limit
- [git push --force-with-lease](https://git-scm.com/docs/git-push) — confirmed race condition semantics; `--force-if-includes` for additional safety (Git 2.30+)

---
*Architecture research for: playwright-healer (GitHub Action — AI-driven Playwright test remediation)*
*Researched: 2026-04-24*
