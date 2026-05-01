---
phase: 04-auto-dispatch-full-fix-classes-deduplication
plan: "02"
subsystem: healer-pipeline-fix-classes
tags: [fix-class, prompts, classifier, type-cascade, agent, FIX-07]
dependency_graph:
  requires:
    - 04-01 (DispatchPayload widening + fireDispatch wiring)
  provides:
    - classifyFixClass(errorSignature) → FixClassHint (src/ingest/classifier.ts)
    - VALID_CLASSES allow-list in both adapters' parseFinalText (T-04-04)
    - 4 new prompt templates (assertions+slow × no-trace+with-trace)
    - CFG-04 per-class disable with core.warning at ingest dispatch loop
    - LLM override observability log in healer/index.ts
  affects:
    - src/healer/adapters/github.ts (parseFinalText widened)
    - src/healer/adapters/gemini.ts (parseFinalText widened)
    - src/healer/prompts/output-format.md (fixClass enum widened)
    - src/healer/index.ts (override log inserted after NoFixProposable return)
    - src/ingest/index.ts (Step 9 placeholder replaced with classifyFixClass)
tech_stack:
  added: []
  patterns:
    - VALID_CLASSES.includes() allow-list guard (T-04-04 LLM-controlled field validation)
    - Pure regex-only classifier with static module-scope literals (T-04-04 mitigation)
    - CFG-04 per-class disable via Record<FixClassHint, boolean> map
key_files:
  created:
    - src/ingest/classifier.ts
    - src/ingest/classifier.test.ts
    - src/healer/prompts/assertions-no-trace.md
    - src/healer/prompts/assertions-with-trace.md
    - src/healer/prompts/slow-no-trace.md
    - src/healer/prompts/slow-with-trace.md
  modified:
    - src/healer/adapters/github.ts
    - src/healer/adapters/gemini.ts
    - src/healer/adapters/github.test.ts
    - src/healer/adapters/gemini.test.ts
    - src/healer/prompts/output-format.md
    - src/healer/index.ts
    - src/healer/index.test.ts
    - src/ingest/index.ts
    - src/ingest/index.test.ts
    - src/healer/prompt-assembler.test.ts
    - src/healer/__snapshots__/prompt-assembler.test.ts.snap
decisions:
  - FIX-07 cascade order: adapter.ts FIRST (already done in Plan 01), adapters' parseFinalText follow
  - VALID_CLASSES.includes() guard replaces narrow OR-chain in parseFinalText (T-04-04)
  - classifyFixClass uses static module-scope regex literals — input never reaches RegExp constructor
  - CFG-04 disable emits core.warning (not silent skip) — surfaces operator-actionable signal
  - LLM override log fires BEFORE diff-lint so it appears regardless of patch validity
  - Snapshot update for selectors-no-trace due to output-format.md fixClass widening (Task 1)
  - Plan 03 (PRI-04 dedup) inherits widened OpenHealerPrArgs.fixClass without further widening
metrics:
  duration: "~8 minutes"
  completed: "2026-05-02"
  tasks: 3
  files_created: 6
  files_modified: 11
---

# Phase 04 Plan 02: FIX-07 Full Fix Classes (assertions + slow) Summary

**One-liner:** FIX-07 closed — VALID_CLASSES allow-list widens parseFinalText to 4 classes, `classifyFixClass(errorSignature)` routes ingest dispatches via 4 static regex rules, and 4 new prompt templates (assertions/slow × no-trace/with-trace) complete the class-specific agent guidance chain.

## What Was Built

### Task 1: FIX-07 Type Cascade — parseFinalText + Override Observability

**`src/healer/adapters/github.ts` and `src/healer/adapters/gemini.ts` (MODIFIED)**

Replaced the narrow `(p.fixClass === 'selectors' || p.fixClass === 'waits')` check with:

```typescript
const VALID_CLASSES = ['selectors', 'waits', 'assertions', 'slow'] as const;
type FixClass = typeof VALID_CLASSES[number];
// ...
VALID_CLASSES.includes(p.fixClass as FixClass)
```

T-04-04 mitigation: the LLM-controlled `fixClass` field is validated via an allow-list includes() guard before any cast. Values outside the four are rejected with "Agent JSON does not match FixProposal or NoFixProposable shape".

**`src/healer/prompts/output-format.md` (MODIFIED)**

`"fixClass": "selectors" | "waits"` → `"selectors" | "waits" | "assertions" | "slow"` — the JSON schema the agent reads to know what values it can emit.

**`src/healer/index.ts` (MODIFIED)**

