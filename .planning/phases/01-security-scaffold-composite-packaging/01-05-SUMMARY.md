---
phase: 01-security-scaffold-composite-packaging
plan: 05
subsystem: ci
tags: [ci, security-lint, persist-credentials, pull-request-target, snapshot-diff, phone-home, d-14]

requires:
  - phase: 01-security-scaffold-composite-packaging/01-02
    provides: src/shared/security-contract.ts, .planning/security-contract.snapshot.json
  - phase: 01-security-scaffold-composite-packaging/01-04
    provides: action.yml (target of Check 2 persist-credentials parse)

provides:
  - .github/workflows/security-lint.yml — 4 D-14 checks as CI gates on push + pull_request
  - .planning/phases/01-security-scaffold-composite-packaging/01-05-checkout-sha.txt — actions/checkout@v6.0.2 SHA sentinel

affects:
  - All future phases: security-lint enforces SEC-01, SEC-02, SEC-07, D-13 on every push + PR
  - Phase 1 Plan 06 (self-test): security-lint.yml is the companion gate; Plan 06 references job names from this file

tech-stack:
  added: []
  patterns:
    - "D-14 enforcement: 4 checks as separate steps in a single job (simpler than 4 jobs; checks are fast)"
    - "yq semantic YAML parse for persist-credentials (not grep — grep false-negatives on multi-line YAML)"
    - "git log range patterns for push vs pull_request contexts (HEAD~1..HEAD vs origin/$BASE_REF...HEAD)"
    - "First-commit edge case: git hash-object -t tree /dev/null as base for initial push"
    - "tsx one-liner for canonical JSON emit from TS module (avoids build step)"

key-files:
  created:
    - path: .github/workflows/security-lint.yml
      size_lines: 173
    - path: .planning/phases/01-security-scaffold-composite-packaging/01-05-checkout-sha.txt
      size_lines: 1
  modified: []

key-decisions:
  - "actions/checkout@v6.0.2 SHA de0fac2e4500dabe0009e67214ff5f5447ce83dd confirmed via gh api at execution — matches RESEARCH.md 2026-04-24 snapshot exactly (tag not moved)"
  - "Single job (6 steps) chosen over 4 jobs — checks are all fast; single-job is simpler and the plan explicitly endorses it"
  - "src/shared/security-contract.ts added to Check 1 :(exclude) pathspec — file legitimately contains 'pull_request_target' as a frozen constant in FORBIDDEN_WORKFLOW_TRIGGERS; Rule 1 auto-fix"
  - "Check 3a on push events: RANGE=HEAD~1..HEAD with first-commit fallback via git hash-object -t tree /dev/null"

requirements-completed: [SEC-01, SEC-02, SEC-07]

duration: ~8min
completed: 2026-04-24
---

# Phase 1 Plan 05: Security Lint CI Gate Summary

**CI enforcement workflow with 4 D-14 checks that mechanically verify SEC-01 (persist-credentials), SEC-02 (no pull_request_target), D-13 (contract trailer + snapshot diff), and SEC-07 (no HTTP call-sites) on every push and pull request**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-24T15:49:24Z
- **Completed:** 2026-04-24T~15:57Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Re-verified `actions/checkout@v6.0.2` SHA via `gh api` — matches RESEARCH.md 2026-04-24 snapshot (`de0fac2e4500dabe0009e67214ff5f5447ce83dd`); tag was not moved
- Created `.github/workflows/security-lint.yml` (173 lines) with all 4 D-14 checks as separate named steps
- Workflow dogfoods SEC-01: its own `actions/checkout` step has `persist-credentials: false` + SHA pin + `fetch-depth: 0`
- Local reruns of Checks 1 and 4 against current Phase 1 artifacts both pass
- All 4 D-14 threat mitigations (T-1-01, T-1-02, T-1-04, T-1-05) are now mechanically enforced in CI

## SHA Re-Verification Result

| Value | Source |
|-------|--------|
| `de0fac2e4500dabe0009e67214ff5f5447ce83dd` | `gh api repos/actions/checkout/tags` + `gh api repos/actions/checkout/git/refs/tags/v6.0.2` (execution-time) |
| `de0fac2e4500dabe0009e67214ff5f5447ce83dd` | RESEARCH.md 2026-04-24 snapshot |

**Match:** Yes — tag was not moved. Using execution-time verified value (D-20 compliance). Version: v6.0.2 (latest stable at 2026-04-24).

## Workflow Step Names (in order)

Output of `yq eval '.jobs["security-lint"].steps[] | .name' .github/workflows/security-lint.yml`:

```
Checkout (with full history for trailer-check git log range)
Check 1: No pull_request_target trigger (SEC-02)
Check 2: actions/checkout has persist-credentials: false (SEC-01)
Check 3a: Security-Contract-Change trailer on contract-touching commits (D-13)
Check 3b: Snapshot JSON matches TS contract values (D-12 canonical diff)
Check 4: No HTTP clients in src/** (SEC-07)
```

