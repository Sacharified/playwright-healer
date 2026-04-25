---
phase: 02-ingest-state-branch-detection
plan: "02"
subsystem: ingest-types
tags: [types, loop-guard, report-parser, security, ingest, tdd]
dependency_graph:
  requires: ["02-00"]
  provides: ["NdjsonRecord", "NdjsonTestEntry", "Detection", "shouldSkipIngest", "parseReport"]
  affects: ["02-03", "02-04", "02-05"]
tech_stack:
  added: ["vitest@4.1.5", "@vitest/coverage-v8@4.1.5"]
  patterns: ["TDD (RED/GREEN)", "Zod safeParse graceful degrade", "optional chaining for non-push events"]
key_files:
  created:
    - src/shared/types.ts
    - src/shared/loop-guard.ts
    - src/ingest/report-parser.ts
    - tests/unit/loop-guard.test.ts
    - tests/unit/report-parser.test.ts
    - tests/fixtures/sample-report.json
    - tests/fixtures/sample-report-unreadable.json
    - tests/fixtures/sample-report-sharded.json
  modified:
    - package.json
    - package-lock.json
decisions:
  - "testId format: {filePath}::{suiteTitle} > {specTitle} — suite title from parent suite, not spec file"
  - "errorSignature uses last result's error (not first failure) — authoritative result for trace/duration too"
  - "suiteTitle passed as context when walking specs, not parentTitle of parent's parent"
metrics:
  duration: "~10m"
  completed: "2026-04-25"
  tasks_completed: 2
  files_created: 8
---

# Phase 02 Plan 02: Shared Types + Loop Guard + Report Parser Summary

**One-liner:** Pure TypeScript data-layer foundation — NdjsonRecord/NdjsonTestEntry/Detection types, SEC-05 loop guard with 3 guards, and Playwright JSON → NdjsonTestEntry[] parser with Zod graceful degrade.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 2-02-01 RED | Add failing tests for types.ts and loop-guard | d1507b3 | src/shared/types.ts, tests/unit/loop-guard.test.ts, package.json, package-lock.json |
| 2-02-01 GREEN | Implement shouldSkipIngest() SEC-05 loop guard | 7ecb9d1 | src/shared/loop-guard.ts |
| 2-02-02 RED | Add failing tests for report-parser with JSON fixtures | 99541ca | tests/unit/report-parser.test.ts, tests/fixtures/*.json (3 files) |
| 2-02-02 GREEN | Implement parseReport() Playwright JSON → NdjsonTestEntry[] | 373822b | src/ingest/report-parser.ts |

## Verification Output

### Unit Tests

```
 RUN  v4.1.5 /Users/sacha/dev/playwright-healer/...

 Test Files  2 passed (2)
      Tests  30 passed (30)
   Start at  13:09:41
   Duration  145ms (transform 68ms, setup 0ms, import 114ms, tests 5ms, environment 0ms)
```

**10 tests** for `loop-guard.test.ts` (all SEC-05 guards + constants + edge cases)
**20 tests** for `report-parser.test.ts` (ING-01..04 full coverage)

### TypeScript

```
npx tsc --noEmit → exit code: 0
```

### Fixture Validation

All three fixture JSON files are valid JSON:
- `tests/fixtures/sample-report.json` — OK (2 tests: expected + flaky)
- `tests/fixtures/sample-report-unreadable.json` — OK (missing suites, triggers ING-03)
- `tests/fixtures/sample-report-sharded.json` — OK (shard 2 of 3, _comment explains metadata location)

### testId format for sample-report.json "should login"

```
tests/auth.spec.ts::auth > should login
```

Format: `{filePath}::{suiteTitle} > {specTitle}` — the suite title (`auth`) from the parent suite object is included as a prefix.

### SEC-07 Check

No `fetch(` or `http.request(` call-sites in `src/shared/loop-guard.ts` or `src/ingest/report-parser.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest not installed**
- **Found during:** Pre-task setup (vitest is required for TDD execution)
- **Issue:** vitest 4.1.5 and @vitest/coverage-v8 4.1.5 were not in package.json devDependencies
- **Fix:** `npm install -D vitest@4.1.5 @vitest/coverage-v8@4.1.5`; updated package.json `test` script from Phase 1 placeholder to `vitest run`
- **Files modified:** package.json, package-lock.json
- **Commit:** d1507b3

**2. [Rule 1 - Bug] walkSuites() passed parentTitle instead of suiteTitle when processing specs**
- **Found during:** Task 2-02-02 GREEN phase — 2 tests failing (`testId` format incorrect)
- **Issue:** Specs were receiving the grandparent title as their suite prefix instead of their direct parent suite title, producing `tests/auth.spec.ts::should login` instead of `tests/auth.spec.ts::auth > should login`
- **Fix:** Changed `const fullTitle = parentTitle ? ...` to `const fullTitle = suiteTitle ? ...` when building testId for specs
- **Files modified:** src/ingest/report-parser.ts
- **Commit:** 373822b (fix applied in the same GREEN commit)

## TDD Gate Compliance

Gate sequence verified in git log:
1. `test(02-02)` commit d1507b3 — RED gate (Task 1: types + loop-guard tests failing)
2. `feat(02-02)` commit 7ecb9d1 — GREEN gate (Task 1: loop-guard implementation passing)
3. `test(02-02)` commit 99541ca — RED gate (Task 2: report-parser tests failing)
4. `feat(02-02)` commit 373822b — GREEN gate (Task 2: report-parser implementation passing)

Both RED/GREEN gate pairs present for both tasks.

## Success Criteria Check

- [x] SC#5: shouldSkipIngest() returns true for playwright-healer-bot author email (Guard 1 test passes)
- [x] All 6+ loop-guard scenarios pass (fork PR, bot email, sentinel, non-bot, non-push, clear-pass)
- [x] ING-01: parseReport() accepts already-parsed JSON (caller resolves file paths via glob in 02-05)
- [x] ING-02: all 9 NdjsonTestEntry fields extracted correctly from fixture
- [x] ING-03: malformed report returns { entries: [], reportUnreadable: true }, no crash
- [x] ING-04: shard fixture is valid; shardIndex/shardTotal documented in _comment as NdjsonRecord-level fields
- [x] npx tsc --noEmit exits 0

## Known Stubs

None — all modules are fully implemented with real logic. No placeholder data, no TODO comments in critical paths.

## Threat Flags

No new security surface introduced beyond what the plan's threat model covers:
- loop-guard.ts reads from `github.context.payload` (already in T-2-02)
- report-parser.ts processes already-parsed JSON from workspace filesystem (already in T-2-03)
- No new network endpoints, auth paths, or file access patterns beyond plan scope

## Self-Check: PASSED

All source files, test files, fixtures, and commits verified present:
- src/shared/types.ts — FOUND
- src/shared/loop-guard.ts — FOUND
- src/ingest/report-parser.ts — FOUND
- tests/unit/loop-guard.test.ts — FOUND
- tests/unit/report-parser.test.ts — FOUND
- tests/fixtures/sample-report.json — FOUND
- tests/fixtures/sample-report-unreadable.json — FOUND
- tests/fixtures/sample-report-sharded.json — FOUND
- .planning/phases/02-ingest-state-branch-detection/02-02-SUMMARY.md — FOUND
- d1507b3 (RED Task 1) — FOUND
- 7ecb9d1 (GREEN Task 1) — FOUND
- 99541ca (RED Task 2) — FOUND
- 373822b (GREEN Task 2) — FOUND
