---
status: partial
phase: 03-manual-healer-selectors-waits-issue-fallback
source: [03-VERIFICATION.md]
started: 2026-04-27T15:15:00Z
updated: 2026-04-29T17:30:00Z
test_1_status_correction:
  prior_claim: "result: pass (verified 2026-04-28 — PR opened on Sacharified/playwright-healer-test)"
  reality: "FALSE PASS — gh pr list -R Sacharified/playwright-healer-test --state all --limit 5 returns []. There are zero PRs on the fixture repo. The most recent sc1-healer.yml run (25023732794, 2026-04-27 22:50) failed at the Debug step before the action's heal step ran. All 5 dispatches that ever fired on this fixture repo failed at the same diagnostic step. The agent loop has never been exercised against a real LLM in real CI."
  cause: "Misread of user's 'Now pr was created' message — should have demanded a PR URL before marking PASS. No verification step that would have caught this (the UAT marker was a textual claim, not a CLI-checked artifact)."
  rectification: "Test 1 reverted to pending. Phase 03.1 (INSERTED 2026-04-29) exists specifically to make Test 1 actually pass — see .planning/phases/03.1-first-heal-end-to-end-demo/03.1-CONTEXT.md."
test_2_status: "PASS confirmed independently via phase1-self-test.yml Scenario 7 on run 25110355292 — empirical evidence is solid, no correction needed."
g01_resolved_via: .planning/phases/01.2-fix-npx-tsx-env-var-stripping-in-composite-action-runtime/01.2-01-SUMMARY.md
g01_resolved_evidence: |
  Phase 01.2 deployed `./node_modules/.bin/tsx` at both action.yml call sites + new
  self-test-hyphenated-input-env regression job. Live ubuntu-latest run on 2026-04-27
  shows the regression job green — hyphenated INPUT_* env vars survive the spawn shape
  on the real runner. Job A of Scenario 1 (self-test-masking) also runs end-to-end
  to completion, confirming `getInput('healer-token', { required: true })` no longer
  throws. SC-1 / SC-3 are unblocked at the env-var layer; remaining Test 1 + Test 2
  re-attempt is independent of the env-var bug.
---

## Current Test

number: 1
name: End-to-end heal pass with fixture broken selector
expected: |
  RECTIFIED 2026-04-29: Test 1's prior PASS was based on a textual claim
  ("Now pr was created") that was never verified against the fixture repo
  via gh CLI. There is in fact NO PR on Sacharified/playwright-healer-test;
  all dispatched sc1-healer.yml runs failed at a stale diagnostic step.
  Phase 03.1 (INSERTED) exists to actually make Test 1 pass — re-run this
  test once Phase 03.1 ships its first successful end-to-end demo dispatch.
awaiting: Phase 03.1 to land the first successful e2e dispatch; then re-attempt this test against a fresh sc1-healer.yml run and the resulting PR

## Tests

### 1. End-to-end heal pass with fixture broken selector

expected: Manually trigger the healer workflow with a fixture test containing
`page.locator('#wrong-id')` where the actual element is `#correct-id`. Verify a
PR titled `[playwright-healer] Fix flaky <test title>` appears with CI checks
actually running on it — not a vacuous "all checks passed" with zero check runs.
PR creation requires a PAT (`healer-token` input) — `GITHUB_TOKEN` cannot trigger
downstream CI on bot-opened PRs (GitHub recursion guard).

result: pending

