---
phase: 04-auto-dispatch-full-fix-classes-deduplication
plan: "01"
subsystem: ingest-dispatch
tags: [dispatch, octokit, workflow_dispatch, concurrency, ingest, config, schema]
dependency_graph:
  requires:
    - 03-manual-healer (healer pipeline schema and PAT auth pattern)
    - 02-ingest-state-branch-detection (Config schema, Detection types)
  provides:
    - fireDispatch + buildConcurrencyKey (src/ingest/dispatch.ts)
    - DispatchPayload 8-flat-input schema (cross-workflow contract for Plans 02-05)
    - enableAutoDispatch + healerWorkflowFile config fields
    - Step 9 auto-dispatch loop in ingest pipeline
  affects:
    - src/healer/adapter.ts (FixProposal.fixClass widened — Plans 02-05 depend on this)
    - src/healer/prompt-assembler.ts (AssemblePromptArgs.fixClassHint widened)
    - src/healer/pr-writer.ts (OpenHealerPrArgs.fixClass widened)
tech_stack:
  added:
    - node:crypto createHash (SHA-1 for concurrency key uniqueness)
  patterns:
    - PAT-via-args Octokit constructor (mirrored from pr-writer.ts:67)
    - z.coerce.number() for workflow_dispatch string→number coercion
    - z.string().default('false').transform(v => v === 'true') for opt-in booleans
    - vi.hoisted() for vitest mock cross-references (avoids ReferenceError hoisting trap)
key_files:
  created:
    - src/ingest/dispatch.ts
    - src/ingest/dispatch.test.ts
    - src/ingest/index.test.ts
  modified:
    - src/healer/dispatch-payload.ts
    - src/healer/dispatch-payload.test.ts
    - src/shared/config.ts
    - src/ingest/index.ts
    - src/ingest/summary-writer.ts
    - src/healer/adapter.ts
    - src/healer/prompt-assembler.ts
    - src/healer/pr-writer.ts
    - action.yml
decisions:
  - enableAutoDispatch defaults to false (CONTEXT D-01 — opt-in, safe default per MRG-01)
  - DispatchPayload uses flat fields replacing recentRunStats (RESEARCH Pitfall 1 — nesting adds parse-failure modes on receive side)
  - concurrencyKey is required in DispatchPayload (prevents empty-string injection into workflow concurrency.group)
  - buildConcurrencyKey: slug(40) + slug(40) + SHA1(8) = max 90 chars (under 250 GitHub cap)
  - SHA-1 component preserves case-distinct uniqueness after slug lowercasing (Pitfall 5)
  - fixClassHint placeholder is 'selectors' in Step 9 — Plan 02 replaces with classifyFixClass()
  - FIX-07 type cascade applied in Plan 01 (adapter.ts, prompt-assembler.ts, pr-writer.ts) because DispatchPayload widening caused TypeScript errors in healer/index.ts
metrics:
  duration: "~9 minutes"
  completed: "2026-05-01"
  tasks: 3
  files_created: 3
  files_modified: 9
---

# Phase 04 Plan 01: Auto-Dispatch Wiring (DET-05/06/07) Summary

**One-liner:** PAT-authenticated `workflow_dispatch` via `fireDispatch` + deterministic SHA-1 concurrency key, gated by opt-in `enableAutoDispatch` config with 8-flat-input `DispatchPayload` as the cross-workflow contract for Plans 02-05.

## What Was Built

### `src/ingest/dispatch.ts` (NEW)

Exports `fireDispatch` and `buildConcurrencyKey`:

- `fireDispatch(args)` — authenticates via `new Octokit({ auth: args.patToken })` (DET-06: PAT, never GITHUB_TOKEN). Validates all 8 inputs are ≤1000 chars (Pitfall 1 guard) before calling `octokit.rest.actions.createWorkflowDispatch`. Surfaces dispatched test to step summary without logging the PAT (T-04-01).

