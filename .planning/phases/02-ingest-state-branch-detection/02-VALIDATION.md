---
phase: 2
slug: ingest-state-branch-detection
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-25
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (per RESEARCH.md §State of the Art — bare-repo integration pattern) |
| **Config file** | `vitest.config.ts` (Wave 0 installs if absent) |
| **Quick run command** | `npx vitest run --reporter=dot` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5–15 seconds (mostly bare-repo git operations) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run --reporter=dot` (changed-file scope where supported)
- **After every plan wave:** `npx vitest run` (full Phase 2 suite)
- **Before `/gsd-verify-work`:** Full suite green + a successful CI run on a fixture repo (concurrent-write scenario cannot be reproduced in `vitest` alone — see Manual-Only Verifications below)
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

*Filled by gsd-planner; rows below are placeholders matching the expected plan decomposition. Update once plan IDs are finalized.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | CFG-03, CFG-06, CFG-07 | — | Zod fail-fast on `flake-rate-threshold: "banana"` (no JS crash) | unit | `npx vitest run tests/ingest/config.test.ts` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | CFG-06 | T-2-01 (config injection from fork PR) | Fork PRs cannot use `.github/playwright-healer.yml` overrides | unit | `npx vitest run tests/ingest/config.test.ts -t "fork-pr"` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | ING-02, ING-04, SEC-05 | T-2-02 (loop guard) | `playwright-healer-bot` author exits early | unit | `npx vitest run tests/ingest/guards.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 1 | ING-01, ING-03 | T-2-03 (path traversal in report glob) | NDJSON record schema validates; report path constrained to workspace | unit | `npx vitest run tests/ingest/record.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 2 | STA-01, STA-02 | — | Worktree isolation: orphan branch created without touching consumer source | integration | `npx vitest run tests/state-branch/worktree.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-02 | 03 | 2 | STA-03, STA-04 | T-2-04 (race condition data loss) | `force-with-lease` retry loop preserves both records under serial conflict | integration | `npx vitest run tests/state-branch/concurrency.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-03 | 03 | 2 | STA-05 | T-2-05 (state branch GC) | Append-only NDJSON; rolling-window prune (date-gated) | integration | `npx vitest run tests/state-branch/gc.test.ts` | ❌ W0 | ⬜ pending |
| 2-04-01 | 04 | 3 | DET-01, DET-02, DET-03 | — | Threshold evaluator computes flake rate over rolling window; emits step-summary annotation | unit | `npx vitest run tests/detector/flake-rate.test.ts` | ❌ W0 | ⬜ pending |
| 2-04-02 | 04 | 3 | DET-04 | T-2-06 (premature dispatch) | Log-only mode: NO `workflow_dispatch` API call exists in src/ingest or src/detector for Phase 2 | static | `git grep -nE 'createWorkflowDispatch\|workflow_dispatch' -- 'src/ingest/*.ts' 'src/detector/*.ts' || echo "OK"` | ❌ W0 | ⬜ pending |
| 2-05-01 | 05 | 3 | (integration test) | — | Two concurrent ingest steps under simulated parallel CI both land records | integration (CI-only) | (manual — see "Manual-Only Verifications") | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest@^2.x` and `@vitest/coverage-v8` added to `devDependencies` in `package.json`
- [ ] `vitest.config.ts` at repo root — `test.environment: 'node'`, `test.include: ['tests/**/*.test.ts']`, `test.testTimeout: 15000` (bare-repo ops can be slow)
- [ ] `tests/_helpers/bare-repo.ts` — utility that creates a temporary bare repo + worktree for state-branch integration tests; tears down after each test
- [ ] `tests/_helpers/fixture-report.ts` — fabricates Playwright JSON report fixtures with controllable per-test pass/fail/duration patterns
- [ ] Update `.gitignore` to exclude `tmp-test-repos/` (bare repo scratch dir)
- [ ] No new `npm ci --production` runtime deps from Wave 0 (vitest stays in devDependencies — composite action's `npm ci --production` skips it)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two concurrent ingest steps both land records (SC#2) | STA-04 | True concurrency requires the GitHub Actions runner — vitest can simulate serial conflicts (force-with-lease retry path) but not the genuine parallel-runner case | Push to a fixture repo; trigger two parallel jobs from a matrix on the same commit; confirm `git log --oneline origin/playwright-healer-state` has 2 new commits and `git show` on each contains a unique NDJSON record |
| First-use orphan branch creation against a real GitHub remote (SC#1) | STA-01 | `git push --force-with-lease` against a local bare repo behaves differently from a real GitHub-hosted remote (refs/refs visibility, branch protection rules) | Push to a fresh fixture repo; check `gh api repos/{owner}/{repo}/branches/playwright-healer-state` returns 200 |
| `contents: write` org restriction handling | STA-01 | Cannot reproduce locally — depends on GitHub org policy | Test in an org with `contents: write` denied; ingest step should fail with a helpful message (not a stack trace) |

---

## SC ↔ Verification Map (closure proof)

| SC# | Statement | Automated coverage | Manual coverage |
|-----|-----------|--------------------|-----------------|
| 1 | First use creates orphan; second appends NDJSON | 2-03-01 (worktree.test.ts) | First-use against real remote (above) |
| 2 | Two concurrent ingests both land | 2-03-02 (concurrency.test.ts — serial conflict path) | True parallel-runner scenario (above) |
| 3 | 40% failure rate → step-summary annotation, no dispatch | 2-04-01 (flake-rate.test.ts) + 2-04-02 (no dispatch static check) | — |
| 4 | Invalid `flake-rate-threshold: "banana"` → Zod error | 2-01-01 (config.test.ts) | — |
| 5 | `playwright-healer-bot` commit → early exit | 2-02-01 (guards.test.ts) | — |

Every SC has at least one automated test; SC#1 and SC#2 also require manual confirmation against a real GitHub remote.

---

## Dimension 8 (Nyquist Validation Coverage)

To be filled by gsd-planner per task. Aim for ≥1 test per requirement-ID at the unit level + integration-level coverage for STA-* and DET-* patterns. Current coverage estimate: 17 / 17 requirement IDs have at least one test row above (DET-04 covered by negative `git grep` static check).
