---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: 15
subsystem: healer-adapters
tags: [security-contract, gemini-adapter, gap-closure, ME-01, ME-03, LO-01]
dependency_graph:
  requires: [03-12]
  provides: [MCP_PLAYWRIGHT_TOOL_PREFIX constant, systemInstruction isolation, single mcpToTool lifecycle]
  affects: [src/healer/adapters/gemini.ts, src/shared/security-contract.ts]
tech_stack:
  added: []
  patterns: [security-contract single-source-of-truth, system-role isolation, one-time MCP transport init]
key_files:
  created: []
  modified:
    - src/shared/security-contract.ts
    - .planning/security-contract.snapshot.json
    - src/healer/adapters/gemini.ts
decisions:
  - MCP_PLAYWRIGHT_TOOL_PREFIX = 'browser_' as const added to security-contract.ts per D-13; all adapter code must import rather than inline the pattern
  - systemPrompt moved to config.systemInstruction (true system role) to prevent co-location of security guardrails with potentially page-injected user-turn content (PITFALLS §4)
  - mcpCallable initialized once before the agent loop — one-time setup per @google/genai docs; per-turn re-init was a latent handle-leak
metrics:
  duration: ~8m
  completed: "2026-04-27T12:40:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 03 Plan 15: Gemini Adapter Hardening (ME-01, ME-03, LO-01) Summary

**One-liner:** Security-contract single-source-of-truth for MCP tool prefix, systemPrompt promoted to true system role via `systemInstruction`, and MCP transport initialized once before the agent loop.

## What Was Built

Gap-closure plan closing three medium/low adapter issues identified in the Phase 03 code review:

- **ME-01 (D-13 violation):** The inline `'browser_*'` glob literal in the Gemini adapter's audit invariant was outside `security-contract.ts`, making the full MCP tool-name surface impossible to audit from a single file. Fix: added `MCP_PLAYWRIGHT_TOOL_PREFIX = 'browser_' as const` to security-contract.ts; updated the snapshot; replaced the `globMatch('browser_*', ...)` call with `tool.name.startsWith(MCP_PLAYWRIGHT_TOOL_PREFIX)`.
- **ME-03 (injection risk):** The systemPrompt (security guardrails, sandbox constraints, forbidden patterns) was concatenated into the user-role content as `initialUserText`. The Google GenAI SDK supports `config.systemInstruction` for true system-role isolation. Fix: dropped `initialUserText`; contents array now contains only `contextSummary`; `systemInstruction: systemPrompt` added to the generateContent config.
- **LO-01 (resource leak):** `mcpToTool(mcpClient)` was called twice per loop iteration — once in `config.tools` and again as `const callable = mcpToToolFn(mcpClient)`. Fix: `mcpCallable` initialized once before the `while (true)` loop; loop body uses `mcpCallable.callTool(functionCalls)`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add MCP_PLAYWRIGHT_TOOL_PREFIX to security-contract.ts + update snapshot | d7f1b49 | src/shared/security-contract.ts, .planning/security-contract.snapshot.json |
| 2 | Harden Gemini adapter — import prefix constant, systemInstruction isolation, single mcpToTool init | ceba54e | src/healer/adapters/gemini.ts |

## Verification Results

- `npm run typecheck`: exit 0
- `npm test`: 230/230 tests passed (22 test files)
- All grep verifications passed:
  - `MCP_PLAYWRIGHT_TOOL_PREFIX` exported from security-contract.ts
  - `mcpPlaywrightToolPrefix` in snapshot
  - `MCP_PLAYWRIGHT_TOOL_PREFIX` imported and used in gemini.ts
  - No `'browser_*'` inline literal in gemini.ts
  - `systemInstruction: systemPrompt` present in generateContent config
  - `initialUserText` removed
  - `const mcpCallable` declared before `while (true)` loop
  - `const callable = mcpToToolFn(mcpClient)` (in-loop duplicate) removed

## Deviations from Plan

None — plan executed exactly as written. No test mock updates were needed (existing tests mock the `_mcpToTool` injection point and were not sensitive to the structural restructuring performed).

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Changes are internal adapter refactoring and security-contract additions. The threat model in the plan covers all affected surfaces.

## Known Stubs

None.

## Self-Check: PASSED

Files exist:
- FOUND: src/shared/security-contract.ts (contains MCP_PLAYWRIGHT_TOOL_PREFIX)
- FOUND: .planning/security-contract.snapshot.json (contains mcpPlaywrightToolPrefix)
- FOUND: src/healer/adapters/gemini.ts (contains systemInstruction + mcpCallable)

Commits exist:
- FOUND: d7f1b49 (Task 1 — security-contract + snapshot)
- FOUND: ceba54e (Task 2 — Gemini adapter hardening)
