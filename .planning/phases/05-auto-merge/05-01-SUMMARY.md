---
phase: 05-auto-merge
plan: 01
subsystem: config-schema, action-contract, pr-writer-interface
tags: [config, action-input, zod, opt-in, default-off, interface-widening]
dependency_graph:
  requires: []
  provides:
    - enableAutoMerge Zod field in Config type
    - autoMergePassRate Zod field in Config type
    - autoMergeFixClasses Zod field in Config type
    - OpenHealerPrArgs widened with four new required fields
    - action.yml three new inputs + three new INPUT_* env rows
  affects:
    - src/healer/index.ts (call-site type error — expected, Plan 02 resolves)
tech_stack:
  added: []
  patterns:
    - z.string().default('false').transform(v => v === 'true') — default-OFF boolean pattern (Phase 04 D-01 carry-forward)
    - z.coerce.number().min(0).max(1).default(1.0) — pass-rate field with range validation
    - superRefine second condition appended to existing callback (no chain)
key_files:
  created:
    - src/shared/config.test.ts
  modified:
    - src/shared/config.ts
    - src/healer/pr-writer.ts
    - action.yml
decisions:
  - "enableAutoMerge uses strict === 'true' transform (not !== 'false') to enforce default-OFF per CONTEXT D-01"
  - "autoMergePassRate default 1.0 is intentionally stricter than rerunPassRate 0.9 (CONTEXT D-01 / MRG-02)"
  - "autoMergeFixClasses stays string at schema layer; split-to-array deferred to Plan 02 gate call site"
  - "Test 9 updated: Zod 4 emits invalid_type for NaN-coerced string before refine fires — test checks success=false + path, not message text"
  - "config.test.ts created from scratch (file did not exist); Test 15 added as fresh describe block"
metrics:
  duration: ~6m
  completed: 2026-05-02T18:07:18Z
  tasks_completed: 3
  files_modified: 4
---

# Phase 05 Plan 01: Auto-Merge Config Foundation Summary

Configuration foundation for Phase 5 auto-merge: three new opt-in action inputs, Zod schema fields with default-OFF transforms and superRefine misconfig guard, and OpenHealerPrArgs interface widening so Plan 02 can land gate logic without re-touching the call site.

## What Was Built

- **`src/shared/config.ts`**: Three new Zod fields (`enableAutoMerge`, `autoMergePassRate`, `autoMergeFixClasses`) with transforms, range validation, and defaults. The existing `superRefine` block extended with a second condition: `enableAutoMerge=true` + empty allow-list emits a ZodIssue at `['autoMergeFixClasses']` with a clear message. No second `.superRefine()` chain — one callback with both conditions.

- **`src/shared/config.test.ts`** (created new): 15 tests across four describe blocks — default-OFF behavior, pass-rate range validation, comma-string passthrough, superRefine misconfig guard (empty + whitespace-only), benign-misconfig on flag-off, and apiKey no-regression.

- **`action.yml`**: Three new inputs (`enable_auto_merge`, `auto_merge_pass_rate`, `auto_merge_fix_classes`) with `required: false` and explicit defaults matching CONTEXT D-01. Three corresponding `INPUT_*` env rows in the `runs.steps[].env` block immediately after the Phase 04 group (Phase 01.2 snake_case convention, T-05-04).

- **`src/healer/pr-writer.ts`**: `OpenHealerPrArgs` interface widened with four new required fields: `enableAutoMerge: boolean`, `autoMergePassRate: number`, `autoMergeFixClasses: string[]`, `patchedFiles: string[]`. Interface widening only — no runtime logic added. Plan 02 owns the gate implementation.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 RED | 0704115 | test(05-01): add failing tests for Phase 05 auto-merge config schema |
| Task 1 GREEN | 7141614 | feat(05-01): add Phase 05 auto-merge config schema with misconfig guard |
| Task 2 | a490e23 | feat(05-01): add three auto-merge action inputs + INPUT_* env rows |
| Task 3 | 43bc023 | feat(05-01): widen OpenHealerPrArgs with four new Phase 05 fields |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Missing file] Created src/shared/config.test.ts from scratch**
- **Found during:** Task 1 setup
- **Issue:** Plan assumed config.test.ts existed for extension; the file does not exist in the codebase (only state-branch.test.ts and loop-guard.test.ts are in src/shared/)
- **Fix:** Created the file from scratch with all 15 tests. Test 15 (apiKey regression) added as a fresh describe block rather than extending an existing one.
- **Files modified:** src/shared/config.test.ts (created)

**2. [Rule 1 - Bug] Test 9 assertion updated for Zod 4 NaN-coerce behavior**
- **Found during:** Task 1 GREEN phase
- **Issue:** Plan's Test 9 expected the `.refine()` message ("auto_merge_pass_rate must be a valid number") to appear for input `'banana'`. In Zod 4, `z.coerce.number()` converts `'banana'` to `NaN`, then emits an `invalid_type` error ("Invalid input: expected number, received NaN") before `.refine()` can run. The refine message never appears.
- **Fix:** Updated Test 9 to check `success === false` and verify the issue path is `autoMergePassRate` (the plan's intent — parse must fail for non-numeric input). The plan's behavioral requirement is satisfied; only the message-text assertion was wrong.
- **Files modified:** src/shared/config.test.ts

## Known Inter-Plan Type Artifact

`tsc --noEmit` reports one expected error at `src/healer/index.ts:354` — the `openHealerPr({...})` call site is missing the four new required fields. This is intentional: Plan 02 (wave 2, `depends_on: [01]`) will add those four fields to the call site. The error does not affect runtime behavior and is resolved before any user-visible verify-work pass.

`src/healer/pr-writer.ts` itself has zero new TypeScript errors.

## TDD Gate Compliance

- RED commit `0704115`: 15 tests written, 13 failing (schema fields absent), 2 passing (benign-misconfig + existing apiKey behavior)
- GREEN commit `7141614`: 15 tests passing after schema fields added

## Self-Check: PASSED

- FOUND: src/shared/config.ts
- FOUND: src/shared/config.test.ts (created)
- FOUND: src/healer/pr-writer.ts
- FOUND: action.yml
- FOUND: .planning/phases/05-auto-merge/05-01-SUMMARY.md
- FOUND: commit 0704115 (RED — test file)
- FOUND: commit 7141614 (GREEN — schema fields)
- FOUND: commit a490e23 (action.yml inputs)
- FOUND: commit 43bc023 (pr-writer interface)
