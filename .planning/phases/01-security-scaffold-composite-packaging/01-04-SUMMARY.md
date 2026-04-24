---
phase: 01-security-scaffold-composite-packaging
plan: 04
subsystem: infra
tags: [composite-action, action-yml, sha-pin, input-surface, pitfall-1-mitigation, node24]

requires:
  - phase: 01-security-scaffold-composite-packaging/01-01
    provides: package.json, package-lock.json, tsx runtime dep
  - phase: 01-security-scaffold-composite-packaging/01-02
    provides: src/shared/config.ts, src/shared/security-contract.ts
  - phase: 01-security-scaffold-composite-packaging/01-03
    provides: src/index.ts (composite entry point invoked by action.yml step 3)

provides:
  - action.yml — composite GitHub Action manifest; consumer-facing entrypoint via uses: org/playwright-healer@ref
  - 01-04-setup-node-sha.txt — verified SHA sentinel for actions/setup-node@v6.4.0

affects:
  - Phase 2 (ingest): action.yml is the invocation surface for all modes
  - Phase 3 (healer): same
  - Plan 05 (security lint): lint greps action.yml for floating tags, pull_request_target, etc.
  - Plan 06 (self-test): uses: ./ points to this action.yml; depends on correct INPUT_* env block

tech-stack:
  added: []
  patterns:
    - "Composite action packaging: runs.using: composite + npm ci --production first step (ROADMAP SC#1)"
    - "SHA-pinning: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e (D-20) re-verified at execution"
    - "Pitfall 1 mitigation: explicit INPUT_* env block with hyphenated keys on run step"
    - "Hyphenated INPUT_* keys: INPUT_ANTHROPIC-API-KEY not INPUT_ANTHROPIC_API_KEY (@actions/core v3 preserves hyphens)"

key-files:
  created:
    - path: action.yml
      size_lines: 61
    - path: .planning/phases/01-security-scaffold-composite-packaging/01-04-setup-node-sha.txt
      size_lines: 1
  modified: []

key-decisions:
  - "INPUT_* env keys use hyphens (INPUT_ANTHROPIC-API-KEY) not underscores — @actions/core v3 preserves hyphens; RESEARCH §Pattern 1 and PLAN acceptance criteria were stale on this point; 01-03-SUMMARY empirical finding takes precedence"
  - "actions/setup-node SHA 48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e re-verified at execution (matches RESEARCH.md 2026-04-24 snapshot exactly — tag was not moved)"
  - "npm ci --production as first composite step (not combined with run in a single step) — D-14 SC#1 verification requires literal first-step check"
  - "No actions/checkout in action.yml — consumer checks out their own repo; action fetched to github.action_path automatically"

patterns-established:
  - "Pattern 1: All composite run steps that invoke @actions/core must have explicit env: INPUT_* block — never rely on auto-population"
  - "Pattern B: Third-party actions pinned to 40-char commit SHA with version comment; re-verified at execution time via gh api"

requirements-completed: [PKG-01, PKG-02, CFG-01, CFG-02]

duration: ~12min
completed: 2026-04-24
---

# Phase 1 Plan 04: Composite Action Manifest Summary

**Composite action.yml with 8-input surface, SHA-pinned setup-node, and load-bearing INPUT_* env block connecting Plans 01-03 into a deployable GitHub Action**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-24T~15:40Z
- **Completed:** 2026-04-24T~15:52Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Verified `actions/setup-node@v6.4.0` SHA via `gh api` — matches RESEARCH.md 2026-04-24 snapshot (`48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e`); tag was not moved
- Created `action.yml` satisfying all ROADMAP SC#1 requirements: `runs.using: composite`, `npm ci --production` as literal first step, no `dist/`, no bundler references
- Explicit 8-key `INPUT_*` env block on run step with hyphenated keys mitigates Pitfall 1 (composite INPUT_* auto-population trap) — empirically verified dry-run exits 0 with summary

