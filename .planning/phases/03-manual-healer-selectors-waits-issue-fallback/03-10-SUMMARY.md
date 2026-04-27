---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: 10
subsystem: healer/adapters
tags: [gemini, adapter, security, budget, mcp, FIX-01, FIX-02, FIX-04, SEC-03, SEC-04, PRI-02]
dependency_graph:
  requires:
    - 03-02 (adapter.ts interface — FixProposal, NoFixProposable, AgentRunStats, Adapter)
    - 03-04 (types.ts — ContextBundle)
    - 03-05 (budget.ts — BudgetTracker, BudgetExhausted)
    - 01-xx (security-contract.ts — ALLOWED_TOOLS, ALLOWED_ORIGIN_TEMPLATE)
  provides:
    - src/healer/adapters/gemini.ts (createGeminiAdapter factory satisfying Adapter interface)
  affects:
    - 03-12 (orchestrator consumes createGeminiAdapter; stats.usdSpent/turnsUsed threaded into PR/issue bodies)
    - 03-13 (issue-creator consumes BudgetExhausted.usdSpent/turnsUsed for agent-budget-exhausted body)
tech_stack:
  added:
    - "@google/genai@1.50.1 — mcpToTool, GoogleGenAI, Content, Part types"
    - "@modelcontextprotocol/sdk@1.29.0 — Client, StdioClientTransport"
  patterns:
    - "Manual tool-use loop (while true + assertCanProceed pre-call gate)"
    - "Injection-based test mocking via factory opts (_GoogleGenAI, _Client, _StdioClientTransport, _mcpToTool)"
    - "D-03 audit invariant (two-step: ALLOWED_TOOLS glob + browser_* convention)"
key_files:
  created:
    - src/healer/adapters/gemini.ts
    - src/healer/adapters/gemini.test.ts
  modified: []
decisions:
  - "Audit invariant implemented as two-step check (see Deviation 1): canonical form must match ALLOWED_TOOLS glob AND raw tool.name must match browser_* — single-step was insufficient"
  - "Injection-based mocking chosen over vi.mock: avoids ESM hoisting brittleness in vitest 4 with native modules; factory opts (_GoogleGenAI etc.) are explicit and type-safe"
  - "BudgetExhausted re-thrown unchanged: Plan 05 already ships BudgetExhausted with usdSpent/turnsUsed fields — no thin local subclass needed"
  - "stats: { usdSpent: budget.usdSpent, turnsUsed: budget.turnsUsed } on every return path — no hardcoded zeros"
metrics:
  duration: "~15 minutes"
  completed_date: "2026-04-27"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 03 Plan 10: Gemini Adapter Summary

**One-liner:** Gemini adapter with `@google/genai@1.50.1` manual tool-use loop, `mcpToTool` MCP integration, two-step D-03 audit invariant, BudgetTracker pre-call gate, and real cost stats pass-through via `budget.usdSpent`/`budget.turnsUsed`.

## What Was Built

`src/healer/adapters/gemini.ts` exports:
- `createGeminiAdapter(opts: GeminiAdapterOpts): Adapter` — the factory used by the orchestrator (Plan 12)
- `geminiAdapter: Adapter` — a default sentinel that throws if called without configuration
- `BudgetExhausted` — re-exported so callers can catch it from this module

The adapter implements the full heal pipeline for Gemini:

1. **SEC-03**: Spawns `@playwright/mcp@0.0.70` via `StdioClientTransport` with `--allowed-origins=${baseUrl};http://localhost:*` (SEMICOLON-joined per Playwright MCP README). The origins array comes from `ALLOWED_ORIGIN_TEMPLATE(baseUrl)`.

2. **SEC-04 / D-03 audit invariant (two-step — see Deviation 1)**: Calls `mcpClient.listTools()` and for each tool verifies: (a) canonical form `mcp__playwright__<name>` matches a glob in `ALLOWED_TOOLS`, AND (b) raw `tool.name` matches `browser_*`. Throws before any `generateContent` call if either fails.

3. **FIX-02 budget gate**: `BudgetTracker.assertCanProceed()` is called at the top of every while-loop iteration before `generateContent`. `BudgetTracker.recordUsage(response.usageMetadata)` is called after each successful response.

4. **FIX-04 result parsing**: `parseFinalText` strips Markdown code fences (``` ```json ... ``` ```) before JSON parsing. Returns `FixProposal` if `rootCause`, `fixClass`, `diff`, `rationale` are present; returns `NoFixProposable` if `reason === 'no-fix-proposable'` and `evidence` are present; throws otherwise.

