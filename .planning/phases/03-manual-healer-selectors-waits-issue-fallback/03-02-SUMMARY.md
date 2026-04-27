---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: 02
subsystem: healer
tags: [typescript, zod, types, adapter-contract, dispatch-payload, wave-0]

# Dependency graph
requires:
  - phase: 02-ingest-state-branch-detection
    provides: "NdjsonRecord, NdjsonTestEntry, Detection types in src/shared/types.ts (analog for type-only pattern)"
  - phase: 01-security-scaffold-composite-packaging
    provides: "ALLOWED_TOOLS canonical form, security-contract.ts patterns; src/healer/index.ts stub"
provides:
  - "src/healer/types.ts: ContextBundle interface + six locked FailureMode tokens (D-09)"
  - "src/healer/adapter.ts: Adapter interface with revised { proposal, stats } return type; FixProposal, NoFixProposable, AgentRunStats"
  - "src/healer/dispatch-payload.ts: DispatchPayload Zod schema (D-18) with SHA validation and P3-scoped fixClassHint"
  - "Wave 0 contracts — Plans 03–14 can import all types without circular dependency risk"
affects:
  - "03-03 through 03-14: all plans that import Adapter, ContextBundle, FailureMode, DispatchPayload, AgentRunStats"
  - "Plan 05 (BudgetTracker): populates AgentRunStats.usdSpent / turnsUsed"
  - "Plan 10 (Gemini adapter): implements Adapter.runAgent returning { proposal, stats }"
  - "Plan 12 (orchestrator): uses FailureMode tokens and AgentRunStats for PR/issue bodies"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure type-only source files (no export const, no export function) — matches src/shared/types.ts pattern"
    - "Zod schema + type alias co-export (export const X = z.object; export type X = z.infer<typeof X>)"
    - "TDD RED/GREEN for Zod schema: test file committed first (RED) then schema (GREEN)"
    - "vitest.config.ts extended to include src/**/*.test.ts alongside tests/unit/**/*.test.ts"

key-files:
  created:
    - src/healer/types.ts
    - src/healer/adapter.ts
    - src/healer/dispatch-payload.ts
    - src/healer/dispatch-payload.test.ts
  modified:
    - vitest.config.ts

key-decisions:
  - "Adapter.runAgent return type revised to { proposal: FixProposal | NoFixProposable; stats: AgentRunStats } per checker BLOCKER #1 — supersedes RESEARCH §A pre-revision shape Promise<FixProposal | NoFixProposable>"
  - "AgentRunStats interface added (usdSpent: number; turnsUsed: number) — mandatory for PRI-02 cost pass-through on PR bodies and budget-exhausted/validation-failed issue bodies"
  - "fixClassHint enum limited to selectors|waits only (P4 widens to assertions|slow per FIX-07 traceability)"
  - "vitest.config.ts unit project extended to include src/**/*.test.ts so tests co-located with source compile and run"

patterns-established:
  - "Wave 0 contracts-first ordering: type files committed before any plan that imports them"
  - "FailureMode tokens single source of truth in types.ts — issue-writer (Plan 12) and orchestrator (Plan 13) import from here, never redeclare"

requirements-completed: [FIX-04]

# Metrics
duration: 12min
completed: 2026-04-27
---

# Phase 3 Plan 02: Healer Type Contracts Summary

**Wave 0 adapter contract with revised { proposal, stats } return type and D-18 Zod dispatch payload schema — unblocks all Phase 3 plans that import Adapter, ContextBundle, FailureMode, DispatchPayload, or AgentRunStats**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-27T10:01:00Z
- **Completed:** 2026-04-27T10:13:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created `src/healer/types.ts` with `ContextBundle` interface and six locked `FailureMode` tokens (D-09) — single source of truth for issue title matching and Phase 4 PRI-04 dedup
- Created `src/healer/adapter.ts` with revised `Adapter` interface returning `{ proposal, stats }` per checker BLOCKER #1, plus `FixProposal`, `NoFixProposable`, and `AgentRunStats` — enables PRI-02 cost pass-through into PR and issue bodies
- Created `src/healer/dispatch-payload.ts` with `DispatchPayload` Zod schema (D-18): hex-SHA validation (T-3-DPL-01 mitigation), P3-scoped `fixClassHint` enum (`selectors|waits` only), optional `recentRunStats`
- 11 vitest cases covering all positive/negative validation paths; full test suite 83/83 passes

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/healer/types.ts and src/healer/adapter.ts** - `6f49303` (feat)
2. **Task 2 RED: Add failing tests for dispatch payload schema** - `cf9f425` (test)
3. **Task 2 GREEN: Add dispatch payload Zod schema** - `5b633c4` (feat)

