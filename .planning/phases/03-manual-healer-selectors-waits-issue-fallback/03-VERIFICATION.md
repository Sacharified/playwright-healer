---
phase: 03-manual-healer-selectors-waits-issue-fallback
verified: 2026-04-27T11:10:00Z
status: gaps_found
score: 1/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Action reproduces failure in consumer workspace and validates fix against consumer tests"
    status: failed
    reason: "HI-01: action.yml Step 5 sets working-directory to github.action_path, so start-command runs in the action's install dir, not the consumer checkout. validate() in validator.ts has no cwd parameter, so both sanity rerun (Step 4) and post-fix rerun (Step 10) run npx playwright test against the action directory — finds no tests, returns 0/N passes, misclassifies every heal as deterministic-failure."
    artifacts:
      - path: "action.yml"
        issue: "Line 156 sets working-directory: ${{ github.action_path }} on Step 5 (spawn start-command). start-command like npm run dev executes from inside the action's own node_modules directory, not from GITHUB_WORKSPACE."
      - path: "src/healer/validator.ts"
        issue: "validate(testFile, testTitle, rerunCount) has no cwd parameter (line 39). getExecOutput call (line 51) passes no cwd option, so Playwright searches for playwright.config.ts relative to process.cwd() which is the action path under the Step 6 working-directory setting."
      - path: "src/healer/index.ts"
        issue: "Both validate() call sites (lines 127 and 220) omit cwd — the orchestrator computes cwd = GITHUB_WORKSPACE at line 109 but does not thread it into validate()."
    missing:
      - "Add cwd?: string parameter to validate() in validator.ts and thread it through getExecOutput options"
      - "Thread cwd into both validate() call sites in src/healer/index.ts (sanity rerun Step 4 and post-fix rerun Step 10)"
      - "Remove or change working-directory from action.yml Step 5 so start-command executes in the consumer workspace (GITHUB_WORKSPACE); the tsx invocation should still reference github.action_path explicitly"
  - truth: "Diff-lint blocks forbidden patterns without false-positives on valid agent fixes"
    status: failed
    reason: "HI-02: The xpath-prefix forbidden pattern regex /^\\s*\\/\\//m matches any TypeScript single-line comment in an added diff line (e.g., '// Fix: use getByRole'). Any agent fix that adds a code comment will be rejected by diff-lint-blocked and routed to issue-fallback rather than a PR — the most common real-world case."
    artifacts:
      - path: "src/healer/forbidden-patterns.ts"
        issue: "Line 17: { name: 'xpath-prefix', re: /^\\s*\\/\\//m } matches TypeScript // comments, not just XPath string literals. The intent is to block page.locator('//div') XPath selectors, not code comments."
    missing:
      - "Narrow the xpath-prefix regex to match // only inside string literal context, e.g. /['\"`]\\/\\// or anchored to locator-call argument: /(?:locator|waitForSelector|getBy\\w+)\\s*\\(['\"`]\\s*\\/\\//. This avoids flagging TypeScript // comments while still catching locator('//div') XPath calls."
  - truth: "Every non-PR exit produces a structured GitHub issue (D-09 no silent failures)"
    status: failed
    reason: "HI-03: The orchestrator's inner catch at Step 6 (index.ts line 159) only intercepts BudgetExhausted. DiffApplyFailure from git apply failures, path-outside-workspace errors from bundleContext, Playwright binary not found from getExecOutput, and missing prompt template errors from assemblePrompt all propagate to the outer finally which only calls supervisorStop() and then rethrows. Consumer sees a red action run with no GitHub artifact — violates D-09 no-silent-failures invariant."
    artifacts:
      - path: "src/healer/index.ts"
        issue: "No outer catch block around the pipeline try/finally (lines 113-255). Errors that are not BudgetExhausted escape without filing an issue. The payload variable is also scoped inside the try block, making it inaccessible in any catch that would need testTitle for the issue."
    missing:
      - "Add an outer catch block that intercepts unexpected pipeline errors and files a GitHub issue using the nearest available D-09 token (no-fix-proposable is the closest for unexpected errors)"
      - "Hoist payload variable declaration before the try block so it is accessible in the catch"
      - "Add a catch-level core.setFailed so the runner still marks the step as failed"