Override observability log inserted after the `if ('reason' in proposal)` no-fix early-return (so `proposal` is narrowed to `FixProposal`):

```typescript
if (proposal.fixClass !== payload.fixClassHint) {
  core.info(
    `Agent overrode fixClassHint: hinted=${payload.fixClassHint}, chose=${proposal.fixClass}`,
  );
}
```

The log fires before diff-lint so it appears in the step log regardless of whether the patch is accepted. This is advisory — the agent has authority to reclassify based on live evidence; the hint is ingest-side best-effort.

**Cascade order applied (load-bearing):**

The types in `adapter.ts`, `prompt-assembler.ts`, and `pr-writer.ts` were already widened in Plan 01 (Rule 1 auto-fix during DispatchPayload widening). This plan completes the cascade at the runtime parser and prompt schema sites.

| Site | Change |
|------|--------|
| `adapter.ts:20` (upstream type) | Done in Plan 01 |
| `dispatch-payload.ts:16` | Done in Plan 01 |
| `prompt-assembler.ts:24` | Done in Plan 01 |
| `pr-writer.ts:23` | Done in Plan 01 |
| `adapters/github.ts parseFinalText` | **Done in this plan (Task 1)** |
| `adapters/gemini.ts parseFinalText` | **Done in this plan (Task 1)** |
| `prompts/output-format.md:8` | **Done in this plan (Task 1)** |

### Task 2: Classifier + Ingest Step 9 Real Implementation

**`src/ingest/classifier.ts` (NEW)**

Pure function `classifyFixClass(errorSignature: string): FixClassHint`:

```typescript
export type FixClassHint = 'selectors' | 'waits' | 'assertions' | 'slow';

const SLOW_RE       = /Test timeout of|Test timed out/i;
const ASSERTIONS_RE = /expect\(received\)|Expected:[\s\S]*Received:|assertion/i;
const WAITS_RE      = /Element is not stable|intercepted/i;
const SELECTORS_RE  = /locator\.|waiting for locator|Target closed/i;

export function classifyFixClass(errorSignature: string): FixClassHint {
  if (SLOW_RE.test(errorSignature))       return 'slow';
  if (ASSERTIONS_RE.test(errorSignature)) return 'assertions';
  if (WAITS_RE.test(errorSignature))      return 'waits';
  if (SELECTORS_RE.test(errorSignature))  return 'selectors';
  return 'selectors'; // fallback — most common class
}
```

Order is load-bearing: `slow` before `assertions` because some Playwright timeout messages contain `expect(...)` substrings. Security invariant: all regexes are static module-scope literals — the input never reaches the `RegExp` constructor (T-04-04).

**`src/ingest/index.ts` Step 9 (MODIFIED)**

Replaced `fixClassHint: 'selectors'` placeholder with the real classifier call and CFG-04 per-class disable check:

```typescript
const latestEntry = latestEntryByTestId.get(detection.testId);
const fixClassHint = classifyFixClass(latestEntry?.errorSignature ?? '');

const enabledFor: Record<typeof fixClassHint, boolean> = {
  selectors:  config.enableSelectorFixes,
  waits:      config.enableWaitFixes,
  assertions: config.enableAssertionFixes,
  slow:       config.enableSlowFixes,
};
if (!enabledFor[fixClassHint]) {
  core.warning(
    `playwright-healer: ${fixClassHint} fix class disabled — skipping dispatch for ${detection.testId}`,
  );
  continue;
}
```

CFG-04 note: `core.warning` (not `core.info`, not silent) — the warning is visible in the GitHub Actions step summary so operators know why a detection was not dispatched.

### Task 3: 4 New Prompt Templates

All four files follow the established skeleton with class-specific guidance:

| Template | Analog | Class-specific guidance |
|----------|--------|------------------------|
| `assertions-no-trace.md` | `selectors-no-trace.md` | Assertion strengthening hierarchy (4 tiers: toHaveText → toHaveValue → state assertions → toHaveAttribute) |
| `assertions-with-trace.md` | `selectors-with-trace.md` | Trace-primary: inspect failing assertion frame → compare expected vs actual → emit no-fix-proposable if racing |
| `slow-no-trace.md` | `waits-no-trace.md` | Slow-test optimization hierarchy (5 tiers: remove redundant goto → tighter timeout → Promise.all → split → beforeAll) |
| `slow-with-trace.md` | `waits-with-trace.md` | Trace bottleneck identification: network+action timeline → test-side vs app-side decision |

