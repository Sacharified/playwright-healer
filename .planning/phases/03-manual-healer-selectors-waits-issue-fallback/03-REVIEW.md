---
phase: 03-manual-healer-selectors-waits-issue-fallback
reviewed: 2026-04-27T15:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - action.yml
  - src/healer/validator.ts
  - src/healer/index.ts
  - src/healer/validator.test.ts
  - src/healer/index.test.ts
  - src/healer/forbidden-patterns.ts
  - src/healer/diff-lint.test.ts
  - src/shared/security-contract.ts
  - src/healer/adapters/gemini.ts
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: issues_found
---

# Phase 3: Code Review Report — Gap-Closure Round 2

**Reviewed:** 2026-04-27T15:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This is the gap-closure verification round for the 11 findings raised in the prior 03-REVIEW.md (3 high, 4 medium, 4 low). Eight of the targeted gaps (HI-01, HI-03, ME-01..04, LO-01, plus the test-coverage backstops in `validator.test.ts` and `index.test.ts`) are correctly closed. One gap (HI-02) is closed for the original false-positive class (TypeScript `//` comments) but introduces a narrower regression: the suggested-fix regex includes `getBy\w+` in the call-name alternation, which over-flags Playwright `getByText`/`getByLabel`/etc. calls whose literal-text argument happens to start with `//`. The fix code and the test in `diff-lint.test.ts` both encode this incorrect behavior, so the 43-test green run is not evidence the regex is right — the test mirrors the bug.

The four security non-negotiables are intact: `MCP_PLAYWRIGHT_TOOL_PREFIX` is now the only remaining MCP-name literal, lives in `security-contract.ts`, and is referenced via import in `gemini.ts` (D-13 satisfied); `ALLOWED_TOOLS` is now threaded through `adapter.runAgent` (ME-02); the Gemini adapter migrated `systemPrompt` to `config.systemInstruction` so prompt-injected page content can no longer co-locate with sandbox guardrails (ME-03); `mcpToTool(mcpClient)` is initialized exactly once before the loop (LO-01); the security-contract change carries the required `Security-Contract-Change: reviewed-by=` trailer and the snapshot JSON was updated to match (commit `d7f1b49`).

Verification specifics:
- **HI-01 (cwd threading):** `validator.ts::validate` accepts an optional `cwd` parameter and passes it to `getExecOutput`; both call sites in `index.ts` pass `cwd = process.env.GITHUB_WORKSPACE ?? process.cwd()`. The `process.cwd()` fallback only fires in test environments — in production, `GITHUB_WORKSPACE` is always set by the runner. `action.yml` Step 5 dropped `working-directory: ${{ github.action_path }}`, so `npm run dev` now runs from the consumer checkout. Behavioral tests in `index.test.ts` (`HI-01 cwd threading` block) and `validator.test.ts` (`validate — HI-01 cwd threading` block) pin the contract.
- **HI-02 (regex narrowing):** The pattern was tightened from a bare `^\s*//` style to `/(?:locator|waitForSelector|getBy\w+)\s*\(\s*['"`]\/\//`. The TypeScript-comment false-positive is gone (test cases at `diff-lint.test.ts:75-85` confirm). However, the `getBy\w+` alternation is incorrect — see WR-01 below.
- **HI-03 (outer catch D-09 routing):** `index.ts` now wraps the entire pipeline body in `try { … } catch (err) { core.error; fileIssue(failureMode='no-fix-proposable'); core.setFailed(msg) }`. `BudgetExhausted` is handled by the inner Step-6 catch and routed to `agent-budget-exhausted` (correct; `BudgetExhausted` is checked via `instanceof` and the at-throw stats are read). All other errors — `bundleContext` path-traversal, `applyFix` `DiffApplyFailure`, adapter network failures, missing prompt template — are routed to a no-fix-proposable issue and the action exits with `setFailed`. Behavioral test at `index.test.ts:304-321` proves the error doesn't escape `run()` and that `supervisorStop` still runs in `finally`. The "no-fix-proposable" reuse is acknowledged in a comment as the closest among the six locked D-09 tokens.
- **ME-01 (D-13 prefix literal):** `MCP_PLAYWRIGHT_TOOL_PREFIX = 'browser_'` exported from `security-contract.ts`; `gemini.ts:106` uses `tool.name.startsWith(MCP_PLAYWRIGHT_TOOL_PREFIX)`. The audit invariant now correctly combines the canonical-form glob check AND the raw-prefix discriminant, neutralizing the prior tautology where the glob alone passed every Playwright tool.
- **ME-02 (allowedTools arg):** `index.ts:157` passes `ALLOWED_TOOLS` as the third argument to `adapter.runAgent`. The Gemini adapter still ignores it (parameter named `_allowedTools`), but future Anthropic and Ollama adapters will receive a non-empty allowlist as designed.
- **ME-03 (systemInstruction isolation):** `gemini.ts:119` builds initial contents with the context summary only; `gemini.ts:136` passes `systemInstruction: systemPrompt` in the `config` object. No information loss — the prior `${systemPrompt}\n\n---\n\n${contextSummary}` concatenation is replaced with a strict role split.
- **ME-04 (PID capture):** `action.yml:167` is now `bash -c "exec ${{ inputs.start-command }}" &` followed by `echo $! > …`. `exec` replaces the inner bash with the start-command process so `$!` captures the actual app PID (with one residual caveat — see IN-01).
- **LO-01 (single mcpToTool init):** `gemini.ts:123` initializes `mcpCallable` exactly once before the loop; both `tools: [mcpCallable]` (line 137) and `mcpCallable.callTool(...)` (line 156) reuse the same object. No use-after-close risk: `mcpClient.close()` runs in `finally` after every loop exit (success / `BudgetExhausted` return / unexpected throw), and `mcpCallable` is never read after that point. Verified the SDK's `McpCallableTool.initialize()` is idempotent via the `mcpTools.length > 0` guard at `node_modules/@google/genai/dist/index.mjs:16085`, so calling `tool()` once before the loop and letting the SDK re-call it internally has no double-initialization side-effect.

