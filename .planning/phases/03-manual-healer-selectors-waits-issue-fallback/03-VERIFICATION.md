---
phase: 03-manual-healer-selectors-waits-issue-fallback
verified: 2026-04-27T15:30:00Z
revised: 2026-04-27T15:11:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 1/5
  gaps_closed:
    - "Action reproduces failure in consumer workspace and validates fix against consumer tests (HI-01)"
    - "Every non-PR exit produces a structured GitHub issue (D-09 no silent failures) (HI-03)"
    - "Diff-lint blocks forbidden patterns without false-positives on valid agent fixes (HI-02 + WR-01 — closed in commit 86c8cb0)"
  gaps_partially_closed: []
  gaps_remaining: []
  regressions: []
gaps: []
post_verification_fix:
  finding: WR-01
  closed_in: 86c8cb0
  description: "Narrowed xpath-prefix regex to /(?:locator|waitForSelector)\\s*\\(\\s*['\"`]\\/\\// per verifier's prescribed remediation. Flipped the diff-lint.test.ts assertion from toBe(true) to toBe(false) (now: 'does NOT flag getByText with // literal-text argument'). Added a guard test covering getByLabel / getByRole / getByPlaceholder / getByAltText / getByTestId with literal-text arguments starting with //. 241 tests pass (was 240 — added one guard test); typecheck clean."
human_verification:
  - test: "End-to-end heal pass with fixture broken selector"
    expected: "Manually trigger the healer workflow with a fixture test containing page.locator('#wrong-id') where the element is #correct-id. Verify a PR titled '[playwright-healer] Fix flaky <test title>' appears with CI checks actually running on it — not 'all checks passed' vacuously."
    why_human: "PR creation via PAT (vs vacuous GITHUB_TOKEN behavior) and CI triggering can only be observed in a live GitHub Actions workflow run. No unit test exercises the full pipeline against a real repo."
  - test: "No zombie processes after startup timeout / clean cleanup of app PID"
    expected: "Configure a start-command that never starts, with startup-timeout-seconds set to 10. After workflow completes, no orphaned playwright-mcp or app processes remain on the runner. Per IN-01: when start-command is 'npm run dev', verify SIGTERM propagation from the npm wrapper PID (captured by exec spawn) reaches the underlying node child."
    why_human: "Process lifecycle (SIGTERM propagation through npm/pnpm wrappers, pkill targeting, PID-file cleanup race) requires a live runner. Unit tests mock app-supervisor entirely."
---

# Phase 3: Manual Healer (Selectors + Waits + Issue Fallback) Verification Report

**Phase Goal:** A maintainer can manually trigger the healer workflow with a fixture dispatch payload targeting a known-broken selector or timing issue; the action reproduces the failure, proposes a fix, validates it with N reruns using `retries: 0`, opens a PR using the PAT token so CI actually fires, and routes all failure paths (startup timeout, deterministic failure, diff-lint block, no fix proposable) to structured GitHub issues
**Verified:** 2026-04-27T15:30:00Z
**Status:** gaps_found
**Re-verification:** Yes — second-round verification after gap-closure plans 03-14 and 03-15

## Re-verification Summary

| Gap (prior) | Severity | Closure | Status |
|-------------|----------|---------|--------|
| HI-01 (cwd threading) | Blocker | 03-14 Tasks 1+2 | ✓ CLOSED |
| HI-02 (xpath-prefix TS-comment false-positive) | Blocker | 03-14 Task 4 | ⚠ PARTIAL — closed for TS comments, regressed via getBy* over-broadening (WR-01) |
| HI-03 (silent pipeline failures) | Blocker | 03-14 Task 2 | ✓ CLOSED |
| ME-01 (D-13 inline literal) | Medium | 03-15 Tasks 1+2 | ✓ CLOSED |
| ME-02 (empty allowedTools) | Medium | 03-14 Task 2 | ✓ CLOSED |
| ME-03 (systemPrompt in user role) | Medium | 03-15 Task 2 | ✓ CLOSED |
| ME-04 (bash-wrapper PID capture) | Medium | 03-14 Task 1 | ✓ CLOSED (with IN-01 caveat — npm/pnpm wrapper sub-process not addressed) |
| LO-01 (mcpToTool double-init) | Low | 03-15 Task 2 | ✓ CLOSED |