- `buildConcurrencyKey(testFile, testTitle)` — format: `<file-slug-≤40>-<title-slug-≤40>-<sha1-8>`. Max length 90 chars. SHA-1 component preserves uniqueness for case-variant titles whose slug collapses to the same string (Pitfall 5). Slug lowercases and replaces non-alphanumeric chars, neutralizing `${{ ... }}` expression injection in test titles (T-04-04).

### `src/healer/dispatch-payload.ts` (MODIFIED — BREAKING CHANGE from Phase 03)

Cross-workflow contract widened to 8 flat inputs:
- `fixClassHint`: enum widened from `['selectors', 'waits']` to `['selectors', 'waits', 'assertions', 'slow']`
- `recentRunStats` nested object: REMOVED — replaced by flat `flakeRate`, `windowDays`, `runCount` with `z.coerce.number()` for string→number coercion (workflow_dispatch inputs are always strings)
- `concurrencyKey`: added as REQUIRED field (T-04-04: `z.string().min(1)` rejects empty strings)

**Plans 02-05 all build on this schema.**

### `src/shared/config.ts` (MODIFIED)

Two new fields added after `skipDiffLint`:
- `enableAutoDispatch: z.string().default('false').transform(v => v === 'true')` — opt-in, default OFF (CONTEXT D-01)
- `healerWorkflowFile: z.string().min(1).default('playwright-healer.yml')` — configurable dispatch target (RESEARCH §Open Questions §2 RESOLVED)

### `src/ingest/index.ts` (MODIFIED — Step 9)

Auto-dispatch loop inserted inside the `try { ... } finally { removeWorktree }` block after Step 8:

```typescript
if (config.enableAutoDispatch && detections.length > 0) {
  for (const detection of detections) {
    const [testFile, testTitle] = detection.testId.split('::', 2);
    await fireDispatch({ ..., workflowFile: config.healerWorkflowFile, ... });
  }
}
```

Key: `ref` comes from `github.context.payload.repository?.default_branch ?? 'main'` (NOT `GITHUB_REF_NAME` — Pitfall 2). `fixClassHint` is placeholder `'selectors'` — **Plan 02 replaces with `classifyFixClass(...)`**.

### `src/ingest/summary-writer.ts` (MODIFIED)

`writeDetectionSummary` now accepts `enableAutoDispatch: boolean = false` as second parameter. Surfaces `Detection mode: **live**` vs `Detection mode: **log-only**` text accordingly.

### `action.yml` (MODIFIED)

Two new inputs added:
- `enable_auto_dispatch` (default: `'false'`)
- `healer_workflow_file` (default: `'playwright-healer.yml'`)

Two new env bridges added (underscores, per Pitfall 8 — NOT kebab-case):
- `INPUT_ENABLE_AUTO_DISPATCH: ${{ inputs.enable_auto_dispatch }}`
- `INPUT_HEALER_WORKFLOW_FILE: ${{ inputs.healer_workflow_file }}`

### FIX-07 Type Cascade (DEVIATION — Rule 1 auto-fix)

Widening `DispatchPayload.fixClassHint` caused TypeScript errors in `healer/index.ts` (line 154: `assemblePrompt` rejected the widened type). Applied the FIX-07 cascade to fix compilation:

- `src/healer/adapter.ts` — `FixProposal.fixClass` widened to include `'assertions' | 'slow'`
- `src/healer/prompt-assembler.ts` — `AssemblePromptArgs.fixClassHint` widened
- `src/healer/pr-writer.ts` — `OpenHealerPrArgs.fixClass` widened

