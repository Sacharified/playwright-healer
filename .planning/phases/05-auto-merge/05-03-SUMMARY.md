---
phase: 05-auto-merge
plan: 03
subsystem: verification, readme-stub, uat
tags: [manual-uat, e2e-demo, branch-protection, reasoning-band, github-actions, readme-stub, verification]
dependency_graph:
  requires:
    - Phase 05 Plan 01 (auto-merge config schema + action.yml inputs)
    - Phase 05 Plan 02 (gate logic: evaluateAutoMerge, enableAutoMerge, renderAutoMergeBand)
  provides:
    - README.md §Auto-merge prerequisites section (D-10 stub; Phase 6 polishes)
    - 05-03-UAT-EVIDENCE.md — four-run evidence record for all four ROADMAP success criteria
    - sc1-healer-phase5.yml — Phase 5-ready fixture workflow (committed for Phase 6 reference)
  affects:
    - Phase 6 (Documentation + Release) — picks up live SC#2 / T-05-06 verification on public-tier fixture
tech_stack:
  added: []
  patterns:
    - Unit-level Layer A evidence as primary SC#3 verification (diff-lint FIX-06 upstream guard makes live bypass impractical without weakening defense-in-depth)
    - Tier-constraint documented deferral pattern — GitHub Free private repos cannot enable allow_auto_merge or branch protection; SC#2 live coverage deferred to Phase 6
    - Reconstructed-band evidence pattern — step-summary content not directly accessible via REST API; reconstruction with identical inputs is functionally equivalent
key_files:
  created:
    - .planning/phases/05-auto-merge/05-03-UAT-EVIDENCE.md
    - .planning/phases/05-auto-merge/sc1-healer-phase5.yml
  modified:
    - README.md
key_decisions:
  - "SC#2 live happy-path deferred to Phase 6 — Sacharified/playwright-healer-test is GitHub Free private; allow_auto_merge and branch protection are Pro-tier features; unit-level IN2 is the primary evidence per plan's accepted fallback"
  - "D-07 demo-mode interaction: skip_post_fix_validation=true causes validation.total=0 → pass_rate condition reports 'blocked | validation skipped (demo mode)' not 'matched'; plan example assumed non-skip path; gate behavior is correct"
  - "sc1-healer-phase5.yml committed to playwright-healer repo so Phase 6 has a stable reference for the fixture workflow — the fixture repo copy (Sacharified/playwright-healer-test) is the live version"
  - "README §Auto-merge prerequisites stub (D-10) committed before UAT runs so D-05 warning link target resolves throughout Phase 5"
patterns_established:
  - "Fixture workflow versioning: commit a stable copy of fixture-side dispatch workflows to the action repo's planning directory so Phase N+1 always has a runbook starting point"
requirements_completed: [MRG-01, MRG-02, MRG-03, MRG-04]
duration: ~60m (UAT execution + evidence capture; Task 0 README stub was ~5m)
completed: 2026-05-02
---

# Phase 05 Plan 03: Auto-Merge UAT Verification Summary