human_verification:
  - test: "End-to-end heal pass with fixture broken selector"
    expected: "Manually trigger the healer workflow with a fixture test containing page.locator('#wrong-id') where the element is #correct-id. Verify a PR titled '[playwright-healer] Fix flaky <test title>' appears with CI checks actually running on it — not 'all checks passed' vacuously."
    why_human: "PR creation via PAT and CI triggering behavior can only be observed in a live GitHub Actions workflow run. No unit test exercises the full pipeline against a real repo."
  - test: "No zombie processes after startup timeout"
    expected: "When start-command app fails to start within startup-timeout-seconds, the action files an app-startup-timeout issue and exits cleanly. No orphaned playwright-mcp or app processes remain on the runner after the cleanup step."
    why_human: "Process lifecycle (pkill, SIGTERM delivery, PID file accuracy) requires a live runner to verify. The unit tests mock app-supervisor."
---

# Phase 3: Manual Healer (Selectors + Waits + Issue Fallback) Verification Report

**Phase Goal:** A maintainer can manually trigger the healer workflow with a fixture dispatch payload targeting a known-broken selector or timing issue; the action reproduces the failure, proposes a fix, validates it with N reruns using `retries: 0`, opens a PR using the PAT token so CI actually fires, and routes all failure paths (startup timeout, deterministic failure, diff-lint block, no fix proposable) to structured GitHub issues
**Verified:** 2026-04-27T11:10:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Broken selector fixture produces validated PR titled `[playwright-healer] Fix flaky <test title>` with CI checks running | ✗ FAILED | SC-1 is blocked by HI-01 (validator runs in action path, not consumer workspace), HI-02 (xpath-prefix false-positives block valid diffs), and HI-03 (unexpected errors produce no issue artifact). Human verification also required for live CI behavior. |
| 2  | Diff with `waitForTimeout` or `:nth-child(` blocked by diff-lint; files issue titled `[playwright-healer] <test title> is unhealable` | ✗ FAILED | SC-2 is partially broken: `waitForTimeout` and `:nth-child(` blocking is correctly implemented, but `xpath-prefix` regex (HI-02) will incorrectly block valid fixes containing TypeScript comments, causing false issue-fallback. The core blocking logic works; the false-positive undermines it. |
| 3  | Startup timeout exits cleanly and files structured issue; no zombie processes | ? UNCERTAIN | wait-for-ready.ts is implemented and tested; action.yml Step 7 pkill cleanup is present. Zombie-process guarantee requires live runner (human verification). The implementation looks correct — needs live validation. |
| 4  | Deterministic failure (0/N reruns pass on unmodified code) routes to issue-fallback | ✗ FAILED | SC-4 trips spuriously because HI-01 causes validator to run against the action directory, finding no tests and returning 0/N, misclassifying every heal as deterministic-failure. The deterministic-failure routing logic itself is correctly implemented in the orchestrator. |
| 5  | Every bot commit on a healer PR branch contains `[skip-healer]` in the commit message | ✓ VERIFIED | `applyFix()` in src/healer/fix-applier.ts (line 79) uses `SKIP_SENTINEL` imported from loop-guard.ts. 7 integration tests confirm the sentinel appears in every commit message. |

**Score:** 1/5 truths fully verified (SC-5). SC-3 is uncertain pending human verification. SC-1, SC-2 (partially), SC-4 blocked by implementation gaps.

### Required Artifacts

