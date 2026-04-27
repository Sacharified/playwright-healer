---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: 13
subsystem: healer
tags: [action-yml, app-supervisor, readiness-probe, issue-fallback, composite-steps]
dependency_graph:
  requires: [03-06, 03-11, 03-01]
  provides: [wait-for-ready-cli, action-yml-7-step-composite]
  affects: [action.yml, src/healer/wait-for-ready.ts]
tech_stack:
  added: []
  patterns:
    - "Two-step composite pattern (D-14): start-command spawned in background step, readiness probe in same step, heal pipeline in following step"
    - "PID file singleton (/tmp/playwright-healer-app-pid) shared between action.yml Step 5 and post-step cleanup"
    - "vi.hoisted() for Vitest mock declarations that precede vi.mock() factories"
key_files:
  created:
    - src/healer/wait-for-ready.ts
    - src/healer/wait-for-ready.test.ts
  modified:
    - action.yml
decisions:
  - "HEALER_DEFAULT_BRANCH added to Step 6 env (confirmed consumed by src/healer/index.ts from 03-12)"
  - "vi.hoisted() used for mock declarations to avoid TDZ error with vi.mock() factory hoisting"
  - "Step 1 (checkout) gated on commit-sha != '' to remain backward-compatible with manual dispatches that omit the field"
metrics:
  duration: 15m
  completed: "2026-04-27"
  tasks: 2
  files: 3
---

# Phase 03 Plan 13: App Supervisor Composite Steps + Wait-for-Ready Summary

One-liner: 7-step composite action wiring SHA-pinned checkout, sync setup, background start-command with HTTP readiness probe, universal healer run, and always-cleanup — with a tiny wait-for-ready CLI that files an `app-startup-timeout` issue and exits 1 on timeout.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add commit-sha input + restructure action.yml composite steps | 8220532 | action.yml |
| 2 (RED) | Add failing tests for wait-for-ready CLI | 8cf5893 | src/healer/wait-for-ready.test.ts |
| 2 (GREEN) | Implement wait-for-ready.ts CLI entry-point | 3d7b1f7 | src/healer/wait-for-ready.ts |

## What Was Built

### action.yml restructure (Task 1)

The composite `runs.steps` block was restructured from 3 steps to 7 steps:

| Step | Name | Condition | Purpose |
|------|------|-----------|---------|
| 1 | Checkout dispatch SHA (heal mode) | `mode == 'heal' && commit-sha != ''` | HEA-01: checkout exact commit; `persist-credentials: false` (SEC-01) |
| 2 | Install action dependencies | always | `npm ci --production` (unchanged) |
| 3 | Set up Node | always | actions/setup-node v6.4.0 (unchanged) |
| 4 | Run setup-command (sync, heal mode) | `mode == 'heal' && setup-command != ''` | D-14 step 3: synchronous setup before app spawn |
| 5 | Spawn start-command + wait for ready (heal mode) | `mode == 'heal' && start-command != ''` | D-14 step 4 + HEA-02 + HEA-03: background spawn, PID write, readiness probe |
| 6 | Run playwright-healer | always | Universal entry: ingest/heal/dry-run; env extended with HEALER_DEFAULT_BRANCH |
| 7 | Cleanup leaked processes (always, heal mode) | `always() && mode == 'heal'` | D-12 layer 2 / HEA-06: pkill playwright-mcp + kill app PID |

New input `commit-sha` (required: false, default: '') added for HEA-01.

`HEALER_DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}` added to Step 6 env — consumed by `src/healer/index.ts` fix-applier rebase logic.

### wait-for-ready.ts (Task 2)

Tiny (~70 line) CLI entry-point invoked by action.yml Step 5 via `npx tsx src/healer/wait-for-ready.ts`.

**Exit code matrix:**

| Exit Code | Condition | Side Effect |
|-----------|-----------|-------------|
| 0 | `waitForReady()` resolves (app up) | none — heal step proceeds |
| 1 | `AppStartupTimeout` thrown | Files `app-startup-timeout` issue via `openIssue()` before exit; heal step automatically skipped |
| 1 | `AppStartupTimeout` + issue creation fails | Logs error; still exits 1 (heal step skip is the gate) |
| 2 | Any other unexpected error | Logs error; no issue filed; fail loud |

**Env vars read:**
- `BASE_URL` — passed to `waitForReady()`
- `STARTUP_TIMEOUT_SECONDS` — parsed as seconds, multiplied by 1000 for `waitForReady()`
- `HEALER_TOKEN` — PAT for `openIssue()`
- `GH_OWNER`, `GH_REPO` — passed to `openIssue()`
- `TEST_TITLE` — issue `testTitle` field
- `TRIGGERING_RUN_URL` — issue link back to the triggering run

## Test Coverage

6 tests in `src/healer/wait-for-ready.test.ts` — all passing:

1. Returns exit 0 when `waitForReady` resolves
2. Returns exit 1 and files `app-startup-timeout` issue on `AppStartupTimeout`
3. Still exits 1 if issue creation itself fails
4. Returns exit 2 on unexpected error (no issue filed)
5. Parses `STARTUP_TIMEOUT_SECONDS` as seconds → ms correctly
6. Issue body includes meaningful `rootCause` + `suggestedManualFix` content

TDD RED/GREEN gate compliance:
- RED commit: `8cf5893` (`test(03-13)`)
- GREEN commit: `3d7b1f7` (`feat(03-13)`)

## Security Coverage

| Threat | Mitigation | Status |
|--------|------------|--------|
| T-3-HEA-01: wrong commit SHA | `ref: ${{ inputs.commit-sha }}` + `persist-credentials: false` | Encoded in Step 1 |
| T-3-HEA-03: startup hang runs heal anyway | Step 5 exits 1 on timeout; Step 6 default `if: success()` skips | Encoded in Step 5 + wait-for-ready.ts |
| T-3-HEA-06-outer: leaked processes on SIGKILL | Step 7 `if: always()` pkills playwright-mcp + kills app PID | Encoded in Step 7 |

## Requirements Satisfied

- HEA-01: Dispatch SHA checkout with `persist-credentials: false`
- HEA-02: Readiness probe wired (Plan 06's `waitForReady` called from action.yml Step 5)
- HEA-03: `app-startup-timeout` issue filed before exit 1; heal step automatically skipped
- HEA-06 outer: post-step pkill cleanup (D-12 layer 2)

## Deviations from Plan

**1. [Rule 1 - Fix] vi.hoisted() used instead of bare const declarations in test**
- Found during: Task 2 RED phase (pre-emptive based on advisor guidance)
- Issue: Vitest hoists `vi.mock()` factories above const declarations, putting mockWaitForReady/mockOpenIssue in TDZ at factory execution time
- Fix: Used `vi.hoisted(() => ({ ... }))` to declare mocks safely before factory runs
- Files modified: src/healer/wait-for-ready.test.ts
- Commit: 8cf5893

None other — plan executed as specified.

## Known Stubs

None. wait-for-ready.ts is fully wired to real app-supervisor and issue-writer modules.

## Threat Flags

None. No new network endpoints or auth paths beyond what the plan documents.

## Self-Check: PASSED

- [x] `src/healer/wait-for-ready.ts` exists
- [x] `src/healer/wait-for-ready.test.ts` exists
- [x] `action.yml` has 7 composite steps
- [x] Commits 8220532, 8cf5893, 3d7b1f7 exist in git log
- [x] All 230 tests pass (`npm test`)
- [x] Typecheck passes (`npm run typecheck`)
- [x] PID_FILE_PATH `/tmp/playwright-healer-app-pid` matches between app-supervisor.ts and action.yml
