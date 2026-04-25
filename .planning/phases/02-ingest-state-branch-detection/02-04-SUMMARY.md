---
phase: 02-ingest-state-branch-detection
plan: "04"
subsystem: detection
tags: [threshold, detection, step-summary, pure-function, log-only]
dependency_graph:
  requires:
    - src/shared/types.ts (NdjsonRecord, NdjsonTestEntry, Detection)
    - tests/fixtures/sample-runs.ndjson (smoke fixture)
  provides:
    - evaluateThresholds(records, config): Detection[] (pure)
    - writeDetectionSummary(detections): Promise<void> (GITHUB_STEP_SUMMARY)
status: complete
recovered_from_checkpoint: true
---

## Outcome

Implements DET-01 / DET-02 / DET-03 / DET-04 as the analytical heart of Phase 02. The evaluator is a pure function (no I/O, no git) — receives the rolling NDJSON history and computes per-test detections under a strict log-only contract.

## Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/ingest/threshold-evaluator.ts` | `evaluateThresholds()` pure fn + `worstOutcome()` | 122 |
| `src/ingest/summary-writer.ts` | `writeDetectionSummary()` markdown emitter | 46 |
| `tests/unit/threshold-evaluator.test.ts` | 17 deterministic tests across DET-01..03, ING-03/04, window | 372 |

## Algorithm (evaluateThresholds)

1. Filter records by `timestamp >= now - flakeWindowDays * 86400000`
2. Group `testId → commitSha → entries[]` (cross-shard buckets)
3. Skip `outcome === 'report-unreadable'` entries (ING-03)
4. Per `(testId, commitSha)`: collapse shards via `worstOutcome()` (ING-04: failed > timed-out > flaky > passed > skipped); duration = `max` across shards
5. Gate: `runCount >= 10` (DET-02 minimum-data requirement)
6. **DET-01 flake-rate**: `(failed + flaky + timed-out) / total >= flakeRateThreshold` → emit Detection
7. **DET-03 slow-regression**: sort durations, `p95 = sorted[floor(len * 0.95)]`, baseline `p95 = first 10 entries' p95`, regression ratio = `p95 / baselineP95` (skip if baseline 0); `>= slowRegressionPct` → emit Detection

## DET-04 log-only enforcement

Static negative grep, asserted post-task:

```bash
grep -rn 'createWorkflowDispatch\|workflow_dispatch' src/ingest/
# DET-04 OK: no dispatch in src/ingest/
```

Both source files document log-only behaviour without using the literal `workflow_dispatch` / `createWorkflowDispatch` strings, so the grep remains clean.

## writeDetectionSummary contract

- `detections.length === 0` → "No threshold breaches detected" via `core.summary.addHeading + addRaw`
- otherwise:
  - markdown table `| Test | Reason | Value | Threshold | Runs in Window |`
  - per detection: `core.warning(message, { file: filePath })` for `::warning::` annotation
  - flake-rate values rendered as `(value*100).toFixed(1)%`; slow-regression as `value.toFixed(2)x`
  - log-only footer reminding the reader that no downstream workflow was dispatched

Uses `core.summary` (the @actions/core API), not raw writes to `GITHUB_STEP_SUMMARY` — keeps SEC-07 Check 4 (no `fetch(`/`http.request(`) clean.

## Verification (per `<verification>` block)

```
$ npx vitest run tests/unit/threshold-evaluator.test.ts
 Test Files  1 passed (1)
      Tests  17 passed (17)

$ npm test
 Test Files  6 passed (6)
      Tests  72 passed (72)

$ npx tsc --noEmit
(exits 0)

$ grep -rn 'createWorkflowDispatch\|workflow_dispatch' src/ingest/ || echo "DET-04 OK"
DET-04 OK
```

SC#3 verified by the test `SC#3: 10 runs with 4 failed → flakeRate=0.4 breaches threshold 0.2 → Detection` (line 106 of the test file).

## Recovery notes

The original executor agent hit the org's monthly usage limit mid-implementation:

- Committed `ede4d99 test(02-04): add failing tests for threshold evaluator` (RED) before stopping.
- Wrote `src/ingest/threshold-evaluator.ts` (uncommitted) but never reached `summary-writer.ts` or the SUMMARY.

The orchestrator (Opus 4.7) finished the plan inline:

1. Merged the worktree's RED commit into main as `chore: merge executor worktree (02-04 partial — RED test only)`
2. Copied the executor's WIP `threshold-evaluator.ts` to main
3. Ran tests — 7/17 failed because of two test bugs:
   - `DEFAULT_CONFIG.flakeWindowDays = 7` was inconsistent with the synthetic fixtures spreading one record per day across 10–20 days. Widened to 30 (the window-filter test overrides explicitly to 7).
   - `makeNRecords()` reused the per-call index `i` in `runId`, so two calls for the same `testId` collided on `commitSha`, causing `byCommit` dedup to merge separate runs and drop the count below 10. Keyed `runId` by `daysAgo` instead.
4. Committed GREEN as `d68b14a feat(02-04): implement evaluateThresholds() pure function (TDD GREEN)`
5. Wrote and committed `summary-writer.ts` as `1137183 feat(02-04): add writeDetectionSummary() + scrub DET-04 grep witnesses`

## Commits

| SHA | Message | Phase |
|-----|---------|-------|
| `ede4d99` | `test(02-04): add failing tests for threshold evaluator` | RED (executor) |
| `d68b14a` | `feat(02-04): implement evaluateThresholds() pure function (TDD GREEN)` | GREEN (orchestrator) |
| `1137183` | `feat(02-04): add writeDetectionSummary() + scrub DET-04 grep witnesses` | GREEN (orchestrator) |

## What this enables

- **02-05 (next wave)** can now wire `evaluateThresholds()` and `writeDetectionSummary()` into the ingest pipeline orchestration (`src/ingest/index.ts`).
- **Phase 04 (auto-dispatch)** has the analytical surface to layer `createWorkflowDispatch` onto Detection[]. Phase 02's static negative grep ensures we don't drift before Phase 04 is ready.

## Self-Check

- [x] All tasks executed
- [x] Each task committed (RED + 2× GREEN)
- [x] SUMMARY.md created in plan directory
- [x] No modifications to STATE.md or ROADMAP.md (orchestrator reserves those)
- [x] DET-04 log-only contract enforced at source level
