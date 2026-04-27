---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: 12
subsystem: healer-orchestrator
tags: [orchestrator, heal-pipeline, routing-tree, cost-passthrough, PRI-02, HEA-06]
dependency_graph:
  requires:
    - 03-02: DispatchPayload Zod schema, adapter.ts interface (Adapter, FixProposal, NoFixProposable, AgentRunStats)
    - 03-03: lintDiff (diff-lint.ts)
    - 03-04: assemblePrompt (prompt-assembler.ts)
    - 03-05: BudgetExhausted class (budget.ts), anthropicAdapter + ollamaAdapter stubs
    - 03-06: stop() / app-supervisor.ts (HEA-06 inner cleanup)
    - 03-07: bundleContext (context-bundler.ts)
    - 03-08: validate / ValidationResult (validator.ts)
    - 03-09: applyFix / ApplyFixResult (fix-applier.ts)
    - 03-10: createGeminiAdapter (adapters/gemini.ts)
    - 03-11: openHealerPr (pr-writer.ts), openIssue (issue-writer.ts)
  provides:
    - run(config): heal pipeline entry point (replaces Phase 1 stub)
  affects:
    - src/index.ts (calls run() for mode=heal — no change needed; stub replaced in-place)
tech_stack:
  added: []
  patterns:
    - numbered-step orchestrator with try/finally cleanup (analog: src/ingest/index.ts)
    - vi.hoisted() for mock initialization before vi.mock() factories (Vitest hoisting semantics)
    - definite-assignment assertions (!) for let-declared variables populated inside inner try
key_files:
  created:
    - src/healer/index.ts
    - src/healer/index.test.ts
  modified: []
decisions:
  - "vi.hoisted() required when vi.mock() factories reference module-level const variables — clearAllMocks preserves implementations; re-apply mockReturnValue in beforeEach"
  - "let proposal! and let stats! with definite-assignment assertion avoids bogus initializers while satisfying TS strict flow analysis"
  - "provider=anthropic/ollama stub errors propagate as throws (configuration error, not heal failure) — no issue filed"
  - "app-startup-timeout failure mode is action.yml's responsibility, not the orchestrator — by the time run() executes the app is up"
metrics:
  duration: ~12 minutes
  completed: 2026-04-27
  tasks_completed: 2
  files_created: 2
  tests_added: 13
---

# Phase 03 Plan 12: Heal Pipeline Orchestrator Summary

**One-liner:** 11-step heal pipeline orchestrator integrating all Phase 3 modules with D-09 routing tree, HEA-06 cleanup, and PRI-02 cost pass-through.

## What Was Built

`src/healer/index.ts` — the `run(config: Config): Promise<void>` entry point that replaces the Phase 1 stub. The orchestrator wires all Phase 3 modules together in a numbered-step pipeline:

1. **Dispatch payload validation** — Zod `DispatchPayload.safeParse(inputs)` → `core.setFailed` on invalid input
2. **Provider switch** — `gemini` → `createGeminiAdapter(opts)`; `anthropic`/`ollama` → stub adapters (throw loud per D-01)
3. **Context bundling** — `bundleContext({ testFile, testTitle, cwd, ... })`
4. **PRI-05 sanity rerun** — `validate()` on unmodified code; if `passRate === 0` → `deterministic-failure` issue + return (no adapter call)
5. **Prompt assembly** — `assemblePrompt({ fixClassHint, traceAttachmentPath, testTitle, testFile })`
6. **Adapter execution** — `adapter.runAgent()` → destructures `{ proposal, stats }`. Inner try/catch handles `BudgetExhausted` (routes to `agent-budget-exhausted` issue with `err.usdSpent` / `err.turnsUsed` in body)
7. **NoFixProposable gate** — `'reason' in proposal` → `no-fix-proposable` issue with `formatStatsLine(stats)` in body
8. **Diff-lint gate** — `lintDiff(proposal.diff)` findings → `diff-lint-blocked` issue with stats line
9. **Fix applier** — `applyFix({ diff, defaultBranch, testSlug, shortSha, cwd })` → `{ branch }`
10. **Post-fix validator** — `validate()` again; `passRate < rerunPassRate` → `validation-failed` issue with `stats.usdSpent` / `stats.turnsUsed` in body
11. **PR writer** — `openHealerPr({ ..., costUsd: stats.usdSpent })` — REAL cost data per PRI-02

**try/finally** wraps Steps 2-11; `supervisorStop()` called on every exit path (HEA-06 inner).

## D-09 Routing Tree Coverage

