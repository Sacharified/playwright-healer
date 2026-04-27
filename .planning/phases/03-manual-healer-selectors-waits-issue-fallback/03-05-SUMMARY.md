---
phase: "03"
plan: "05"
subsystem: healer/budget
tags: [budget, adapter, stub, fix-02, gemini]
dependency_graph:
  requires: [03-02]
  provides: [BudgetTracker, BudgetExhausted, anthropicAdapter, ollamaAdapter]
  affects: [03-10, 03-12]
tech_stack:
  added: []
  patterns: [pre-call-gate, fail-loud-stub, tdd]
key_files:
  created:
    - src/healer/budget.ts
    - src/healer/budget.test.ts
    - src/healer/adapters/anthropic.ts
    - src/healer/adapters/anthropic.test.ts
    - src/healer/adapters/ollama.ts
    - src/healer/adapters/ollama.test.ts
    - src/healer/adapter.ts
    - src/healer/types.ts
  modified:
    - vitest.config.ts
decisions:
  - "BudgetExhausted constructor takes { usdSpent, turnsUsed } stats object (revised 2026-04-26 per checker BLOCKER #1) — orchestrator reads err.usdSpent / err.turnsUsed on the catch path to render real cost into issue bodies"
  - "thoughtsTokenCount billed at output rate ($10/M) matching Gemini 2.5 Pro pricing docs"
  - "vitest.config.ts extended with 'src' project to support co-located test files (plan-specified pattern)"
  - "types.ts + adapter.ts created as Rule 3 blocking dependency (Plan 02 Wave 0 not yet committed in this worktree)"
metrics:
  duration: "~6 minutes"
  completed: "2026-04-27"
  tasks_completed: 2
  files_created: 8
  files_modified: 1
---

# Phase 03 Plan 05: Budget Tracker + Stub Adapters Summary

**One-liner:** BudgetTracker with FIX-02 pre-call gate, BudgetExhausted carrying at-throw cost stats, and fail-loud anthropic/ollama stubs satisfying the Adapter interface.

## Tasks Completed

| Task | Description | Commit | Tests |
|------|-------------|--------|-------|
| 1 | BudgetTracker + BudgetExhausted + tests (TDD) | af67637 | 12 green |
| 2 | Anthropic + Ollama stub adapters + tests (TDD) | be0310d | 4 green |

**Total: 16 tests green, typecheck clean.**

## API Surface

### `src/healer/budget.ts`

```typescript
export const GEMINI_PRICE_INPUT_PER_M = 1.25;   // $/M input tokens
export const GEMINI_PRICE_OUTPUT_PER_M = 10.0;  // $/M output tokens (candidates + thoughts)

export class BudgetExhausted extends Error {
  readonly usdSpent: number;
  readonly turnsUsed: number;
  constructor(message: string, stats: { usdSpent: number; turnsUsed: number });
}

export class BudgetTracker {
  constructor(opts: { maxTurns: number; maxBudgetUsd: number });
  assertCanProceed(): void;           // Pre-call gate — throws BudgetExhausted if at/above cap
  recordUsage(u: UsageMetadataLike): void;  // Accounts usage, increments turnsUsed
  get usdSpent(): number;
  get turnsUsed(): number;
}
```

**BudgetExhausted constructor note (revised 2026-04-26):** Takes `{ usdSpent, turnsUsed }` stats object so Plan 12 orchestrator can render `err.usdSpent` / `err.turnsUsed` into the `agent-budget-exhausted` issue body (PRI-02 / checker BLOCKER #1).

### `src/healer/adapters/anthropic.ts`

```typescript
export const anthropicAdapter: Adapter = {
  async runAgent() {
    throw new Error('anthropic adapter not implemented in Phase 3');
  },
};
```

### `src/healer/adapters/ollama.ts`

```typescript
export const ollamaAdapter: Adapter = {
  async runAgent() {
    throw new Error('ollama adapter not implemented in Phase 3');
  },
};
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created adapter.ts and types.ts as Wave 0 dependency**
- **Found during:** Task 1 setup — stub adapters `import type { Adapter }` from `../adapter.js` which Plan 02 creates; Plan 02 is Wave 0 but not yet committed in this worktree
- **Fix:** Created `src/healer/adapter.ts` and `src/healer/types.ts` from the exact interfaces specified in Plan 02's `<interfaces>` block (including the revised 2026-04-26 `{ proposal, stats }` return type per checker BLOCKER #1)
- **Files modified:** `src/healer/adapter.ts`, `src/healer/types.ts`
- **Commit:** af67637

**2. [Rule 3 - Blocking] Extended vitest.config.ts to support co-located src tests**
- **Found during:** Task 1 TDD RED phase — `npx vitest run src/healer/budget.test.ts` returned "No test files found" because the vitest projects config only includes `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts`
- **Fix:** Added a third `src` vitest project with `include: ['src/**/*.test.ts']`; this matches the plan's explicit `<files>` directive placing tests at `src/healer/budget.test.ts`
- **Files modified:** `vitest.config.ts`
- **Commit:** 5d0dac9 (included in RED phase commit)

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `anthropicAdapter.runAgent` always throws | `src/healer/adapters/anthropic.ts` | Intentional D-01: Phase 3 ships Gemini only; Phase 4 implements Anthropic adapter |
| `ollamaAdapter.runAgent` always throws | `src/healer/adapters/ollama.ts` | Intentional D-01: Phase 3 ships Gemini only; Phase 4 implements Ollama adapter |

These stubs are intentional per CONTEXT D-01 and plan requirements. Plan 12 orchestrator routes to them via `config.provider` switch — wrong provider = immediate hard failure, not silent.

## Threat Model

| Threat | Status |
|--------|--------|
| T-3-FIX-02: Agent runaway loop | Mitigated — `assertCanProceed()` pre-call gate enforces maxTurns + maxBudgetUsd |
| T-3-D01-01: Stubs silently accept calls | Mitigated — both stubs throw with exact error message |

## Self-Check: PASSED

Files exist:
- src/healer/budget.ts: FOUND
- src/healer/budget.test.ts: FOUND
- src/healer/adapters/anthropic.ts: FOUND
- src/healer/adapters/anthropic.test.ts: FOUND
- src/healer/adapters/ollama.ts: FOUND
- src/healer/adapters/ollama.test.ts: FOUND
- src/healer/adapter.ts: FOUND
- src/healer/types.ts: FOUND

Commits exist:
- 5d0dac9: test RED BudgetTracker
- af67637: feat GREEN BudgetTracker + adapter.ts + types.ts
- 228f528: test RED stub adapters
- be0310d: feat GREEN stub adapters
