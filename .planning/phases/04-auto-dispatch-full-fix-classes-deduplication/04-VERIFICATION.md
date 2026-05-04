---
phase: 04-auto-dispatch-full-fix-classes-deduplication
verified: 2026-05-02T03:00:00Z
status: human_needed
score: 4/4
overrides_applied: 0
human_verification:
  - test: "SC#4 (PRI-04 dedup) post-fix re-verification — HIGHEST PRIORITY"
    expected: "A second dispatch for the same broken-selector fixture produces a comment on the existing open issue (not a new issue or PR). The HTTP 422 errors observed during Step A (3 duplicate issues #7, #9, #11) must not recur now that HEALER_TOKEN threading is in place."
    why_human: "Dedup paths (findExistingOpenIssue, findExistingOpenPr) execute via Octokit GitHub API. Static analysis confirms the search query strings and comment-on-existing branches exist. But Step A live run produced 3 duplicate artifacts before the fix — no subsequent live run has re-verified the fixed dedup path against a real repo state."
  - test: "SC#1 (DET-05/06) threshold-triggered auto-dispatch"
    expected: "When ingest processes a Playwright JSON report whose rolling flake-rate exceeds config.flakeRateThreshold with enableAutoDispatch=true, Step 9 in src/ingest/index.ts calls fireDispatch without human intervention. The dispatched workflow run appears in the Actions tab with correct inputs."
    why_human: "Only manual dispatch has been demonstrated (Step A). The enableAutoDispatch flag defaults to false. A live ingest run with a real threshold breach is required to prove the auto-dispatch path fires correctly."
  - test: "SC#2 (DET-07) concurrent dispatch queue"
    expected: "Two simultaneous dispatches with the same concurrencyKey produce one in_progress run and one queued run — not two parallel runs."
    why_human: "Step C was deferred in UAT. The concurrency block exists with correct structure, but GitHub's concurrency queueing behavior can only be confirmed with a live parallel dispatch."
  - test: "SC#3 (FIX-07) assertion-class LLM heal"
    expected: "A dispatch with fixClassHint=assertions produces a diff that changes 'Submission complete' to match fixture/index.html, does NOT weaken the assertion (no .toContainText, no removal), and fixClass passes VALID_CLASSES validation."
    why_human: "Step B was deferred in UAT. Prompt templates and VALID_CLASSES allow-list exist, but LLM fix quality and assertion-class prompt routing are behavioral — requires a live run."
---

# Phase 04: Auto-Dispatch + Full Fix Classes + Deduplication — Verification Report

**Phase Goal:** Threshold-triggered dispatch; all 4 fix classes (selectors, waits, assertions, slow); deduplication prevents duplicate PRs/issues.
**Verified:** 2026-05-02T03:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

