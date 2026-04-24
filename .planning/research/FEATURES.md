# Feature Research

**Domain:** AI-powered Playwright test healer / flake-triage GitHub Action
**Researched:** 2026-04-24
**Confidence:** HIGH (table stakes, differentiators); MEDIUM (competitor comparisons — based on public docs and search results)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Accurate Playwright JSON report parsing | Every Playwright CI setup emits a JSON report; if the action can't read it, nothing works | S | Playwright JSON schema is stable; use `reporter: 'json'` output. Must handle `passed`, `failed`, `flaky` (retry-passed) statuses and duration per test. |
| Rolling flake/slow detection with configurable thresholds | Industry standard: Currents, Buildkite, Trunk all use multi-run windows. A single-run fail is noise; a pattern is signal. Teams expect to tune sensitivity. | M | Store per-test stats (pass/fail/retry counts, durations) on the dedicated `playwright-healer-state` branch. Rolling window (default: last 10 runs, configurable) over a configurable flake-rate threshold (default: 20%). |
| Duration regression detection | "Consistently slow" causes build-time bloat; teams expect parity with flake detection. | S | Per-test baseline duration tracked in state branch; alert when P95 exceeds baseline × configurable multiplier (default: 2×). |
| Reproduction of the failure in a CI-matching environment | Root-cause analysis run against a different environment is worthless. If you can't reproduce it, you can't fix it. | M | Consumer provides `setup-command`, `start-command`, `base-url` inputs. Healer runs these on a clean GH Actions runner. This is the key trust-builder. |
| Human-readable root-cause analysis artifact | If the agent can't fix it, the RCA must still be usable by a human in 5 minutes. Teams rejected tools that produce log dumps with no synthesis. | M | Claude agent produces structured output: what failed, likely cause class (selector/timing/assertion/infra), evidence (console errors, network failures, DOM state), reproduction steps. Attached to both PRs and issues. |
| Validated fixes: N successful re-runs before PR | Unvalidated PRs become noise and erode trust. Datadog Test Optimization confirms fixes by retrying 20× before marking resolved. GitHub Copilot agent "self-heals on test failures" before opening a PR. | M | Re-run the patched test N times (default configurable; recommend 3 min, 10 max) on the clean runner. Require configurable pass-rate threshold (default: 100%). |
| Safe PR opening (correct base, no clobber of user work) | Any automation that overwrites developer work is immediately uninstalled. Renovate/Dependabot patterns: always branch-from-default, always rebase before PR, never force-push to user branches. | M | Always branch from default branch. Healer branch name includes test ID + run SHA. Rebase onto default before opening PR. Never push to branches the user already owns. |
| Fallback structured issue when no fix is proposed | Teams need a "floor" guarantee: something actionable always comes out. The issue is a degraded-but-useful output. | S | Issue template: RCA summary, reproduction command, suspected cause class, debugging hints, link to the failing run. Must be distinct from noise — rich content or users stop reading issues. |
| Per-run cost bound / token budget cap | Unbounded agent loops are a dealbreaker for any reusable action consumed by teams with cost controls. | S | Action input: `max-tokens-per-run` (default: 100k tokens, ~$0.30 at Sonnet pricing). Agent loop interrupted and gracefully degraded to issue-filing if budget exceeded. |
| Respect branch protection and CODEOWNERS | An action that bypasses branch protection will be rejected by enterprise teams during security review. | S | Never push directly to protected branches. Always open PRs. Read CODEOWNERS to assign reviewers. Use a PAT path for orgs where GITHUB_TOKEN lacks write permissions. |
| Clear documentation and copy-paste example workflow | The action is dead on arrival without this. Dependabot-style: one YAML block in the docs that can be pasted verbatim to adopt. | S | Ship with `docs/` and a `examples/` directory. The example must cover: basic flake detection, custom thresholds, and auto-merge opt-in. |

