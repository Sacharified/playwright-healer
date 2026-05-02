---
phase: 05-auto-merge
plan: 02
subsystem: pr-writer, healer-orchestrator
tags: [auto-merge, evaluateAutoMerge, enableAutoMerge, renderAutoMergeBand, octokit-graphql, reasoning-band, gate, soft-fail, tdd]
dependency_graph:
  requires:
    - Phase 05 Plan 01 (OpenHealerPrArgs widening, Config schema fields)
  provides:
    - evaluateAutoMerge() pure function (MRG-02 four-condition gate)
    - enableAutoMerge() GraphQL wrapper with D-05 soft-fail (MRG-03)
    - renderAutoMergeBand() reasoning-band renderer (MRG-04)
    - extractPatchedFiles() unified-diff parser (SSOT, exported)
    - CONFIG_FILE_DENYLIST overlay (D-03, lives next to gate)
    - Auto-merge gate wired into openHealerPr post-create path (D-04/D-08)
    - index.ts call site fully typed — Plan 01 type error resolved
  affects:
    - src/healer/pr-writer.ts (gate implementation + IO + reasoning band)
    - src/healer/index.ts (call site threaded with Phase 05 args)
    - src/healer/index.test.ts (baseConfig + mock updated)
tech_stack:
  added: []
  patterns:
    - Pure evaluateAutoMerge() → AutoMergeDecision (four ordered conditions)
    - D-05 soft-fail: GraphqlResponseError instanceof + generic catch → errorMessage return (no throw)
    - D-08 dedup-bypass: gate runs ONLY on no-existing-PR branch of openHealerPr
    - D-07 validation-sentinel: total===0 → ineligible (WR-02 carry-forward)
    - D-17 SSOT: TEST_PATH_ALLOWLIST re-imported from forbidden-patterns.ts; not duplicated
    - CONFIG_FILE_DENYLIST overlay: second stricter denylist for config files, lives next to gate (D-03)
    - Reasoning band always renders on PR creation regardless of enableAutoMerge flag (MRG-04/D-09)
    - TDD RED→GREEN per task (Tasks 2, 3, 4 each have explicit RED commit before GREEN)
key_files:
  created: []
  modified:
    - src/healer/pr-writer.ts
    - src/healer/pr-writer.test.ts
    - src/healer/index.ts
    - src/healer/index.test.ts
decisions:
  - "Task 1 has no RED gate per plan revision — helpers land directly, coverage folds into Task 2"
  - "warning text uses lowercase 'see README §auto-merge-prerequisites' (matched by test stringContaining)"
  - "index.test.ts baseConfig extended with enableAutoMerge/autoMergePassRate/autoMergeFixClasses (Rule 1: runtime undefined crash without them)"
  - "index.test.ts pr-writer.js mock extended with extractPatchedFiles: vi.fn().mockReturnValue([]) (Rule 1: newly imported function was undefined in mock)"
metrics:
  duration: ~70m
  completed: 2026-05-02T19:20:47Z
  tasks_completed: 4
  files_modified: 4
---

# Phase 05 Plan 02: Auto-Merge Gate Implementation Summary

Auto-merge gate end-to-end: `evaluateAutoMerge()` pure function over four eligibility conditions, `enableAutoMerge()` Octokit GraphQL wrapper with D-05 soft-fail, `renderAutoMergeBand()` reasoning-band emitter, `extractPatchedFiles()` unified-diff parser — all wired into `openHealerPr()` post-create path with `index.ts` call site fully threaded.

## What Was Built

