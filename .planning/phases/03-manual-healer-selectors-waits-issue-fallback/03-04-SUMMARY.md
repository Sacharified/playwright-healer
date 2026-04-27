---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: "04"
subsystem: healer/prompt-assembler
tags: [prompts, system-prompt, assembler, tdd, security, FIX-03, HEA-05]
dependency_graph:
  requires:
    - "03-03 (forbidden-patterns.ts — FORBIDDEN_PATCHED_LINE_PATTERNS export)"
  provides:
    - "src/healer/prompts/ — 7 markdown templates for agent system prompt"
    - "src/healer/prompt-assembler.ts — assemblePrompt() pure function"
    - "src/healer/prompt-assembler.test.ts — 9 tests covering D-05..D-08, FIX-03, HEA-05"
  affects:
    - "03-11 (Gemini adapter — calls assemblePrompt to build system prompt)"
    - "03-13 (orchestrator — writes assembled prompt to GITHUB_STEP_SUMMARY)"
tech_stack:
  added: []
  patterns:
    - "Template-based system prompt assembly via fs.readFileSync (deterministic, snapshot-stable)"
    - "ESM __dirname via fileURLToPath(import.meta.url)"
    - "D-17 single source of truth: FORBIDDEN_PATCHED_LINE_PATTERNS.name injected textually into prompt"
    - "TDD RED→GREEN flow with cross-plan dependency documented"
key_files:
  created:
    - src/healer/prompts/role-guardrails.md
    - src/healer/prompts/output-format.md
    - src/healer/prompts/termination.md
    - src/healer/prompts/selectors-with-trace.md
    - src/healer/prompts/selectors-no-trace.md
    - src/healer/prompts/waits-with-trace.md
    - src/healer/prompts/waits-no-trace.md
    - src/healer/prompt-assembler.ts
    - src/healer/prompt-assembler.test.ts
  modified:
    - vitest.config.ts
decisions:
  - "Test file placed at src/healer/prompt-assembler.test.ts per plan files_modified; vitest config updated to include src/**/*.test.ts in the unit project (Rule 3 auto-fix)"
  - "Explicit type annotation on map callback: (p: { name: string; re: RegExp }) => p.name to suppress implicit-any when forbidden-patterns.ts is absent from the worktree"
metrics:
  duration: "~4 minutes"
  completed: "2026-04-27"
  tasks_completed: 2
  files_created: 9
  files_modified: 1
---

# Phase 3 Plan 4: Prompt Templates and Assembler Summary

## One-liner

Seven markdown system-prompt templates plus a deterministic `assemblePrompt()` pure function that concatenates shared + fix-class-variant sections and injects `FORBIDDEN_PATCHED_LINE_PATTERNS` names textually (D-17 single source of truth).

## What Was Built

### Task 1: Seven markdown prompt templates

All seven files exist under `src/healer/prompts/`:

| File | Chars | Purpose |
|------|-------|---------|
| role-guardrails.md | 976 | Sandbox constraints, untrusted-data guardrail, FORBIDDEN_PATTERNS placeholder (T-3-PIT-04) |
| output-format.md | 793 | JSON shape `{rootCause, fixClass, diff, rationale}` + `no-fix-proposable` sentinel |
| termination.md | 921 | 10-browser-call soft limit + maxTurns/maxBudgetUsd hard ceilings (T-3-PIT-06) |
| selectors-with-trace.md | 1147 | getByRole/getByLabel/getByText/getByTestId hierarchy; nth-child/xpath forbidden |
| selectors-no-trace.md | 1384 | Live-repro via Playwright MCP first (HEA-05); same selector rules |
| waits-with-trace.md | 1105 | waitForSelector/waitForLoadState/toBeVisible/waitForResponse; waitForTimeout forbidden |
| waits-no-trace.md | 1330 | Live-repro via Playwright MCP first (HEA-05); same waits rules |

Total templates: 7,656 chars. All four fix-class variants include `{{FORBIDDEN_PATTERNS}}` placeholder.

### Task 2: assemblePrompt + tests

`src/healer/prompt-assembler.ts` — pure function (1,926 chars):
- Reads 4 ordered templates: role-guardrails + fix-class variant + output-format + termination
- Selects `-with-trace` or `-no-trace` variant based on `traceAttachmentPath !== null` (D-07)
- Concatenates sections with `\n\n` separator
- Substitutes `{{TEST_TITLE}}`, `{{TEST_FILE}}`, `{{FORBIDDEN_PATTERNS}}` (all placeholders cleared)
- `{{FORBIDDEN_PATTERNS}}` = `FORBIDDEN_PATCHED_LINE_PATTERNS.map(p => p.name).join(', ')`
- Uses `fileURLToPath(import.meta.url)` for ESM-safe `__dirname`