---

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but high value when present.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Fix-class coverage beyond selectors (waits, assertions, slow-test optimization) | Most AI test-healing tools only address locators/selectors. The other three classes (timing, assertions, slow) cover a large portion of Playwright-specific flake patterns. | M | v1 ships all four classes: (a) selectors/locators, (b) waits/timing (adding `waitFor`, adjusting timeouts), (c) assertions (relaxing strict equality, adding retry logic), (d) slow-test optimizations (reducing unnecessary waits, parallelism). Each class is separately enable/disable configurable. |
| Trace-aware analysis (reads Playwright `.zip` traces, not just logs) | Playwright traces contain DOM snapshots, network HAR, screenshots, and a full action timeline — far richer diagnostic signal than log output alone. Trace Viewer is already the debugger Playwright engineers reach for; the agent should too. Playwright 1.59 added `npx playwright trace` CLI for programmatic/headless trace access. | L | Depends on: Playwright JSON report parsing (trace path in report) + agent tooling to call `npx playwright trace show --json` or unzip and parse `trace.zip`. Confidence scoring depends on this. High complexity because trace format is a ZIP with internal structure. |
| Confidence scoring on proposed fixes | Gives maintainers a rational basis for trusting the auto-merge flag. GitHub Copilot agent and other AI PR openers don't expose confidence; this makes review prioritization easier. | M | Score derived from: fix class (selectors = high confidence, infra/async races = low), validation pass rate (10/10 runs = higher than 3/3), trace evidence quality (trace-backed = higher). Attached to PR description as a band: LOW / MEDIUM / HIGH. Confidence scoring depends on trace-aware analysis for maximum signal. |
| Auto-merge for high-confidence fix classes (opt-in) | Closes the loop completely for routine flakes on teams with mature CI. Not a default; an opt-in power feature. | S | Implemented via GitHub auto-merge API (`gh pr merge --auto`). Triggered only when: confidence = HIGH, all CI checks pass, fix class is in user's `auto-merge-classes` list. Gate: validation re-runs must have already passed. |
| Per-fix-class enable/disable toggles | Teams may trust selector fixes but not timing changes. Granular control prevents the action from touching code the team hasn't blessed. | S | Action input: `fix-classes: selectors,waits` (default: all four). Simple string-list input parsed in action entry point. |
| Dry-run mode (propose analysis, do not open PR or issue) | Lets teams audit the healer's output before enabling write permissions. Essential for trust-building on first adoption. | S | Action input: `dry-run: true`. In dry-run, the agent still runs, produces RCA and proposed fix, and logs everything — but GitHub API calls for PR/issue creation are skipped. Outputs are posted as action summary instead. |
| Batch healing (one PR per healing cycle grouping related flakes) | Avoids PR spam when multiple tests flake simultaneously. Adjacent tools like Renovate batch dependency updates to avoid notification noise. | M | Group tests that share the same root cause (same selector, same wait pattern, same component) into a single PR. Requires pattern-recognition across multiple RCA outputs. Add after v1 single-test healing is validated. |
| Ability to rebase stale healing branches | A healing branch opened last week may conflict with main by the time a reviewer looks at it. Renovate's `:rebaseStalePrs` preset is the prior art. | S | Scheduled cron job or `push` trigger: scan open healing PRs, rebase onto current default branch, re-run validation if needed. Low complexity — GH API + `git rebase`. |
| Cross-run pattern detection ("test X always fails on Tuesdays") | Surfaces environmental flakes (infra cold-start windows, scheduled jobs, time-based) that single-run analysis misses. | L | Requires enough historical data in the state branch + time-of-day / day-of-week correlation logic. High complexity, deferred to v2+. |
| Cost dashboard / budget alerting per repo | Teams running the action across many repos need aggregate spend visibility. | L | Requires token-usage tracking in the state branch, a reporting action, and possibly an external sink. Out of scope for v1 (zero-infra constraint). |

---

### Anti-Features (Deliberately NOT Built)

Features that seem appealing but create danger, erode trust, or exceed the tool's scope.