All 26 plan-declared files exist and are substantive:

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/shared/config.ts` | CFG-04 toggles + startupTimeoutSeconds | ✓ VERIFIED | enableSelectorFixes/enableWaitFixes/enableAssertionFixes/enableSlowFixes (boolean, default true), startupTimeoutSeconds (int min 1, default 120) |
| `src/healer/types.ts` | ContextBundle + 6 FailureMode tokens | ✓ VERIFIED | All 6 tokens present verbatim; ContextBundle matches plan interface |
| `src/healer/adapter.ts` | Adapter interface with `{ proposal, stats }` return | ✓ VERIFIED | AgentRunStats with usdSpent/turnsUsed; revised contract per checker BLOCKER #1 |
| `src/healer/dispatch-payload.ts` | Zod schema, hex SHA, P3 fixClassHint | ✓ VERIFIED | 11 tests pass; selectors/waits only; optional recentRunStats |
| `src/healer/forbidden-patterns.ts` | Frozen constants: FORBIDDEN_PATCHED_LINE_PATTERNS, ASSERTION_WEAKENING_PAIRS, TEST_PATH_ALLOWLIST | ✓ VERIFIED (with gap) | All three frozen via Object.freeze; xpath-prefix regex is too broad (HI-02) |
| `src/healer/diff-lint.ts` | Pure function lintDiff(diff) → LintFinding[] | ✓ VERIFIED (with gap) | State machine walk correct; xpath-prefix false-positive on TS comments |
| `src/healer/prompts/` | 7 markdown templates | ✓ VERIFIED | All 7 files present; trace-free variants include live-repro instruction; sandbox guardrails present |
| `src/healer/prompt-assembler.ts` | assemblePrompt() pure function | ✓ VERIFIED | Deterministic; imports FORBIDDEN_PATCHED_LINE_PATTERNS; selects trace/no-trace variant |
| `src/healer/budget.ts` | BudgetTracker + BudgetExhausted with usdSpent/turnsUsed | ✓ VERIFIED | Pre-call gate; Gemini pricing constants; stats-carrying error class |
| `src/healer/adapters/anthropic.ts` | Fail-loud stub | ✓ VERIFIED | Throws 'anthropic adapter not implemented in Phase 3' |
| `src/healer/adapters/ollama.ts` | Fail-loud stub | ✓ VERIFIED | Throws 'ollama adapter not implemented in Phase 3' |
| `src/healer/app-supervisor.ts` | PID_FILE_PATH, waitForReady, stop | ✓ VERIFIED | /tmp/playwright-healer-app-pid; redirect:manual; AppStartupTimeout class |
| `src/healer/context-bundler.ts` | bundleContext() with path safety | ✓ VERIFIED | assertWithinCwd check; first-hop imports; git blame; trace nullable |
| `src/healer/validator.ts` | validate() with --retries=0 --workers=1 | ✓ VERIFIED (with gap) | Sequential reruns; RE2-safe grep escaping; no cwd parameter (HI-01) |
| `src/healer/fix-applier.ts` | applyFix() rebase + SKIP_SENTINEL commit | ✓ VERIFIED | Rebases onto origin/defaultBranch; commit includes SKIP_SENTINEL from loop-guard |
| `src/healer/adapters/gemini.ts` | createGeminiAdapter with audit invariant, budget gate, stats | ✓ VERIFIED | Two-step audit; BudgetTracker pre-call gate; stats.usdSpent/turnsUsed on all return paths |
| `src/healer/pr-writer.ts` | openHealerPr() via PAT, PRI-01 title, PRI-02 body | ✓ VERIFIED | `new Octokit({ auth: patToken })`; title `[playwright-healer] Fix flaky <test>`; costUsd to 4 decimal places |
| `src/healer/issue-writer.ts` | openIssue() with 6 FailureMode tokens, PRI-03 title | ✓ VERIFIED | Title `[playwright-healer] <test> is unhealable`; FailureMode imported as type |
| `src/healer/index.ts` | 11-step pipeline, D-09 routing tree, cost pass-through | ✓ VERIFIED (with gap) | All 6 failure modes route to issue-writer; stats.usdSpent threaded into PR/issues; HI-03 — non-BudgetExhausted errors escape without issue |
| `src/healer/wait-for-ready.ts` | CLI entry, app-startup-timeout issue on timeout | ✓ VERIFIED | Exits 0/1/2; files app-startup-timeout issue; reads HEALER_TOKEN/GH_OWNER/GH_REPO |
| `action.yml` | 7-step composite with HEA-01/02/03/06 | ✓ VERIFIED (with gap) | commit-sha checkout; setup-command; spawn+probe; cleanup step; HI-01 — Step 5 uses wrong working-directory |
| `tests/fixtures/unified-diff-*.patch` | 5 diff fixtures | ✓ VERIFIED | All 5 present: clean, waitForTimeout, nth-child, weakened-assertion, out-of-testdir |
| `tests/fixtures/playwright-rerun-*.json` | 3 rerun fixtures | ✓ VERIFIED | passed/failed/mixed |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/healer/index.ts` | all pipeline modules | step-by-step orchestration | ✓ WIRED | All 13 imports present; all steps call the appropriate module |
| `src/healer/diff-lint.ts` | `src/healer/forbidden-patterns.ts` | `import { FORBIDDEN_PATCHED_LINE_PATTERNS, ... }` | ✓ WIRED | Single source of truth per D-17 |
| `src/healer/prompt-assembler.ts` | `src/healer/forbidden-patterns.ts` | `import { FORBIDDEN_PATCHED_LINE_PATTERNS }` for textual injection | ✓ WIRED | Defense-in-depth: agent sees forbidden list in prompt; lint checks at output |
| `src/healer/adapters/gemini.ts` | `src/shared/security-contract.ts` | `ALLOWED_TOOLS, ALLOWED_ORIGIN_TEMPLATE` | ✓ WIRED | No inline literals; two-step audit invariant |
| `src/healer/fix-applier.ts` | `src/shared/loop-guard.ts` | `SKIP_SENTINEL, BOT_EMAIL, BOT_NAME` | ✓ WIRED | Sentinel in every bot commit message |
| `src/healer/pr-writer.ts` | `@octokit/rest` | `new Octokit({ auth: patToken })` | ✓ WIRED | PAT auth; not GITHUB_TOKEN (D-20) |
| `action.yml` Step 1 | consumer checkout | `ref: inputs.commit-sha, persist-credentials: false` | ✓ WIRED | HEA-01; SEC-01 |
| `action.yml` Step 5 | `src/healer/wait-for-ready.ts` | `npx tsx src/healer/wait-for-ready.ts` | ✓ WIRED (with gap) | Wired; HI-01 — wrong working-directory causes start-command to run in action path |
| `src/healer/index.ts` | `src/healer/validator.ts` | `validate()` calls at Steps 4 and 10 | ✓ WIRED (with gap) | Called correctly; missing cwd propagation (HI-01) |
| `src/healer/index.ts` | `src/healer/issue-writer.ts` | `openIssue()` for all 5 in-orchestrator failure modes | ✓ WIRED (with gap) | 5 of 6 D-09 tokens routed (app-startup-timeout handled by wait-for-ready.ts); HI-03 — unhandled errors escape without issue |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `src/healer/pr-writer.ts` | costUsd | `stats.usdSpent` from Gemini adapter BudgetTracker | Yes — BudgetTracker accumulates from usageMetadata | ✓ FLOWING |
| `src/healer/issue-writer.ts` | failureMode | FailureMode token from orchestrator | Yes — D-09 tokens routed from real pipeline state | ✓ FLOWING |
| `src/healer/index.ts` | sanity.passRate | `validate()` return value | Yes — calls real Playwright; HI-01 means cwd is wrong on live runner | ⚠ HOLLOW — validator executes against wrong directory |
| `src/healer/adapters/gemini.ts` | proposal.diff | `generateContent` response parsed for JSON | Yes — adapter parses LLM response text | ✓ FLOWING (runtime; not testable without API key) |