## SHA Re-Verification Result

| Value | Source |
|-------|--------|
| `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` | `gh api repos/actions/setup-node/git/refs/tags/v6.4.0 --jq .object.sha` (execution-time) |
| `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` | RESEARCH.md 2026-04-24 snapshot |

**Match:** Yes — tag was not moved. Using execution-time verified value (D-20 compliance).

## INPUT_* Env Keys (step 3)

`yq -e '.runs.steps[2].env | keys' action.yml` output:
```
- INPUT_MODE
- INPUT_ANTHROPIC-API-KEY
- INPUT_HEALER-TOKEN
- INPUT_GITHUB-TOKEN
- INPUT_SETUP-COMMAND
- INPUT_START-COMMAND
- INPUT_TEST-COMMAND
- INPUT_BASE-URL
```

All 8 keys present, all hyphenated (except INPUT_MODE which has no hyphen in the original input name).

## Dry-Run Smoke Test

Verified `npx tsx src/index.ts` resolves from `github.action_path` equivalent:

```bash
env GITHUB_STEP_SUMMARY=$(mktemp) INPUT_MODE=dry-run 'INPUT_ANTHROPIC-API-KEY'=x 'INPUT_HEALER-TOKEN'=x 'INPUT_GITHUB-TOKEN'=x \
  npx --prefix /path/to/playwright-healer tsx src/index.ts
# Exit: 0
# Summary: "playwright-healer — dry-run summary" heading + 8-row table, secrets redacted
```

**Result:** Exit 0, GITHUB_STEP_SUMMARY written with correct heading and all secrets showing `(set — redacted)`. Action is ready to `uses: ./` from Plan 06 self-test workflow.

## Task Commits

1. **Task 1-04-01: Verify SHA sentinel** — `39d6fa5` (chore)
2. **Task 1-04-02: Create action.yml** — `330dd17` (feat)

## Files Created/Modified

- `action.yml` (61 lines) — composite manifest; consumer entrypoint
- `.planning/phases/01-security-scaffold-composite-packaging/01-04-setup-node-sha.txt` (1 line) — verified SHA sentinel

## Decisions Made

1. **Hyphenated INPUT_* keys** — `INPUT_ANTHROPIC-API-KEY` not `INPUT_ANTHROPIC_API_KEY`. The PLAN's action.yml template and acceptance-criteria yq checks used underscores, but the 01-03-SUMMARY empirical finding (and the critical_constraints in the execution prompt) both specify hyphens. `@actions/core` v3 `getInput('anthropic-api-key')` reads `process.env['INPUT_ANTHROPIC-API-KEY']` — hyphens preserved, not converted to underscores. The plan's template was stale; the corrected form is authoritative.