| Feature | Why Requested | Why Dangerous or Problematic | What to Do Instead |
|---------|---------------|------------------------------|-------------------|
| Blind auto-merge without validation re-runs | "Just fix it and merge, I'm busy" | If the agent produces a bad fix (e.g., weakens an assertion from `toEqual` to `toBeTruthy`), a blind merge silently degrades the test suite. This is the single most catastrophic failure mode for a test-healing tool. | Every fix must pass N re-runs before any PR is opened. Auto-merge is only available after validation passes AND is opt-in by fix class. |
| Healing tests that are legitimately broken (app bug regression) | The healer "fixes the flake" and CI goes green | Weakening or removing an assertion that was catching a real regression is worse than the original failure. The action has no way to know whether a test failure reflects a flaky test or a real app bug without application domain knowledge. | Scope fixes strictly to the four test-flakiness classes. If a test fails deterministically across all re-runs, file an issue and do NOT propose a fix. "Deterministic fail = app bug" heuristic is the guard. |
| Modifying non-test production code | "The bug is in the app, fix the app" | v1 has no trust envelope for application logic fixes. A wrong app fix could introduce regressions across the entire product. | Fixes are scoped to test files only. If the RCA points to an app bug, file a structured issue with root-cause details and leave the fix to a developer. |
| Running healer on PRs from forks | "Also heal external contributor PRs" | Fork PRs don't have access to repo secrets. If the action attempts to use `ANTHROPIC_API_KEY` or `GITHUB_TOKEN` in a fork PR context, the secrets are not available (blank) or the token lacks write permissions — and GH Actions explicitly blocks this for security. | Only trigger on `push` to repo branches (not `pull_request` from forks). Document this clearly. |
| Triggering healing on every CI run | "Always be healing" | Every trigger fires an agent loop. At non-trivial test-suite size and CI frequency, this would consume Anthropic API budget in hours and generate PR spam. | Only trigger healing when a test crosses a threshold over a rolling window. The threshold is the gate. |
| Implementing a full flake detection dashboard (SaaS-style) | "Show me all my flakes in a UI" | This is Currents.dev, Trunk, and Buildkite's core product. Building it duplicates their work and pulls scope toward SaaS infra the team explicitly ruled out. | The state branch is the data store; consumers who want dashboards should send the branch data to Currents/Datadog. playwright-healer's output is actions (PRs, issues), not visualizations. |
| Supporting non-Playwright frameworks (Cypress, Jest, Vitest) | "Can you also heal my Jest tests?" | The Playwright MCP is central to the diagnosis loop. Supporting other frameworks requires entirely different MCP surfaces (or no MCP at all), different report formats, and different flake patterns. It is a different product. | Document the boundary clearly in README. Non-Playwright test failures should route through existing flake dashboards. |
| Non-GitHub CI support (GitLab, CircleCI, Buildkite CI) | "We're on GitLab" | v1 leans hard on GitHub Actions, GitHub API, and the GH Actions runner environment. Porting is non-trivial and requires a different distribution mechanism. | Document the boundary. v2+ can consider GitLab CI Catalog. |
| Real-time notifications / Slack / PagerDuty integrations | "Alert me immediately when a test flakes" | Scope creep into monitoring/alerting territory. The action's output is a PR or issue — both are native GitHub notification surfaces teams already monitor. | Let GitHub's built-in notification system handle it. Users who want Slack alerts can add a `slack-notify` action step after `playwright-healer`. |
| Implementing Playwright's own retry logic | "Also add retries to the test suite" | Playwright already has `--retries` and `retries` config. Reimplementing this is competing with first-party tooling, and doing it worse. The action *consumes* retry output (the `flaky` status) rather than replacing it. | Require consumers to enable Playwright retries (≥1) so the `flaky` status appears in reports. Document this as a prerequisite. |
| Rewriting test files wholesale | "Just rewrite the whole test to be better" | Wholesale rewrites risk changing test intent, introducing new bugs, and failing code review. They're also harder to validate than targeted fixes. | Fixes are minimal and surgical — change one selector, one wait, one assertion at a time. The PR diff should be small and reviewable. |