### Behavioral Spot-Checks

Step 7b: SKIPPED — the healer pipeline requires live Playwright MCP and GitHub API. Unit tests mock all external interfaces; no runnable entry point is exercisable from the local filesystem without runner environment variables.

**Test suite results (automated):**

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All unit/integration tests pass | `npm test` | 230/230 tests pass (22 test files) | ✓ PASS |
| TypeScript compiles | `npm run typecheck` | Exit 0, no errors | ✓ PASS |
| DispatchPayload rejects non-hex SHA | `npx vitest run src/healer/dispatch-payload.test.ts` | 11/11 pass | ✓ PASS |
| lintDiff catches waitForTimeout | `npx vitest run src/healer/diff-lint.test.ts` | Tests pass | ✓ PASS |
| Orchestrator routes all 6 D-09 failure modes | `npx vitest run src/healer/index.test.ts` | 13/13 pass | ✓ PASS |

### Requirements Coverage

All 27 Phase 3 requirement IDs declared in the PLAN frontmatter have implementing artifacts. Coverage against REQUIREMENTS.md:

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CFG-04 | 03-01 | Per-fix-class toggles (enable-selector-fixes, enable-wait-fixes, etc.) | ✓ SATISFIED | config.ts enableSelectorFixes/enableWaitFixes/enableAssertionFixes/enableSlowFixes; action.yml inputs + INPUT_* env |
| SEC-03 | 03-10 | Playwright MCP --allowed-origins scoped to base-url + localhost | ✓ SATISFIED | gemini.ts line 77: ALLOWED_ORIGIN_TEMPLATE(baseUrl) used for --allowed-origins |
| SEC-04 | 03-10 | allowedTools explicit list; no Bash/Write/Edit | ✓ SATISFIED | Gemini adapter audit invariant; fix application is outside agent loop (fix-applier.ts); Adapter interface accepts allowedTools param |
| HEA-01 | 03-13 | Checkout dispatch SHA, not HEAD | ✓ SATISFIED | action.yml Step 1: ref: inputs.commit-sha, persist-credentials: false |
| HEA-02 | 03-06, 03-13 | App-supervisor readiness probe | ✓ SATISFIED | waitForReady() polls base-url; action.yml Step 5 calls wait-for-ready.ts |
| HEA-03 | 03-13 | Startup timeout → structured issue + clean exit | ✓ SATISFIED | wait-for-ready.ts exits 1 + calls openIssue('app-startup-timeout') |
| HEA-04 | 03-07 | Context bundler with test file + first-hop imports + git blame | ✓ SATISFIED | context-bundler.ts: testFileSource, firstHopImports, gitBlame, traceAttachmentPath, recentErrorMessages |
| HEA-05 | 03-04, 03-07 | Trace-free prompt variant when trace.zip missing | ✓ SATISFIED | assemblePrompt selects -no-trace variant when traceAttachmentPath is null; prompt instructs live repro via Playwright MCP |
| HEA-06 | 03-12, 03-13 | Cleanup on every exit path | ✓ SATISFIED | index.ts try/finally calls supervisorStop(); action.yml Step 7 pkill always() |
| FIX-01 | 03-10 | Provider adapter selected by config.provider | ✓ SATISFIED | orchestrator switch: gemini → createGeminiAdapter; anthropic/ollama → stubs |
| FIX-02 | 03-05 | Agent constrained by maxTurns + maxBudgetUsd pre-call gate | ✓ SATISFIED | BudgetTracker.assertCanProceed() before each generateContent call |
| FIX-03 | 03-04 | System prompt forbids waitForTimeout, nth-child, positional selectors, files outside test dir | ✓ SATISFIED | role-guardrails.md + selectors/waits templates include forbidden list via FORBIDDEN_PATCHED_LINE_PATTERNS injection |
| FIX-04 | 03-02 | Agent returns { rootCause, fixClass, diff, rationale } | ✓ SATISFIED | FixProposal interface; Gemini adapter parseFinalText() extracts fields; NoFixProposable as alternate |
| FIX-05 | 03-09 | Fix-applier rebases onto origin/defaultBranch before applying | ✓ SATISFIED | applyFix(): git fetch, checkout -B from origin, git apply --3way |
| FIX-06 | 03-03 | Diff-lint blocks anti-patterns before PR | ✓ SATISFIED (with gap) | lintDiff() called in orchestrator Step 8; waitForTimeout/nth-child/assertion-weakening/out-of-testdir blocked; xpath-prefix overly broad (HI-02) |
| FIX-08 | 03-12 | NoFixProposable or diff-lint failure routes to issue | ✓ SATISFIED (with gap) | Steps 7 and 8 in orchestrator correctly route; HI-03 — unhandled errors bypass issue routing |
| VAL-01 | 03-08 | Re-run with retries=0, workers=1 | ✓ SATISFIED | validate() passes --retries=0 --workers=1 verbatim |
| VAL-02 | 03-08 | Record each re-run outcome + duration | ✓ SATISFIED | RunResult per iteration; ValidationResult.perRun[] |
| VAL-03 | 03-08 | Accept only if passRate >= rerunPassRate | ✓ SATISFIED | Orchestrator Step 10: validation.passRate < config.rerunPassRate → validation-failed issue |
| VAL-04 | 03-08 | Same app instance; no restart between reruns | ✓ SATISFIED | Sequential for-loop in validate(); no app-supervisor restart between iterations; documented limitation |
| VAL-05 | 03-11 | Validation results in PR description and step summary | ✓ SATISFIED | renderPrBody() includes per-run table; core.summary.addRaw().write() for D-11 parity |
| PRI-01 | 03-11 | PR titled `[playwright-healer] Fix flaky <test title>` | ✓ SATISFIED | pr-writer.ts line 69: `[playwright-healer] Fix flaky ${args.testTitle}` |
| PRI-02 | 03-11 | PR body includes root cause, fix class, validation, cost, links, Signed-off | ✓ SATISFIED | renderPrBody() builds all required sections; costUsd.toFixed(4); `Signed-off: playwright-healer-bot` |
| PRI-03 | 03-11 | Issue titled `[playwright-healer] <test title> is unhealable` | ✓ SATISFIED | issue-writer.ts line 45: `[playwright-healer] ${args.testTitle} is unhealable` |
| PRI-05 | 03-12 | Deterministic failure (0/N) → issue-fallback, never PR | ✓ SATISFIED (with gap) | Logic correct in orchestrator Step 4; HI-01 causes false positives on live runner |
| PRI-06 | 03-09 | Bot commits contain `[skip-healer]` | ✓ SATISFIED | SKIP_SENTINEL imported from loop-guard.ts; every applyFix commit message ends with it; 7 integration tests confirm |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/healer/forbidden-patterns.ts` | 17 | xpath-prefix regex `/^\s*\/\//m` matches TS `// comments` | Blocker | Every agent fix adding a code comment rejected as diff-lint-blocked; SC-1 and SC-2 broken |
| `src/healer/validator.ts` | 39 | `validate()` has no cwd parameter | Blocker | Playwright runs against action install directory; finds no tests; 0/N pass; every heal = deterministic-failure false-positive |
| `action.yml` | 156 | Step 5 `working-directory: ${{ github.action_path }}` | Blocker | start-command runs from action dir, not consumer workspace; app cannot start from wrong location |
| `src/healer/index.ts` | 113-255 | Only BudgetExhausted caught; all other pipeline errors escape without filing issue | Blocker | D-09 no-silent-failures violated; consumer sees red run with no actionable GitHub artifact |
| `src/healer/index.ts` | 156 | `adapter.runAgent(context, systemPrompt, [])` — empty allowedTools | Warning | ME-02: Gemini ignores it today; future Anthropic adapter would interpret empty as "all tools allowed" — latent security regression |
| `src/healer/adapters/gemini.ts` | 106 | `'browser_*'` inline literal for audit invariant second step | Warning | ME-01: inline MCP tool pattern outside security-contract.ts contradicts D-13; security reviewers cannot audit from security-contract.ts alone |
| `src/healer/adapters/gemini.ts` | 119-121 | System prompt concatenated into user-role message | Info | ME-03: GenAI SDK supports systemInstruction for true system-role isolation; mixing into user content weakens injection isolation per PITFALLS §4 |
| `action.yml` | 166-167 | `bash -c "${{ inputs.start-command }}" &; echo $! > PID_FILE` | Info | ME-04: $! captures the bash wrapper PID, not the app process PID; SIGTERM to wrapper may not propagate to app |

