---
phase: 04-auto-dispatch-full-fix-classes-deduplication
plan: "04"
subsystem: heal-cap, state-branch, ingest-dispatch, healer-pipeline, security-lint
tags: [heal-cap, sec-05, guard-3, ndjson, append-heal-event, wr-01, wr-02, wr-03, det-07]
dependency_graph:
  requires:
    - 04-01 (auto-dispatch wiring)
    - 04-02 (fix classes + classifier)
    - 04-03 (PRI-04 dedup)
  provides:
    - DET-07 heal-cap enforcement (ingest pre-check + healer backstop)
    - HealEvent NDJSON schema + appendHealEvent write API
    - countHealsForTest + shouldSkipHeal exports
    - WR-01 verified + regression check in CI
    - WR-02 renderPrBody skipped sentinel fix
    - WR-03 unconditional-validate fix
  affects:
    - src/healer/index.ts (Step 1.5 + fileIssue widening + heal-event write sites)
    - src/ingest/index.ts (D-04 cap gate in dispatch loop)
    - src/shared/state-branch.ts (appendHealEvent)
    - src/shared/loop-guard.ts (countHealsForTest + shouldSkipHeal)
    - src/healer/pr-writer.ts (WR-02 renderPrBody total===0 path)
    - .github/workflows/security-lint.yml (WR-01 Check 5)
tech_stack:
  added:
    - node:fs / node:path synchronous I/O in countHealsForTest (no git calls, pure file walk)
  patterns:
    - appendHealEvent mirrors appendRecord retry-loop verbatim (Pitfall A/B/C invariants preserved)
    - Defense-in-depth: ingest D-04 cheap pre-check + healer Guard 3 backstop
    - [skip-healer] sentinel in every heal-event commit message (Guard 2 prerequisite)
key_files:
  created:
    - src/shared/state-branch.test.ts
    - src/shared/loop-guard.test.ts
  modified:
    - src/shared/types.ts (HealEvent interface added after Detection)
    - src/shared/state-branch.ts (todayHealPath + appendHealEvent)
    - src/shared/loop-guard.ts (countHealsForTest + shouldSkipHeal)
    - src/healer/types.ts (FailureMode widened with 'cap-exceeded')
    - src/healer/index.ts (Step 1.5 + IssueOpts widening + fileIssue widening + 3 heal-event write sites + WR-03 + WR-02)
    - src/healer/index.test.ts (Guard 3 tests + heal-event write site tests + WR-02/03 tests)
    - src/healer/pr-writer.ts (WR-02 total===0 special case in renderPrBody)
    - src/healer/pr-writer.test.ts (WR-02 tests)
    - src/ingest/index.ts (D-04 countHealsForTest + recordCapHit in dispatch loop)
    - src/ingest/index.test.ts (D-04 cap tests)
    - src/ingest/dispatch.ts (recordCapHit helper + appendHealEvent import)
    - src/ingest/dispatch.test.ts (no new tests; mocks updated)
    - .github/workflows/security-lint.yml (Check 5 WR-01 regression grep)
decisions:
  - IssueOpts widened to include testFile + stateWorktreePath — use full testFile::testTitle key for issue-opened heal events, matching the pr-opened path (no cap undercount)
  - appendHealEvent NOT abstracted from appendRecord — deliberate duplication for independent auditability
  - countHealsForTest uses synchronous fs I/O (walks ≤ flakeWindowDays files, each <1KB; async would add complexity without benefit)
  - Guard 3 bootstrap failure is non-fatal — cap is defense-in-depth backstop; blocking all heals on state-branch error is worse than a single cap-bypass
  - security-lint.yml Check 5 excludes itself (--exclude=security-lint.yml) to avoid self-referential false positive from grep command string
metrics:
  duration: ~35min
  completed: "2026-05-01"
  tasks: 3
  files: 15
---

# Phase 04 Plan 04: Heal-Cap (DET-07) + WR Backlog Summary

**One-liner:** Per-test heal cap enforced defense-in-depth (ingest D-04 pre-check + healer SEC-05 Guard 3 backstop) with NDJSON heal-event log, 3 write sites, and WR-01/02/03 hardening fixes.

