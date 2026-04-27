---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: "07"
subsystem: healer
tags: [context-bundler, hea-04, hea-05, path-safety, first-hop-imports, git-blame]
dependency_graph:
  requires: [03-02]
  provides: [bundleContext, BundleContextArgs, ContextBundle]
  affects: [03-11, 03-13]
tech_stack:
  added: []
  patterns:
    - "getExecOutput with { cwd, ignoreReturnCode: true, silent: true } pattern from state-branch.ts"
    - "path.resolve + startsWith(cwd + path.sep) for path traversal protection"
    - "RELATIVE_IMPORT_RE regex for single-hop relative import discovery"
key_files:
  created:
    - src/healer/types.ts
    - src/healer/context-bundler.ts
    - src/healer/context-bundler.test.ts
  modified:
    - vitest.config.ts
decisions:
  - "First-hop only — single regex pass with no recursion; T-3-CTX-02 mitigation"
  - "TS path aliases (@/) not resolved in Phase 3 — documented limitation"
  - "git blame uses { silent: true } to suppress noisy output in CI logs"
  - "resolveOrNull tries 8 extension candidates in order to handle extensionless imports"
  - "vitest.config.ts extended with src project to enable src/**/*.test.ts discovery"
metrics:
  duration: "~6m"
  completed: "2026-04-27T09:05:43Z"
  tasks_completed: 2
  files_changed: 4
---

# Phase 03 Plan 07: Context Bundler Summary

One-liner: `bundleContext()` assembles ContextBundle from test source, first-hop relative imports, `git blame -p`, and nullable trace path, with workspace path-traversal guard.

## What Was Built

`src/healer/context-bundler.ts` exports `bundleContext(BundleContextArgs): Promise<ContextBundle>`. The bundler:

1. **Validates testFile path** — rejects paths that resolve outside `cwd` using `path.resolve` + `startsWith(resolvedCwd + path.sep)` check (T-3-CTX-01). Error message contains `'outside workspace'` for test/diagnostics matching.

2. **Reads test file source** — full UTF-8 text of the failing test file.

3. **Resolves first-hop relative imports** — single regex pass (`RELATIVE_IMPORT_RE`) over the test file's `import` statements. Only `./` and `../` prefixed paths are resolved; absolute imports, `@playwright/test`, `react`, and `@/` TS path aliases are skipped naturally because the regex requires `.` or `..` prefix. Each resolved import is range-bounded by the same path traversal check. No recursion — B's imports from A's imported file are ignored (T-3-CTX-02).

4. **Captures `git blame -p`** — via `@actions/exec.getExecOutput` with `{ cwd, ignoreReturnCode: true, silent: true }`. Empty string on non-zero exit code or exception.

5. **Validates trace attachment** — `traceAttachmentPath` is set to `null` when the arg is undefined or the file doesn't exist on disk (HEA-05 trace-free prompt variant). Preserved as-is when the file is accessible.

6. **Defaults `recentErrorMessages`** — to `[]` when not provided.

## Test Coverage (12 tests)

| # | Test | Covers |
|---|------|--------|
| 1 | reads testFileSource | Basic file reading |
| 2 | resolves first-hop relative imports | HEA-04 import resolution |
| 3 | skips non-relative imports | T-3-CTX-02 node_modules exclusion |
| 4 | skips TS path-alias (@/) imports | Documented P3 limitation |
| 5 | does NOT recurse — only first hop | T-3-CTX-02 no-recursion |
| 6 | traceAttachmentPath null when file missing | HEA-05 trace-free path |
| 7 | traceAttachmentPath preserved when file exists | HEA-05 positive path |
| 8 | traceAttachmentPath null when arg undefined | HEA-05 undefined case |
| 9 | captures git blame stdout | HEA-04 blame capture |
| 10 | empty gitBlame on non-zero exit | Error resilience |
| 11 | rejects testFile escaping workspace | T-3-CTX-01 path traversal |
| 12 | defaults recentErrorMessages to [] | HEA-04 defaults |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `src/healer/types.ts` missing in worktree**
- **Found during:** Task 1 (typecheck would fail without it)
- **Issue:** Plan 02 creates `src/healer/types.ts` in a separate parallel worktree; this worktree only had the base commit `eecdca5` with no `types.ts` in `src/healer/`
- **Fix:** Created `src/healer/types.ts` with byte-identical content to the Plan 02 version (verified from `agent-a2df50a536fcc8e7d/src/healer/types.ts`). Clean merge when branches are integrated.
- **Files modified:** `src/healer/types.ts`
- **Commit:** `3c8bbc1`

**2. [Rule 3 - Blocking] vitest config didn't include `src/**/*.test.ts`**
- **Found during:** Task 2 (vitest reported "No test files found" for `src/healer/context-bundler.test.ts`)
- **Issue:** The plan specifies `src/healer/context-bundler.test.ts` as the test file location, but the vitest config only included `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts`
- **Fix:** Added a `src` project to `vitest.config.ts` matching the pattern from the Plan 02 worktree (`agent-a2df50a536fcc8e7d/vitest.config.ts`). This is the intended project structure for healer unit tests.
- **Files modified:** `vitest.config.ts`
- **Commit:** `fa87f05`

## Known Stubs

None — `bundleContext` is a complete, fully-wired implementation.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes at trust boundaries. The bundler reads files and runs `git blame`; no writes. The path traversal guard (T-3-CTX-01) is implemented and tested.

## Self-Check: PASSED

Files exist:
- `src/healer/types.ts` — FOUND
- `src/healer/context-bundler.ts` — FOUND
- `src/healer/context-bundler.test.ts` — FOUND
- `vitest.config.ts` — modified and committed

Commits exist:
- `3c8bbc1` — feat(03-07) implementation
- `fa87f05` — test(03-07) tests + vitest config
