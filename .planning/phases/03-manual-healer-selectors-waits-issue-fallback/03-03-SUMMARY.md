---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: "03"
subsystem: healer
tags: [diff-lint, security, pure-function, tdd, forbidden-patterns]
dependency_graph:
  requires: []
  provides:
    - src/healer/forbidden-patterns.ts (D-17 single source of truth for diff-lint regexes)
    - src/healer/diff-lint.ts (lintDiff pure function, FIX-06 defense layer)
  affects:
    - src/healer/prompt-assembler.ts (Plan 04 — imports FORBIDDEN_PATCHED_LINE_PATTERNS)
    - Plan 13 orchestrator (calls lintDiff before validator)
tech_stack:
  added: []
  patterns:
    - Object.freeze([...] as const) for runtime-frozen + TS-readonly exported constants
    - Pure function with per-hunk state machine (no IO, no @actions/core, no throw)
    - TDD RED/GREEN discipline with separate commits per gate
key_files:
  created:
    - src/healer/forbidden-patterns.ts
    - src/healer/forbidden-patterns.test.ts
    - src/healer/diff-lint.ts
    - src/healer/diff-lint.test.ts
    - tests/fixtures/unified-diff-clean.patch
    - tests/fixtures/unified-diff-with-waitForTimeout.patch
    - tests/fixtures/unified-diff-with-nth-child.patch
    - tests/fixtures/unified-diff-with-weakened-assertion.patch
    - tests/fixtures/unified-diff-out-of-testdir.patch
  modified:
    - vitest.config.ts (extended unit include glob to cover src/**/*.test.ts)
decisions:
  - "Pattern name tokens for LintFinding.pattern: forbidden-pattern entries use their .name field verbatim (waitForTimeout, nth-child, etc.); assertion-weakening uses encoded form toBe-to-toBeTruthy; out-of-allowlist uses 'out-of-test-dir'"
  - "Vitest config extended to include src/**/*.test.ts — plan colocates tests with source rather than tests/unit/"
  - "xpath-prefix regex (/^\\s*\\/\\//m) matches + lines that are JS // comments too — accepted per RESEARCH §D verbatim; flagged as residual risk in threat model"
metrics:
  duration: "~4 minutes"
  completed: "2026-04-27"
  tasks_completed: 2
  files_created: 10
  files_modified: 1
---

# Phase 03 Plan 03: Diff-Lint Defense Layer Summary

Implemented the diff-lint defense layer (FIX-06) and its single source of truth for forbidden patterns (D-17 / FIX-03): frozen regex constants in `forbidden-patterns.ts` plus a pure `lintDiff()` function that scans unified diffs for anti-patterns before any fix is applied.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create forbidden-patterns.ts + tests | 39053f9 | src/healer/forbidden-patterns.ts, src/healer/forbidden-patterns.test.ts, vitest.config.ts |
| 2 | Create diff-lint.ts + fixtures + tests | 402e8f1 | src/healer/diff-lint.ts, src/healer/diff-lint.test.ts, 5 fixture .patch files |

## TDD Gate Compliance

Both tasks followed the RED/GREEN discipline:

| Gate | Task 1 | Task 2 |
|------|--------|--------|
| RED (test commit) | 0ade3e9 | fe8a6c3 |
| GREEN (feat commit) | 39053f9 | 402e8f1 |
| REFACTOR | Not needed | Not needed |

## Implementation Notes

### forbidden-patterns.ts

Three frozen constant exports per RESEARCH §D verbatim:

- `FORBIDDEN_PATCHED_LINE_PATTERNS` — 5 entries: `waitForTimeout`, `nth-child`, `nth-of-type`, `xpath-equals`, `xpath-prefix`. All use `\s*\(` tolerance for whitespace-padded calls.
- `ASSERTION_WEAKENING_PAIRS` — 3 `{from, to}` regex pairs: `.toBe→.toBeTruthy`, `.toBe→.toBeFalsy`, `.toEqual→.toContain`.
- `TEST_PATH_ALLOWLIST` — 3 path regexes: `/^tests\//`, `/^e2e\//`, `/^playwright\//`.

All three arrays are frozen at runtime (`Object.isFrozen()` returns `true`) and TS-readonly via `as const`.

### diff-lint.ts

Pure function `lintDiff(unifiedDiff: string): LintFinding[]`. State machine walk:

1. Detect `+++ b/<path>` headers → set `currentFilePath`; skip `/dev/null` from allowlist check.
2. Detect `@@ ... @@` hunk boundaries → flush per-hunk state for assertion-weakening detection.
3. For each `+` added line (excluding `+++` headers): test against `FORBIDDEN_PATCHED_LINE_PATTERNS`; accumulate for weakening check.
4. For each `-` removed line: accumulate for weakening check.
5. Post-hunk flush: detect `from`/`to` pair matches within same hunk → emit finding.
6. Post-diff: check all file paths that had `+` content against `TEST_PATH_ALLOWLIST`; emit `out-of-test-dir` finding for non-allowlisted paths.

LintFinding pattern tokens:
- Forbidden-line patterns: exact `.name` from `FORBIDDEN_PATCHED_LINE_PATTERNS` (`'waitForTimeout'`, `'nth-child'`, etc.)
- Assertion weakening: `'toBe-to-toBeTruthy'`, `'toBe-to-toBeFalsy'`, `'toEqual-to-toContain'`
- Out-of-allowlist: `'out-of-test-dir'`

### Fixture files

| Fixture | Condition tested |
|---------|-----------------|
| unified-diff-clean.patch | No findings (returns `[]`) |
| unified-diff-with-waitForTimeout.patch | `waitForTimeout` added line |
| unified-diff-with-nth-child.patch | `:nth-child(` selector |
| unified-diff-with-weakened-assertion.patch | `.toBe(5)` → `.toBeTruthy()` weakening |
| unified-diff-out-of-testdir.patch | `src/foo.ts` modified (outside allowlist) |

## Test Results

```
Test Files  2 passed (2)
      Tests  18 passed (18)
```

Full suite: 90 tests passing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended vitest config to include src/**/*.test.ts**

- **Found during:** Task 1 pre-implementation analysis
- **Issue:** vitest.config.ts `include` glob only covered `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts`. Plan colocates tests at `src/healer/*.test.ts`, which vitest would not discover.
- **Fix:** Added `'src/**/*.test.ts'` to the unit project's `include` array.
- **Files modified:** vitest.config.ts
- **Commit:** 0ade3e9 (RED commit, alongside failing test)

## Known Stubs

None — both files are fully implemented pure functions with no placeholder logic.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes. This plan is entirely pure-function logic with no I/O.

## Self-Check: PASSED

Files exist:
- FOUND: src/healer/forbidden-patterns.ts
- FOUND: src/healer/diff-lint.ts
- FOUND: src/healer/forbidden-patterns.test.ts
- FOUND: src/healer/diff-lint.test.ts
- FOUND: tests/fixtures/unified-diff-clean.patch
- FOUND: tests/fixtures/unified-diff-with-waitForTimeout.patch
- FOUND: tests/fixtures/unified-diff-with-nth-child.patch
- FOUND: tests/fixtures/unified-diff-with-weakened-assertion.patch
- FOUND: tests/fixtures/unified-diff-out-of-testdir.patch

Commits exist:
- FOUND: 0ade3e9 (RED - forbidden-patterns test)
- FOUND: 39053f9 (GREEN - forbidden-patterns impl)
- FOUND: fe8a6c3 (RED - diff-lint test + fixtures)
- FOUND: 402e8f1 (GREEN - diff-lint impl)