All 4 must-haves are verified at the static layer (code exists, is substantive, and is wired; 403/403 unit tests pass). None of the 4 success criteria have live behavioral demonstration — Steps B/C/D were explicitly deferred in 04-05-HUMAN-UAT.md. SC#4 additionally has direct empirical evidence of live failure before a code fix was applied (3 duplicate issues during Step A), making it the highest-priority human test.

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                       | Status      | Evidence                                                                                                                                   |
|----|-------------------------------------------------------------------------------------------------------------|-------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | Ingest auto-dispatches healer workflow when flake threshold is breached (SC#1 / DET-05, DET-06)             | ✓ VERIFIED  | `src/ingest/index.ts` Step 9: `if (config.enableAutoDispatch && detections.length > 0)` loop calls `fireDispatch` via PAT Octokit          |
| 2  | Concurrency key prevents duplicate parallel runs (SC#2 / DET-07)                                           | ✓ VERIFIED  | `buildConcurrencyKey` (slug-slug-sha1(8), max 90 chars) in `dispatch.ts`; concurrency block in `e2e-heal-self.yml` lines 63–67             |
| 3  | All 4 fix classes routable with per-class prompts, classifier, and per-class CFG-04 disable toggles (SC#3 / FIX-07) | ✓ VERIFIED  | `classifier.ts` (4 regex rules + priority order + fallback); 8 prompt templates in `src/healer/prompts/`; `VALID_CLASSES` in both adapters |
| 4  | Dedup prevents duplicate PR/issue; existing open artifact gets a comment (SC#4 / PRI-04)                   | ✓ VERIFIED  | `findExistingOpenPr` and `findExistingOpenIssue` exist and are wired before create paths; NOTE: observed failing live in Step A before HEALER_TOKEN fix — post-fix live re-verification required (see SC#4 human item) |

**Score:** 4/4 truths verified at the static layer. All 4 require live behavioral demonstration — see Human Verification Required section. SC#4 is additionally flagged for post-fix re-verification due to observed Step A failure.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ingest/dispatch.ts` | fireDispatch + buildConcurrencyKey + recordCapHit | ✓ VERIFIED | All three exports present; PAT Octokit, 8-input shape, Pitfall 1 length guard |
| `src/ingest/classifier.ts` | classifyFixClass with 4 regex rules | ✓ VERIFIED | SLOW_RE, ASSERTIONS_RE, WAITS_RE, SELECTORS_RE; priority slow > assertions > waits > selectors; fallback 'selectors' |
| `src/healer/pr-writer.ts` | PRI-04 dedup — findExistingOpenPr + commentOnPr | ✓ VERIFIED | `pulls.list({ state:'open', head:'${owner}:${branch}' })` (Pitfall 3 owner:branch format); comment-on-hit before create |
| `src/healer/issue-writer.ts` | PRI-04 dedup — findExistingOpenIssue + comment | ✓ VERIFIED | Search includes `is:issue is:open`, `in:body "${failureMode}"`; safeTitle quote-neutralization (T-04-04) |
| `src/healer/index.ts` | Step 1.5 Guard 3 (cap-exceeded) + HealEvent write sites | ✓ VERIFIED | bootstrapOrGetWorktree → shouldSkipHeal → cap-exceeded branch; 3 appendHealEvent call sites; non-fatal bootstrap; finally cleanup |
| `src/ingest/index.ts` | Step 9 auto-dispatch loop with D-04 pre-check and CFG-04 toggles | ✓ VERIFIED | enableAutoDispatch gate; countHealsForTest before fireDispatch; enabledFor[fixClassHint] map check with core.warning |
| `src/shared/config.ts` | enableAutoDispatch + healerWorkflowFile config fields | ✓ VERIFIED | Lines 116–120; `z.string().default('false').transform(v => v === 'true')` |
| `action.yml` | enable_auto_dispatch + healer_workflow_file inputs + env pass-through | ✓ VERIFIED | Lines 128, 132 (inputs); lines 266–267 (INPUT_* env vars) |
| `src/healer/prompts/` | 8 templates: 4 fix classes × no-trace/with-trace | ✓ VERIFIED | selectors, waits, assertions, slow × no-trace/with-trace all present |
| `src/healer/prompt-assembler.ts` | Routes to ${fixClassHint}-${traceTag}.md; type widened to 4 values | ✓ VERIFIED | Type union widened; template path construction routes correctly |
| `src/healer/adapters/github.ts` | VALID_CLASSES allow-list | ✓ VERIFIED | `const VALID_CLASSES = ['selectors', 'waits', 'assertions', 'slow'] as const`; `VALID_CLASSES.includes(...)` guard |
| `src/healer/adapters/gemini.ts` | VALID_CLASSES allow-list | ✓ VERIFIED | Same pattern as github.ts adapter |
| `src/healer/dispatch-payload.ts` | fixClassHint enum widened + concurrencyKey required + flat run stats | ✓ VERIFIED | `z.enum(['selectors', 'waits', 'assertions', 'slow'])`; `concurrencyKey: z.string().min(1)`; flat flakeRate/windowDays/runCount |
| `src/shared/state-branch.ts` | appendHealEvent + todayHealPath | ✓ VERIFIED | todayHealPath returns `runs/YYYY/MM/DD-heals.ndjson`; appendHealEvent mirrors appendRecord retry loop with [skip-healer] sentinel |
| `.github/workflows/e2e-heal-self.yml` | Concurrency block on concurrencyKey + 8 inputs + Job 3 accepts PR or issue | ✓ VERIFIED | concurrency.group keyed on `github.event.inputs.concurrencyKey`; cancel-in-progress: false; Job 3 renamed assert-artifact-opened |
| `fixture/tests/broken-assertion.spec.ts` | Assertion-class UAT fixture | ✓ VERIFIED | File exists at `fixture/tests/broken-assertion.spec.ts` (confirmed via filesystem check) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/ingest/index.ts` Step 9 | `src/ingest/dispatch.ts` fireDispatch | import + conditional call | ✓ WIRED | enableAutoDispatch gate calls `fireDispatch(args)` inside detection loop |
| `fireDispatch` | GitHub Actions API | `new Octokit({ auth: args.patToken })` | ✓ WIRED | PAT Octokit; `actions.createWorkflowDispatch` |
| `action.yml` enable_auto_dispatch | `src/shared/config.ts` enableAutoDispatch | `INPUT_ENABLE_AUTO_DISPATCH` env var | ✓ WIRED | action.yml line 266; config.ts reads via `core.getInput` |
| `src/ingest/index.ts` | `src/ingest/classifier.ts` classifyFixClass | import + call per detection | ✓ WIRED | `classifyFixClass(latestEntry?.errorSignature ?? '')` called before fireDispatch |
| `src/healer/index.ts` | `src/shared/state-branch.ts` bootstrapOrGetWorktree | import + Step 1.5 | ✓ WIRED | Guard 3 bootstrap then shouldSkipHeal; non-fatal inner try/catch; finally cleanup |
| `src/healer/pr-writer.ts` openHealerPr | findExistingOpenPr before create | dedup check | ✓ WIRED | Dedup query fires; on hit → commentOnPr + return existing url |
| `src/healer/issue-writer.ts` openIssue | findExistingOpenIssue before create | dedup check | ✓ WIRED | Dedup query fires; on hit → comment; on miss → create |
| `e2e-heal-self.yml` concurrency block | GitHub concurrency queue | `group: playwright-healer-{repo}-{concurrencyKey}` | ✓ WIRED (static) | Block present and correctly structured; live behavior not tested (Step C deferred) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/ingest/index.ts` Step 9 | `detections` array | `evaluateThresholds(records)` from state branch NDJSON | Real detection objects from rolling-window calculation | ✓ FLOWING |
| `src/ingest/dispatch.ts` fireDispatch | `inputs` dispatch payload | `buildDispatchInputs(detection, fixClassHint, concurrencyKey, config)` | Real detection fields threaded to workflow inputs | ✓ FLOWING |
| `src/healer/pr-writer.ts` findExistingOpenPr | `data` (PR list) | `octokit.rest.pulls.list(...)` | Real GitHub API response | ⚠️ STATIC-RISK — HEALER_TOKEN auth gap fixed post-Step-A; not re-verified live |
| `src/healer/issue-writer.ts` findExistingOpenIssue | `data` (search results) | `octokit.rest.search.issuesAndPullRequests(...)` | Real GitHub API response | ⚠️ STATIC-RISK — HTTP 422 observed during Step A; fix applied; not re-verified live |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — The action runs inside GitHub Actions runners. No local entrypoint serves live dispatch or GitHub API calls. Unit tests (403/403 passing per 04-05-SUMMARY.md) cover conditional branches but cannot replace live runner execution.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DET-05 | 04-01-PLAN.md | Ingest dispatches healer workflow on threshold breach | ✓ SATISFIED | Step 9 in `src/ingest/index.ts`; `fireDispatch` with Octokit; `enableAutoDispatch` gate |
| DET-06 | 04-01-PLAN.md | PAT (not GITHUB_TOKEN) used for dispatch to enable downstream CI | ✓ SATISFIED | `new Octokit({ auth: args.patToken })`; `config.healerToken` threaded from `INPUT_HEALER_TOKEN` |
| DET-07 | 04-01-PLAN.md | Deterministic concurrency key per (testFile, testTitle) prevents duplicate runs | ✓ SATISFIED | `buildConcurrencyKey`: slug(40)-slug(40)-sha1(8), max 90 chars; concurrency block in e2e-heal-self.yml |
| FIX-07 | 04-03-PLAN.md | All 4 fix classes routable with per-class prompts, classifier, and CFG-04 disable toggles | ✓ SATISFIED | `classifier.ts` (4 regex rules); 8 prompt templates; VALID_CLASSES in both adapters; `enabledFor` map in ingest |
| PRI-04 | 04-04-PLAN.md | Dedup: comment on existing open PR/issue instead of creating duplicate | ✓ SATISFIED (static) | Code paths exist in pr-writer.ts and issue-writer.ts; 3 duplicate issues during Step A before token fix; post-fix behavior unverified live — see SC#4 human item |

---

### Anti-Patterns Found

None blocking. No TODO/FIXME/placeholder patterns found in Phase 04 code paths. 403/403 unit tests pass.

Notable: the PRI-04 dedup branches are exercised by unit tests with mocked Octokit responses, but the live Octokit search query path hit HTTP 422 during Step A (before HEALER_TOKEN threading fix). The fix is applied; the concern is carried to the human verification section.

---

### Human Verification Required

#### 1. SC#4 PRI-04 Dedup — Post-Fix Re-Verification (HIGHEST PRIORITY)

**Test:** Run a second dispatch for the same broken-selector fixture while issue #11 (or another healer artifact) is open:

```bash
FULL_SHA=$(git rev-parse HEAD)
gh workflow run e2e-heal-self.yml \
  --ref playwright-healer/clicks-submit-button-and-sees-confirmation-5c12678 \
  -F testFile='fixture/tests/broken-selector.spec.ts' \
  -F testTitle='clicks submit button and sees confirmation' \
  -F fixClassHint='selectors' \
  -F concurrencyKey='manual-selector-dedup-recheck-1' \
  -F commitSha="$FULL_SHA"
```

**Expected:** The heal job's log shows "Found existing open issue — commenting instead of creating." No new issue is created. The existing issue receives a new comment. No HTTP 422 errors in the log.

**Why human:** `findExistingOpenIssue` executes a live GitHub search API call. Three duplicate issues were created during Step A before HEALER_TOKEN was threaded to the search query. The fix (commits ae8a27d + 53127fb) is applied, but no subsequent live run has confirmed the dedup path executes cleanly and routes correctly to comment-on-existing.

#### 2. SC#1 Threshold-Triggered Auto-Dispatch

**Test:** Configure with `enableAutoDispatch=true` and a low `flakeRateThreshold`. Inject a Playwright JSON report whose rolling flake-rate for a known test exceeds the threshold. Run the ingest step.

**Expected:** The ingest step logs "Dispatching healer for test: {testTitle}" and a new workflow run appears in the Actions tab with inputs populated from detection data (not manually entered).

**Why human:** The `enableAutoDispatch` flag defaults to `false` and has never been set to `true` in a live ingest run. Step A was a manual dispatch. The code path is covered by unit tests but threshold-triggered behavior requires live ingest execution with a real threshold breach.

#### 3. SC#2 Concurrent Dispatch Queue (DET-07 SC#2)

**Test:** Run the Step C runbook from 04-05-HUMAN-UAT.md — two rapid parallel dispatches with the same concurrencyKey:

```bash
FULL_SHA=$(git rev-parse HEAD)
for i in 1 2; do
  gh workflow run e2e-heal-self.yml \
    --ref playwright-healer/clicks-submit-button-and-sees-confirmation-5c12678 \
    -F testFile='fixture/tests/broken-selector.spec.ts' \
    -F testTitle='clicks submit button and sees confirmation' \
    -F fixClassHint='selectors' \
    -F concurrencyKey='uat-c-shared-key' \
    -F commitSha="$FULL_SHA" &
done
wait
sleep 6
gh run list --workflow=e2e-heal-self.yml --limit 5 \
  --json status,conclusion,createdAt,databaseId,event
```

**Expected:** One run is `in_progress` (or `completed`), one run is `queued`. Not two parallel `in_progress` runs.

**Why human:** GitHub's workflow-level concurrency queueing (`cancel-in-progress: false`) is a platform behavior that requires live dispatch to verify. The block in e2e-heal-self.yml is correctly structured but cannot be mocked.

#### 4. SC#3 Assertion-Class LLM Heal (FIX-07)

**Test:** Run the Step B runbook from 04-05-HUMAN-UAT.md:

```bash
FULL_SHA=$(git rev-parse HEAD)
gh workflow run e2e-heal-self.yml \
  --ref playwright-healer/clicks-submit-button-and-sees-confirmation-5c12678 \
  -F testFile='fixture/tests/broken-assertion.spec.ts' \
  -F testTitle='clicks submit button and sees assertion confirmation' \
  -F fixClassHint='assertions' \
  -F concurrencyKey='manual-assertion-uat-1' \
  -F commitSha="$FULL_SHA"
```

**Expected:** Green run with all 3 jobs passing. The diff changes `'Submission complete'` to match `fixture/index.html`. Diff does NOT weaken the assertion (no `.toContainText`, no `.toBeVisible`, no assertion removal). The agent response's `fixClass` passes VALID_CLASSES validation (no "invalid fixClass" error in logs).

**Why human:** LLM output is non-deterministic. Prompt templates and VALID_CLASSES allow-list are implemented, but the specific fix the model generates cannot be predicted or verified statically.

---

### Gaps Summary

No structural gaps. All Phase 04 code artifacts exist, are substantive, and are wired. The phase is blocked on live behavioral demonstration, not missing code.

SC#4 (PRI-04 dedup) is the highest-priority human test: it has direct empirical evidence of live failure during Step A (3 duplicate issues created before HEALER_TOKEN fix). The code fix is applied but a confirming live run has not been performed.

Steps B (SC#3), C (SC#2), and D (heal-cap verification) were explicitly deferred in 04-05-HUMAN-UAT.md due to iteration budget constraints. Full runbooks for all deferred steps are in that file.

---

_Verified: 2026-05-02T03:00:00Z_
_Verifier: Claude (gsd-verifier)_