No behavior changes — pure type widening. The cascade was a prerequisite for `healer/index.ts` to compile after the `DispatchPayload` schema change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript compilation failure after DispatchPayload widening**
- **Found during:** Task 1 GREEN phase
- **Issue:** `src/healer/index.ts:154` — `assemblePrompt({ fixClassHint: payload.fixClassHint })` rejected because `AssemblePromptArgs.fixClassHint` was typed as `'selectors' | 'waits'` but `payload.fixClassHint` is now the wider union
- **Fix:** Applied FIX-07 enum widening cascade to `adapter.ts`, `prompt-assembler.ts`, `pr-writer.ts` — pure type widening, zero behavior change
- **Files modified:** `src/healer/adapter.ts`, `src/healer/prompt-assembler.ts`, `src/healer/pr-writer.ts`
- **Commits:** `5acc89b`

**2. [Rule 1 - Bug] vitest hoisting trap in dispatch.test.ts**
- **Found during:** Task 2 GREEN phase
- **Issue:** `vi.mock('@octokit/rest', ...)` factory referenced `mockCreateWorkflowDispatch` from outer scope — vitest hoisting meant the variable wasn't initialized when the factory ran, causing `ReferenceError`
- **Fix:** Used `vi.hoisted()` to initialize shared mock variables before `vi.mock` factories execute; kept Octokit constructor mock inline in `vi.mock` factory
- **Files modified:** `src/ingest/dispatch.test.ts`
- **Commits:** `4b15e92`

### Pre-existing Failures (Out of Scope)

`src/healer/index.test.ts` — 21 tests were already failing before this plan's changes (verified via `git stash` + test run). These failures existed in the base commit `1dc5a7a` and are unrelated to Plan 01's scope. Logged in deferred-items.

## Known Stubs

**`fixClassHint: 'selectors'` placeholder in `src/ingest/index.ts:163`**

The Step 9 dispatch loop hard-codes `fixClassHint: 'selectors'` for all dispatches. Plan 02 replaces this with `classifyFixClass(detection.errorSignature)` — the FIX-07 classifier implementation. This is an intentional stub per the plan boundary: Plan 01's sole responsibility is the dispatch wiring, not the classification logic.

## Test Coverage

| File | Tests Added | Coverage |
|------|-------------|----------|
| `src/healer/dispatch-payload.test.ts` | 15 (rewritten) | DET schema, enum widen, concurrencyKey required, z.coerce.number() |
| `src/ingest/dispatch.test.ts` | 9 (new) | DET-05 payload, DET-06 PAT auth, DET-07 determinism, Pitfall 1 guard, Pitfall 5 case-folding |
| `src/ingest/index.test.ts` | 6 (new) | Flag-off suppression, flag-on dispatch, zero-detections, removeWorktree-on-throw, summary-writer 2nd param |
| Config tests (in dispatch-payload.test.ts) | 3 | enableAutoDispatch true/false/absent, healerWorkflowFile default/override |

**Total new/updated tests: 33**

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `698e2b2` | test | RED: dispatch-payload widening + config tests |
| `5acc89b` | feat | GREEN: DispatchPayload 8-flat + enableAutoDispatch + FIX-07 cascade |
| `b2f46fa` | test | RED: fireDispatch + buildConcurrencyKey tests |
| `4b15e92` | feat | GREEN: dispatch.ts implementation |
| `3e57576` | test | RED: index.ts + summary-writer integration tests |
| `8e9f74a` | feat | GREEN: Step 9 wiring + summary-writer + action.yml |

## Self-Check: PASSED

- `src/ingest/dispatch.ts` exists ✓
- `src/ingest/dispatch.test.ts` exists ✓
- `src/ingest/index.test.ts` exists ✓
- All 6 commits exist in git log ✓
- `./node_modules/.bin/tsc --noEmit` reports no errors ✓
- 52 tests pass across the 5 modified/created test files ✓
- `grep -n "recentRunStats" src/healer/dispatch-payload.ts` — only in comments ✓
- `grep -n "enableAutoDispatch" src/shared/config.ts` — line 116 ✓
- `grep -n "INPUT_ENABLE_AUTO_DISPATCH" action.yml` — line 259 ✓