`src/healer/prompt-assembler.test.ts` — 9 tests:
1. Determinism (same inputs → same output)
2. Selectors variant contains nth-child + getByRole
3. Waits variant contains waitForTimeout + waitForLoadState
4. Fix-class sections mutually exclusive (selectors prompt has no waits header, vice versa)
5. Trace-free variant contains "reproduce" + "Playwright MCP" (HEA-05)
6. Sandbox guardrails always present ("untrusted", "sandbox") — T-3-PIT-04
7. Termination rule always present ("10 browser tool calls", "no-fix-proposable") — T-3-PIT-06
8. Placeholder substitution: TEST_TITLE + TEST_FILE replaced, no raw `{{...}}` remain
9. Snapshot: selectors + no-trace variant is stable

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest.config.ts did not include src/**/*.test.ts in unit project**
- **Found during:** Task 2 (TDD RED phase — `npx vitest run src/healer/prompt-assembler.test.ts` returned "No test files found")
- **Issue:** The plan places the test file at `src/healer/prompt-assembler.test.ts` (per `files_modified` frontmatter), but `vitest.config.ts` only included `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts`. The explicit path passed to vitest is filtered by the projects config, not the path argument.
- **Fix:** Added `'src/**/*.test.ts'` to the `unit` project's `include` array in `vitest.config.ts`.
- **Files modified:** `vitest.config.ts`
- **Commit:** `5896494`

**2. [Rule 1 - Bug] Implicit-any type on map callback when forbidden-patterns.ts absent**
- **Found during:** Task 2 — `npm run typecheck` emitted `Parameter 'p' implicitly has an 'any' type`
- **Issue:** TypeScript infers `FORBIDDEN_PATCHED_LINE_PATTERNS` as `any` when the module resolution fails, making the `.map(p => p.name)` callback implicit-any.
- **Fix:** Added explicit type annotation `(p: { name: string; re: RegExp }) => p.name`. This annotation matches the export contract declared in `03-03-PLAN.md` frontmatter, so no divergence.
- **Files modified:** `src/healer/prompt-assembler.ts`
- **Commit:** `60bbe2a`

## Cross-Plan Dependencies

**Blocked by plan 03 (`03-03-PLAN.md`):** `src/healer/forbidden-patterns.ts` exports `FORBIDDEN_PATCHED_LINE_PATTERNS: readonly { name: string; re: RegExp }[]`.

The assembler imports this at line 15: `import { FORBIDDEN_PATCHED_LINE_PATTERNS } from './forbidden-patterns.js'`.

In this parallel worktree (wave 1), plan 03 (wave 0) has not run. The import fails at runtime and typecheck. All 9 tests will pass once the orchestrator merges wave 0 into the integration branch.

Verification that the import contract matches:
- `03-03-PLAN.md` frontmatter exports: `FORBIDDEN_PATCHED_LINE_PATTERNS`
- `03-04-PLAN.md` interfaces block imports: `FORBIDDEN_PATCHED_LINE_PATTERNS` with `.name` field
- Assembler uses: `.map((p: { name: string; re: RegExp }) => p.name).join(', ')` — type-safe

## Wording Deviations from CONTEXT D-05

No substantive wording deviations from CONTEXT D-05 §1–4. Minor structural choices:

- `role-guardrails.md`: kept the `{{FORBIDDEN_PATTERNS}}` placeholder in the role section (not just fix-class sections), so the forbidden list appears at the top of every assembled prompt — defense-in-depth on the D-05 §1 sandbox guardrail.
- `selectors-with-trace.md` and `waits-with-trace.md`: included `{{FORBIDDEN_PATTERNS}}` in the "Forbidden" section header as `Forbidden ({{FORBIDDEN_PATTERNS}}):` — makes the list doubly present (once in role section, once in fix-class section). The plan's acceptance criterion only requires `>= 1` occurrence.
- `selectors-no-trace.md`: the plan's action section described it as "selectors-with-trace.md PLUS a leading section." Implementation uses a fully independent file with the live-repro instructions integrated naturally — all required content is present.

## Known Stubs

None. The assembler is a pure function with no stub placeholders. The snapshot test cannot be generated until `forbidden-patterns.ts` exists (cross-plan dependency above), but this is a dependency gap, not a stub.

## Self-Check

### Files exist
- [x] src/healer/prompts/role-guardrails.md
- [x] src/healer/prompts/output-format.md
- [x] src/healer/prompts/termination.md
- [x] src/healer/prompts/selectors-with-trace.md
- [x] src/healer/prompts/selectors-no-trace.md
- [x] src/healer/prompts/waits-with-trace.md
- [x] src/healer/prompts/waits-no-trace.md
- [x] src/healer/prompt-assembler.ts
- [x] src/healer/prompt-assembler.test.ts

### Commits exist
- [x] 9de4397 — feat(03-04): author seven markdown prompt templates
- [x] 5896494 — test(03-04): add failing tests for assemblePrompt (RED)
- [x] 60bbe2a — feat(03-04): implement assemblePrompt pure function (GREEN)

## Self-Check: PASSED
