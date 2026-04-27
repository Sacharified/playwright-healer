---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: "08"
subsystem: healer/validator
tags: [validator, vibe-test, playwright-exec, tdd, val-01, val-02, val-03, val-04]
dependency_graph:
  requires: []
  provides: [validate, escapeForGrep, ValidationResult, RunResult]
  affects: [src/healer/pr-writer.ts (Plan 12), src/healer/orchestrator.ts (Plan 13)]
tech_stack:
  added: []
  patterns:
    - "@actions/exec getExecOutput with ignoreReturnCode"
    - "PLAYWRIGHT_JSON_OUTPUT_NAME env var for JSON output path"
    - "RE2 regex escape recipe for --grep injection mitigation"
    - "Sequential for-await loop (no Promise.all) for deterministic reruns"
key_files:
  created:
    - src/healer/validator.ts
    - src/healer/validator.test.ts
    - tests/fixtures/playwright-rerun-passed.json
    - tests/fixtures/playwright-rerun-failed.json
    - tests/fixtures/playwright-rerun-mixed.json
  modified:
    - vitest.config.ts
decisions:
  - "Stdout-first JSON parsing with PLAYWRIGHT_JSON_OUTPUT_NAME file fallback — covers both Playwright JSON-to-stdout and JSON-to-file modes"
  - "parseRerunResult uses stats.expected/unexpected (not suite walk) for pass/fail determination — consistent with RESEARCH Pattern 4"
  - "vitest.config.ts extended with a 'healer' project covering src/healer/**/*.test.ts — plan-colocated tests follow the same pattern as src/ingest/"
metrics:
  duration: "~10 min"
  completed: "2026-04-27"
  tasks_completed: 2
  files_changed: 6
---

# Phase 03 Plan 08: Validator Harness Summary

Implements VAL-01..04 — the re-run harness that validates proposed fixes by running the suspect test N times sequentially and aggregating pass/fail results.

## One-Liner

Sequential Playwright test re-runner with RE2-safe grep escaping and stdout+file JSON fallback, returning structured `ValidationResult` for pr-writer consumption.

## What Was Built

### `src/healer/validator.ts`

Exports two functions:

- **`escapeForGrep(s: string): string`** — Escapes all RE2 metacharacters in `testTitle` before embedding as `--grep` argument. Implements T-3-VAL-01 security mitigation. Recipe: `s.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')`.

- **`validate(testFile, testTitle, rerunCount): Promise<ValidationResult>`** — Spawns `npx playwright test` exactly `rerunCount` times in a sequential for-loop. Each invocation uses:
  - `testFile` as a positional argv element (no shell interpolation via @actions/exec)
  - `--grep <escapedTitle>` (injection-safe)
  - `--retries=0` (D-19 CLI flag — NOT a config-file patch)
  - `--workers=1` (deterministic, comparable timing)
  - `--reporter=json`
  - `PLAYWRIGHT_JSON_OUTPUT_NAME=<reportPath>` env var for file output fallback

  JSON is parsed from stdout first; if stdout is unparseable, falls back to reading the file at `RUNNER_TEMP/playwright-healer-rerun-{i}.json`. A run is "passed" if `stats.unexpected === 0 && stats.expected >= 1`.

### Fixtures

Three minimal Playwright JSON reporter fixture files under `tests/fixtures/`:

| File | stats.expected | stats.unexpected | Use |
|------|---------------|-----------------|-----|
| playwright-rerun-passed.json | 1 | 0 | All-pass scenario (passRate = 1.0) |
| playwright-rerun-failed.json | 0 | 1 | All-fail scenario (passRate = 0) |
| playwright-rerun-mixed.json | 9 | 1 | Mixed scenario reference |

### `src/healer/validator.test.ts`

13 tests across 3 describe blocks:

1. `escapeForGrep` — 4 tests: parens, dots, brackets+pipes, alphanumeric no-op
2. `validate` — 8 tests: argv shape (VAL-01), grep escaping (T-3-VAL-01), call count (VAL-02), all-pass, all-fail, mixed 9/1, sequential call pattern, unparseable JSON graceful handling
3. VAL-04 inspection — 1 test: asserts `validator.ts` source has no `from '*/app-supervisor'` import

### `vitest.config.ts`

Added a `healer` project to cover `src/healer/**/*.test.ts` alongside the existing `unit` and `integration` projects.

## Argv Contract

```
npx playwright test
  <testFile>           # separate argv element — no shell interpolation
  --grep <escaped>     # RE2-escaped testTitle
  --retries=0          # D-19: CLI flag NOT config-file patch
  --workers=1          # sequential, deterministic
  --reporter=json
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary changes. The `escapeForGrep` function mitigates T-3-VAL-01 (shell injection via testTitle in --grep) as specified in the plan threat model.

## Self-Check: PASSED

- `src/healer/validator.ts`: FOUND
- `src/healer/validator.test.ts`: FOUND
- `tests/fixtures/playwright-rerun-passed.json`: FOUND
- `tests/fixtures/playwright-rerun-failed.json`: FOUND
- `tests/fixtures/playwright-rerun-mixed.json`: FOUND
- RED commit b65d948: FOUND
- GREEN commit 09ff46a: FOUND
- 13 tests pass, 85 total (no regressions)
- `npm run typecheck` exits 0