- **`src/healer/pr-writer.ts`** — 285 lines added across four tasks:
  - `CONFIG_FILE_DENYLIST` module-scope frozen array (D-03, overlay denylist for config files, lives next to gate not in forbidden-patterns.ts)
  - `AutoMergeCondition` / `AutoMergeDecision` interfaces (exported)
  - `extractPatchedFiles(diff: string): string[]` — parses unified-diff `+++ b/<path>` lines, excludes `/dev/null`, exported as SSOT for both gate and index.ts
  - `isInTestPath()` / `isConfigFile()` private helpers
  - `EvaluateAutoMergeArgs` interface (exported)
  - `evaluateAutoMerge(args): AutoMergeDecision` — pure function, four ordered conditions: `pass_rate` (D-07 total>0 guard), `fix_class`, `scope` (D-02 TEST_PATH_ALLOWLIST re-import), `config_files` (D-03 CONFIG_FILE_DENYLIST)
  - `ENABLE_AUTO_MERGE_MUTATION` GraphQL constant (no commitHeadline/commitBody per T-05-06)
  - `EnableAutoMergeResult` interface (exported)
  - `enableAutoMerge(octokit, prNodeId): Promise<EnableAutoMergeResult>` — D-05 soft-fail catches `GraphqlResponseError` (joined `.errors[].message`) and generic errors; returns result object, never throws
  - `renderAutoMergeBand(decision, enabledFlag, enableResult): string[]` — MRG-04 markdown table `Condition | Result | Reason` + outcome row; always renders on PR creation
  - `openHealerPr()` modified: gate runs post-create only (D-08 dedup-bypass), node_id missing guard (D-05), mutation called only when `enableAutoMerge && eligible`

- **`src/healer/pr-writer.test.ts`** — 625 lines added:
  - `evaluateAutoMerge` describe blocks: pass_rate (PR1-5), fix_class (FC1-5), scope (SC1-7), config_files (CF1-7), eligible aggregation (EA1-4) = 28 tests
  - `enableAutoMerge` happy path (EA1-2), soft-fail GraphQL (EF1-3), soft-fail non-GraphQL (EF4-5) = 7 tests
  - `renderAutoMergeBand` preview (RB1-2), live (RB3-5), table structure (RB6-7) = 7 tests
  - `openHealerPr` integration (IN1-IN9) = 9 tests
  - Total: 51 new tests; 79 total in pr-writer.test.ts

- **`src/healer/index.ts`** — 12 lines added: import `extractPatchedFiles`, split `autoMergeFixClasses` string at call site, extract `patchedFiles` from `proposal.diff`, thread four new fields into `openHealerPr({...})` — resolves Plan 01's expected type error at line 354

- **`src/healer/index.test.ts`** — 4 lines modified: `extractPatchedFiles` added to pr-writer.js mock; Phase 05 fields added to `baseConfig`

## Commits

| Task | Phase | Commit | Description |
|------|-------|--------|-------------|
| Task 1 | feat | b54dc9d | Add CONFIG_FILE_DENYLIST, extractPatchedFiles, AutoMerge types |
| Task 2 | RED | 538f32c | Failing tests for evaluateAutoMerge (28 tests) |
| Task 2 | GREEN | 0c9dfde | Implement evaluateAutoMerge() four-condition gate |
| Task 3 | RED | 28c3e43 | Failing tests for enableAutoMerge + renderAutoMergeBand (14 tests) |
| Task 3 | GREEN | 836682d | Implement enableAutoMerge() and renderAutoMergeBand() |
| Task 4 | RED | 1ea87c6 | Failing integration tests for openHealerPr gate wiring (9 tests) |
| Task 4 | GREEN | 658470f | Wire gate into openHealerPr + extend index.ts call site |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] index.test.ts pr-writer.js mock missing extractPatchedFiles**
- **Found during:** Task 4 GREEN verification
- **Issue:** `vi.mock('./pr-writer.js', ...)` only exported `openHealerPr` and `renderPrBody`. After Task 4 added `import { extractPatchedFiles }` to `index.ts`, the mock returned `undefined` for `extractPatchedFiles` causing `TypeError: extractPatchedFiles is not a function` in 8 pre-existing index.test.ts tests.
- **Fix:** Added `extractPatchedFiles: vi.fn().mockReturnValue([])` to the mock factory.
- **Files modified:** src/healer/index.test.ts