**Score:** 4/5 truths fully verified (one was already verified pre-closure: SC-5 [skip-healer] sentinel). The single remaining gap (WR-01) is a regression of the HI-02 closure introduced by an over-broad regex specified in the 03-14 PLAN.

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Broken selector fixture produces validated PR titled `[playwright-healer] Fix flaky <test title>` with CI checks running | ⚠ MOSTLY VERIFIED — WR-01 introduces a narrow false-positive that could route a legitimate `getByText('//foo')`-using fix to issue-fallback. For the typical fixture case (`page.locator('#wrong-id')` → `page.locator('#correct-id')` or `getByRole('button', {name:'Submit'})`), SC-1 is unblocked. Live runner human verification required. | HI-01, HI-03 closed; pipeline goes payload → bundle → sanity rerun in cwd → adapter → diff-lint → applyFix → validate → openHealerPr. Code path verified end-to-end via index.ts:96-252. |
| 2  | Diff with `waitForTimeout` or `:nth-child(` blocked by diff-lint; files issue titled `[playwright-healer] <test title> is unhealable` | ✓ VERIFIED | waitForTimeout / :nth-child / :nth-of-type / xpath-equals patterns all match correctly. WR-01 affects only the xpath-prefix sub-pattern, not these three. issue-writer.ts:45 builds the unhealable title. |
| 3  | Startup timeout exits cleanly and files structured issue; no zombie processes | ? UNCERTAIN | wait-for-ready.ts is implemented and tested (exits 0/1/2; files app-startup-timeout issue on timeout). action.yml Step 7 always-run pkill cleanup is present. ME-04 fix landed (exec spawn captures app PID, not bash wrapper). Live runner verification required for SIGTERM propagation under npm wrapper sub-shells (IN-01 residual concern). |
| 4  | Deterministic failure (0/N reruns pass on unmodified code) routes to issue-fallback | ✓ VERIFIED | HI-01 closed: validator.ts:39 accepts cwd?: string and threads to getExecOutput options. Both index.ts validate() call sites (lines 128, 221) pass cwd = process.env.GITHUB_WORKSPACE ?? process.cwd(). Sanity gate (index.ts:129) routes 0/N to deterministic-failure issue. |
| 5  | Every bot commit on a healer PR branch contains `[skip-healer]` in the commit message | ✓ VERIFIED | applyFix() in src/healer/fix-applier.ts uses SKIP_SENTINEL imported from loop-guard.ts. 7 integration tests confirm presence in every commit message. Unchanged from prior verification. |

**Score:** 4/5 truths fully verified (SC-2, SC-4, SC-5 fully verified; SC-1 mostly verified with WR-01 caveat; SC-3 uncertain pending human verification).

### Required Artifacts (Re-verified — focus on gap-closure changes)

