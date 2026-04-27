---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: 11
subsystem: healer/pr-writer + healer/issue-writer
tags: [pr-creation, issue-creation, octokit, pat-auth, pri-01, pri-02, pri-03, pri-06, val-05, d-09, d-10, d-11, d-20, tdd]
dependency_graph:
  requires: [03-02, 03-08, 03-09]
  provides: [openHealerPr, renderPrBody, openIssue, renderIssueBody]
  affects: [src/healer/pr-writer.ts, src/healer/issue-writer.ts]
tech_stack:
  added: []
  patterns: [octokit-pat-auth, core.summary-parity, tdd-red-green]
key_files:
  created:
    - src/healer/pr-writer.ts
    - src/healer/pr-writer.test.ts
    - src/healer/issue-writer.ts
    - src/healer/issue-writer.test.ts
  modified: []
decisions:
  - "PR body markdown structure: ## Root cause / ## Rationale / ## Validation / ## Links sections with per-run table"
  - "Issue body sections: ## Failure mode (token) / ## Root cause / ## Reproduction / ## Suggested manual fix"
  - "Step summary uses core.summary.addRaw().write() — full body content included (D-11 parity)"
  - "renderPrBody filters empty-string array entries to avoid blank lines from null traceLink"
metrics:
  duration: ~8 minutes
  completed: 2026-04-27
  tasks_completed: 2
  files_created: 4
---

# Phase 03 Plan 11: PR-Writer + Issue-Writer Summary

**One-liner:** PAT-authenticated PR/issue writers via `@octokit/rest` with locked PRI-01/PRI-03 title formats, PRI-02 body required content, D-09 six failure-mode tokens, and D-11 step-summary parity.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | pr-writer tests | c3044cf | src/healer/pr-writer.test.ts |
| 1 (GREEN) | pr-writer impl | 8d9f690 | src/healer/pr-writer.ts, src/healer/pr-writer.test.ts |
| 2 (RED) | issue-writer tests | 6f1347d | src/healer/issue-writer.test.ts |
| 2 (GREEN) | issue-writer impl | fe9c9df | src/healer/issue-writer.ts |

## Implementation Details

### pr-writer.ts

- `openHealerPr(args)`: constructs `new Octokit({ auth: args.patToken })` — NOT `@actions/github.getOctokit()` (D-20 / SC-1 / T-3-PIT-01)
- `renderPrBody(args)`: builds body with `## Root cause`, `## Rationale`, `## Validation` (pass rate percentage + per-run table), `## Links` (triggering run + optional trace), `Signed-off: playwright-healer-bot`, `[skip-healer]` sentinel sourced from `SKIP_SENTINEL` import
- Title format locked: `` `[playwright-healer] Fix flaky ${testTitle}` `` (PRI-01)
- Cost expressed as `$X.XXXX` to 4 decimal places (PRI-02)
- `traceLink: null` omits the Playwright trace line cleanly (filter on empty strings)

### issue-writer.ts

- `openIssue(args)`: same PAT-only Octokit pattern; calls `octokit.issues.create()`
- `renderIssueBody(args)`: body opens with `` ## Failure mode\n\n`<token>` `` (D-09/D-10)
- Title format locked: `` `[playwright-healer] ${testTitle} is unhealable` `` (PRI-03)
- Six sections: Failure mode, Root cause, Reproduction, Suggested manual fix, triggering run link
- `FailureMode` is imported as a type from `./types.js` — passing an unlocked string fails at compile time

## Test Coverage

- pr-writer: 10 tests — PRI-01, PRI-02/VAL-05, PRI-06/SC-5, T-3-PIT-01, T-3-PRI-PI, D-11
- issue-writer: 12 tests — PRI-03/D-10 title, D-09 parametric loop (6 tokens), PRI-03 body, D-20, D-11, T-3-PRI-PI
- Total: 22 tests, all green

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed vi.fn() class constructor mock in pr-writer.test.ts**
- **Found during:** Task 1 GREEN phase — 3 tests failed with "not a constructor" error
- **Issue:** The plan's `<action>` block used an arrow function in `vi.fn().mockImplementation(() => ({...}))`. Arrow functions cannot be called with `new`, which is how `Octokit` is constructed.
- **Fix:** Changed to a regular function `vi.fn().mockImplementation(function () { return {...}; })`. Applied the same correct pattern proactively to issue-writer.test.ts (Task 2).
- **Files modified:** src/healer/pr-writer.test.ts, src/healer/issue-writer.test.ts
- **Commit:** 8d9f690

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (pr-writer) | c3044cf | PASSED — module-not-found failure confirmed |
| GREEN (pr-writer) | 8d9f690 | PASSED — 10/10 tests pass |
| RED (issue-writer) | 6f1347d | PASSED — module-not-found failure confirmed |
| GREEN (issue-writer) | fe9c9df | PASSED — 12/12 tests pass |

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes beyond what the plan's threat model addresses. Both writers use `@octokit/rest` with PAT auth exactly as specified — no new surface introduced.

## Known Stubs

None — both `openHealerPr` and `openIssue` are fully wired to `@octokit/rest` API calls.

## Self-Check: PASSED

Files exist:
- FOUND: src/healer/pr-writer.ts
- FOUND: src/healer/pr-writer.test.ts
- FOUND: src/healer/issue-writer.ts
- FOUND: src/healer/issue-writer.test.ts

Commits exist:
- FOUND: c3044cf (test RED pr-writer)
- FOUND: 8d9f690 (feat GREEN pr-writer)
- FOUND: 6f1347d (test RED issue-writer)
- FOUND: fe9c9df (feat GREEN issue-writer)

Tests: 22/22 passing
Typecheck: clean