## Files Created/Modified

- `src/healer/types.ts` — ContextBundle interface + six locked FailureMode tokens
- `src/healer/adapter.ts` — Adapter interface (revised), FixProposal, NoFixProposable, AgentRunStats
- `src/healer/dispatch-payload.ts` — DispatchPayload Zod schema (D-18)
- `src/healer/dispatch-payload.test.ts` — 11 vitest cases (positive + negative)
- `vitest.config.ts` — Extended unit project include to cover `src/**/*.test.ts`

## Decisions Made

- **Adapter return type revision:** `runAgent` now returns `Promise<{ proposal: FixProposal | NoFixProposable; stats: AgentRunStats }>` instead of just the union (checker BLOCKER #1). This is the Wave 0 contract — all adapter implementations in Plans 05/10 must satisfy this shape.
- **AgentRunStats mandatory on every return path:** adapters populate `usdSpent` and `turnsUsed` on both success and `NoFixProposable` returns. On thrown `BudgetExhausted`, stats travel on the error object (Plans 05/10).
- **P3 fixClassHint scope:** `z.enum(['selectors', 'waits'])` — `assertions` and `slow` deferred to Phase 4 per FIX-07. The plan assembler (D-08) reinforces this at runtime.
- **vitest config extension (Rule 3 auto-fix):** The plan specifies test file at `src/healer/dispatch-payload.test.ts` and verify command `npx vitest run src/healer/dispatch-payload.test.ts`, but the existing config only included `tests/unit/**/*.test.ts`. Extended unit project include to `['tests/unit/**/*.test.ts', 'src/**/*.test.ts']` to unblock the verify step.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended vitest config to include src/**/*.test.ts**
- **Found during:** Task 2 (dispatch-payload test)
- **Issue:** vitest.config.ts only scanned `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts`. Plan places test at `src/healer/dispatch-payload.test.ts` and verify command is `npx vitest run src/healer/dispatch-payload.test.ts` — without config extension, vitest reports "No test files found" and exits 0 (false GREEN).
- **Fix:** Added `'src/**/*.test.ts'` to the unit project `include` array in vitest.config.ts
- **Files modified:** vitest.config.ts
- **Verification:** `npx vitest run src/healer/dispatch-payload.test.ts` → 11 tests pass; full suite 83/83 still passes
- **Committed in:** `cf9f425` (TDD RED commit, alongside test file)

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking issue)
**Impact on plan:** Essential for test verification to work. No scope creep. Future co-located tests in `src/` will automatically be discovered.

## Known Stubs

None. These files contain no runtime code (types.ts, adapter.ts are pure type-only) and no hardcoded placeholders.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-3-DPL-01 (mitigated) | src/healer/dispatch-payload.ts | commitSha validated as `/^[0-9a-f]{7,40}$/i` — rejects shell metacharacters and path traversal in SHA field. testFile path traversal is enforced by context-bundler (Plan 08). |

## Self-Check

Files created:
- `src/healer/types.ts` — FOUND
- `src/healer/adapter.ts` — FOUND
- `src/healer/dispatch-payload.ts` — FOUND
- `src/healer/dispatch-payload.test.ts` — FOUND

Commits:
- `6f49303` — FOUND (feat: healer type contracts)
- `cf9f425` — FOUND (test: failing tests for dispatch payload)
- `5b633c4` — FOUND (feat: dispatch payload Zod schema)

Verification:
- `npx vitest run src/healer/dispatch-payload.test.ts` — 11/11 PASS
- `npm run typecheck` — EXIT 0
- Full suite `npm test` — 83/83 PASS

## Self-Check: PASSED