| Artifact | Status | Details |
|----------|--------|---------|
| `src/healer/validator.ts` | ✓ VERIFIED | Line 39-44: `cwd?: string` 4th parameter present. Line 66: `cwd,` threaded into getExecOutput options. |
| `src/healer/index.ts` | ✓ VERIFIED | Line 23: `import { ALLOWED_TOOLS } from '../shared/security-contract.js'`. Lines 128, 221: both validate() calls pass cwd as 4th arg. Line 157: `adapter.runAgent(context, systemPrompt, ALLOWED_TOOLS)`. Lines 253-279: outer catch with no-fix-proposable issue + core.setFailed + 1000-char truncation. |
| `action.yml` | ✓ VERIFIED | Step 5 (lines 153-169): no working-directory directive (consumer-workspace default); `bash -c "exec ${{ inputs.start-command }}" &` (exec PID); `npx tsx ${{ github.action_path }}/src/healer/wait-for-ready.ts` (absolute path). Step 6 still has `working-directory: ${{ github.action_path }}` (untouched). |
| `src/healer/forbidden-patterns.ts` | ⚠ PARTIAL | Line 22: regex `/(?:locator|waitForSelector|getBy\w+)\s*\(\s*['"`]\/\//` — TS-comment false-positive closed; getBy* alternation introduces NEW false-positive class (see WR-01). |
| `src/healer/diff-lint.test.ts` | ⚠ PARTIAL | 5 new regression cases added: 2 false-positive guards (TS comment, page.goto URL) + 3 true positives (locator, waitForSelector, getByText). The getByText case asserts the bug (toBe(true) for `getByText('//literal text')`) — the test mirrors the WR-01 regression. |
| `src/shared/security-contract.ts` | ✓ VERIFIED | Lines 34-39: `MCP_PLAYWRIGHT_TOOL_PREFIX = 'browser_' as const` exported with documentation. Existing exports unchanged. |
| `.planning/security-contract.snapshot.json` | ✓ VERIFIED | Line 15: `"mcpPlaywrightToolPrefix": "browser_"`. Existing keys unchanged. |
| `src/healer/adapters/gemini.ts` | ✓ VERIFIED | Line 28: imports `MCP_PLAYWRIGHT_TOOL_PREFIX`. Line 106: `tool.name.startsWith(MCP_PLAYWRIGHT_TOOL_PREFIX)` (no `'browser_*'` literal). Line 119: contents array contains contextSummary only (no initialUserText). Line 123: `mcpCallable` initialized once before while(true). Line 136: `systemInstruction: systemPrompt` in config. Line 156: `mcpCallable.callTool(functionCalls)` reuses single callable. |
| `src/healer/validator.test.ts` | ✓ VERIFIED | Lines 125-141: HI-01 cwd threading describe block — 2 tests confirm options.cwd is passed through (with and without cwd argument). |
| `src/healer/index.test.ts` | ✓ VERIFIED | Lines 280-303: HI-01 cwd threading describe block (passes GITHUB_WORKSPACE to both validate() sites). Lines 304-321: HI-03 outer catch describe block (routes bundleContext error to no-fix-proposable + setFailed; supervisorStop still called in finally). Three prior `rejects.toThrow()` assertions removed (grep `-c "rejects.toThrow"` returns 0). `error: vi.fn()` added to @actions/core mock (line 60). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/healer/index.ts` | `src/healer/validator.ts` | `validate(...,cwd)` at Steps 4 and 10 | ✓ WIRED | Both call sites pass cwd as 4th arg (lines 128, 221) |
| `src/healer/index.ts` | `src/shared/security-contract.ts` | `import { ALLOWED_TOOLS }` for adapter call | ✓ WIRED | Line 23 import; line 157 use |
| `src/healer/index.ts` | `src/healer/issue-writer.ts` | outer catch routes unexpected errors via no-fix-proposable | ✓ WIRED | Lines 263-274 fileIssue call; failureMode: 'no-fix-proposable' |
| `action.yml` Step 5 | consumer workspace (`GITHUB_WORKSPACE`) | composite step default working-directory | ✓ WIRED | working-directory directive removed; default is github.workspace |
| `action.yml` Step 5 | app process PID | `bash -c "exec <cmd>" &; echo $!` | ✓ WIRED | exec replaces bash, $! is the start-command process. IN-01 caveat: when start-command wraps another process (npm run dev → node), the captured PID is the wrapper. |
| `src/healer/adapters/gemini.ts` | `src/shared/security-contract.ts` | `MCP_PLAYWRIGHT_TOOL_PREFIX` for audit invariant | ✓ WIRED | Line 28 import; line 106 use; no inline `'browser_*'` literal |
| `src/healer/adapters/gemini.ts` | `config.systemInstruction` | systemPrompt isolated to system role | ✓ WIRED | Line 136 `systemInstruction: systemPrompt`; user-content array contains contextSummary only |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `src/healer/index.ts` | sanity.passRate | `validate()` return value WITH cwd threaded | Yes — validator now executes against consumer workspace | ✓ FLOWING (was ⚠ HOLLOW in prior verification — fixed by HI-01) |
| `src/healer/index.ts` | validation.passRate | `validate()` post-fix WITH cwd threaded | Yes — same fix applies | ✓ FLOWING |
| `src/healer/index.ts` outer catch | failureMode token + rootCause | err.message from any pipeline throw | Yes — real error, truncated to 1000 chars | ✓ FLOWING (HI-03 closed) |
| `src/healer/adapters/gemini.ts` | systemInstruction | systemPrompt threaded into config | Yes — true system role per @google/genai SDK | ✓ FLOWING |
| `src/healer/adapters/gemini.ts` | mcpCallable | mcpToToolFn(mcpClient) called once before loop | Yes — single instance reused | ✓ FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED for live pipeline — healer requires Playwright MCP + GitHub API + LLM provider. Unit tests mock all external interfaces.

**Test suite results (automated):**

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `npm test` | 240/240 tests pass (22 test files) — was 230 pre-closure, +10 behavioral tests | ✓ PASS |
| TypeScript compiles | `npm run typecheck` | exit 0 | ✓ PASS |
| HI-01 cwd threading (validator unit) | grep "options.cwd" validator.test.ts | 2 assertions present | ✓ PASS |
| HI-03 outer catch (orchestrator unit) | grep "no-fix-proposable" index.test.ts | 4 occurrences across 3 tests | ✓ PASS |
| ME-02 ALLOWED_TOOLS wired | grep "ALLOWED_TOOLS" index.ts | line 23 import + line 157 use | ✓ PASS |
| ME-04 exec spawn | grep "exec ${{ inputs" action.yml | line 167 present | ✓ PASS |
| ME-01 prefix constant exported | grep "MCP_PLAYWRIGHT_TOOL_PREFIX" security-contract.ts | line 39 export | ✓ PASS |
| ME-03 systemInstruction isolation | grep "systemInstruction" gemini.ts | line 136 present | ✓ PASS |
| LO-01 single mcpCallable init | grep -B1 -A1 "while (true)" gemini.ts | mcpCallable on line 123 before loop | ✓ PASS |
| WR-01 regression NOT caught by suite | "flags getByText" diff-lint.test.ts | test asserts toBe(true) — encodes the bug | ✗ FAIL (test mirrors regression) |

### Spot-Check: Plan 14 Must-Haves vs Codebase

Per the verification protocol, ≥5 must_haves spot-checked from each gap-closure plan against actual code (not SUMMARY claims):

**03-14-PLAN must_haves:**
1. ✓ "validate() threads cwd into getExecOutput options" — validator.ts:66 confirmed
2. ✓ "index.ts outer catch fires on non-BudgetExhausted errors" — index.ts:253-279 confirmed
3. ⚠ "diff-lint accepts unified-diff lines containing TypeScript // comments without triggering xpath-prefix" — verified via diff-lint.test.ts:75-79 (TS comment guard passes); plan-listed truth NOT a regression but the COMPANION truth introduced WR-01
4. ✗ "diff-lint blocks page.locator('//xpath'), waitForSelector('//...'), and getByText('//...') patterns" — partial. The `getByText('//...')` clause is incorrect per Playwright API; the plan asked for it; the executor implemented it; the test asserts it. WR-01.
5. ✓ "PID file /tmp/playwright-healer-app-pid contains the app process PID (not bash wrapper) via exec replacement" — action.yml:167 `exec` confirmed; IN-01 residual on wrapper sub-processes acknowledged
6. ✓ "adapter.runAgent() receives ALLOWED_TOOLS instead of empty array" — index.ts:157 confirmed

**03-15-PLAN must_haves:**
1. ✓ "Gemini adapter audit invariant references MCP_PLAYWRIGHT_TOOL_PREFIX from security-contract.ts, not an inline 'browser_*' literal" — gemini.ts:106 confirmed; grep confirms no `'browser_*'` literal remaining
2. ✓ "Gemini adapter passes systemPrompt via config.systemInstruction (system role)" — gemini.ts:136 confirmed; no `initialUserText` variable in source
3. ✓ "mcpToTool is called once before the agent loop, not twice per iteration" — gemini.ts:123 single mcpCallable; loop body uses mcpCallable.callTool()
4. ✓ "security-contract.snapshot.json includes mcpPlaywrightToolPrefix key matching the new constant" — line 15 confirmed

### Requirements Coverage

All 27 Phase 3 requirement IDs declared across plans 03-01..03-15 still have implementing artifacts. The single regression (WR-01) is a sub-pattern of FIX-06 (diff-lint anti-pattern blocking) — the broader FIX-06 still satisfies for waitForTimeout / nth-child / xpath-equals / out-of-testdir; only the xpath-prefix sub-pattern over-broadens.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| FIX-06 (diff-lint blocks anti-patterns before PR) | ⚠ SATISFIED-with-defect | Core blocking logic correct for 4 of 5 sub-patterns; xpath-prefix sub-pattern over-broadens (WR-01) |
| HEA-01..06, FIX-01..05, FIX-08, VAL-01..05, PRI-01..03, PRI-05..06, CFG-04, SEC-03..04 | ✓ SATISFIED | Unchanged from prior verification or improved by gap closures |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/healer/forbidden-patterns.ts` | 22 | `getBy\w+` in xpath-prefix regex alternation | Warning (WR-01) | Playwright getByText/getByLabel/getByRole/etc. take literal text — `//`-prefixed strings are valid argument values, not XPath. Narrow false-positive routes valid fixes to diff-lint-blocked. |
| `src/healer/diff-lint.test.ts` | 99-103 | Test asserts wrong invariant — `getByText('//literal text')` flagged as XPath true-positive | Warning (WR-01) | Test encodes the bug, so the 240-test green suite does not catch the regression. |
| `action.yml` | 167 | `bash -c "exec ${{ inputs.start-command }}" &` captures wrapper PID for `npm run dev` / `pnpm start` chains | Info (IN-01) | Not a regression — original ME-04 (bash-wrapper PID) is closed. Modern npm propagates SIGTERM, but legacy npm or wrapper scripts using `&&` chains may not. Outer pkill is the D-12 layer-2 net but only targets MCP, not the consumer app. |