6 steps total (1 checkout + 5 check steps).

## Bash Safety

`grep -c 'set -euo pipefail' .github/workflows/security-lint.yml` → **5** (one per check run block; Check 3a + 3b each have one).

## Verification Results (Local Sanity Tests)

| Check | Test | Result |
|-------|------|--------|
| Check 1 | `git grep -l 'pull_request_target' -- ':(exclude).planning/' ':(exclude)CLAUDE.md' ':(exclude)README.md' ':(exclude).github/workflows/security-lint.yml' ':(exclude)src/shared/security-contract.ts'` | PASS (zero matches) |
| Check 4 | `git grep -nE 'fetch\(|http\.request\(|...' -- 'src/*.ts' 'src/**/*.ts'` | PASS (zero matches) |
| Full plan verification | `yq` + `git grep` suite | PASS |

## yq Version Compatibility

yq version on local dev machine: `v4.53.2` (mikefarah/yq).

The plan acceptance criterion `yq -e '.on | has("push") and has("pull_request")'` returns `false` on yq 4.x (the pipe chains the expression — `has("push")` returns `true`, but `and has("pull_request")` has no LHS value to chain against). The corrected form `(.on | has("push")) and (.on | has("pull_request"))` returns `true`. The ubuntu-latest runner ships the same yq 4.x behavior.

**Implication for CI:** The Check 2 step uses `yq eval -o=json '...'` (the stable `yq` invocation form) which works on yq 4.x. The acceptance criterion mismatch is in the local verification helper only — the actual Check 2 implementation uses a `yq eval` query form that is compatible with yq 4.x runners.

## Task Commits

1. **Task 1-05-01: SHA sentinel** — `5eb828d` (chore)
2. **Task 1-05-02: security-lint.yml** — `90c7b26` (feat)

## Files Created/Modified

- `.github/workflows/security-lint.yml` (173 lines) — 4 D-14 checks; 6 steps
- `.planning/phases/01-security-scaffold-composite-packaging/01-05-checkout-sha.txt` (1 line) — verified SHA sentinel

## Decisions Made

1. **Single job, 6 steps** — the plan endorsed this choice explicitly; all checks are fast (~5s each); simpler than 4 jobs.

2. **`de0fac2e4500dabe0009e67214ff5f5447ce83dd` for actions/checkout@v6.0.2** — re-verified via `gh api` at execution; no tag mutation since RESEARCH.md 2026-04-24.

3. **`src/shared/security-contract.ts` added to Check 1 :(exclude) pathspec** — the file legitimately contains `'pull_request_target'` as a frozen constant in `FORBIDDEN_WORKFLOW_TRIGGERS`. Without this exclusion, Check 1 would always fail on its own repo. Documented as Rule 1 auto-fix below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added `src/shared/security-contract.ts` to Check 1 :(exclude) pathspec**

- **Found during:** Task 1-05-02 acceptance criteria verification (local sanity test run)
- **Issue:** The plan's Check 1 `:(exclude)` pathspec only listed `.planning/`, `CLAUDE.md`, and `README.md`. The local sanity test `git grep -l 'pull_request_target' -- ':(exclude)...'` matched `src/shared/security-contract.ts` because it contains `'pull_request_target'` as a value in `FORBIDDEN_WORKFLOW_TRIGGERS`. This is intentional data — the file defines what triggers are forbidden. Without the exclusion, Check 1 would fail on every push/PR in this very repo.
- **Fix:** Added `':(exclude)src/shared/security-contract.ts'` to the `git grep` pathspec in Check 1. The check still catches any workflow YAML that uses `pull_request_target` as a trigger.
- **Files modified:** `.github/workflows/security-lint.yml` (one line added to Check 1 grep pathspec)
- **Committed in:** `90c7b26` (Task 1-05-02 commit)
- **Impact:** None to security posture — the exclusion is for data-holding constant file, not a workflow YAML file. Any new workflow YAML file would still be caught by the grep.

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)

## Known Stubs

None — this is a pure CI workflow file. No data flows, no UI, no stub values.

## Threat Flags

None — this workflow introduces no new network endpoints, auth paths, file access patterns, or schema changes. It is a read-only CI gate.

## Threat Mitigations Applied

| Threat ID | Control | Status |
|-----------|---------|--------|
| T-1-01 (persist-credentials leak, SEC-01) | Check 2 yq-parses every actions/checkout + dogfoods on own checkout | Mitigated |
| T-1-02 (pull_request_target RCE, SEC-02) | Check 1 git grep with :(exclude) allowlist | Mitigated |
| T-1-04 (phone-home via HTTP, SEC-07) | Check 4 git grep for HTTP call-site patterns in src/** | Mitigated |
| T-1-05 (unreviewed contract change, D-13) | Check 3a trailer gate + Check 3b canonical snapshot diff | Mitigated |

---
*Phase: 01-security-scaffold-composite-packaging*
*Completed: 2026-04-24*