## What Was Built

### Task 1: HealEvent schema + write API + cap query

**`src/shared/types.ts` — HealEvent interface:**
```typescript
export interface HealEvent {
  schemaVersion: 1;
  timestamp: string;
  testId: string;        // "{filePath}::{title}" key
  outcome: 'pr-opened' | 'issue-opened' | 'cap-reached';
  dispatchRunId: string;
  prUrl?: string;
  issueUrl?: string;
}
```

**`src/shared/state-branch.ts` — new exports:**
- `todayHealPath()` — returns `runs/YYYY/MM/DD-heals.ndjson` (sibling of `todayPath()`)
- `appendHealEvent(event, worktreePath)` — mirrors `appendRecord` retry-loop exactly:
  - Pitfall A: every git call uses `{ cwd: worktreePath }`
  - Pitfall B: atomic write via `.tmp` rename
  - Pitfall C: `--force-with-lease=playwright-healer-state` (ref-qualified)
  - Sentinel: `[skip-healer]` in every commit message (Guard 2 prerequisite — without it, heal commits trigger infinite re-ingest)
  - Exhaustion: `core.warning()` only, no throw

**`src/shared/loop-guard.ts` — new exports:**
- `countHealsForTest(testId, windowDays, worktreePath)` — walks `runs/YYYY/MM/DD-heals.ndjson` files within the rolling window; pure synchronous fs I/O; malformed JSON lines skipped silently
- `shouldSkipHeal(testId, config, worktreePath)` — SEC-05 Guard 3 backstop; returns `{ skip: boolean, count: number }`; emits `core.info()` on cap-hit

**`src/healer/types.ts` — 7th FailureMode token:**
```typescript
| 'cap-exceeded'   // Phase 04 — SEC-05 Guard 3 backstop
```

**20 tests added:** todayHealPath format, appendHealEvent happy path + retry exhaustion + Pitfall A/B/C/sentinel discipline, countHealsForTest window filtering + malformed line resilience, shouldSkipHeal boundary conditions.

### Task 2: Heal-cap gate wiring + 3 heal-event write sites

**`src/ingest/dispatch.ts` — new export:**
- `recordCapHit(args)` — emits `core.warning()` + writes `cap-reached` HealEvent; called from ingest Step 9 when D-04 pre-check fires

**`src/ingest/index.ts` — D-04 pre-check in Step 9:**
- BEFORE `fireDispatch`, calls `countHealsForTest(detection.testId, config.flakeWindowDays, worktreePath)`
- If `count >= maxHealsPerTestPerWeek`: calls `recordCapHit`, `continue` (skips dispatch)
- Ingest-side pre-check is the cheap layer (saves a workflow run on cap-already-hit path)

**`src/healer/index.ts` — Step 1.5 + IssueOpts widening + 3 heal-event write sites:**

Step 1.5 (Guard 3 backstop, inserted between Step 1 payload-parse and Step 2 adapter-select):
```
bootstrapOrGetWorktree → shouldSkipHeal → if skip: fileIssue(cap-exceeded) + appendHealEvent(cap-reached) + return
```
Bootstrap failure is non-fatal — warning emitted, flow continues without the backstop.

IssueOpts widened:
```typescript
interface IssueOpts {
  testFile: string;              // NEW — enables full testFile::testTitle cap key
  stateWorktreePath: string | null; // NEW — threaded from Step 1.5
  ...
}
```

All 6 pre-existing `fileIssue()` call sites updated to pass `testFile` and `stateWorktreePath`. Total: 7 call sites (6 pre-existing + 1 new cap-exceeded).

Three heal-event write sites:
1. **fileIssue helper** (after `openIssue` returns) — writes `outcome: 'issue-opened'` for all non-cap-exceeded modes; skipped for cap-exceeded (caller writes `cap-reached` after)
2. **Step 11** (after `openHealerPr` returns) — writes `outcome: 'pr-opened'` with `prUrl`
3. **Step 1.5 cap-exceeded branch** — writes `outcome: 'cap-reached'` (sticky cap — recorded before early return)