---

## Feature Dependencies

```
[Playwright JSON Report Parsing]
    └──required-by──> [Rolling Flake/Slow Detection]
    └──required-by──> [Trace-Aware Analysis] (trace path is in the JSON report)

[Rolling Flake/Slow Detection]
    └──required-by──> [Failure Reproduction]
    └──required-by──> [Threshold Trigger → Healer Workflow]

[Failure Reproduction]
    └──required-by──> [Root-Cause Analysis]

[Root-Cause Analysis]
    └──required-by──> [Fix Proposal (all four classes)]
    └──required-by──> [Structured Issue Filing]

[Fix Proposal]
    └──required-by──> [Validation Re-Runs]

[Validation Re-Runs]
    └──required-by──> [Safe PR Opening]
    └──required-by──> [Confidence Scoring]
    └──required-by──> [Auto-Merge (opt-in)]

[Trace-Aware Analysis]
    └──enhances──> [Root-Cause Analysis] (richer signal → better RCA)
    └──enhances──> [Confidence Scoring] (trace-backed diagnosis = higher confidence band)

[Confidence Scoring]
    └──enables──> [Auto-Merge (opt-in)] (auto-merge gates on HIGH confidence)

[Per-Fix-Class Toggles]
    └──scopes──> [Fix Proposal] (only propose enabled classes)
    └──scopes──> [Auto-Merge] (auto-merge only on user-approved classes)

[Dry-Run Mode]
    └──requires──> [Root-Cause Analysis] (must still run fully)
    └──skips──> [Safe PR Opening]
    └──skips──> [Structured Issue Filing]
    └──replaces-with──> [Action Summary Output]

[Stale Branch Rebase]
    └──requires──> [Safe PR Opening] (only healer-owned PRs)

[Batch Healing]
    └──requires──> [Root-Cause Analysis × N tests] (need multiple RCAs to group)
    └──requires──> [Fix Proposal × N tests]

[Cross-Run Pattern Detection]
    └──requires──> [Rolling Flake/Slow Detection] (needs substantial history)
    └──requires──> [State Branch] (time-stamped per-run data)
```

### Dependency Notes

- **Trace-Aware Analysis requires Playwright JSON Report Parsing:** The JSON report contains the path to `trace.zip` for each failed test. Without parsing the report first, there is no trace to fetch.
- **Confidence Scoring depends on Trace-Aware Analysis for maximum signal:** Confidence can be computed without traces (using only fix class and re-run pass rate), but the highest confidence band requires trace evidence. Confidence scoring is therefore a partial dependency — it degrades gracefully without traces.
- **Auto-Merge is the terminal node:** It depends on validation re-runs, confidence scoring, CI checks passing, AND user opt-in. It must not be implemented until all upstream dependencies are stable.
- **Dry-Run Mode is a cross-cutting concern:** It does not add features; it suppresses the write-side effects of features that already exist. Implement it as a single flag checked before any GitHub API write call.
- **Batch Healing conflicts with simple PR-per-test model:** Implementing both simultaneously creates ambiguity about PR ownership and rebase behavior. Batch healing is a v1.x addition after single-test healing is validated.

---

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the core value proposition ("a flaky Playwright test should result in a reviewable PR or structured issue without a human reading logs").

- [ ] Playwright JSON report parsing — without this, nothing works
- [ ] Rolling flake/slow detection with configurable thresholds — the trigger mechanism
- [ ] Failure reproduction on a clean runner — prerequisite for trustworthy diagnosis
- [ ] Root-cause analysis artifact (human-readable) — the floor guarantee even when no fix is possible
- [ ] Fix proposal for all four classes (selectors, waits, assertions, slow) — the core value delivery
- [ ] Validation re-runs (N passes before PR) — the trust mechanism that makes PRs reviewable, not noise
- [ ] Safe PR opening — the primary output artifact
- [ ] Structured issue filing (fallback) — the secondary output artifact when no fix is found
- [ ] Per-run cost bound — required for responsible reusable action; cannot be deferred
- [ ] Per-fix-class enable/disable toggles — low complexity, high trust value for cautious early adopters
- [ ] Dry-run mode — essential for first-time adoption; allows audit without write permissions
- [ ] Documentation + copy-paste example workflow — the action is not usable without this