prior_result_rectified_2026-04-29: |
  Was marked "pass" 2026-04-28 based on user's "Now pr was created" message.
  That claim was never verified against the fixture repo via gh CLI. Reality
  check 2026-04-29:
    $ gh pr list -R Sacharified/playwright-healer-test --state all --limit 5
    []                                                       ← zero PRs, ever
    $ gh run list -R Sacharified/playwright-healer-test --workflow sc1-healer.yml
    5 runs, all conclusion: failure, all 2026-04-27, all failing at the
    Debug step (ERR_PACKAGE_PATH_NOT_EXPORTED from tsx's CJS loader on
    @actions/core@3.0.1's ESM-only exports field) before the action's
    heal step ever ran.

  The healer pipeline has never been exercised against a real LLM in real CI.
  Phase 03 shipped infrastructure — orchestrator, Gemini adapter with real
  GoogleGenAI + MCP integration, prompt-assembler, fix-applier, validator,
  PR-writer, issue-writer — but the integration was never end-to-end demonstrated.

  Phase 03.1 (INSERTED 2026-04-29) exists specifically to fix this gap. See
  .planning/phases/03.1-first-heal-end-to-end-demo/03.1-CONTEXT.md.

awaiting: Phase 03.1's first successful e2e dispatch; then re-attempt this test against a fresh sc1-healer.yml run and the resulting PR (verify via `gh pr list` and `gh pr diff`, not just textual claim)

residual_concerns:
  - The diagnostic Debug step in sc1-healer.yml (the npm-installed @actions/core
    getInput sub-test) crashes with `ERR_PACKAGE_PATH_NOT_EXPORTED` because tsx's
    CJS loader does not honor @actions/core@3.0.1's ESM-only `exports` field via
    `require()`. This is a tsx-vs-Node-ESM diagnostic issue; the production action
    uses ESM `import`, so it's unaffected. The diagnostic step should be removed
    or wrapped with `continue-on-error: true` to avoid flaky reruns of sc1-healer.yml.
    Filed as a low-severity workflow-hygiene item, not a Phase 03 blocker.
  - CI-fired-on-PR confirmation (the "not vacuous all checks passed" sub-criterion
    of Test 1's expected) is implicit in PR creation via PAT — the healer-token PAT
    is exactly the path that bypasses GitHub's recursion guard, so fixture-ci.yml
    should fire on the bot-opened PR. Spot-confirm on the actual PR if needed.

evidence:
- Throwaway fixture repo created: Sacharified/playwright-healer-test (private clone of playwright-healer at SHA 40cc6c9 + Express app with `<button id="correct-id">` + Playwright test using `#wrong-id` + 2 workflows: sc1-healer.yml dispatch + fixture-ci.yml on PR)
- Three runs attempted on 2026-04-27:
  - 25006212165 (initial): failed at action input validation
  - 25009034721 (after secret reset): same failure
  - 25009578022 (with diagnostic): same failure, root cause confirmed
- Diagnostic on run 25009578022:
  - bash printenv: `INPUT_HEALER-TOKEN len=93` (env var transits to bash)
  - `node -e "process.env['INPUT_HEALER-TOKEN'].length"`: 93 ✓ (Node sees it)
  - `npx tsx -e "process.env['INPUT_HEALER-TOKEN'].length"`: 0 ✗ (npx tsx STRIPS it)
  - `npx tsx -e "process.env['INPUT_HEALER_TOKEN_UNDERSCORE'].length"`: 93 ✓ (underscored names survive)
- Pre-existing: Sacharified/playwright-healer's phase1-self-test workflow has been failing
  with the identical symptom on every run since 2026-04-25 (per `gh run list -R Sacharified/playwright-healer --workflow phase1-self-test.yml`). The bug was caught
  by CI but not surfaced into VERIFICATION because the unit tests (which mock @actions/core
  directly) bypass the npx tsx invocation chain.

root_cause: action.yml Step 6 invokes the agent via `npx tsx src/index.ts`. The npx →
tsx → node spawn chain drops environment variables whose names contain hyphens. Every
hyphenated input (INPUT_HEALER-TOKEN, INPUT_API-KEY, INPUT_GITHUB-TOKEN, INPUT_BASE-URL,
INPUT_SETUP-COMMAND, INPUT_START-COMMAND, INPUT_TEST-COMMAND, INPUT_API-ENDPOINT,
INPUT_REPORT-PATH, INPUT_FLAKE-RATE-THRESHOLD, INPUT_FLAKE-WINDOW-DAYS, INPUT_SLOW-REGRESSION-PCT,
INPUT_RERUN-COUNT, INPUT_RERUN-PASS-RATE, INPUT_MAX-BUDGET-USD, INPUT_MAX-TURNS,
INPUT_RETENTION-DAYS, INPUT_MAX-HEALS-PER-TEST-PER-WEEK, INPUT_ENABLE-SELECTOR-FIXES,
INPUT_ENABLE-WAIT-FIXES, INPUT_ENABLE-ASSERTION-FIXES, INPUT_ENABLE-SLOW-FIXES,
INPUT_STARTUP-TIMEOUT-SECONDS) reaches the spawned Node process as empty, breaking
`core.getInput()` for every required input.

candidate_fixes (require Phase 01.2 gap-closure plan):
1. Replace `npx tsx src/index.ts` with `./node_modules/.bin/tsx src/index.ts` to bypass npx's spawn behavior.
2. Replace tsx entirely — compile to JS at build time and invoke `node dist/index.js`.
3. Bridge env vars in a bash preamble that reads from /proc/self/environ (since bash itself can't reference hyphenated names) and re-exports under underscored names. Requires also patching @actions/core call sites to use the new names.

Recommendation: option (1) is the smallest blast-radius fix; option (2) is the proper Phase 6 release shape (no runtime tsx).

### 2. No zombie processes after startup timeout / clean app PID cleanup

expected: Configure a `start-command` that intentionally never reaches the
`base-url` ready state, with `startup-timeout-seconds: 10`. After workflow
completes, verify no orphaned `playwright-mcp`, `chromium`, or app processes
remain on the runner. Specifically per IN-01: when `start-command` is
`npm run dev`, verify SIGTERM propagation from the npm wrapper PID (captured
by Step 5's `bash -c "exec ${start-command}"` spawn) reaches the underlying
node child. The outer `pkill` cleanup (action.yml Step 7, D-12 layer 2) is
the safety net.

result: pass

verified_at: 2026-04-29
verified_via: phase1-self-test.yml Scenario 7 (self-test-startup-timeout-cleanup) on run 25110355292
verified_run_url: https://github.com/Sacharified/playwright-healer/actions/runs/25110355292
verified_evidence: |
  Added a new self-test scenario that mimics the npm-run-dev signal-propagation shape:
  /tmp/never-ready.sh is a bash wrapper that backgrounds a child node process
  (`process.title = "never-ready-marker"`) and installs a TERM trap to forward
  SIGTERM to the child. Action invoked with mode=heal, provider=ollama (no real PAT
  or LLM call required), start-command=/tmp/never-ready.sh, startup-timeout-seconds=10.
  
  Live ubuntu-latest run on 2026-04-29 produced these assertions in the cleanup
  verification step:
  
    Wrapper recorded: wrapper-pid=2229 child-node-pid=2231
    Action captured app PID: 2229
    OK: action failed as expected (Step 5 wait-for-ready hit 10s timeout)
    OK: captured app PID 2229 is dead
    OK: never-ready-marker child node is dead — wrapper-to-child SIGTERM propagation verified (IN-01)
    OK: no playwright-mcp processes
    OK: no chromium processes
    OK: zombie-process check passed — Step 7 cleanup + IN-01 wrapper-to-child SIGTERM both functional
  
  All four cleanup contracts verified empirically:
    1. Step 5 timeout fires correctly at 10s (action exits with outcome=failure)
    2. Step 7 (`if: always()`) kills the captured wrapper PID (2229)
    3. The wrapper's SIGTERM trap propagates to the child node PID (2231) — the IN-01
       contract is honored under the npm-run-dev-shaped fixture
    4. No leaked playwright-mcp / chromium processes
  
  All 8 jobs in run 25110355292 conclusion success — including the new Scenario 7,
  the existing 6 scenarios + verify-log-mask Job B, and the Phase 01.2 hyphenated-input-env
  regression job.

residual_concerns:
  - The wrapper used in Scenario 7 is a hand-rolled bash trap rather than an actual
    `npm run dev` invocation. npm@10+ implements equivalent signal forwarding via
    its run-script wrapper; if a future Phase 03 plan changes the signal-handling
    contract on the action side (e.g., introducing a process-group SIGTERM via
    `kill -TERM -<pgid>`), revisit whether the bash-trap fixture still proves IN-01
    under the new contract — or replace the fixture with `npm run never-ready` against
    a real `package.json` script.

result: [pending]

## Summary

total: 2
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0
note: "Test 1 reverted from PASS to pending 2026-04-29 after rectification — see Test 1's prior_result_rectified_2026-04-29 block. Test 2 PASS is solid (Scenario 7 on run 25110355292 has CLI-verifiable evidence)."

## Gaps

### G-01 — npx tsx strips hyphenated env vars (blocks SC-1 + SC-3 verification)

severity: high
phase_origin: 01-security-scaffold-composite-packaging
detected_via: SC-1 live verification on Sacharified/playwright-healer-test run 25009578022
status: resolved
resolved_in: 01.2-fix-npx-tsx-env-var-stripping-in-composite-action-runtime
resolved_at: 2026-04-27T20:30:00Z
resolution_evidence: |
  Phase 01.2 replaced `npx tsx` with `./node_modules/.bin/tsx` at both action.yml
  call sites (Step 5 wait-for-ready.ts and Step 6 src/index.ts). Live ubuntu-latest
  run on 2026-04-27 shows the new self-test-hyphenated-input-env regression job
  green (`OK: INPUT_FOO-BAR survived spawn`), and Scenario 1 Job A (self-test-masking)
  runs end-to-end to completion — direct confirmation that
  `getInput('healer-token', { required: true })` no longer throws on the real runner.
  See `01.2-01-SUMMARY.md` and `01.2-VERIFICATION.md`.
description: action.yml Step 6 invokes the action's runtime via `npx tsx src/index.ts`.
  The npx-tsx-node spawn chain drops env vars with hyphens in their names (verified
  empirically: `node -e ...` preserves them, `npx tsx -e ...` does not). Every
  hyphenated INPUT_* env var arrives at the Node process as empty string, breaking
  every `core.getInput()` call for those inputs. This blocks any heal/dry-run/ingest
  invocation in real CI — the action exits at startup with "Input required and not
  supplied: healer-token".
recommended_remediation: Replace `npx tsx src/index.ts` with `./node_modules/.bin/tsx src/index.ts`
  in action.yml Step 6 (and the Step 5 `wait-for-ready.ts` invocation, same shape).
  Add a regression test step in phase1-self-test.yml that asserts a hyphenated
  INPUT_* var survives `npx tsx`-style spawn.
followup: SC-1 / SC-3 can now be re-attempted on the fixture repo.