**Live demo (SC#1 + SC#4) + unit-level evidence (SC#2 soft-path + SC#3 gate) verify all four Phase 5 ROADMAP success criteria with SC#2 live happy-path deferred to Phase 6 per GitHub Free tier constraints.**

## Performance

- **Duration:** ~60m (UAT execution + evidence capture)
- **Started:** 2026-05-02
- **Completed:** 2026-05-02
- **Tasks:** 5 (Task 0 README stub + Tasks 1-4 UAT evidence)
- **Files created/modified:** 3 (README.md, 05-03-UAT-EVIDENCE.md, sc1-healer-phase5.yml)

## Accomplishments

- **Task 0 (README stub, committed b9c40c1):** Added `## Auto-merge prerequisites` section at top-level heading depth so D-05's `core.warning` link target `README §auto-merge-prerequisites` resolves. Four-bullet matrix covers: allow-auto-merge repo toggle, allow-squash-merging toggle, branch protection with required checks, and healer_token PAT scope.
- **Tasks 1-4 (live + unit UAT, committed 6831d93):** All four Phase 5 ROADMAP success criteria and all subsidiary decisions (D-05, D-07, D-08, T-05-06) verified with concrete evidence. Live Run 1 (PR #3 open, band reconstructed, SC#1 + SC#4 confirmed). SC#2 live deferred to Phase 6 per tier constraint. SC#3 and D-05 covered by unit-level Layer A evidence (IN5, EF1-EF5, IN3). sc1-healer-phase5.yml committed as Phase 6 runbook starting point.
- **Evidence file complete:** `05-03-UAT-EVIDENCE.md` contains four `## Run` sections + a Phase 5 Verification Summary table with 8 rows all `pass`.

## Phase 5 Verification Summary

Reproduced from `05-03-UAT-EVIDENCE.md`:

| Success Criterion | Evidence | Verdict |
|-------------------|----------|---------|
| SC#1 (default-off zero-change) | Run 1 (PR #3 OPEN) + reconstructed band | pass |
| SC#2 (enable=true happy path) | Plan 02 Test IN2 (unit) + live attempts blocked by tier + demo flags | pass (unit) — live deferred to Phase 6 |
| SC#3 (out-of-test-dir blocked) | Run 3 (Layer A unit IN5) | pass |
| SC#4 (reasoning band rendered) | Run 1 reconstructed band + RB6/RB7 unit tests | pass |
| D-05 soft-fail | Run 4 (unit EF1-EF5 + IN3) | pass |
| D-07 validation-skipped | Plan 02 Test IN7 + observed in Run 1 (`pass_rate blocked`) | pass |
| D-08 dedup-bypass | Plan 02 Test IN8 | pass (unit) |
| T-05-06 SKIP_SENTINEL preserved | Plan 02 Test EA2 (mutation vars exclude commit metadata) | pass (unit) — live deferred to Phase 6 |

## Task Commits

1. **Task 0: README §Auto-merge prerequisites stub** — `b9c40c1` (docs)
2. **Tasks 1-4: UAT evidence + sc1-healer-phase5.yml** — `6831d93` (docs)
3. **Plan metadata** — committed via `gsd-sdk query commit` (docs)

## Files Created/Modified

- `README.md` — New `## Auto-merge prerequisites` section (D-10 stub; Phase 6 polishes)
- `.planning/phases/05-auto-merge/05-03-UAT-EVIDENCE.md` — Four-run UAT evidence record for all ROADMAP SC + subsidiary decisions
- `.planning/phases/05-auto-merge/sc1-healer-phase5.yml` — Phase 5-ready fixture dispatch workflow (for Phase 6 reference)

## Decisions Made

**1. SC#2 live happy-path deferred to Phase 6 (tier constraint)**
`Sacharified/playwright-healer-test` is private + User-owned + GitHub Free. Both prerequisites for `enablePullRequestAutoMerge` — `allow_auto_merge` repo setting and branch protection with required checks — require GitHub Pro. Plan 05-03 Task 2 explicitly accommodates this: SC#2 is verified by unit-level Test IN2 as the plan-accepted fallback, with live verification shifting to Phase 6's release fixture.

**2. D-07 demo-mode interaction documented**
The Phase 03.1 demo runs with `skip_post_fix_validation: true`, causing `validation.total === 0`. The gate's D-07 sentinel correctly reports `pass_rate | blocked | validation skipped (demo mode)` — not `eligible`. The plan's example band assumed a non-skip path. Gate behavior is correct under both paths; the difference is observable in Run 1's reconstructed band.

**3. sc1-healer-phase5.yml committed to action repo**
The fixture dispatch workflow is the live runbook for Phase 6 SC#2 happy-path verification. Committing the Phase 5 snapshot to `.planning/phases/05-auto-merge/` ensures Phase 6 has a stable starting point regardless of future changes to the fixture repo.

## Deviations from Plan

### Discovery during UAT

**1. [Documented] GitHub Free tier blocks SC#2 live happy-path**
- **Found during:** Task 2 (Run 2 + Run 2-bis live attempts)
- **Issue:** `Sacharified/playwright-healer-test` cannot enable `allow_auto_merge` (silent no-op via PATCH /repos) or branch protection rules (HTTP 403: Upgrade to GitHub Pro)
- **Resolution:** Plan 05-03 Task 2 `<behavior>` explicitly accepts unit-level IN2 as the primary SC#2 evidence. Deferred to Phase 6. Not a code defect.
- **Impact:** SC#2 coverage is unit-level only for Phase 5 close. Phase 6 release verification will confirm live end-to-end behavior.

**2. [Documented] Demo-flag + gate D-07 interaction**
- **Found during:** Task 1 (Run 1 reconstructed band)
- **Issue:** Plan's Run 1 example band showed `auto_merge | eligible | enable_auto_merge=false (informational only)` but actual Run 1 shows `auto_merge | blocked` because `skip_post_fix_validation: true` triggers D-07 (`validation.total === 0` → ineligible). The plan's example assumed a non-skip-validation scenario.
- **Resolution:** Gate behavior is correct — D-07 correctly treats demo mode as ineligible. SC#1 and SC#4 verdicts are `pass` regardless. Documented in evidence file with analysis.

---

**Total deviations:** 2 documented discoveries (not auto-fixes — both are expected boundary conditions)
**Impact on plan:** Phase 5 closes as intended. Tier constraint shifts one live verification to Phase 6 where the release fixture will be public or Pro-tier.

## Issues Encountered

Three fixture-workflow issues discovered and repaired during live UAT (committed to `Sacharified/playwright-healer-test`):

1. `sc1-healer.yml` was empty (commit `017e80b2` on 2026-05-02 had deleted all 71 lines)
2. Phase 04 made `commitSha` + `concurrencyKey` required on the dispatch contract; the manual workflow had never been updated to supply them
3. `skip_post_fix_validation` was not exposed as a workflow input, making Phase 5 gate-eligible path testing require hardcoded edits

All three repairs are committed to the fixture repo. The Phase 5-ready version is also preserved in `sc1-healer-phase5.yml` in this repo.

## User Setup Required

None — no external service configuration required for plan close.

## Next Phase Readiness

Phase 6 (Documentation + Release) can start with:
- Full README polish (expand §Auto-merge prerequisites with screenshots, example branch-protection JSON, trust-chain prerequisites)
- Public-tier or Pro-tier fixture configuration for live SC#2 / T-05-06 verification at release time
- `sc1-healer-phase5.yml` as the starting runbook for the Phase 6 release fixture
- All Phase 5 code (Plans 01 + 02) committed and tested (469/469 tests passing, tsc 0 errors)
- ROADMAP success criteria all evidenced at unit or live level

**SC#2 live verification blockers for Phase 6:**
- Fixture repo must be public or on GitHub Pro/Team to enable `allow_auto_merge` and branch protection with required checks
- The Phase 6 runbook command is documented in `05-03-UAT-EVIDENCE.md` §Live UAT runbook

---
*Phase: 05-auto-merge*
*Completed: 2026-05-02*