### Human Verification Required

#### 1. End-to-end heal with fixture broken selector (SC-1)

**Test:** Trigger the healer workflow manually with inputs pointing to a fixture test containing `page.locator('#wrong-id')` where the element is `#correct-id`.
**Expected:** A PR titled `[playwright-healer] Fix flaky <test title>` appears with CI checks actually running (not the vacuous "all checks passed" that GITHUB_TOKEN would produce).
**Why human:** PAT vs GITHUB_TOKEN CI triggering is observable only in a live GitHub Actions run.

#### 2. No zombie processes after startup timeout (SC-3)

**Test:** Configure a start-command that never starts, with startup-timeout-seconds=10. Verify the action files an `app-startup-timeout` issue. Check the runner for residual playwright-mcp or application processes after Step 7 cleanup.
**Expected:** No orphaned processes. If start-command is `npm run dev`, verify SIGTERM propagation through the npm wrapper PID to the underlying node child (IN-01 residual concern).
**Why human:** Process lifecycle (SIGTERM propagation, pkill targeting, PID-file cleanup race) requires a live runner. Unit tests mock app-supervisor entirely.

### Gaps Summary

**Gap 1 — WR-01: xpath-prefix regex over-broadens to Playwright getBy* family (regression of HI-02 closure):**

The 03-14 PLAN explicitly listed in must_haves.truths: *"diff-lint blocks page.locator('//xpath'), waitForSelector('//...'), and getByText('//...') patterns"*. The executor implemented this faithfully — added `getBy\w+` to the regex alternation and a true-positive test for `getByText('//literal text')`. The plan was wrong: Playwright `getByText`, `getByLabel`, `getByRole(name:)`, `getByPlaceholder`, `getByTitle`, `getByAltText`, and `getByTestId` interpret the string argument as **literal text** (or role/test-id), not as a selector — a leading `//` is two literal slash characters, not XPath syntax.