Every template includes:
- All 4 placeholders: `{{TEST_TITLE}}`, `{{TEST_FILE}}`, `{{FORBIDDEN_PATTERNS}}`, `{{BASE_URL}}`
- `Forbidden ({{FORBIDDEN_PATTERNS}}):` stanza so the diff-lint allow-list is visible to the LLM (T-04-04 defense-in-depth)

## Cascade Order Applied

The FIX-07 enum widening cascade per PATTERNS §"FIX-07 enum widening cascade":

1. `adapter.ts:20` — **Plan 01 (already done)**
2. `dispatch-payload.ts:16` — **Plan 01 (already done)**
3. `prompt-assembler.ts:24` — **Plan 01 (already done)**
4. `pr-writer.ts:23` — **Plan 01 (already done)**
5. `adapters/github.ts parseFinalText` — **Plan 02 Task 1**
6. `adapters/gemini.ts parseFinalText` — **Plan 02 Task 1**
7. `prompts/output-format.md:8` — **Plan 02 Task 1**

## Plan 03 Inheritance

Plan 03 (PRI-04 dedup) inherits the widened `OpenHealerPrArgs.fixClass` type (already `'selectors' | 'waits' | 'assertions' | 'slow'` from Plan 01) without further widening. The `fixClass` field flows through `pr-writer.ts`'s `renderPrBody` as a display string — no enum check at that site.

## CFG-04 Disable Behavior

`core.warning` (not silent skip) at the ingest dispatch loop:

```
playwright-healer: assertions fix class disabled — skipping dispatch for tests/login.spec.ts::login flow
```

This message appears in the GitHub Actions step summary under the "Run ingest" step. Operators who disabled a fix class see exactly which detections were suppressed and can re-enable via `enable_assertion_fixes: 'true'` in their action input.

## Deviations from Plan

None — plan executed exactly as written. The FIX-07 type cascade at sites 1-4 was pre-applied by Plan 01 as a Rule 1 auto-fix; this plan handled sites 5-7 and the runtime implementations.

## Test Coverage

| File | Tests Added | Coverage |
|------|-------------|----------|
| `src/healer/adapters/github.test.ts` | +3 | assertions accept, slow accept, unknown-class reject |
| `src/healer/adapters/gemini.test.ts` | +3 | same 3 cases for gemini parity |
| `src/healer/index.test.ts` | +2 | override log fires on mismatch; quiet on match |
| `src/ingest/classifier.test.ts` | +9 (new) | all 4 rules + fallback + empty + adversarial input |
| `src/ingest/index.test.ts` | +2 | CFG-04 disable warns + suppresses; classifier output flows to fireDispatch |
| `src/healer/prompt-assembler.test.ts` | +8 | assertions+slow (no-trace+with-trace), placeholder interpolation, Forbidden stanza, snapshots |

**Total new tests: 27** (baseline was 309; full suite now 336)

## Known Stubs

None. All four fix classes are now fully wired end-to-end:
- Classifier maps errorSignature → fixClassHint
- prompt-assembler routes to the correct template
- Both adapters' parseFinalText accept all four values
- CFG-04 disable check prevents dispatch for disabled classes with a warning

## Threat Flags

No new security-relevant surfaces introduced. All security mitigations per the plan's threat model are implemented:
- T-04-04 (LLM-controlled fixClass): VALID_CLASSES.includes() allow-list in both adapters
- T-04-04 (untrusted errorSignature → classifier): static regex literals only, no RegExp(input)
- T-04-04 (prompt placeholders): replaceAll string substitution, no template-engine eval

## Self-Check: PASSED

Files created/exist:
- `src/ingest/classifier.ts` ✓
- `src/ingest/classifier.test.ts` ✓
- `src/healer/prompts/assertions-no-trace.md` ✓
- `src/healer/prompts/assertions-with-trace.md` ✓
- `src/healer/prompts/slow-no-trace.md` ✓
- `src/healer/prompts/slow-with-trace.md` ✓

Commits:
- `900dec0` — Task 1: parseFinalText widening + override log ✓
- `be663e8` — Task 2: classifier + ingest Step 9 replacement ✓
- `d5d9e09` — Task 3: 4 prompt templates + prompt-assembler tests ✓

Verifications:
- `./node_modules/.bin/tsc --noEmit` — clean ✓
- `./node_modules/.bin/vitest run` — 336 passed (29 test files) ✓
- `grep -rn "p.fixClass === 'selectors' || p.fixClass === 'waits'" src/` — ZERO matches ✓
- `grep -nE 'eval|new Function|new RegExp\(' src/ingest/classifier.ts` — ZERO executable matches ✓
- `ls src/healer/prompts/{selectors,waits,assertions,slow}-{no-trace,with-trace}.md` — 8 files ✓