Analytics-only-loss fall-through: heal-event write failures are caught, `core.warning()` emitted, pipeline continues.

**WR-03 fix (also in Task 2):** `validate()` call now wrapped in `if (!config.skipDeterministicCheck)` gate — was previously called unconditionally then result checked behind the gate (wasteful in demo mode).

**WR-02 sentinel fix (also in Task 2):** `skipPostFixValidation` sentinel changed from `{ passRate: 1, total: 0 }` to `{ passRate: 0, total: 0 }` — `total: 0` is the signal for `renderPrBody` special-case.

**11 new tests:** D-04 cap-hit/below-cap, Guard 3 cap-hit/below-cap/bootstrap-failure, heal-event write sites #1/#2/#3, WR-02/03 fix confirmations.

### Task 3: WR-02 renderPrBody + WR-01 security-lint

**`src/healer/pr-writer.ts` — WR-02 `total===0` special-case:**
```typescript
if (args.validation.total === 0) {
  // renders: "Pass rate: **skipped (post-fix validation disabled)**"
} else {
  // existing: "Pass rate: **90%** (9/10 reruns at --retries=0)"
}
```
Prevents demo-mode PRs from showing "100% (0/0 reruns)" which misled reviewers about the heal's evidence quality.

**`.github/workflows/security-lint.yml` — Check 5 WR-01:**
Negative grep for `git config --global url.insteadOf` in `action.yml src/ .github/workflows/` (excludes `security-lint.yml` itself to avoid self-referential false positive). Fails CI if the global gitconfig PAT leak pattern returns. The live mitigation — inline `git -c http.extraheader` per-invocation at `fix-applier.ts:115` — is verified intact.

**6 new tests:** WR-02 skipped message, cost line, backwards compat, WR-03 validate call count guards.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Security-lint Check 5 self-referential false positive**
- **Found during:** Task 3 verification
- **Issue:** The WR-01 grep searched `.github/workflows/` which includes `security-lint.yml` itself; the YAML file contains the string `git config --global url.insteadOf` in the grep command, causing the check to always fail
- **Fix:** Added `--exclude='security-lint.yml'` to the grep invocation
- **Files modified:** `.github/workflows/security-lint.yml`
- **Commit:** 0436e11

**2. [Rule 2 - Missing] WR-03 fix co-located with Task 2**
- The plan listed WR-03 as a Task 3 item, but the unconditional-validate fix was naturally co-located with the Task 2 healer index restructuring (same code region). Applied in Task 2 commit to avoid a partial state where Step 1.5 is wired but WR-03 is not.

**3. [Rule 2 - Missing] WR-02 sentinel co-located with Task 2**
- Same rationale as WR-03 — the `passRate: 0` sentinel fix was in the same `skipPostFixValidation` block touched during Task 2's healer restructuring. Applied in Task 2, tested in Task 3.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes beyond the state branch heal-event NDJSON already described in the plan's threat model (T-04-02, T-04-04, T-04-05).

## Known Stubs

None — all three heal-event write sites write real data; no placeholders.

## Self-Check: PASSED

Files verified to exist:
- src/shared/types.ts — HealEvent interface present
- src/shared/state-branch.ts — todayHealPath + appendHealEvent present
- src/shared/state-branch.test.ts — 20 tests
- src/shared/loop-guard.ts — countHealsForTest + shouldSkipHeal present
- src/shared/loop-guard.test.ts — tests present
- src/healer/types.ts — 'cap-exceeded' token present
- src/healer/index.ts — Step 1.5 + fileIssue widening + 3 write sites present
- src/healer/pr-writer.ts — total===0 special-case present
- .github/workflows/security-lint.yml — Check 5 WR-01 present

Commits verified:
- 36d945f — Task 1
- 5aca4d3 — Task 2
- 0436e11 — Task 3

Test count: 402 (365 baseline + 37 new) — all pass.
TypeScript: clean (tsc --noEmit exits 0).
WR-01 grep: no matches in action.yml + src/ (verified locally).