### Add After Validation (v1.x)

Features to add once core is working and teams have adopted the action.

- [ ] Trace-aware analysis — add when v1 RCA proves insufficient for a class of hard-to-diagnose flakes
- [ ] Confidence scoring — add after trace analysis; depends on it for maximum signal quality
- [ ] Auto-merge opt-in — add after confidence scoring is validated; this is the "trust graduation" feature
- [ ] Stale branch rebase — add when teams report that healing PRs go stale; low complexity when needed
- [ ] Batch healing — add when PR spam becomes a complaint from teams with many simultaneous flakes

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] Cross-run pattern detection (time-of-day/day-of-week correlation) — needs historical data volume and is high complexity
- [ ] Cost dashboard / budget alerting — requires external state; violates zero-infra constraint for v1
- [ ] Non-GitHub CI support — different distribution mechanism; out of scope until GitHub pattern is proven

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Playwright JSON report parsing | HIGH | LOW | P1 |
| Rolling flake/slow detection | HIGH | MEDIUM | P1 |
| Failure reproduction (clean runner) | HIGH | MEDIUM | P1 |
| Root-cause analysis artifact | HIGH | MEDIUM | P1 |
| Fix proposal: selectors | HIGH | MEDIUM | P1 |
| Fix proposal: waits/timing | HIGH | MEDIUM | P1 |
| Fix proposal: assertions | MEDIUM | MEDIUM | P1 |
| Fix proposal: slow-test | MEDIUM | MEDIUM | P1 |
| Validation re-runs | HIGH | MEDIUM | P1 |
| Safe PR opening | HIGH | LOW | P1 |
| Structured issue fallback | HIGH | LOW | P1 |
| Per-run cost bound | HIGH | LOW | P1 |
| Per-fix-class toggles | MEDIUM | LOW | P1 |
| Dry-run mode | MEDIUM | LOW | P1 |
| Documentation + example workflow | HIGH | LOW | P1 |
| Trace-aware analysis | HIGH | HIGH | P2 |
| Confidence scoring | MEDIUM | MEDIUM | P2 |
| Auto-merge opt-in | MEDIUM | LOW | P2 |
| Stale branch rebase | MEDIUM | LOW | P2 |
| Batch healing | MEDIUM | MEDIUM | P2 |
| Cross-run pattern detection | LOW | HIGH | P3 |
| Cost dashboard | LOW | HIGH | P3 |
| Non-GitHub CI support | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch (v1)
- P2: Should have, add when core is validated (v1.x)
- P3: Nice to have, future consideration (v2+)

---

## Competitor Feature Analysis

How adjacent tools handle test flake triage, and what playwright-healer does differently.

