---
phase: 05-auto-merge
plan: 05-03
status: complete
created: 2026-05-02
updated: 2026-05-02
---

# Phase 5 — Auto-merge UAT Evidence

Captures the four verification runs required by Plan 05-03 against the four Phase 5 ROADMAP success criteria, plus subsidiary D-05 / D-07 / D-08 / T-05-06 checks.

**Run summary:**
- Run 1 — default-off demo (live, PR #3): SC#1 ✓ + SC#4 ✓
- Run 2 — enable_auto_merge=true (live, PRs #4 + Issue #5): documented per the tier + demo-flag constraints below; SC#2 closed via unit-level IN2 (plan-accepted fallback)
- Run 3 — out-of-test-dir blocked (unit-level Layer A): SC#3 ✓
- Run 4 — soft-fail D-05 (unit-level fallback): D-05 ✓

**Tier constraint discovered during execution:** `Sacharified/playwright-healer-test` is private + User-owned + GitHub Free, so:
- `allow_auto_merge` repo setting cannot be enabled (silent no-op via PATCH /repos)
- Branch protection requires GitHub Pro (`HTTP 403: Upgrade to GitHub Pro`)

Both prerequisites for `enablePullRequestAutoMerge` to succeed are unavailable on this tier. SC#2's live happy-path is therefore deferred to Phase 6 release verification (which will configure a public-tier or Pro-tier fixture). Plan 03 Task 2 explicitly accommodates this case: SC#2 is verified mathematically by Plan 02 Test IN2 (`pr-writer.test.ts`), and the live demo shifts to Phase 6.

---

## Run 1 — default-off demo (ROADMAP SC#1 + SC#4)

**Date:** 2026-05-02
**Run URL:** https://github.com/Sacharified/playwright-healer-test/actions/runs/25260388518
**Healer PR opened:** https://github.com/Sacharified/playwright-healer-test/pull/3
**Heal exit code:** 0 (run conclusion: `success`)
**Verdict:** ✓ pass

### Step summary excerpt (Auto-merge decision band)

The band content is reconstructed by calling `evaluateAutoMerge` + `renderAutoMergeBand` (the same code that ran on the runner) with Run 1's exact inputs. GitHub's REST API does not expose step-summary content directly; reconstruction with identical inputs is functionally equivalent to scraping the UI. Capture script: `evaluateAutoMerge({ enableAutoMerge: false, autoMergePassRate: 0.9, autoMergeFixClasses: ['selectors','waits'], patchedFiles: ['fixture/tests/broken-selector.spec.ts'], fixClass: 'selectors', validation: { passed: 0, total: 0, passRate: 0, perRun: [] } })` — `validation.total: 0` because `skip_post_fix_validation: true` is on for the Phase 03.1 demo.

```
## Auto-merge decision

| Condition | Result | Reason |
| --- | --- | --- |
| pass_rate | blocked | validation skipped (demo mode) |
| fix_class | matched | selectors in allow-list (selectors, waits) |
| scope | matched | all patched files in tests/, e2e/, or playwright/ |
| config_files | matched | no config files patched |
| auto_merge | blocked | enable_auto_merge=false (informational only) |
```

Note: the outcome row reads `auto_merge | blocked | enable_auto_merge=false (informational only)` rather than Plan 03's example `auto_merge | eligible | enable_auto_merge=false (informational only)`. The difference is the D-07 path: the demo runs `skip_post_fix_validation: true`, which makes `validation.total === 0` — the gate's pass_rate condition correctly reports `blocked | validation skipped (demo mode)`. The plan's example assumed a non-skip-validation path; the gate behavior is correct under both paths.

### Negative invariant — no merge API call

`gh run view 25260388518 -R Sacharified/playwright-healer-test --log | grep -i "enablePullRequestAutoMerge"` returns 0 matches. The mutation was never called because `args.enableAutoMerge && decision.eligible` (`pr-writer.ts:439`) is `false && false → false`. Confirmed by inspection of the action's gate logic.

### SC#1 verdict
✓ pass — PR #3 is in OPEN state (`gh pr view 3 --json state` → `{"state":"OPEN", "mergedAt":null}`); `enablePullRequestAutoMerge` mutation never called; heal exit code 0.

### SC#4 verdict
✓ pass — band rendered with `## Auto-merge decision` heading + four condition rows + one outcome row. RB6/RB7 unit tests (`pr-writer.test.ts`) verify the structure mathematically; Run 1's PR creation confirms the same `core.summary.addRaw(... ${bandLines.join('\n')})` line at `pr-writer.ts:461-463` was executed.

---

## Run 2 — enable_auto_merge=true (ROADMAP SC#2 attempt)

**Run 2 (initial attempt):** https://github.com/Sacharified/playwright-healer-test/actions/runs/25261401104 — PR [#4](https://github.com/Sacharified/playwright-healer-test/pull/4) opened, OPEN, not merged. The gate's pre-flight ineligibility check (`decision.eligible: false` from D-07 path) prevented the mutation from being called. PR was created without an auto-merge attempt.

**Run 2-bis (validation enabled):** https://github.com/Sacharified/playwright-healer-test/actions/runs/25261472606 — Heal exit 0, Issue [#5](https://github.com/Sacharified/playwright-healer-test/issues/5) opened. With `skip_post_fix_validation: false`, the agent's fix was applied but validation rerun pass rate was 0/5 (= 0%) < required 0.9. Per `index.ts:340-352`, the action took the validation-failed branch and called `fileIssue` instead of `openHealerPr`, so the auto-merge gate code path was not executed.

### Why SC#2's live happy path was not demonstrated

Both attempts hit short-circuits BEFORE the gate ever called `enablePullRequestAutoMerge`:

| Demo flag | Gate path | Outcome |
|---|---|---|
| `skip_post_fix_validation: true` | `decision.eligible: false` (D-07: validation.total=0) | Mutation guarded out by `if (args.enableAutoMerge && decision.eligible)` |
| `skip_post_fix_validation: false` | Validation pass rate 0% → `fileIssue` returns early | `openHealerPr` never called → gate never runs |

Both branches expose real behavior of the gate's defense-in-depth contract (D-02: gate runs only on PR-yielding paths; D-07: validation-skipped is treated as ineligible). Neither branch reaches the live mutation. To exercise the live mutation soft-fail (D-05) on this fixture would require either: (a) a fix that reliably passes validation, OR (b) bypassing validation while keeping eligibility (which would require a code change to the gate).

### SC#2 closure
Per Plan 05-03 Task 2, SC#2 is verified at the unit level: `src/healer/pr-writer.test.ts` Test IN2 (`pr-writer.test.ts:858`) — `enableAutoMerge=true` + eligible decision → `mockGraphql` called with `{ pullRequestId, mergeMethod: 'SQUASH' }` + summary outcome row `mutation succeeded at <iso>`. This is the same code path that would execute on a Pro-tier fixture with branch protection. **Live happy-path verification is deferred to Phase 6** (Documentation + Release), which configures the public-tier or Pro-tier fixture as part of release prerequisites.

### T-05-06 (SKIP_SENTINEL preservation in squash commit)
Verified at unit level by `pr-writer.test.ts` Test EA2: `enableAutoMerge` mutation variables include only `{ pullRequestId, mergeMethod }` — they do NOT include `commitHeadline`/`commitBody`/`expectedHeadOid`/`authorEmail`. This means GitHub uses the PR's existing commit body (which already contains `[skip-healer]` per the `fix:` commit pattern) for the squash commit message. Live verification deferred to Phase 6.

### SC#2 verdict
✓ pass (unit-level via IN2) — live happy path deferred to Phase 6 per tier constraints documented above.

---

## Run 3 — out-of-test-dir blocking (ROADMAP SC#3)

**Date:** 2026-05-02
**Verification mode:** unit-level (Layer A) — diff-lint FIX-06 already blocks this case at the upstream gate, so an end-to-end live demo would require deliberately bypassing diff-lint, which violates the project's defense-in-depth contract per CONTEXT D-02.
**Source of evidence:** `src/healer/pr-writer.test.ts` Test IN5 (line 874)

### Test code (quoted)

```typescript
it('IN5: ineligible scope blocked → graphql NEVER called', async () => {
  await openHealerPr(mkArgs({
    enableAutoMerge: true,
    patchedFiles: ['src/foo.ts', 'tests/bar.spec.ts'],
    validation: { passed: 10, total: 10, passRate: 1.0, perRun: [] },
  }));
  expect(mockGraphql).not.toHaveBeenCalled();
  const summaryCall = vi.mocked(core.summary.addRaw).mock.calls[0][0] as string;
  expect(summaryCall).toContain('files outside test directory (src/foo.ts)');
});
```

### Test output (captured 2026-05-02)

```
$ ./node_modules/.bin/vitest run src/healer/pr-writer.test.ts -t "IN5" --reporter=verbose

 ✓ |unit| src/healer/pr-writer.test.ts > pr-writer — Phase 05 openHealerPr integration —
       gate fires post-create only > IN5: ineligible scope blocked → graphql NEVER called  1ms

 Test Files  1 passed (1)
      Tests  1 passed | 78 skipped (79)
   Start at  20:07:58
   Duration  146ms
```

### SC#3 verdict
✓ pass — `evaluateAutoMerge` blocks at the eligibility step when any patched file is outside the `tests/`, `e2e/`, `playwright/` allowlist. `mockGraphql` was NEVER called even with `enableAutoMerge: true`. The reasoning band names the offending path `files outside test directory (src/foo.ts)`.

### Note on layer-A vs layer-B
Layer A (unit-level) is the primary evidence — it tests the same code that runs in production with full coverage of the offending-path-naming logic. A live integration run would require synthesizing a malicious agent that bypasses diff-lint (FIX-06), which is out of scope for Phase 5: FIX-06 is the upstream guard, and Phase 5's gate is defense-in-depth per CONTEXT D-02.

---

## Run 4 — soft-fail (D-05)

**Date:** 2026-05-02
**Verification mode:** unit-level fallback (per Plan 05-03 Task 4 `<behavior>`: "Either is acceptable for closing Phase 5; live evidence is preferred for the release notes (Phase 6) but not required for completion.")
**Source of evidence:** `src/healer/pr-writer.test.ts` Tests EF1-EF5 (soft-fail `enableAutoMerge`) + Test IN3 (full `openHealerPr` integration with mocked rejection)

**Why live D-05 was not captured during this UAT cycle:** Two live attempts (Run 2 + Run 2-bis) both short-circuited before the gate's mutation call (see Run 2 section above for analysis). Live D-05 would require either tier-upgrading the fixture (out of scope for Phase 5 closure) or a more reliable test fixture for validation. Phase 6 release verification will retry live D-05 against a public-tier fixture.

### Test output (captured 2026-05-02)

```
$ ./node_modules/.bin/vitest run src/healer/pr-writer.test.ts -t "EF1|EF2|EF3|EF4|EF5|IN3" --reporter=verbose

 ✓ EF1: branch protection error → returns errorMessage, does not throw
 ✓ EF2: multiple error messages joined with semicolon
 ✓ EF3: empty errors array → falls back to err.message
 ✓ EF4: network error → errorMessage includes Auto-merge enable failed and error text
 ✓ EF5: TypeError → errorMessage includes the error text
 ✓ IN3: eligible + enable=true + mutation fails → core.warning + PR url returned + summary shows error

 Test Files  1 passed (1)
      Tests  6 passed | 73 skipped (79)
   Start at  20:08:02
   Duration  104ms
```

### What each test asserts (D-05 coverage matrix)

| Test | D-05 sub-claim |
|------|----------------|
| EF1 | `GraphqlResponseError` caught; specific GitHub message bubbled in `errorMessage` |
| EF2 | Multiple GraphQL errors are joined with `; ` |
| EF3 | Empty `errors` array falls back to `err.message` |
| EF4 | Non-GraphQL error path: network error → `errorMessage` contains "Auto-merge enable failed" + error text |
| EF5 | Non-GraphQL error path: `TypeError` → `errorMessage` contains the error text |
| IN3 | End-to-end: `core.warning` fired + PR URL returned (heal exit 0) + step summary shows the error |

### D-05 verdict
✓ pass — soft-fail path renders specific error message (not a generic placeholder) + heal exit 0 + PR remains open + README link target `#auto-merge-prerequisites` resolves (verified via `grep -n "^## Auto-merge prerequisites$" README.md` → line 5).

---

## Phase 5 Verification Summary

| Success Criterion | Evidence | Verdict |
|-------------------|----------|---------|
| SC#1 (default-off zero-change) | Run 1 (PR #3 OPEN) + reconstructed band | ✓ pass |
| SC#2 (enable=true happy path) | Plan 02 Test IN2 (unit) + live attempts blocked by tier + demo flags | ✓ pass (unit) — live deferred to Phase 6 |
| SC#3 (out-of-test-dir blocked) | Run 3 (Layer A unit IN5) | ✓ pass |
| SC#4 (reasoning band rendered) | Run 1 reconstructed band + RB6/RB7 unit tests | ✓ pass |
| D-05 soft-fail | Run 4 (unit-level fallback EF1-EF5 + IN3) | ✓ pass |
| D-07 validation-skipped | Plan 02 Task 4 Test IN7 + observed in Run 1 (`pass_rate | blocked | validation skipped`) | ✓ pass |
| D-08 dedup-bypass | Plan 02 Task 4 Test IN8 | ✓ pass (unit) |
| T-05-06 SKIP_SENTINEL preserved | Plan 02 Test EA2 (mutation variables exclude commit metadata) | ✓ pass (unit) — live verification deferred to Phase 6 |

**Phase 5 status:** all ROADMAP success criteria + locked decisions + threat-model items verified. SC#2's live happy-path and T-05-06's live SKIP_SENTINEL verification are deferred to Phase 6 per the documented tier constraint (private + User-owned + GitHub Free fixture cannot enable `allow_auto_merge` or branch protection).

**Next phase:** Phase 6 (Documentation + Release) — full README polish, example consumer workflow, version tag, AND a public-tier or Pro-tier fixture configuration for live SC#2 / T-05-06 verification at release time.

---

## Live UAT runbook (Tasks 1 + 2)

The original runbook from this file's first version (commit prior to live execution) anticipated full live coverage of SC#1, SC#2, and live D-05. Actual execution diverged due to the tier constraint and demo-flag interaction documented above. The fixture-side workflow `Sacharified/playwright-healer-test:.github/workflows/sc1-healer.yml` was updated during this UAT cycle to:

1. Restore the file (it had been emptied by an earlier broken commit `017e80b2` on 2026-05-02)
2. Pin `actions/checkout` of `Sacharified/playwright-healer` to the Phase 5 branch `playwright-healer/clicks-submit-button-and-sees-confirmation-5c12678`
3. Add Phase 5 inputs (`enable_auto_merge`, `auto_merge_pass_rate: '0.9'`, `auto_merge_fix_classes: 'selectors,waits'`)
4. Declare `commitSha` + `concurrencyKey` as workflow_dispatch inputs (Phase 04 dispatch contract regression — unrelated to Phase 5 but blocking UAT)
5. Add `skip_post_fix_validation` workflow input (so Phase 5 testing can flip validation on without code changes)

The fixture workflow as it stands (commit `b119687`) is ready to demonstrate Phase 5 end-to-end against a Pro-tier or public fixture in Phase 6.

For Phase 6 release verification, dispatch with the values shown in the runbook example below:

```bash
SHA=$(gh api repos/Sacharified/playwright-healer-test/branches/main --jq .commit.sha)
TF="fixture/tests/broken-selector.spec.ts"
TT="clicks submit button and sees confirmation"
slug40() { python3 -c "import sys, re; s=sys.argv[1].lower(); s=re.sub(r'[^a-z0-9]+','-',s).strip('-'); print(s[:40])" "$1"; }
KEY="$(slug40 "$TF")-$(slug40 "$TT")-$(printf '%s::%s' "$TF" "$TT" | sha1sum | cut -c1-8)"

# Run 2 (SC#2 happy-path, requires branch protection + allow_auto_merge):
gh workflow run sc1-healer.yml -R Sacharified/playwright-healer-test \
  -f commitSha="$SHA" -f concurrencyKey="$KEY" \
  -f testFile="$TF" -f testTitle="$TT" \
  -f fixClassHint=selectors -f enable_auto_merge=true \
  -f skip_post_fix_validation=false
```

---

## Notes on this evidence file

- Tasks 0 (README stub) committed as `b9c40c1`. Tasks 3 + 4 committed as part of Plan 05-02's pr-writer test suite (`b54dc9d` through `658470f`). This evidence file documents the closure for all four UAT tasks.
- Live UAT execution discovered + repaired three pre-existing fixture-workflow issues:
  1. `sc1-healer.yml` was empty (commit `017e80b2` 2026-05-02 had deleted all 71 lines)
  2. Phase 04 made `commitSha` (regex) and `concurrencyKey` (min(1)) required on the dispatch contract; the manual workflow had never been updated to supply them
  3. The `skip_post_fix_validation` flag wasn't exposed as a workflow input, so Phase 5 testing of the gate-eligible path required hardcoding edits
- All three repairs are committed to the fixture repo and persist for future Phase 6 work.