**2. [Rule 1 - Bug] index.test.ts baseConfig missing Phase 05 fields**
- **Found during:** Task 4 GREEN verification (same batch as above)
- **Issue:** `baseConfig` used `as Config` cast without `enableAutoMerge`, `autoMergePassRate`, `autoMergeFixClasses`. At runtime, `config.autoMergeFixClasses.split(',')` threw `Cannot read properties of undefined`. 8 tests that called the happy path through `run()` failed.
- **Fix:** Added three Phase 05 fields to `baseConfig` with correct defaults (enableAutoMerge: false, autoMergePassRate: 1.0, autoMergeFixClasses: 'selectors').
- **Files modified:** src/healer/index.test.ts

**3. [Rule 1 - Bug] warning text case mismatch**
- **Found during:** Task 4 GREEN — IN3 test failure
- **Issue:** Implementation used `"See README §auto-merge-prerequisites"` (capital S); test checked `stringContaining('see README §auto-merge-prerequisites')` (lowercase s). Case-sensitive mismatch.
- **Fix:** Changed to lowercase `see` to match the plan's specified warning text and test assertion.
- **Files modified:** src/healer/pr-writer.ts

## Plan Completion Criteria

- [x] MRG-02: evaluateAutoMerge() with four conditions tested in pr-writer.test.ts
- [x] MRG-03: enableAutoMerge() GraphQL mutation with SQUASH, soft-fail paths tested
- [x] MRG-04: renderAutoMergeBand() always renders when PR created, tested
- [x] D-05 soft-fail: GraphqlResponseError and non-GraphQL errors both tested (EF1-5)
- [x] D-07 validation-skipped path: total===0 → ineligible (PR1, IN7)
- [x] D-08 dedup-bypass: mockGraphql never called on dedup branch (IN8)
- [x] D-02/D-03: scope and config-file overlay both tested with concrete paths (SC1-7, CF1-7)
- [x] T-05-06: commitHeadline/commitBody not in mutation variables (EA2)
- [x] T-05-05: gate not invoked on PRI-04 dedup branch (IN8)
- [x] extractPatchedFiles SSOT: imported by index.ts, not duplicated (grep confirms)
- [x] tsc --noEmit: 0 errors (Plan 01's index.ts:354 error resolved)
- [x] Full suite: 469 tests passing, 0 failing

## TDD Gate Compliance

- Task 1: No RED gate (plan-specified — helpers only, coverage folds into Task 2)
- Task 2 RED: commit 538f32c — 28 failing tests (evaluateAutoMerge not yet implemented)
- Task 2 GREEN: commit 0c9dfde — 28 tests passing
- Task 3 RED: commit 28c3e43 — 14 failing tests (enableAutoMerge/renderAutoMergeBand not yet implemented)
- Task 3 GREEN: commit 836682d — 14 tests passing
- Task 4 RED: commit 1ea87c6 — 9 failing integration tests (gate not yet wired)
- Task 4 GREEN: commit 658470f — 9 tests passing; 3 Rule 1 fixes applied (index.test.ts)

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The `enablePullRequestAutoMerge` GraphQL mutation uses the existing `healer_token` PAT (already required for `pulls.create`). The mutation is gated by `enableAutoMerge && eligible` — cannot fire without both config flag and eligibility conditions met. T-05-02 (scope bypass), T-05-03 (soft-fail info leak), T-05-05 (dedup re-evaluation), T-05-06 (SKIP_SENTINEL in squash commit body) all mitigated per plan threat_model and verified via tests.

## Self-Check: PASSED

- FOUND: src/healer/pr-writer.ts (466 lines)
- FOUND: src/healer/pr-writer.test.ts (938 lines)
- FOUND: src/healer/index.ts (439 lines)
- FOUND: src/healer/index.test.ts (699 lines)
- FOUND: commit b54dc9d (Task 1 feat — types + helpers)
- FOUND: commit 538f32c (Task 2 RED)
- FOUND: commit 0c9dfde (Task 2 GREEN)
- FOUND: commit 28c3e43 (Task 3 RED)
- FOUND: commit 836682d (Task 3 GREEN)
- FOUND: commit 1ea87c6 (Task 4 RED)
- FOUND: commit 658470f (Task 4 GREEN)
- tsc --noEmit: 0 errors confirmed
- vitest run: 469/469 tests passing confirmed
