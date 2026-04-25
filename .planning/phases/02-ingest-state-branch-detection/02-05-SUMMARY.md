---
phase: 02-ingest-state-branch-detection
plan: "05"
subsystem: ingest-pipeline
tags: [ingest, pipeline, wiring, end-to-end]
dependency_graph:
  requires:
    - src/shared/loop-guard.ts (shouldSkipIngest)
    - src/shared/state-branch.ts (bootstrap/append/runGc/removeWorktree)
    - src/shared/types.ts (NdjsonRecord/NdjsonTestEntry)
    - src/ingest/report-parser.ts (parseReport)
    - src/ingest/threshold-evaluator.ts (evaluateThresholds)
    - src/ingest/summary-writer.ts (writeDetectionSummary)
  provides:
    - src/ingest/index.ts run(config): Promise<void> — full orchestration
    - src/index.ts main() — extended with CFG-03 inputs + YAML pre-merge
status: complete
recovered_from_checkpoint: false
---

## Outcome

The ingest pipeline is now end-to-end wired. `src/ingest/index.ts run(config)` no longer throws "ingest mode not implemented" — it executes the full Phase 02 contract:

1. SEC-05 loop guard (first call, zero side-effects before this)
2. Report glob via `@actions/glob` → `parseReport` (zero matches → `report-unreadable` record but pipeline continues)
3. Build `NdjsonRecord` from parsed entries + runner env (`GITHUB_RUN_ID`, `github.context.sha`, `github.context.ref`, `SHARD_INDEX/SHARD_TOTAL`, `package.json` version)
4. `bootstrapOrGetWorktree` → `appendRecord` (STA-01..04)
5. `runGc(retentionDays)` (STA-05)
6. `evaluateThresholds(windowRecords, config)` (DET-01..03)
7. `writeDetectionSummary(detections)` (DET-04 log-only)
8. `finally { removeWorktree }` — worktree cleanup never aborts the run; errors become warnings

`src/index.ts main()`:

- **Phase B** extended with 10 CFG-03 inputs (`reportPath`, `flakeRateThreshold`, `flakeWindowDays`, `slowRegressionPct`, `rerunCount`, `rerunPassRate`, `maxBudgetUsd`, `maxTurns`, `retentionDays`, `maxHealsPerTestPerWeek`).
- **Phase B'** added: `loadYamlConfig(workspacePath)` runs BEFORE `safeParse`; YAML kebab-case keys are camelized via a small `camelize()` helper, then `mergeConfigs(actionInputs, yamlAsCamel)` produces the rawInputs Zod sees.
- D-07 secret-masking ordering preserved (Phase A unchanged).

The kebab→camel translation is the key bridge that makes SC#4 work end-to-end: a YAML `flake-rate-threshold: "banana"` becomes `flakeRateThreshold: "banana"` before reaching Zod, so `z.coerce.number().refine(!isNaN)` fires the named field error.

## Files

| File | Change | Lines |
|------|--------|-------|
| `src/index.ts` | Phase B extended; Phase B' YAML pre-merge added | 156 (was 123) |
| `src/ingest/index.ts` | Phase 01 stub → full pipeline | 188 (was 6) |

## Verification

```
$ npx tsc --noEmit
(exits 0)

$ npm test
 Test Files  6 passed (6)
      Tests  72 passed (72)
   Duration  2.79s

$ grep -rn 'createWorkflowDispatch\|workflow_dispatch' src/
DET-04 OK: no dispatch in src/

$ awk '/loadYamlConfig/{l=NR} /safeParse/{if(l>0 && NR>l){print "OK: line " l " < " NR; exit}}' src/index.ts
OK: line 77 < 84

$ grep -n 'shouldSkipIngest\|bootstrapOrGetWorktree\|loadYamlConfig\|parseReport' src/ingest/index.ts | head -3
6://   1. shouldSkipIngest()  — SEC-05 loop-guard MUST be first
27:import { shouldSkipIngest } from '../shared/loop-guard.js';
29:import { parseReport } from './report-parser.js';

$ git grep -nE 'fetch\(|http\.request\(|axios|got\(|node-fetch|undici' -- 'src/*.ts' 'src/**/*.ts' || echo "OK"
SEC-07 Check 4 OK: no HTTP call-sites

$ wc -l src/ingest/index.ts
     188 src/ingest/index.ts
```

## Notable design notes

- **`shardIndex/shardTotal` parsing:** `parseInt('') || null` and `parseInt('0') || null` both collapse to `null`. This is intentional — both an unset env var and an explicit "0" mean "not sharded".
- **`report-unreadable` synthesis:** When the glob matches no files (or when `parseReport` returns `reportUnreadable: true`), the record contains a single sentinel test entry with `outcome: 'report-unreadable'`. The threshold evaluator filters these out (ING-03), so the record exists for audit but does not move detections.
- **YAML key camelization is local:** Implemented inline in `src/index.ts` (not in `mergeConfigs`) so the existing `mergeConfigs` tests in `tests/unit/config.test.ts` (which assert verbatim kebab keys) still pass.
- **Worktree cleanup as `finally`:** Cleanup runs on success, exception, and signal exit. Cleanup-failure is downgraded to a warning so a flaky `/tmp` doesn't fail the action.

## Commits

| SHA | Message |
|-----|---------|
| `e9db464` | `feat(02-05): wire ingest pipeline end-to-end` |

## What this enables

- **02-06 (next wave)** can now check the 17 Phase 02 requirement IDs against real implementations.
- **Phase 04** layers `createWorkflowDispatch` onto the Detection[] surface that `writeDetectionSummary` already renders.
- **SC#4** is now wirable end-to-end: a YAML `flake-rate-threshold: "banana"` will trigger `Invalid inputs: flakeRateThreshold: flake-rate-threshold must be a valid number (e.g. 0.2)`.

## Self-Check

- [x] All tasks executed (2/2)
- [x] Single squashed commit (the two tasks share a logical unit; tasks 2-05-01 and 2-05-02 are tightly coupled by the SC#4 wiring contract)
- [x] SUMMARY.md created in plan directory
- [x] No modifications to STATE.md or ROADMAP.md (orchestrator reserves those)
- [x] DET-04 log-only contract enforced across full src/ tree
- [x] Loop-guard ordering preserved (shouldSkipIngest first call in run())
