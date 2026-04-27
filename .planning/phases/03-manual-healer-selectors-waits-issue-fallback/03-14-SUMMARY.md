---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: 14
subsystem: healer
tags: [gap-closure, cwd-threading, diff-lint, outer-catch, allowed-tools, xpath-regex]
dependency_graph:
  requires: []
  provides:
    - validate() cwd parameter threaded to getExecOutput
    - outer catch D-09 no-fix-proposable routing for unexpected pipeline errors
    - ALLOWED_TOOLS passed to adapter.runAgent (not empty array)
    - xpath-prefix regex narrowed to selector call context
    - action.yml Step 5 working-directory removed, exec spawn, absolute wait-for-ready path
  affects:
    - src/healer/validator.ts
    - src/healer/index.ts
    - src/healer/index.test.ts
    - src/healer/validator.test.ts
    - src/healer/forbidden-patterns.ts
    - src/healer/diff-lint.test.ts
    - action.yml
tech_stack:
  added: []
  patterns:
    - outer catch with D-09 issue-fallback routing for unexpected pipeline errors
    - exec spawn for correct PID capture in composite action step
    - locator-anchored regex for XPath detection without TS comment false-positives
key_files:
  created: []
  modified:
    - action.yml
    - src/healer/validator.ts
    - src/healer/index.ts
    - src/healer/index.test.ts
    - src/healer/validator.test.ts
    - src/healer/forbidden-patterns.ts
    - src/healer/diff-lint.test.ts
decisions:
  - exec spawn in action.yml Step 5 gives app PID directly (not bash wrapper), enabling correct SIGTERM delivery
  - ALLOWED_TOOLS (frozen readonly tuple) is directly compatible with adapter.runAgent(readonly string[]) — no spread needed
  - outer catch uses 'no-fix-proposable' failureMode (closest D-09 token; no 'unexpected-error' token exists in the spec)
  - xpath-prefix regex anchored to locator/waitForSelector/getBy* call context prevents TS comment and URL false-positives
metrics:
  duration: "~8 minutes"
  completed: "2026-04-27"
  tasks_completed: 4
  files_modified: 7
---

# Phase 03 Plan 14: Gap-Closure (HI-01, HI-02, HI-03, ME-02, ME-04) Summary

**One-liner:** Five correctness gaps closed — cwd threading to validator, outer D-09 catch routing unexpected errors to GitHub issues, ALLOWED_TOOLS replacing empty array, exec PID capture for correct SIGTERM delivery, and xpath-prefix regex narrowed to eliminate TS comment false-positives.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Fix action.yml Step 5 (HI-01 + ME-04) | 33e6eb1 | action.yml |
| 2 | cwd to validator + outer catch + ALLOWED_TOOLS (HI-01 + HI-03 + ME-02) | 86b612c | validator.ts, index.ts, index.test.ts |
| 3 | Behavioral tests: cwd threading + outer catch routing | d89cd00 | validator.test.ts, index.test.ts |
| 4 | Narrow xpath-prefix regex + 5 regression tests (HI-02) | 77e4b76 | forbidden-patterns.ts, diff-lint.test.ts |

## What Was Built

### HI-01: cwd threading to validator (action.yml + validator.ts + index.ts)

**Problem:** `validate()` ran `npx playwright test` without a `cwd`, so it executed in whatever the process cwd was — on a live runner, this is the action install directory rather than the consumer checkout. Every heal would misclassify as `deterministic-failure` because the test file can't be found.

**Fix — action.yml Step 5:** Removed `working-directory: ${{ github.action_path }}` so the step executes from `github.workspace` (the consumer checkout). Changed `bash -c "${{ inputs.start-command }}"` to `bash -c "exec ${{ inputs.start-command }}"` (ME-04 fix — exec replaces the bash wrapper, so `$!` is the app PID). Changed relative `npx tsx src/healer/wait-for-ready.ts` to absolute `npx tsx ${{ github.action_path }}/src/healer/wait-for-ready.ts`.

**Fix — validator.ts:** Added `cwd?: string` as 4th parameter, passed into `getExecOutput` options object.

**Fix — index.ts:** Both `validate()` call sites (Step 4 sanity rerun, Step 10 post-fix rerun) now pass `cwd` as 4th argument. `cwd` was already computed on line 109 as `process.env['GITHUB_WORKSPACE'] ?? process.cwd()`.

### HI-02: xpath-prefix regex false-positives (forbidden-patterns.ts)

**Problem:** Old regex `/^\s*\/\//m` matched any line starting with `//` — including TypeScript comments. If the agent added a code comment in its diff, the diff-lint would flag it as an XPath and route to `diff-lint-blocked` issue, rejecting valid fixes.

**Fix:** Replaced with `/(?:locator|waitForSelector|getBy\w+)\s*\(\s*['"`]\/\//` — the `//` must appear inside a string literal argument to a Playwright selector call. This correctly flags `page.locator('//div')` while ignoring `// TS comment` and `page.goto('//cdn.example.com')`.