Also confirmed orthogonally: `npx vitest run` against the three changed test files passes 43 tests; the `Security-Contract-Change` trailer is present on commit `d7f1b49`; `.planning/security-contract.snapshot.json` has the new `mcpPlaywrightToolPrefix` key.

---

## Warnings

### WR-01: HI-02 fix over-narrows then over-broadens — `getBy\w+` alternation false-positives on Playwright text-locator family

**File:** `src/healer/forbidden-patterns.ts:22` and `src/healer/diff-lint.test.ts:99-103`

**Issue:** The narrowed regex is

```typescript
{ name: 'xpath-prefix', re: /(?:locator|waitForSelector|getBy\w+)\s*\(\s*['"`]\/\// }
```

The `(?:locator|waitForSelector)` half is correct — both APIs interpret their string argument as a selector and treat a `//` prefix as XPath. The `getBy\w+` half is incorrect: the Playwright `getByText` / `getByLabel` / `getByPlaceholder` / `getByRole` / `getByTitle` / `getByAltText` / `getByTestId` family treats the string argument as **literal text** (or role / test-id), not a selector. A leading `//` in that string is just two literal slash characters — not XPath syntax. So a fix that legitimately matches text starting with `//` (URL fragments, Markdown horizontal-rule markers, comment markers in user-visible UI text) gets routed to `diff-lint-blocked` and an issue is filed instead of a PR.

The matching test case at `diff-lint.test.ts:99-103` encodes this incorrect behavior:

```typescript
it('flags getByText with // XPath prefix (true positive — getBy* family)', () => {
  const diff = patchWithLine("page.getByText('//literal text');");
  const findings = lintDiff(diff);
  expect(findings.some((f) => f.pattern === 'xpath-prefix')).toBe(true);
});
```

The test name even gives the game away: `'//literal text'` is, by Playwright's own contract, literal text — not an XPath. The test is asserting the wrong invariant, which is why the 43-test green run does not catch the regression. Rooting cause: the suggested-fix sketch in the prior 03-REVIEW.md HI-02 included `getBy\w+`; the executor implemented it verbatim and wrote a test that confirms it. Same false-positive shape as the original HI-02 (a valid fix gets blocked), just narrower in scope.

**Severity reasoning:** Same class as HI-02 (rejecting a valid fix) but narrower (only triggers when a string argument to `getByX` happens to start with `//`). Not a security regression and not as broad as the TS-comment false-positive HI-02 closed, so Warning rather than High. Worth fixing now to avoid users hitting it once Phase 4 sees production traffic.

**Fix:**