The result: any agent fix that legitimately uses `getByText`/`getByLabel`/etc. with a string starting with `//` (URL fragments, Markdown horizontal-rule markers, comment markers in user-visible UI text) will be rejected by diff-lint and routed to `diff-lint-blocked` issue-fallback. This is the **same class** of failure HI-02 was designed to close (rejecting valid fixes), narrower in scope (only triggers when a getBy* string starts with `//`).

The matching test at `diff-lint.test.ts:99-103` actively asserts the wrong contract:
```typescript
it('flags getByText with // XPath prefix (true positive — getBy* family)', () => {
  const diff = patchWithLine("page.getByText('//literal text');");
  expect(findings.some((f) => f.pattern === 'xpath-prefix')).toBe(true);
});
```

The 240-test green run is **not evidence the regex is right** — the test mirrors the bug. Because the planned must-have was incorrect, the executor cannot be faulted; the closure plan must be revised.

**Closure direction:**
1. Drop `getBy\w+` from the regex alternation in `forbidden-patterns.ts:22`. Final form: `/(?:locator|waitForSelector)\s*\(\s*['"`]\/\//`.
2. Flip the `diff-lint.test.ts:99-103` assertion to `toBe(false)` and rename to `'does NOT flag getByText with // literal-text argument (false-positive guard)'`. Move into the existing `'xpath-prefix false-positive regression (HI-02)'` describe block as a guard.
3. Add a second guard test covering `getByLabel('//user-label')`, `getByRole('button', { name: '//submit' })`, `getByPlaceholder('//enter url')`, etc., to lock the contract for the full text-locator family.

**Remaining human verification (carried forward):** SC-1 live PR + CI check behavior; SC-3 zombie-process cleanup with IN-01 (`npm run dev` wrapper SIGTERM propagation) acknowledged.

---

_Re-verified: 2026-04-27T15:30:00Z (was: 2026-04-27T11:10:00Z, status: gaps_found, score: 1/5)_
_Verifier: Claude (gsd-verifier)_
_Round: gap-closure verification (1 partial gap remaining — WR-01 introduced by 03-14-PLAN must-have specification error)_