2. **SHA verified, not trusted from cache** — Re-ran `gh api` at execution time even though research was from the same day (2026-04-24). D-20's intent is "re-verify at execution time" — SHA matched exactly, confirming no tag mutation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] INPUT_* env keys use hyphens, not underscores as PLAN template shows**
- **Found during:** Task 1-04-02 pre-write analysis (01-03-SUMMARY review, critical_constraints)
- **Issue:** The PLAN's action.yml template and acceptance-criteria yq checks used `INPUT_ANTHROPIC_API_KEY` (underscores). However, `@actions/core` v3 preserves hyphens in input names when constructing env var lookup keys. Using underscores would cause `getInput('anthropic-api-key')` to return `""`, triggering the Zod `required` failure on every invocation — exactly the bug Pitfall 1 warns about.
- **Fix:** Used hyphenated form throughout: `INPUT_ANTHROPIC-API-KEY`, `INPUT_HEALER-TOKEN`, `INPUT_GITHUB-TOKEN`, `INPUT_SETUP-COMMAND`, `INPUT_START-COMMAND`, `INPUT_TEST-COMMAND`, `INPUT_BASE-URL`. `INPUT_MODE` is unaffected (no hyphen in `mode`).
- **Files modified:** `action.yml` (only file written)
- **Verification:** Dry-run smoke test: exit 0, summary written correctly with `INPUT_ANTHROPIC-API-KEY=x` passed via `env` command
- **Committed in:** 330dd17 (Task 1-04-02 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Critical correctness fix. Without it, every Zod validation would fail with empty-string input — the composite action would always fail. No scope creep.

## Issues Encountered

- yq not installed in PATH; installed via Homebrew during verification (not a plan deviation — dev environment tooling)

## Threat Mitigations Applied

| Threat ID | Status |
|-----------|--------|
| T-1-08 (supply-chain via floating tag) | Mitigated: `uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` (SHA pinned, re-verified at execution) |
| T-env-gotcha (silent input drop via missing INPUT_*) | Mitigated: all 8 INPUT_* mappings in explicit env block; 8-key length verified; dry-run smoke-test passes |
| T-dist-bundle (bundler re-introduction) | Mitigated: `runs.using: composite` (not node20/node24); no ncc/esbuild/dist/ anywhere; `[ ! -d dist ]` verified |

## Known Stubs

None — action.yml invokes `src/index.ts` which dispatches to real dry-run logic (exit 0) and Phase 2/3 stubs that throw explicitly. The stub behavior is intentional and documented in Plan 03.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. action.yml is a declaration-only manifest.

## Next Phase Readiness

- `action.yml` is ready for `uses: ./` invocation from Plan 05 (security lint workflow) and Plan 06 (self-test workflow)
- ROADMAP SC#1 verified: composite + npm ci first step + no dist/
- Phase 1 gate: Plan 05 (security lint) and Plan 06 (self-test on ubuntu-latest) remain to verify the Native SDK binary resolves on `ubuntu-latest` (`npm ci --production` installing `@anthropic-ai/claude-agent-sdk-linux-x64`)

---
*Phase: 01-security-scaffold-composite-packaging*
*Completed: 2026-04-24*

## Self-Check: PASSED

```
PASS: action.yml exists (61 lines)
PASS: .planning/phases/01-security-scaffold-composite-packaging/01-04-setup-node-sha.txt exists (1 line)
PASS: valid YAML
PASS: name == playwright-healer
PASS: runs.using == composite
PASS: 3 steps
PASS: step 0 run == npm ci --production
PASS: step 0 shell == bash
PASS: step 0 working-directory == ${{ github.action_path }}
PASS: step 1 uses matches SHA pattern
PASS: step 1 node-version == 24
PASS: step 2 run contains npx tsx src/index.ts
PASS: step 2 shell == bash
PASS: step 2 working-directory == ${{ github.action_path }}
PASS: 8 inputs declared
PASS: mode required
PASS: anthropic-api-key required
PASS: healer-token required
PASS: github-token default == ${{ github.token }}
PASS: 4 command inputs default empty
PASS: 8 env keys on step 2
PASS: INPUT_MODE mapped
PASS: INPUT_ANTHROPIC-API-KEY mapped (hyphenated)
PASS: INPUT_HEALER-TOKEN mapped
PASS: INPUT_GITHUB-TOKEN mapped
PASS: INPUT_SETUP-COMMAND mapped
PASS: INPUT_START-COMMAND mapped
PASS: INPUT_TEST-COMMAND mapped
PASS: INPUT_BASE-URL mapped
PASS: no ncc/esbuild/dist/ references
PASS: no pull_request_target
PASS: using: composite not node20/node24
PASS: no floating-tag setup-node
PASS: no actions/checkout inside composite action
PASS: no dist directory
PASS: no dist/index.js
PASS: dry-run smoke test exit 0 with correct summary
PASS: commit 39d6fa5 exists (chore: SHA sentinel)
PASS: commit 330dd17 exists (feat: action.yml)
```
