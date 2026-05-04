---
phase: 04-auto-dispatch-full-fix-classes-deduplication
plan: "05"
subsystem: e2e-verification
tags: [e2e, workflow, concurrency, fixture, assertion-class, manual-uat]
dependency_graph:
  requires:
    - 04-01 (fireDispatch + buildConcurrencyKey + DispatchPayload 8-flat schema)
    - 04-02 (FIX-07 classifier + prompts for assertions/slow)
    - 04-03 (PRI-04 dedup — pr-writer + issue-writer)
    - 04-04 (DET-07 heal-cap Guard 3 + appendHealEvent)
  provides:
    - e2e-heal-self.yml with concurrency block (DET-07 SC #2 runtime implementation)
    - assertion-class fixture (FIX-07 e2e validation scaffold)
    - post-fix validation re-engaged in demo path
    - manual UAT runbook for concurrency + assertion + cap verification
  affects:
    - .github/workflows/e2e-heal-self.yml
    - fixture/tests/broken-assertion.spec.ts
    - fixture/tests/broken-selector.spec.ts (revert to broken form)
tech_stack:
  added: []
  patterns:
    - workflow-level concurrency block keyed on inputs.concurrencyKey
    - assertion-class fixture as TDD RED (intentionally failing spec)
    - sentinel default value for required workflow input (maintainer hand-dispatch convenience)
key_files:
  created:
    - fixture/tests/broken-assertion.spec.ts
  modified:
    - .github/workflows/e2e-heal-self.yml
    - fixture/tests/broken-selector.spec.ts (revert to broken #wrong-id form)
decisions:
  - concurrencyKey has required:true with a constant default sentinel — satisfies DET-07 schema while keeping manual hand-dispatch workable without computing SHA-1
  - cancel-in-progress: false chosen per CONTEXT D-03 (queue not cancel — preserve both runs' detection evidence)
  - concurrency block placed at workflow level (not in action.yml) per RESEARCH Anti-Patterns: GitHub evaluates concurrency at scheduling time, not action-runtime
  - skip_post_fix_validation commented out (not deleted) — one-line revert path for demo rollback
  - broken-assertion.spec.ts uses 'Submission complete' as wrong literal — not a substring of 'Submitted!' so .toContainText weakening would also fail (good gate test)
  - broken-selector.spec.ts restored to #wrong-id form as Rule 3 pre-task fix (UAT Step A requires broken state)
metrics:
  duration: "~20m (automated tasks); UAT pending"
  completed: "2026-05-01"
  tasks: 2 of 3 (Task 3 is checkpoint:human-verify — awaiting maintainer UAT)
  files_created: 1
  files_modified: 2
---

# Phase 04 Plan 05: E2E Verification + Concurrency UAT Summary

**One-liner:** Workflow-level `concurrency:` block keyed on `inputs.concurrencyKey` (DET-07), assertion-class fixture (`'Submission complete'` vs actual `'Submitted!'`), and post-fix validation re-engaged — the three artifacts that let a maintainer verify Plans 01-04 work together on a live GitHub Actions runner.

## What Was Built

### Pre-Task Deviation: Revert broken-selector.spec.ts to broken form

`fixture/tests/broken-selector.spec.ts` was in healed form on this branch (a prior E2E run had merged the fix). Restored to `page.locator('#wrong-id')` as a Rule 3 auto-fix — UAT Step A (selector heal with full gates) requires the fixture to be in broken state for the red-guard job to fail.

**Commit:** `a113d8e`

### Task 1: e2e-heal-self.yml — concurrency block + 8-input schema + validation re-engaged

**Part A — Extended `workflow_dispatch.inputs` to 8 flat inputs:**

Four new inputs added alongside the existing Phase 03 set:
- `flakeRate` (required: false) — optional run-stat for ingest auto-dispatch
- `windowDays` (required: false) — optional run-stat for ingest auto-dispatch
- `runCount` (required: false) — optional run-stat for ingest auto-dispatch
- `concurrencyKey` (required: true, default: `'manual-broken-selector-default'`) — DET-07 key

The sentinel default (`'manual-broken-selector-default'`) allows maintainers to hand-dispatch the fixture workflow without computing the SHA-1 key, while ingest's auto-dispatch always passes the real `buildConcurrencyKey()` result.

**Part B — Concurrency block at workflow level:**

```yaml
concurrency:
  group: playwright-healer-${{ github.repository }}-${{ inputs.concurrencyKey }}
  cancel-in-progress: false
```

Placed after `permissions:` and before `jobs:`. `cancel-in-progress: false` matches CONTEXT D-03 (queue, don't cancel — preserve both runs' evidence). Group key reads `inputs.concurrencyKey` directly — pre-computed by `buildConcurrencyKey()` in ingest, or the sentinel for manual dispatch.

**Part C — Post-fix validation re-engaged:**

`skip_post_fix_validation: 'true'` commented out (not deleted):

```yaml
          # skip_post_fix_validation: 'true'   # REMOVED Phase 04 — validation re-engaged
```

One-line revert path preserved. The deterministic-check skip remains because the broken fixture is intentionally deterministic by design.

**Acceptance criteria verified:**
- `grep -c "^concurrency:" .github/workflows/e2e-heal-self.yml` → 1
- `grep -n "group: playwright-healer-"` → line 64, references `inputs.concurrencyKey`
- `grep -n "cancel-in-progress: false"` → line 65
- `grep -nE "concurrencyKey:"` → 2 matches (input declaration + concurrency group)
- No active `skip_post_fix_validation: 'true'` lines
- YAML validates cleanly via `js-yaml` (clean JSON representation produced)

**Commit:** `04b1856`

### Task 2: fixture/tests/broken-assertion.spec.ts — assertion-class fixture (TDD RED)

Assertion-class fixture created following the plan spec exactly:

- **Selector:** `page.getByRole('button', { name: 'Submit' })` — resolves correctly to the `<button id="correct-id">Submit</button>` in `fixture/index.html:9`
- **Click:** succeeds — `#message` element becomes `<p id="message">Submitted!</p>`
- **Assertion bug:** `expect(page.locator('#message')).toHaveText('Submission complete')` — wrong literal; actual rendered text is `'Submitted!'` (WITH bang per `fixture/index.html:13`)
- **Test title:** `'clicks submit button and sees assertion confirmation'` — distinct from broken-selector title, ensuring different concurrency keys

**Empirically verified failure shape:**

```
Error: expect(locator).toHaveText(expected) failed
Locator:  locator('#message')
Expected: "Submission complete"
Received: "Submitted!"
Timeout:  5000ms
```

Failure is on the `expect(...)` line (line 30), NOT on the `click()` line — confirms assertion-class, not selector-class. The error message contains `expect` and `toHaveText`, matching the classifier's `assertions` substring rules.

**Correct fix the agent should propose:** Change `'Submission complete'` → `'Submitted!'`. Must NOT weaken to `.toContainText('Submitted')` or remove the assertion (diff-lint would block weakening).

**TDD gate:** RED commit (`test(04-05)`) made before any implementation consideration — this spec is the implementation; it stays broken by design.

**Commit:** `4cf32a1`

## Updated e2e-heal-self.yml Shape

The workflow now has:
- 8-flat-input schema matching `DispatchPayload` Zod schema 1:1
- `concurrency:` block (DET-07 SC #2 runtime implementation)
- `skip_post_fix_validation` commented out (validation re-engaged)
- `skip_deterministic_check: 'true'` retained (broken fixture is deterministic by design)
- `skip_diff_lint: 'false'` retained (explicit, defense-in-depth)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restore broken-selector.spec.ts to broken form**
- **Found during:** Pre-task orientation
- **Issue:** `fixture/tests/broken-selector.spec.ts` was in healed form (`getByRole` locator) on this branch from a prior E2E run merge. UAT Step A requires the red-guard job to fail — impossible with the healed form.
- **Fix:** Restored to `page.locator('#wrong-id')` using the content from commit `9bdc188` (original broken form).
- **Files modified:** `fixture/tests/broken-selector.spec.ts`
- **Commit:** `a113d8e`

### Design Choices Surfaced (Not Deviations)

**Assertion-class dispatch as separate workflow input (not a new job in e2e-heal-self.yml):**

The plan notes (Task 1, Part D) that the assertion-class dispatch should NOT add a new job to `e2e-heal-self.yml` — keep the workflow focused on a single dispatch shape. The assertion-class fixture (`fixture/tests/broken-assertion.spec.ts`) is dispatched via the same job graph by passing `testFile='fixture/tests/broken-assertion.spec.ts'` and `fixClassHint='assertions'` as inputs to the existing `e2e-heal-self.yml` workflow. This is the intended UAT Step B mechanism.

## Manual UAT Runbook (Task 3 — CHECKPOINT)

Task 3 is a `checkpoint:human-verify` gate. The automated file-change tasks (Tasks 1-2) are complete and committed. Remaining verification requires a live GitHub Actions runner.

### Pre-flight Checklist

- [ ] Push this branch to GitHub: `git push origin playwright-healer/clicks-submit-button-and-sees-confirmation-5c12678`
- [ ] Confirm repo secrets set at `/settings/secrets/actions`: `GEMINI_API_KEY` and `HEALER_PAT` (PAT with `repo` scope)
- [ ] Confirm `fixture/tests/broken-selector.spec.ts` shows `page.locator('#wrong-id')` (restored in commit `a113d8e`)

### Step A — Selector heal with full gates engaged

```bash
gh workflow run e2e-heal-self.yml \
  -F testFile='fixture/tests/broken-selector.spec.ts' \
  -F testTitle='clicks submit button and sees confirmation' \
  -F fixClassHint='selectors' \
  -F concurrencyKey='manual-selector-uat-1'
```

Watch: `gh run watch`

Expected: all 3 jobs green; healer PR opens with `fixClass: selectors`; post-fix validation shows actual pass-rate (NOT "skipped").

### Step B — Assertion-class heal

```bash
gh workflow run e2e-heal-self.yml \
  -F testFile='fixture/tests/broken-assertion.spec.ts' \
  -F testTitle='clicks submit button and sees assertion confirmation' \
  -F fixClassHint='assertions' \
  -F concurrencyKey='manual-assertion-uat-1'
```

Expected: red-guard fails as designed; heal job classifies as `assertions`; PR diff corrects `'Submission complete'` → `'Submitted!'` without weakening to `.toContainText`.

### Step C — Concurrency queue verification (DET-07 SC #2)

```bash
gh workflow run e2e-heal-self.yml \
  -F testFile='fixture/tests/broken-selector.spec.ts' \
  -F testTitle='clicks submit button and sees confirmation' \
  -F fixClassHint='selectors' \
  -F concurrencyKey='uat-c-key' &
gh workflow run e2e-heal-self.yml \
  -F testFile='fixture/tests/broken-selector.spec.ts' \
  -F testTitle='clicks submit button and sees confirmation' \
  -F fixClassHint='selectors' \
  -F concurrencyKey='uat-c-key' &
wait
```

Then: `gh run list --workflow=e2e-heal-self.yml --limit 5 --json status,conclusion,createdAt,databaseId,event`

Expected: TWO runs; ONE `in_progress` or `completed`, OTHER `queued`.

### Step D — Heal-cap verification (optional)

After 3+ heal events for the same test, dispatch a 4th. Expected: `cap-exceeded` issue opens; no new PR.

## Test Count

- Vitest: 403 tests pass (unchanged — workflow/fixture changes don't affect vitest)
- Playwright fixture: `broken-assertion.spec.ts` fails with correct assertion-class error shape (intentional — this IS the red-guard behavior)

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `a113d8e` | revert | Restore broken-selector.spec.ts to #wrong-id form (Rule 3 pre-task) |
| `04b1856` | feat | Task 1 — e2e-heal-self.yml concurrency block + 8-input schema |
| `4cf32a1` | test | Task 2 — assertion-class fixture (TDD RED) |

## Known Stubs

None — all implemented artifacts are complete. UAT verification (Task 3) is pending human execution on a live runner.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes beyond the workflow inputs declared in Task 1 (covered by T-04-04 in the plan's threat model).

## Phase 04 Close-Out Checklist

| SC | Description | Status | Evidence |
|----|-------------|--------|---------|
| SC #1 | Auto-dispatch fires from threshold breach | PASSED (unit tests) | Plan 01 ingest/dispatch.test.ts 9 tests + ingest/index.test.ts Step 9 tests |
| SC #2 | Concurrency block queues simultaneous dispatches | PENDING UAT | Workflow block committed in `04b1856` — UAT Step C required for runtime verification |
| SC #3 | Assertion-class fix triggers from real assertion bug | PENDING UAT | Fixture committed in `4cf32a1` — UAT Step B required for live LLM + runner verification |
| SC #4 | Re-trigger comments on existing PR/issue, no duplicate | PASSED (unit tests) | Plan 03 pr-writer.test.ts + issue-writer.test.ts dedup tests |

## Self-Check: PASSED (partial — UAT pending)

- `.github/workflows/e2e-heal-self.yml` exists and has `concurrency:` block ✓
- `fixture/tests/broken-assertion.spec.ts` exists ✓
- `fixture/tests/broken-selector.spec.ts` has `#wrong-id` locator ✓
- 403 vitest tests pass ✓
- Playwright fixture test fails with assertion-class error shape ✓
- All 3 commits exist in git log ✓
- UAT Steps A-D: PENDING (Task 3 checkpoint)
