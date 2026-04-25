---
phase: 2
slug: ingest-state-branch-detection
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-25
updated: 2026-04-25
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.5 (installed in 02-00-PLAN.md) |
| **Config file** | `vitest.config.ts` (created by 02-00; two projects: unit/threads + integration/forks) |
| **Quick run command** | `npx vitest run tests/unit/ --reporter=dot` |
| **Full suite command** | `npx vitest run` |
| **Integration only** | `npx vitest run --pool=forks tests/integration/` |
| **Estimated runtime** | unit: ~5s; integration: ~15s (bare-repo git ops) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run tests/unit/ --reporter=dot` (unit tests only, < 10s)
- **After every plan wave:** `npx vitest run` (full suite including integration, < 30s)
- **Before `/gsd-verify-work`:** Full suite green + DET-04 static assertion clean
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

*Updated 2026-04-25 — task IDs reflect final plan decomposition.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-00-01 | 02-00 | 0 | (infra) | — | devDeps installed; vitest config has two projects | unit | `node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); if(!p.devDependencies.vitest) throw new Error(); console.log('OK')"` | ❌ W0 | ⬜ pending |
| 2-00-02 | 02-00 | 0 | (infra) | — | bare-repo + fixture helpers exist; `npx vitest run` exits 0 with zero tests | unit | `npx vitest run 2>&1; echo "exit: $?"` | ❌ W0 | ⬜ pending |
| 2-01-01 | 02-01 | 1 | CFG-03, CFG-06, CFG-07 | T-2-01 (config injection from fork PR) | Zod fail-fast on `flake-rate-threshold: "banana"` (no JS crash); loadYamlConfig wraps parse in try/catch | unit | `npx vitest run tests/unit/config.test.ts` | ❌ W0 | ⬜ pending |
| 2-01-02 | 02-01 | 1 | CFG-03 | — | action.yml has 21 inputs; INPUT_FLAKE-RATE-THRESHOLD present in env block | static | `yq eval '.inputs \| keys \| length' action.yml` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02-02 | 1 | SEC-05 | T-2-02 (loop amplification) | playwright-healer-bot author → shouldSkipIngest() returns true; fork PR → returns true; [skip-healer] → returns true | unit | `npx vitest run tests/unit/loop-guard.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02-02 | 1 | ING-01, ING-02, ING-03, ING-04 | T-2-03 (path traversal in report glob) | parseReport() extracts testId={file}::{title}, correct outcome mapping; unreadable shape returns reportUnreadable:true | unit | `npx vitest run tests/unit/report-parser.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-01 | 02-03 | 2 | STA-01, STA-02, STA-03, STA-04 | T-2-04 (race condition data loss) | Orphan branch created in isolated worktree; second run appends; serial conflict path preserves both records | integration | `npx vitest run --pool=forks tests/integration/state-branch.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-02 | 02-03 | 2 | STA-05 | T-2-05 (GC data) | retention-days:0 is no-op; recent files preserved; GC prunes old files (integration) | unit+integration | `npx vitest run tests/unit/state-branch-gc.test.ts` | ❌ W0 | ⬜ pending |
| 2-04-01 | 02-04 | 3 | DET-01, DET-02, DET-03 | — | 10 runs at 40% failure → flake-rate Detection; 9 runs → no detection; p95 2x → slow-regression Detection; shard dedup counts correctly | unit | `npx vitest run tests/unit/threshold-evaluator.test.ts` | ❌ W0 | ⬜ pending |
| 2-04-02 | 02-04 | 3 | DET-04 | T-2-06 (premature dispatch) | Log-only mode: NO createWorkflowDispatch in src/ingest/ — static grep assertion | static | `grep -rn 'createWorkflowDispatch' src/ingest/ \|\| echo "DET-04 OK"` | ❌ W0 | ⬜ pending |
| 2-05-01 | 02-05 | 4 | CFG-03, CFG-06 | — | rawInputs includes report-path; D-07 startup ordering preserved | static | `grep -q "reportPath.*getInput.*report-path" src/index.ts && echo "OK"` | ❌ W0 | ⬜ pending |
| 2-05-02 | 02-05 | 4 | ING-01..04, STA-01..05, DET-01..04, SEC-05 | T-2-02c (pipeline guard ordering) | shouldSkipIngest() appears before bootstrapOrGetWorktree() in run(); full suite passes | integration | `npx vitest run` | ❌ W0 | ⬜ pending |
| 2-06-01 | 02-06 | 5 | (all 17 Phase 02 IDs) | — | All 17 requirements marked [x] in REQUIREMENTS.md; ROADMAP shows 7 plans | static | `grep -c '\[x\].*CFG-03\|ING-01\|STA-01\|DET-01\|SEC-05' REQUIREMENTS.md` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest@4.1.5` and `@vitest/coverage-v8@4.1.5` added to `devDependencies` in `package.json`
- [ ] `yaml@2.8.3` added to `dependencies` in `package.json`
- [ ] `@actions/glob@0.7.0` added to `dependencies` (RUNTIME — imported by src/ingest/index.ts; composite action's `npm ci --production` excludes devDependencies)
- [ ] `vitest.config.ts` at repo root — two projects: `unit` (threads pool, `tests/unit/**/*.test.ts`) and `integration` (forks pool, `tests/integration/**/*.test.ts`); `testTimeout: 15000`
- [ ] `tests/_helpers/bare-repo.ts` — `makeBareRepo()` creates bare remote + two primary workspace clones; `BareRepoContext` interface with `cleanup()`
- [ ] `tests/_helpers/fixture-report.ts` — `makeFixtureReport(specs)` fabricates Playwright JSON reports; `makeTestEntry(override)` convenience wrapper
- [ ] Directory scaffolding: `tests/unit/.gitkeep`, `tests/integration/.gitkeep`, `tests/fixtures/.gitkeep`
- [ ] `.gitignore` updated to exclude `tmp-test-repos/` and `tmp-state-worktree*/` and `coverage/`
- [ ] `package.json` scripts.test updated from Phase 01 stub to `"vitest run"`
- [ ] No new `npm ci --production` runtime deps from Wave 0 (vitest + @vitest/coverage-v8 stay in devDependencies)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two truly concurrent ingest steps both land records (SC#2 — real parallel runners) | STA-04 | True concurrency requires the GitHub Actions runner — vitest simulates the serial conflict path (force-with-lease rejection + retry), but not genuine parallel races on separate runner VMs | Push to a fixture repo; trigger two parallel jobs from a matrix on the same commit; confirm `git log --oneline origin/playwright-healer-state` has 2 new commits |
| First-use orphan branch creation against a real GitHub remote (SC#1 — real remote) | STA-01 | `git push --force-with-lease` against a local bare repo behaves correctly, but a real GitHub remote has additional ref visibility and branch protection semantics | Push to a fresh fixture repo; check `gh api repos/{owner}/{repo}/branches/playwright-healer-state` returns 200 |
| `contents: write` org restriction — helpful error message | STA-01 | Cannot reproduce locally — depends on GitHub org policy | Test in an org with `contents: write` denied; ingest step should emit core.error() with hint, not a bare git exit 128 |

---

## SC ↔ Verification Map (closure proof)

| SC# | Statement | Automated coverage | Manual coverage |
|-----|-----------|--------------------|-----------------|
| 1 | First use creates orphan; second appends NDJSON | 2-03-01 (state-branch.test.ts: STA-01 + STA-02 tests) | First-use against real remote (above) |
| 2 | Two concurrent ingests both land | 2-03-01 (serial conflict path: STA-03 + STA-04 retry loop) | True parallel-runner scenario (above) |
| 3 | 40% failure rate → step-summary annotation, no dispatch | 2-04-01 (threshold-evaluator.test.ts) + 2-04-02 (DET-04 static grep) | — |
| 4 | `flake-rate-threshold: "banana"` → Zod error naming field | 2-01-01 (config.test.ts — "banana" test case) | — |
| 5 | playwright-healer-bot commit → early exit | 2-02-01 (loop-guard.test.ts — Guard 1 test case) | — |

Every SC has at least one automated test. SC#1 and SC#2 also require manual confirmation against a real GitHub remote.

---

## Dimension 8 (Nyquist Validation Coverage)

Coverage after plan decomposition: **17 / 17** requirement IDs have at least one test row above.

| Req ID | Plan | Test File | Notes |
|--------|------|-----------|-------|
| CFG-03 | 02-01 | tests/unit/config.test.ts | All 10 threshold inputs with default + coerce + refine |
| CFG-06 | 02-01 | tests/unit/config.test.ts | loadYamlConfig + mergeConfigs merge rules |
| CFG-07 | 02-01 | tests/unit/config.test.ts | "banana" → Zod error with field name (SC#4) |
| ING-01 | 02-02 | tests/unit/report-parser.test.ts | glob in 02-05; parser takes resolved JSON |
| ING-02 | 02-02 | tests/unit/report-parser.test.ts | 9 NdjsonTestEntry fields extracted |
| ING-03 | 02-02 | tests/unit/report-parser.test.ts | {} → { reportUnreadable: true }, no crash |
| ING-04 | 02-02 | tests/unit/report-parser.test.ts | shardIndex/shardTotal on NdjsonRecord (caller sets it) |
| STA-01 | 02-03 | tests/integration/state-branch.test.ts | orphan branch created; primary workspace unchanged |
| STA-02 | 02-03 | tests/integration/state-branch.test.ts | second appendRecord appends, not overwrites |
| STA-03 | 02-03 | tests/integration/state-branch.test.ts | force-with-lease retry on rejection |
| STA-04 | 02-03 | tests/integration/state-branch.test.ts | serial conflict → both records land |
| STA-05 | 02-03 | tests/unit/state-branch-gc.test.ts | retention-days:0 no-op; recent files preserved |
| DET-01 | 02-04 | tests/unit/threshold-evaluator.test.ts | flake rate + p95 computed from seeded records |
| DET-02 | 02-04 | tests/unit/threshold-evaluator.test.ts | 9 runs → no detection; 10 runs at 40% → detection |
| DET-03 | 02-04 | tests/unit/threshold-evaluator.test.ts | p95 2x baseline → slow-regression detection |
| DET-04 | 02-04 | static: `grep -rn 'createWorkflowDispatch' src/ingest/` | zero matches enforced in verify step |
| SEC-05 | 02-02 | tests/unit/loop-guard.test.ts | fork PR + bot email + sentinel all return true |