1. Drop `getBy\w+` from the alternation in `forbidden-patterns.ts`:

   ```typescript
   // forbidden-patterns.ts:22 — corrected
   { name: 'xpath-prefix', re: /(?:locator|waitForSelector)\s*\(\s*['"`]\/\// },
   ```

   `locator` and `waitForSelector` are the only two Playwright string-selector entry points that interpret `//` as XPath. (`page.$` / `page.$$` are deprecated and rare; if a future fix wants to add them, do so consciously.)

2. Flip the assertion in `diff-lint.test.ts:99-103` and move it into the `'xpath-prefix false-positive regression (HI-02)'` describe block as a guard:

   ```typescript
   it('does NOT flag getByText with // literal-text argument (false-positive guard)', () => {
     const diff = patchWithLine("page.getByText('//literal text');");
     const findings = lintDiff(diff);
     expect(findings.some((f) => f.pattern === 'xpath-prefix')).toBe(false);
   });
   ```

   Add a second guard for the broader family to lock the contract:

   ```typescript
   it('does NOT flag getByLabel/getByRole/getByPlaceholder with // literal-text argument', () => {
     for (const call of [
       "page.getByLabel('//user-label')",
       "page.getByRole('button', { name: '//submit' })",
       "page.getByPlaceholder('//enter url')",
     ]) {
       const findings = lintDiff(patchWithLine(call + ';'));
       expect(findings.some((f) => f.pattern === 'xpath-prefix')).toBe(false);
     }
   });
   ```

---

## Info

### IN-01: ME-04 fix captures `npm`/start-command wrapper PID, not the actual node app PID

**File:** `action.yml:166-168`

**Issue:** The `bash -c "exec ${{ inputs.start-command }}" &` pattern is a meaningful improvement over the prior `bash -c "${{ inputs.start-command }}" &` (which captured the bash wrapper PID — the original ME-04 finding). After `exec`, `$!` correctly resolves to the start-command process. However, when `start-command` is a wrapper like `npm run dev` or `pnpm start`, the captured PID is the npm/pnpm process, not the underlying `node` server it spawns. `supervisorStop()` sends SIGTERM to that PID and relies on npm propagating the signal to its node child. npm 7+ does propagate signals reliably, but older Node 18-era npm versions, and certain wrapper scripts that run `node` via `&&`/`||` chains, can fail to propagate — leaving the actual app running until the outer `pkill -f "playwright-mcp"` post-step (which only targets the MCP, not the app).

This is not a regression — ME-04 is closed for its own scope (don't capture the bash wrapper). The remaining limitation is in the wrapper-process layer below the `exec`. The outer `pkill` is the D-12 layer-2 safety net, but `pkill -f` only fires on the MCP pattern, so a leaked node would persist until the next runner sweep.

**Severity reasoning:** Info because (a) it is not a regression introduced by gap closure, (b) D-12 documents the layered cleanup approach, (c) modern npm propagates SIGTERM, (d) ephemeral GitHub-hosted runners reset between jobs. Worth recording so it's tracked when Phase 6 hardens the runtime.

**Fix (optional, future work):** Two options if this becomes a real consumer pain point:

```yaml
# Option A — kill the entire process group with setsid:
run: |
  setsid bash -c "exec ${{ inputs.start-command }}" &
  echo "-$!" > /tmp/playwright-healer-app-pid   # negative = process group
  npx tsx ${{ github.action_path }}/src/healer/wait-for-ready.ts
```

Then in `app-supervisor.ts::stop`, parse the leading minus and call `process.kill(-pgid, 'SIGTERM')` to signal the whole group.

```yaml
# Option B — broaden the outer pkill to cover the consumer's app pattern:
- name: Cleanup leaked processes (always, heal mode)
  if: always() && inputs.mode == 'heal'
  shell: bash
  run: |
    pkill -f "playwright-mcp" || true
    if [[ -f /tmp/playwright-healer-app-pid ]]; then
      pid="$(cat /tmp/playwright-healer-app-pid)"
      # Kill the process group rooted at pid (negative PID semantics)
      kill -- "-${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true
    fi
```

Option B is the smaller change and can be deferred until a real leak is observed.

---

_Reviewed: 2026-04-27T15:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Round: gap-closure verification (0 blocking, 1 warning, 1 info; was 0/3/4/4 in prior round)_
