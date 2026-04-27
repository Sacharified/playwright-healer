---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: "06"
subsystem: healer
tags: [readiness-probe, app-supervisor, pid-file, timeout, hea-02, hea-03, hea-06]
dependency_graph:
  requires: []
  provides:
    - waitForReady (HEA-02) — HTTP polling probe with redirect:manual, 2s per-attempt AbortSignal
    - AppStartupTimeout — distinct error class for orchestrator routing (HEA-03)
    - PID_FILE_PATH — '/tmp/playwright-healer-app-pid' constant (single source of truth with Plan 14 action.yml)
    - readPidFile() — reads PID file; returns number|null (HEA-06 inner cleanup)
    - stop() — sends SIGTERM via readPidFile (HEA-06 layer 1)
  affects:
    - src/healer/index.ts (Plan 13 imports waitForReady, AppStartupTimeout, PID_FILE_PATH)
    - action.yml (Plan 14 references identical '/tmp/playwright-healer-app-pid' literal in post-step pkill)
tech_stack:
  added: []
  patterns:
    - HTTP readiness probe via Node built-in fetch() with AbortSignal.timeout(2000) and redirect:manual
    - PID file as cross-layer contract between TS inner cleanup and YAML outer cleanup (D-12)
    - Co-located unit tests using Node http.createServer with OS-assigned ephemeral ports
key_files:
  created:
    - src/healer/app-supervisor.ts
    - src/healer/app-supervisor.test.ts
  modified:
    - vitest.config.ts (added src/**/*.test.ts include to unit project)
decisions:
  - PID_FILE_PATH is a single string constant in app-supervisor.ts; Plan 14 action.yml uses identical literal — any rename must update both
  - waitForReady reads only response.status, never body (T-3-PIN-PI: no prompt-injection surface at probe layer)
  - child_process.spawn is NOT in this file — app process lifecycle lives in action.yml composite Step 4 per D-14
  - Test file co-located at src/healer/ (not tests/unit/) per plan spec; vitest.config.ts updated to include src/**/*.test.ts
metrics:
  duration: "~10 minutes"
  completed: "2026-04-27"
  tasks: 2
  files_created: 2
  files_modified: 1
---

# Phase 3 Plan 06: App Supervisor Readiness Probe Summary

HTTP readiness probe + PID file constant for app process lifecycle coordination across TS inner cleanup and action.yml outer cleanup.

## What Was Built

### src/healer/app-supervisor.ts

Exports three primitives and two helpers:

| Export | Type | Purpose |
|--------|------|---------|
| `PID_FILE_PATH` | `const string` | `/tmp/playwright-healer-app-pid` — single source of truth shared with Plan 14 action.yml post-step `pkill` |
| `AppStartupTimeout` | `class extends Error` | Distinct error class so Plan 13 orchestrator can catch and route to `app-startup-timeout` issue (D-09) |
| `waitForReady(baseUrl, timeoutMs)` | `async function` | HTTP poll per D-15: `redirect:'manual'`, `AbortSignal.timeout(2000)`, 1s cadence, `status < 500` = ready, 5xx = keep polling |
| `readPidFile()` | `function` | Reads `PID_FILE_PATH`; returns `number \| null`; graceful on missing/corrupt file |
| `stop()` | `function` | Sends SIGTERM via `readPidFile()`; no-op if PID absent; Plan 14 SIGKILL fallback is the outer layer |

### Probe behavior table (HEA-02 / D-15)

| HTTP status | Treatment | Rationale |
|-------------|-----------|-----------|
| 1xx, 2xx, 3xx | Ready (return) | status < 500 |
| 401 | Ready (return) | Auth wall means app is running |
| 302 | Ready (return) | redirect:'manual' gives raw status; 302 < 500 |
| 4xx (other) | Ready (return) | App is responding |
| 5xx | Keep polling | Server up but degraded |
| ECONNREFUSED / AbortError / ENOTFOUND | Keep polling | Not yet started |
| Deadline exceeded | Throw `AppStartupTimeout` | Deterministic failure for issue routing |

### Security invariants enforced

- `response.text()`, `response.json()`, `response.body` — none appear in source (T-3-PIN-PI: no body parse = no prompt-injection surface at probe layer)
- `child_process` — not imported (spawn is action.yml Step 4 per D-14)
- No network calls other than the readiness probe fetch

### src/healer/app-supervisor.test.ts

8 tests using Node built-in `http.createServer` (no nock, no msw):

| Test | Scenario |
|------|----------|
| 1 | 200 → resolves immediately |
| 2 | 302 → resolves (redirect:manual, status < 500) |
| 3 | 401 → resolves |
| 4 | 500 forever → throws AppStartupTimeout |
| 5 | 503×2 then 200 → resolves on 3rd poll |
| 6 | ECONNREFUSED → throws AppStartupTimeout |
| 7 | AppStartupTimeout instanceof Error + .name check |
| 8 | PID_FILE_PATH === '/tmp/playwright-healer-app-pid' exact string |

All servers bind to `127.0.0.1:0` (OS-assigned ephemeral port); closed in `afterEach` — no port leaks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest.config.ts updated to include src/**/*.test.ts**
- **Found during:** Task 2 verification
- **Issue:** The vitest `projects` config restricted test discovery to `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts`. Running `npx vitest run src/healer/app-supervisor.test.ts` produced "No test files found" because the project-level `include` patterns overrode the CLI file path filter.
- **Fix:** Added `'src/**/*.test.ts'` to the `unit` project's `include` array in `vitest.config.ts`. This allows co-located tests (as specified by the plan) to be discovered by both explicit path and `npm run test`.
- **Files modified:** `vitest.config.ts`
- **Commit:** 71843c9

**2. [Rule 1 - Minor] JSDoc comment adjusted to avoid grep false positive**
- **Found during:** Task 1 acceptance criteria verification
- **Issue:** The JSDoc comment for `waitForReady` contained `redirect: 'manual'` as a documentation fragment, causing `grep -c "redirect: 'manual'"` to return 2 instead of the plan's expected 1.
- **Fix:** Rephrased the JSDoc bullet to "redirect set to manual" (plain English, not code syntax) so only the actual implementation line matches.
- **Files modified:** `src/healer/app-supervisor.ts`

## Self-Check

### Files created
- [x] `src/healer/app-supervisor.ts` exists
- [x] `src/healer/app-supervisor.test.ts` exists
- [x] `.planning/phases/03-manual-healer-selectors-waits-issue-fallback/03-06-SUMMARY.md` exists

### Commits
- [x] `1526c3a` — feat(03-06): implement app-supervisor readiness probe
- [x] `71843c9` — test(03-06): add app-supervisor unit tests with real HTTP server

### Acceptance criteria
- [x] `grep -c "export const PID_FILE_PATH = '/tmp/playwright-healer-app-pid'"` → 1
- [x] `grep -c "export class AppStartupTimeout"` → 1
- [x] `grep -c "export async function waitForReady"` → 1
- [x] `grep -c "export function readPidFile"` → 1
- [x] `grep -c "redirect: 'manual'"` → 1 (in implementation only)
- [x] `grep -c "AbortSignal.timeout(2000)"` → 1
- [x] `grep -c "child_process"` → 0
- [x] `grep -cE "response\.(text|json|body)"` → 0
- [x] `npm run typecheck` → exit 0
- [x] `npx vitest run src/healer/app-supervisor.test.ts` → 8 tests pass

## Self-Check: PASSED
