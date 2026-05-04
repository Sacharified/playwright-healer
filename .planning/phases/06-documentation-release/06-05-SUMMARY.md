---
phase: 06-documentation-release
plan: 06-05
subsystem: ci-workflows
tags: [self-test, sec-05, pkp-04, workflows, dogfood, ingest]
dependency_graph:
  requires: [06-01, 06-02, 06-03, 06-04]
  provides: [self-test.yml, ingest.yml]
  affects: [.github/workflows/]
tech_stack:
  added: []
  patterns: [SEC-05 actor guard, dogfood no-op skeleton, workflow promotion]
key_files:
  created:
    - .github/workflows/self-test.yml
    - .github/workflows/ingest.yml
  modified:
    - scripts/trigger-heal-local.sh
    - tests/fixture-app/tests/broken-assertion.spec.ts
  deleted:
    - .github/workflows/e2e-heal-self.yml
decisions:
  - SEC-05 guard uses github.actor != 'playwright-healer-bot' (not github-actions[bot]) — HEALER_PAT carries PAT owner identity, not built-in bot identity; BOT_NAME in loop-guard.ts is canonical
  - ingest.yml ships as documented no-op skeleton — report-parser expects Playwright JSON (suites/config/stats); this repo uses vitest; vitest→Playwright adapter deferred to v0.1.1
  - github-actions[bot] appears twice in self-test.yml comment block (explaining WHY not to use it) — correct, not a condition bug
metrics:
  duration: 3m
  completed: 2026-05-03
  tasks_completed: 3
  files_changed: 5
---

# Phase 6 Plan 5: Self-Test Workflow Promotion Summary

Self-test.yml created from e2e-heal-self.yml with push/PR/workflow_dispatch triggers, SEC-05 playwright-healer-bot actor guard on all three jobs, and dogfood ingest.yml skeleton with documented no-op for vitest→Playwright format gap.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create .github/workflows/self-test.yml | 6651958 | .github/workflows/self-test.yml (created) |
| 2 | Remove e2e-heal-self.yml | ca1d339 | .github/workflows/e2e-heal-self.yml (deleted), scripts/trigger-heal-local.sh, tests/fixture-app/tests/broken-assertion.spec.ts |
| 3 | Create .github/workflows/ingest.yml | ca569c0 | .github/workflows/ingest.yml (created) |

## Verification Results

### Phase-Level Gates

| Gate | Check | Result |
|------|-------|--------|
| Gate 1 | self-test.yml exists AND e2e-heal-self.yml deleted | PASS |
| Gate 2 | YAML structure valid (name/on/jobs present) | PASS |
| Gate 3 | playwright-healer-bot in if: conditions (4 matches); github-actions[bot] only in comments (2 matches, not conditions) | PASS |
| Gate 4 | push/pull_request triggers present | PASS |
| Gate 5 | No bare fixture/ references (all paths use tests/fixture-app/) | PASS |
| Gate 6 | ingest.yml has mode: ingest, actor guard, skip sentinel | PASS |

### self-test.yml Verification

- `on:` trigger block: `push: branches: [main]` + `pull_request: paths:` + `workflow_dispatch`
- Paths filter: `src/**`, `action.yml`, `.github/workflows/self-test.yml`, `tests/fixture-app/**`
- All three jobs (`assert-test-broken`, `heal`, `assert-artifact-opened`) have `if:` with `github.actor != 'playwright-healer-bot'` and `!contains(github.event.head_commit.message, '[skip-healer]')`
- Comment block at top of file explains playwright-healer-bot identity reasoning
- BOT_NAME confirmed from `src/shared/loop-guard.ts` line 14: `export const BOT_NAME = 'playwright-healer-bot'`
- `tests/fixture-app/` count: 10 occurrences (no bare `fixture/` references)

### ingest.yml Verification

- Valid YAML structure with push/pull_request/workflow_dispatch triggers
- SEC-05 actor guard identical to self-test.yml
- `enable_auto_dispatch: 'false'` hardcoded (not parameterized)
- `contents: write` + `actions: read` permissions
- `fetch-depth: 0` for state-branch git operations
- Top-of-file comment documents dogfood-not-self-test intent
- No-op skeleton with `core.warning` when no Playwright report found
- v0.1.1 follow-up item documented inline

## Deviations from Plan

### Auto-fixed Issues

None.

### Plan vs Reality Clarifications

**1. SEC-05 guard was added (not replaced)**

The plan stated "the current condition checks for `github-actions[bot]` — this is WRONG". In reality, `e2e-heal-self.yml` had NO `if:` conditions on any jobs at all. The SEC-05 guard was therefore added fresh to all three jobs (not replacing an incorrect one). The end state is identical to what the plan specified — this was a plan description inaccuracy, not a code issue.

### Task 3: No-op skeleton decision

The `src/ingest/report-parser.ts` Zod schema validates Playwright JSON format (`suites`, `config`, `stats` keys). This repo's test suite uses vitest, which emits a different JSON shape. Creating a vitest→Playwright adapter exceeded ~30 lines and would require non-trivial format mapping. Per the plan's explicit authorization ("document the gap and ship as a no-op skeleton"), the workflow ships with:
- A step that checks for Playwright-shaped report at `test-results/results.json`
- If absent/wrong shape: `core.warning` explaining the gap + exit success
- CONTEXT D-09 file hierarchy requirement satisfied
- v0.1.1 follow-up item documented in the workflow comments and this SUMMARY

### Reference updates (Rule 1 - auto-fix)

When removing `e2e-heal-self.yml` in Task 2, `git grep` found two non-planning references:
- `scripts/trigger-heal-local.sh` line 5: comment referencing old filename — updated to `self-test.yml`
- `tests/fixture-app/tests/broken-assertion.spec.ts` line 19: comment referencing old filename — updated to `self-test.yml`

Both were comment-only references (no logic change). Included in Task 2 commit.

## Known Stubs

**ingest.yml dogfood wiring**: The ingest step is a documented no-op skeleton. When no Playwright-shaped JSON report exists (the current state of this repo), the workflow emits `core.warning` and exits cleanly. This is the authorized path per the plan and does NOT prevent the plan's goal — CONTEXT D-09's file hierarchy requirement is satisfied by the file's existence. The v0.1.1 follow-up is: generate a Playwright-compatible report wrapper around vitest results and pass it to `report_path`.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary surface introduced. The workflows use existing `secrets.HEALER_PAT` (established in Phase 03.1) and `secrets.GEMINI_API_KEY` patterns. SEC-05 actor guard is additive security (defense-in-depth).

## Self-Check: PASSED

Files created:
- `.github/workflows/self-test.yml` — FOUND
- `.github/workflows/ingest.yml` — FOUND

Files deleted:
- `.github/workflows/e2e-heal-self.yml` — CONFIRMED DELETED

Commits exist:
- `6651958` — feat(06-05): create self-test.yml from e2e-heal-self.yml — FOUND
- `ca1d339` — chore(06-05): remove e2e-heal-self.yml (replaced by self-test.yml) — FOUND
- `ca569c0` — feat(06-05): create .github/workflows/ingest.yml dogfood ingest workflow — FOUND