| Failure mode | Trigger | Handler | Stats in body |
|---|---|---|---|
| `app-startup-timeout` | action.yml Step 4 (not orchestrator) | action.yml inline script | N/A |
| `deterministic-failure` | sanity `passRate === 0` | `openIssue` | No (adapter not called) |
| `agent-budget-exhausted` | `BudgetExhausted` thrown | `openIssue` | Yes — `err.usdSpent` / `err.turnsUsed` |
| `no-fix-proposable` | `'reason' in proposal` | `openIssue` | Yes — from `stats` |
| `diff-lint-blocked` | `lintDiff.length > 0` | `openIssue` | Yes — from `stats` |
| `validation-failed` | `passRate < rerunPassRate` | `openIssue` | Yes — from `stats` |
| _(success)_ | all gates pass | `openHealerPr` | `costUsd: stats.usdSpent` |

## Cost Pass-Through Design (PRI-02 / checker BLOCKER #1)

The adapter's revised return contract `{ proposal, stats: { usdSpent, turnsUsed } }` is unpacked at Step 6. From there:

- **Happy path**: `openHealerPr({ ..., costUsd: stats.usdSpent })` — never hardcoded zero
- **BudgetExhausted**: reads `err.usdSpent` / `err.turnsUsed` from the error class properties (Plan 05 `BudgetExhausted` carries them natively)
- **4 remaining failure modes**: `formatStatsLine(stats)` interpolated into `rootCause` or `suggestedManualFix` strings so maintainers see real economics in every healer artifact

No hardcoded `costUsd: 0` anywhere — the PRI-02 regression guard test enforces this.

## BudgetExhausted Stats Access

`BudgetExhausted` (Plan 05) carries `usdSpent` and `turnsUsed` as native class properties. The orchestrator reads them directly on the `instanceof BudgetExhausted` catch path — no wrapping needed. The adapter itself does NOT return stats on the BudgetExhausted path (it throws); the orchestrator surfaces the at-throw snapshot from the error object.

## Test Mocking Strategy

Vitest's `vi.mock()` factories are hoisted to the top of the file before `const` declarations. The 13 tests use `vi.hoisted()` to pre-initialize all mock functions before any `vi.mock()` factory runs. `vi.clearAllMocks()` in `beforeEach` clears call history but NOT implementations — `mockCreateGeminiAdapter.mockReturnValue({ runAgent: mockRunAgent })` is re-applied in `beforeEach` to restore the return value after clearAllMocks.

## Tests Written (13 total)

**D-09 routing tree (8 tests):**
- Invalid payload → `core.setFailed`
- PRI-05 sanity 0/N → `deterministic-failure`, adapter NOT called
- BudgetExhausted → `agent-budget-exhausted` with `$0.5000` / `10 turn` in body
- NoFixProposable → `no-fix-proposable` with `$0.3000` / `8 turn` in suggestedManualFix
- lintDiff findings → `diff-lint-blocked` with `$0.5500` in suggestedManualFix
- passRate < threshold → `validation-failed` with `$0.7700` / `15 turn` in body
- Happy path → `openHealerPr` called with `costUsd: 0.42`
- PRI-02 regression guard → `costUsd` not 0 when `stats.usdSpent > 0`

**HEA-06 inner cleanup (2 tests):**
- `supervisorStop` called on success
- `supervisorStop` called when adapter throws unexpectedly

**Provider switch (3 tests):**
- `anthropic` → stub error propagates, no issue filed
- `ollama` → stub error propagates
- `gemini` → `createGeminiAdapter` called with correct config values

## Deviations from Plan

None — plan executed exactly as written. The only implementation adjustment:
- Used `let proposal!` and `let stats!` with definite-assignment assertions per advisor recommendation, to satisfy TS strict flow analysis without bogus initializers.
- `vi.hoisted()` was needed instead of plain `const` declarations for mock variables (Vitest hoisting semantics — factories run before const initializers).

## Known Stubs

None affecting plan goals. The `anthropicAdapter` and `ollamaAdapter` stubs intentionally throw — documented as Phase 3 scope boundary per D-01. They will be implemented in a later phase.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced beyond what was already planned. The orchestrator delegates all network calls to `openHealerPr` / `openIssue` (Plan 11) which use the Octokit PAT pattern established in Phase 1.

## Self-Check: PASSED

- FOUND: src/healer/index.ts
- FOUND: src/healer/index.test.ts
- FOUND: .planning/phases/03-manual-healer-selectors-waits-issue-fallback/03-12-SUMMARY.md
- FOUND commit c2c568c (feat(03-12): implement run() heal pipeline orchestrator)
- FOUND commit 020d8df (test(03-12): orchestrator routing tree + stats pass-through (13 tests))
- Full test suite: 224 tests passing across 21 test files