### HI-03: Non-BudgetExhausted errors escape without filing a GitHub issue (index.ts)

**Problem:** The outer try/finally had no catch. Errors that weren't `BudgetExhausted` would propagate through `finally` (which calls `supervisorStop()`), then rethrow. The consumer's action run would show a red X with no GitHub issue artifact — violating D-09 "no silent failures".

**Fix:** Added outer `catch (err)` block that calls `core.error()` with the message, attempts to `fileIssue()` with `failureMode: 'no-fix-proposable'` and `rootCause: Unexpected pipeline error: ${msg.slice(0, 1000)}`, and finally calls `core.setFailed(msg)`. The inner BudgetExhausted catch at Step 6 still handles budget errors before they reach the outer catch.

**Updated 3 existing tests:** Three tests that asserted `rejects.toThrow()` were updated — `run()` now resolves on all unexpected errors. Tests now assert `mockSetFailed` was called and `mockOpenIssue` was called with `failureMode: 'no-fix-proposable'`.

### ME-02: adapter.runAgent() received [] instead of ALLOWED_TOOLS (index.ts)

**Fix:** Imported `ALLOWED_TOOLS` from `../shared/security-contract.js` and replaced `[]` with `ALLOWED_TOOLS` in the `adapter.runAgent()` call. The `Adapter.runAgent` signature accepts `readonly string[]`, which is directly compatible with the frozen `as const` tuple.

### ME-04: PID capture in action.yml Step 5

Covered under HI-01 fix above — `exec` spawn ensures `$!` captures the app process PID directly, not the bash wrapper PID. See T-03-14-07 in threat model — this is accepted as the consumer already controls the runner environment.

## Behavioral Tests Added

| Test | File | What It Verifies |
|------|------|-----------------|
| passes cwd to getExecOutput options when provided | validator.test.ts | options.cwd === '/my/workspace' |
| passes cwd=undefined when no cwd argument | validator.test.ts | options.cwd === undefined |
| passes GITHUB_WORKSPACE as cwd to both validate() call sites | index.test.ts | mockValidate.mock.calls[0][3] and [1][3] === '/consumer/workspace' |
| routes bundleContext error to no-fix-proposable + setFailed | index.test.ts | HI-03 D-09 routing |
| calls supervisorStop even when outer catch fires | index.test.ts | finally block still executes |
| does NOT flag TS // comment (false-positive guard) | diff-lint.test.ts | xpath-prefix narrowed regex |
| does NOT flag page.goto with // URL (false-positive guard) | diff-lint.test.ts | xpath-prefix narrowed regex |
| flags page.locator('//...') | diff-lint.test.ts | true positive |
| flags waitForSelector('//...') | diff-lint.test.ts | true positive |
| flags getByText('//...') | diff-lint.test.ts | true positive |

## Test Results

- Total tests: 240 (was 230 before this plan, +10 new behavioral tests)
- All test files: 22 passed
- TypeCheck: exit 0

## Deviations from Plan

**1. [Rule 2 - Missing Critical Functionality] Added `error: vi.fn()` to @actions/core mock**
- **Found during:** Task 2 implementation
- **Issue:** The existing @actions/core mock in index.test.ts did not include `error: vi.fn()`. The outer catch block calls `core.error(...)`, which would throw "core.error is not a function" and cause tests to fail for the wrong reason.
- **Fix:** Added `error: vi.fn()` to the mock object (plan's NOTE section anticipated this requirement).
- **Files modified:** src/healer/index.test.ts
- **Commit:** 86b612c

No other deviations — plan executed as specified with explicit before/after code snippets followed precisely.

## Known Stubs

None — all code paths are wired. No placeholder text, hardcoded empty values, or TODO markers introduced in this plan.

## Threat Flags

No new security-relevant surface beyond what was documented in the plan's threat model (T-03-14-01 through T-03-14-07). The outer catch truncates `err.message` to 1000 chars before embedding in the issue body (T-03-14-01 mitigation implemented).

## Self-Check: PASSED

Files exist:
- src/healer/validator.ts: FOUND (cwd? param added)
- src/healer/index.ts: FOUND (outer catch, ALLOWED_TOOLS, cwd threading)
- src/healer/validator.test.ts: FOUND (HI-01 cwd tests)
- src/healer/index.test.ts: FOUND (HI-01, HI-03 behavioral tests)
- src/healer/forbidden-patterns.ts: FOUND (narrowed xpath-prefix regex)
- src/healer/diff-lint.test.ts: FOUND (5 regression tests)
- action.yml: FOUND (exec spawn, absolute path, no working-directory)

Commits exist:
- 33e6eb1: action.yml Task 1
- 86b612c: validator.ts + index.ts + index.test.ts Task 2
- d89cd00: validator.test.ts + index.test.ts Task 3
- 77e4b76: forbidden-patterns.ts + diff-lint.test.ts Task 4
