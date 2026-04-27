---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: 09
subsystem: healer
tags: [git, fix-applier, skip-sentinel, loop-guard, bot-identity, diff-apply, integration-test]

# Dependency graph
requires:
  - phase: 02-ingest-state-branch-detection
    provides: loop-guard.ts with SKIP_SENTINEL and BOT_EMAIL constants
  - phase: 03-manual-healer-selectors-waits-issue-fallback
    provides: Plan 01 (bare-repo helper for integration tests)

provides:
  - applyFix(args): Promise<{branch, commitSha}> — rebases onto origin/<defaultBranch>, applies diff with --3way, commits with SKIP_SENTINEL, pushes fresh PR branch
  - DiffApplyFailure error class for diff application failures
  - BOT_NAME export added to loop-guard.ts (co-located with BOT_EMAIL)
  - tests/integration/fix-applier.test.ts — 7 real-git integration tests

affects:
  - Plan 12 (pr-writer) — consumes { branch, commitSha } return value
  - Plan 10 (diff-lint) — runs before fix-applier per CONTEXT D-16 ordering

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bot identity via inline -c user.email= -c user.name= flags per git command (no global config writes)"
    - "Fresh branch from origin/<defaultBranch> via checkout -B (rebase semantics, no force-with-lease needed)"
    - "git apply --3way for drift-tolerant patch application"
    - "SKIP_SENTINEL imported from loop-guard.ts — never inlined (Phase 1 D-13)"
    - "Integration tests placed in tests/integration/ to match vitest forks pool config"

key-files:
  created:
    - src/healer/fix-applier.ts
    - tests/integration/fix-applier.test.ts
  modified:
    - src/shared/loop-guard.ts

key-decisions:
  - "Test file placed at tests/integration/fix-applier.test.ts (not src/healer/) — vitest.config.ts only includes tests/integration/**; co-location would not be picked up by the test runner"
  - "BOT_NAME added to loop-guard.ts as a new export (not inlined in fix-applier.ts) — natural co-location with BOT_EMAIL; avoids drift if bot name ever changes"
  - "No --force-with-lease on push — fresh branch has no existing remote ref, lease flag would be meaningless"

patterns-established:
  - "Pattern: git apply --3way with ignoreReturnCode + DiffApplyFailure on non-zero exit"
  - "Pattern: commit message shape: short subject + blank line + SKIP_SENTINEL body"

requirements-completed: [FIX-05, PRI-06]

# Metrics
duration: 15min
completed: 2026-04-27
---

# Phase 03 Plan 09: Fix-Applier Summary

**Git diff applier that rebases onto origin/main, applies patches with 3-way merge fallback, and commits with [skip-healer] sentinel imported from loop-guard.ts — returning {branch, commitSha} for pr-writer**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-27T10:00:00Z
- **Completed:** 2026-04-27T10:04:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `applyFix()` implements FIX-05 rebase semantics: always starts from `origin/<defaultBranch>` tip via `git checkout -B`, never modifies main
- PRI-06 / SC-5 enforced: every bot commit message ends with `\n\n${SKIP_SENTINEL}` imported from `loop-guard.ts` — no inline literal
- BOT_NAME exported from `loop-guard.ts` (natural co-location with BOT_EMAIL, avoids drift)
- 7 real-git integration tests covering: branch push, sentinel assertion, author identity, upstream safety, DiffApplyFailure, file content verification

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement fix-applier.ts (and add BOT_NAME export to loop-guard.ts)** - `91b09ad` (feat)
2. **Task 2: Test fix-applier with real git via bare-repo helper (integration test)** - `59243a9` (test)

## Files Created/Modified

- `src/healer/fix-applier.ts` — `applyFix()` + `DiffApplyFailure`; fetches, rebases, applies, commits with SKIP_SENTINEL, pushes
- `src/shared/loop-guard.ts` — Added `export const BOT_NAME = 'playwright-healer-bot'`
- `tests/integration/fix-applier.test.ts` — 7 integration tests using bare-repo helper

## Decisions Made

- Test file placed at `tests/integration/fix-applier.test.ts` (not `src/healer/` as noted in plan frontmatter): vitest.config.ts only picks up `tests/integration/**` for the forks pool; co-location in `src/healer/` would produce "No test files found, exiting with code 0" — moved to match project convention.
- BOT_NAME added to `loop-guard.ts` as a new export (not inlined in `fix-applier.ts`) to prevent drift if the bot name ever changes, and because loop-guard is the canonical bot-identity module.
- No `--force-with-lease` on the push step: the branch is fresh (no existing remote ref), so the flag is meaningless and the plan explicitly notes this.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test file relocated from src/healer/ to tests/integration/**
- **Found during:** Task 2 (writing integration test)
- **Issue:** Plan frontmatter lists `src/healer/fix-applier.test.ts`; vitest.config.ts `include` patterns are `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts` — running the test as written would silently exit with "No test files found"
- **Fix:** Created test at `tests/integration/fix-applier.test.ts` and updated imports accordingly (`../../tests/_helpers/bare-repo.js` → `../\_helpers/bare-repo.js`)
- **Files modified:** tests/integration/fix-applier.test.ts (correct location)
- **Verification:** `npx vitest run --project=integration tests/integration/fix-applier.test.ts` — 7 tests pass in 3.88s
- **Committed in:** 59243a9 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (blocking — test runner config mismatch)
**Impact on plan:** No scope change. Test coverage is equivalent; location is corrected to match project convention.

## Issues Encountered

- `git apply --3way` on a shallow fetch reports "repository lacks the necessary blob to perform 3-way merge" and falls back to direct application. This is expected and benign for the shallow-clone scenario — the diff applies cleanly. No code change needed; noted for future documentation.

## Known Stubs

None — `applyFix()` is fully wired with real git operations. No placeholder data or hardcoded returns.

## Threat Flags

No new security surface introduced beyond what the plan's threat model covers (T-3-FIX-05, T-3-PRI-06). The function only writes to a fresh PR branch, never to main.

## Next Phase Readiness

- Plan 12 (pr-writer) can consume `{ branch, commitSha }` from `applyFix()` — interface contract fulfilled
- Plan 10 (diff-lint) runs before fix-applier per CONTEXT D-16 ordering; fix-applier has no dependency on diff-lint being complete

## Self-Check: PASSED

- `src/healer/fix-applier.ts` — exists
- `src/shared/loop-guard.ts` — BOT_NAME export present
- `tests/integration/fix-applier.test.ts` — exists
- Commit `91b09ad` — exists (feat: fix-applier + BOT_NAME)
- Commit `59243a9` — exists (test: integration tests)
- Typecheck: PASS
- Tests: 7/7 pass

---
*Phase: 03-manual-healer-selectors-waits-issue-fallback*
*Completed: 2026-04-27*