### Human Verification Required

#### 1. End-to-end heal with fixture broken selector (SC-1)

**Test:** After closing the three gaps above, trigger the healer workflow manually with inputs pointing to a fixture test containing `page.locator('#wrong-id')` where the element is `#correct-id`.
**Expected:** A PR titled `[playwright-healer] Fix flaky <test title>` appears in the repository with CI checks actually running (not the vacuous "all checks passed" that GITHUB_TOKEN would produce).
**Why human:** PAT vs GITHUB_TOKEN CI triggering behavior is only observable in a live GitHub Actions run. Unit tests mock the Octokit call.

#### 2. No zombie processes after startup timeout (SC-3)

**Test:** Configure a start-command that never starts, with startup-timeout-seconds set to 10. Trigger a heal pass. After the workflow completes, check the runner for residual playwright-mcp or application processes.
**Expected:** Action files an `app-startup-timeout` issue. All processes are cleaned up by Step 7 pkill. No port conflicts on the next run.
**Why human:** Process lifecycle (SIGTERM delivery, PID file accuracy under the exec vs bash wrapper issue ME-04, pkill targeting) requires a live runner to verify reliably.

### Gaps Summary

Three implementation gaps block goal achievement:

**Gap 1 — Wrong working directory (HI-01):** Step 5 of action.yml sets `working-directory: ${{ github.action_path }}` when spawning the consumer's `start-command`. The consumer app (`npm run dev`, etc.) needs to run from `GITHUB_WORKSPACE` where the consumer repo is checked out, not the action's install directory. This also propagates into `validator.ts` which has no `cwd` parameter — both sanity reruns and post-fix reruns use the action directory instead of the consumer workspace. On a live runner, this causes every heal to produce a deterministic-failure false-positive (Playwright finds no tests in the action directory, returns 0/N, trips the PRI-05 sanity gate). This gap makes SC-1, SC-2, and SC-4 unachievable.

**Gap 2 — xpath-prefix false-positive (HI-02):** The `xpath-prefix` forbidden pattern uses `/^\s*\/\//m` which matches any TypeScript `// comment` on an added diff line. An agent fix that adds a comment like `// Use accessible role selector instead of positional XPath` would be rejected by diff-lint and routed to issue-fallback. This breaks SC-1 and SC-2 for the common real-world case where the agent annotates its fix with comments.

**Gap 3 — Silent pipeline failures (HI-03):** The orchestrator catch at Step 6 only intercepts `BudgetExhausted`. `DiffApplyFailure` (from `git apply` errors), path-traversal errors from `bundleContext`, Playwright binary not found, and missing prompt template file errors all escape to the outer `finally` (which only runs `supervisorStop()`) and rethrow. Consumer sees a red run with no GitHub issue — D-09's "no silent failures" invariant is violated.

All three gaps are correctness failures, not hardening deficiencies. They block the goal's primary success paths. The 230-test suite passes because tests mock all external interfaces — the gaps are only observable on a live runner.

---

_Verified: 2026-04-27T11:10:00Z_
_Verifier: Claude (gsd-verifier)_