| Feature | Currents.dev | Buildkite Test Engine | Datadog Test Visibility | GitHub Copilot Agent | playwright-healer |
|---------|--------------|----------------------|------------------------|---------------------|-------------------|
| Flake detection | Auto-detected when retries enabled; ranked by flake rate; rolling presence window | Three monitors: transition count, passed-on-retry, probabilistic flakiness. ~10 historical runs for confidence. | Tracks historical performance, identifies flake rate, surfaces regressions by commit | N/A (not a test platform) | Rolling window over configurable run count; per-test stats on dedicated branch |
| Threshold configuration | Implicit (1–2% thresholds mentioned in docs) | Configurable per monitor type | Configurable flaky test policies | N/A | Explicit action inputs for flake rate and duration regression multiplier |
| Quarantine / mute | Yes — quarantine removes flakes from blocking CI | Yes — auto-quarantine mutes or skips flaky tests on default branch | Yes — muting and quarantine supported | N/A | Not v1 — playwright-healer heals instead of quarantines |
| Root-cause analysis | No — observability only; shows which errors cause flakiness | No — categorizes failures, no diagnosis | No — shows what failed, not why | Yes — analyzes codebase and proposes fixes | Yes — Claude agent produces structured RCA with evidence |
| Fix proposal | No | No | No — Datadog confirms fixes by retrying 20×, but doesn't propose them | Yes — proposes multi-file fixes | Yes — four fix classes, targeted and minimal |
| Validation before merge | N/A | N/A | Yes — retry-based confirmation (20 runs) | Yes — self-heals on test failures before PR | Yes — N configurable re-runs, configurable pass rate |
| PR opening | No | No | No | Yes — opens PR after analysis | Yes — primary output artifact |
| Auto-merge | No | No | No | Via GH Actions workflow | Opt-in, per fix class, gates on HIGH confidence + CI green |
| Issue filing fallback | No — dashboard-only | No — dashboard-only | No | Not explicitly | Yes — structured issue with RCA when no fix proposed |
| Trace-aware analysis | No | No | No | Indirectly (reads code context) | v1.x — reads Playwright trace.zip for DOM/network evidence |
| Confidence scoring | No | No | No | No | v1.x — derived from fix class + re-run rate + trace evidence |
| Cost control | N/A (SaaS pricing) | N/A (SaaS pricing) | N/A (SaaS pricing) | GitHub Copilot subscription | Action input: max-tokens-per-run; hard budget cap per healing pass |
| Self-hosted / bring-your-own-key | No (SaaS only) | No (SaaS only) | No (SaaS only) | No (GitHub-hosted) | Yes — GH Action + ANTHROPIC_API_KEY secret; zero external infra |
| Playwright-specific | Yes | No (multi-framework) | No (multi-framework) | No (general coding) | Yes — Playwright MCP is central; Playwright-only by design |

**Key insight from competitor analysis:**

The observability tools (Currents, Buildkite, Datadog) are detection-and-dashboard plays — they tell you what is broken and track trends but produce no code. The AI coding agents (Copilot Agent) produce code but have no Playwright-specific diagnostic loop, no flake threshold detection, and no state-tracking over rolling windows.

playwright-healer occupies the gap: it closes the loop from detection → diagnosis → fix → validated PR, using Playwright's own MCP surface for the diagnostic pass. No adjacent tool does all four of these steps together.

The closest precedent for the validation-before-merge pattern is Datadog's "retry 20×" confirmation step, which validates that a fix resolves the flake before marking it resolved. playwright-healer applies the same pattern to fix proposals before opening a PR.

---

## Sources

- [Currents.dev Flaky Tests Documentation](https://docs.currents.dev/dashboard/tests/flaky-tests)
- [Playwright Test Retries Documentation](https://playwright.dev/docs/test-retries)
- [Playwright Trace Viewer Documentation](https://playwright.dev/docs/trace-viewer)
- [Trunk.io Flaky Test Detection](https://docs.trunk.io/flaky-tests/detection)
- [Trunk.io Quarantining](https://docs.trunk.io/flaky-tests/quarantining)
- [Buildkite Test Engine](https://buildkite.com/platform/test-engine/)
- [Buildkite Test State and Quarantine](https://buildkite.com/docs/test-engine/test-state-and-quarantine)
- [Datadog Flaky Tests Management](https://docs.datadoghq.com/tests/flaky_management/)
- [GitHub Copilot Meet the New Coding Agent](https://github.blog/news-insights/product-news/github-copilot-meet-the-new-coding-agent/)
- [Renovate Bot Comparison Docs](https://docs.renovatebot.com/bot-comparison/)
- [Automating Dependabot with GitHub Actions](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/automating-dependabot-with-github-actions)

---
*Feature research for: playwright-healer (AI-powered Playwright test healer GitHub Action)*
*Researched: 2026-04-24*