5. **PRI-02 stats pass-through**: Every successful return includes `stats: { usdSpent: budget.usdSpent, turnsUsed: budget.turnsUsed }` — sourced DIRECTLY from the BudgetTracker, no hardcoded zeros.

6. **HEA-06 cleanup**: `mcpClient.close()` is called in a `try/finally` block wrapping the entire loop, ensuring cleanup on success, `BudgetExhausted`, and any other error.

`src/healer/adapters/gemini.test.ts` contains 13 tests across 5 describe blocks covering all security invariants and behavioral requirements.

## Plan Output Questions (from `<output>` block)

### 1. Deviations from RESEARCH §Pattern 1

**One deviation:** The RESEARCH §Pattern 1 loop uses `(response as any).functionCalls` — the installed `@google/genai@1.50.1` exposes `functionCalls` as a real getter on `GenerateContentResponse` (verified against `dist/genai.d.ts`), so the `as any` cast was replaced with a direct property access.

The tool execution sequence matches RESEARCH §Pattern 1 verbatim: `mcpToTool(mcpClient)` called per-turn to get the callable, `callable.tool()` to initialize the side-effect, then `callable.callTool(functionCalls)` to execute.

### 2. Test mocking strategy (injection vs vi.mock)

**Injection-based mocking** via `GeminiAdapterOpts._GoogleGenAI / _Client / _StdioClientTransport / _mcpToTool`. The factory opts accept optional constructor/function overrides that default to the real production imports when absent.

**Why not vi.mock:** ESM hoisting of `vi.mock` for native packages (`@google/genai`, `@modelcontextprotocol/sdk`) is brittle in vitest 4 — the mock factory runs before imports are resolved, causing race conditions with ESM-native packages. Explicit injection is type-safe, readable, and avoids the hoisting problem entirely.

### 3. Audit invariant exact match logic

The audit invariant performs a **two-step check** for each tool returned by `listTools()`:

```
canonical = `mcp__playwright__${tool.name}`
covered = ALLOWED_TOOLS.some(p => globMatch(p, canonical))
       && globMatch('browser_*', tool.name)
```

`globMatch(pattern, name)` converts the glob to a regex: escapes regex metacharacters, then replaces `*` with `.*`, wrapping in `^...$`. This handles `mcp__playwright__*` → `^mcp__playwright__.*$`.

The two-step check was necessary because `mcp__playwright__*` is too broad — it would match `mcp__playwright__filesystem_write` (a rogue tool after prefixing), defeating the purpose of the audit. The additional `browser_*` check on the raw name enforces that only actual Playwright browser tools (which all start with `browser_`) pass. See Deviation 1 below.

### 4. Stats on BudgetExhausted throw path

**Plan 05 already ships the stats-carrying form.** `BudgetExhausted` in `budget.ts` carries `readonly usdSpent: number` and `readonly turnsUsed: number` set from the tracker's state at throw time. No thin local subclass was needed — the adapter simply re-throws what `assertCanProceed()` emits. Plan 12 orchestrator catches `BudgetExhausted` and reads `err.usdSpent` / `err.turnsUsed` directly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Audit invariant was insufficient — any tool name passed after prefixing**

- **Found during:** Task 2 (test writing — test #2 "rogue tool throws" failed)
- **Issue:** The original audit checked `canonical = mcp__playwright__${tool.name}` against `ALLOWED_TOOLS` glob `mcp__playwright__*`. Since the glob matches ANY string after the prefix, `mcp__playwright__filesystem_write` passed — the audit was a no-op for detecting rogue tools.
- **Fix:** Added a second condition: `tool.name` must also match `browser_*` (the Playwright MCP naming convention). Together the two conditions correctly reject `filesystem_write` (fails `browser_*`) while passing `browser_navigate` and `browser_click` (both satisfy both checks).
- **Files modified:** `src/healer/adapters/gemini.ts` (lines 95-110)
- **Commits:** `a67b669` (fix: strengthen audit invariant)

## Known Stubs

None. All exports are fully implemented. The `geminiAdapter` sentinel is intentional (throws with a helpful message directing callers to use `createGeminiAdapter(opts)`).

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes beyond what the plan's threat model (`T-3-SEC-03`, `T-3-SEC-04`, `T-3-FIX-02`, `T-3-PRI-02`) already covers.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `src/healer/adapters/gemini.ts` exists | FOUND |
| `src/healer/adapters/gemini.test.ts` exists | FOUND |
| Commit `65921b6` (feat) exists | FOUND |
| Commit `a67b669` (fix) exists | FOUND |
| Commit `f9551ef` (test) exists | FOUND |
| 13 tests pass | PASSED |
| typecheck exits 0 | PASSED |
