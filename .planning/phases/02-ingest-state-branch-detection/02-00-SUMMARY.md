---
phase: 02-ingest-state-branch-detection
plan: "00"
subsystem: test-infrastructure
tags: [vitest, test-infrastructure, bare-repo, wave0]
dependency_graph:
  requires: []
  provides:
    - vitest test runner (unit + integration projects)
    - tests/_helpers/bare-repo.ts (BareRepoContext factory)
    - tests/_helpers/fixture-report.ts (makeFixtureReport, makeTestEntry)
  affects:
    - All Phase 02 plans that use npx vitest run for verification
tech_stack:
  added:
    - vitest@4.1.5 (devDependency — test runner)
    - "@vitest/coverage-v8@4.1.5 (devDependency — coverage)"
    - yaml@2.8.3 (runtime dependency — imported by src/ingest/index.ts)
    - "@actions/glob@0.7.0 (runtime dependency — imported by src/ingest/index.ts; must be present after npm ci --production)"
  patterns:
    - Two-project vitest config (unit:threads + integration:forks) for parallel + isolated test execution
    - passWithNoTests:true at root level required for vitest 4.x multi-project mode (per-project flag does not apply to global "no files" check)
key_files:
  created:
    - vitest.config.ts
    - tests/_helpers/bare-repo.ts
    - tests/_helpers/fixture-report.ts
    - tests/unit/.gitkeep
    - tests/integration/.gitkeep
    - tests/fixtures/.gitkeep
  modified:
    - package.json (added deps + updated scripts.test)
    - package-lock.json (lockfile updated)
    - .gitignore (appended tmp-test-repos/, tmp-state-worktree*/, coverage/)
decisions:
  - passWithNoTests:true must be at the root test: level in vitest 4.x multi-project config, not inside each project's test: block — per-project flag does not suppress the global "no test files" exit-1
  - package-lock.json staged alongside package.json — composite action's npm ci --production consumes the lockfile; planner omitted it from files_modified but it is an implicit correctness requirement
metrics:
  duration: ~10m
  completed: "2026-04-25"
  tasks: 2
  files: 9
---

# Phase 02 Plan 00: Test Infrastructure (vitest + Helpers) Summary

Installed vitest 4.1.5 with a two-project config (unit:threads, integration:forks) and built the bare-repo and fixture-report helper utilities required by all subsequent Phase 02 integration and unit tests.

## What Was Built

**Task 2-00-01:** Installed Phase 02 dependencies and created vitest config.

- Added `yaml@2.8.3` and `@actions/glob@0.7.0` to runtime deps (composite action's `npm ci --production` must include them — they are imported by `src/ingest/index.ts`)
- Added `vitest@4.1.5` and `@vitest/coverage-v8@4.1.5` to devDependencies
- Updated `scripts.test` from Phase 1 stub to `"vitest run"`
- Created `vitest.config.ts` with two projects: `unit` (threads pool) and `integration` (forks pool)
- Appended `tmp-test-repos/`, `tmp-state-worktree*/`, `coverage/` to `.gitignore`

**Task 2-00-02:** Created test directory scaffold and helper utilities.

- Created `tests/unit/`, `tests/integration/`, `tests/fixtures/` with `.gitkeep` placeholders
- Created `tests/_helpers/bare-repo.ts`: `makeBareRepo()` factory that creates a bare git "remote" (simulating GitHub) plus two workspace clones for concurrent-write integration tests
- Created `tests/_helpers/fixture-report.ts`: `makeFixtureReport()` and `makeTestEntry()` for generating synthetic Playwright JSON reports with controlled pass/fail/flaky/skipped patterns

## Dependency Versions Installed

```
playwright-healer@0.0.0
├── @actions/glob@0.7.0
├── @vitest/coverage-v8@4.1.5
├── vitest@4.1.5
└── yaml@2.8.3
```

## Vitest Verification

```
 RUN  v4.1.5 /Users/sacha/dev/playwright-healer/...

No test files found, exiting with code 0

|unit|
include: tests/unit/**/*.test.ts

|integration|
include: tests/integration/**/*.test.ts

EXIT: 0
```

## Helper Export Verification

```
makeBareRepo export: OK
makeFixtureReport export: OK
makeTestEntry export: OK (via fixture-report.ts)
BareRepoContext interface: OK
.gitignore tmp-test-repos: OK
.gitignore tmp-state-worktree: OK
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] vitest 4.x exits 1 with no test files in multi-project mode**

- **Found during:** Task 2-00-01 verification
- **Issue:** The plan stated "Zero tests is a valid pass state for vitest — it exits 0." In vitest 4.1.5 with a `projects` config, the global "no test files" check exits with code 1 even when each project has `passWithNoTests: true`. The per-project flag does not suppress the global check.
- **Fix:** Added `passWithNoTests: true` at the root `test:` level (above `projects`), which is the correct location for the global check in vitest 4.x multi-project mode.
- **Files modified:** `vitest.config.ts`
- **Commit:** 0c5cba2

**2. [Rule 3 - Blocker] package-lock.json not in files_modified but must be committed**

- **Found during:** Task 2-00-01 commit
- **Issue:** The plan's `files_modified` list did not include `package-lock.json`, but `npm install` updates it. The composite action's `npm ci --production` consumes the lockfile — leaving it uncommitted would cause CI failures.
- **Fix:** Staged and committed `package-lock.json` alongside `package.json`.
- **Files modified:** `package-lock.json`
- **Commit:** 0c5cba2

## Known Stubs

None — this plan creates infrastructure utilities, not product features.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary crossings introduced. Test helpers use `fs.mkdtempSync` under `os.tmpdir()` with static shell command strings (no user input reaches shell).

## Self-Check

### Files created/modified

- [x] `vitest.config.ts` — exists, contains `projects`
- [x] `tests/_helpers/bare-repo.ts` — exists, exports `makeBareRepo`, `BareRepoContext`
- [x] `tests/_helpers/fixture-report.ts` — exists, exports `makeFixtureReport`, `makeTestEntry`
- [x] `tests/unit/.gitkeep` — exists
- [x] `tests/integration/.gitkeep` — exists
- [x] `tests/fixtures/.gitkeep` — exists
- [x] `package.json` — yaml and @actions/glob in deps, vitest + coverage-v8 in devDeps
- [x] `.gitignore` — contains tmp-test-repos/ and tmp-state-worktree*/

### Commits

- [x] 0c5cba2 — chore(02-00): install Phase 02 deps + create vitest.config.ts
- [x] 3f45c7c — feat(02-00): add test directory scaffold and helper utilities

## Self-Check: PASSED
