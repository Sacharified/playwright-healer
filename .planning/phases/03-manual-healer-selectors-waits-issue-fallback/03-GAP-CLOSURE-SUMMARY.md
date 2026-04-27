# Phase 3: Gap Closure Summary

**Generated:** 2026-04-27
**Triggered by:** 03-VERIFICATION.md (status: gaps_found, 1/5 must-haves verified) + 03-REVIEW.md
**Plans added:** 03-14-PLAN.md (Wave 1), 03-15-PLAN.md (Wave 1)

---

## Gap-to-Plan Mapping

| Gap ID | Severity | Description | Closed By |
|--------|----------|-------------|-----------|
| HI-01 | Blocker | validator.ts has no cwd param; action.yml Step 5 uses wrong working-directory | 03-14 Tasks 1 + 2 |
| HI-02 | Blocker | xpath-prefix regex matches TS // comments (false-positive) | 03-14 Task 3 |
| HI-03 | Blocker | Non-BudgetExhausted errors escape index.ts without filing a GitHub issue | 03-14 Task 2 |
| ME-01 | Medium | Inline `'browser_*'` literal in gemini.ts contradicts D-13 | 03-15 Tasks 1 + 2 |
| ME-02 | Medium | adapter.runAgent() receives [] instead of ALLOWED_TOOLS | 03-14 Task 2 |
| ME-03 | Medium | systemPrompt in user-role message weakens injection isolation | 03-15 Task 2 |
| ME-04 | Medium | PID file captures bash wrapper PID, not app PID | 03-14 Task 1 |
| LO-01 | Low | mcpToTool called twice per iteration (handle leak risk) | 03-15 Task 2 |

## Deferred Findings

The following LOW findings from 03-REVIEW.md are deferred to Phase 6 polish — none block goal
achievement and none introduce security regressions:

| Gap ID | Severity | Description | Reason for Deferral |
|--------|----------|-------------|---------------------|
| LO-02 | Low | assertWithinCwd has dead-code `=== resolvedCwd` guard | No security/functional impact; documentation/clarity only |
| LO-03 | Low | PR body filter removes '' but not null/undefined per-run rows | Prevented by Zod min(1) upstream; edge case only |
| LO-04 | Low | wait-for-ready.ts does not validate HEALER_TOKEN before calling openIssue | Falls back to exit 1 correctly; error message clarity only |

---

## Plan Summaries

### 03-14-PLAN.md — Correctness Blockers + Medium Co-Located Fixes

**Wave:** 1 (no dependencies on other gap-closure plans)
**Files:** action.yml, src/healer/validator.ts, src/healer/index.ts, src/healer/forbidden-patterns.ts, src/healer/diff-lint.test.ts

**Task 1 — action.yml Step 5 (HI-01 + ME-04):**
- Remove `working-directory: ${{ github.action_path }}` from Step 5 so start-command runs from consumer checkout (GITHUB_WORKSPACE)
- Change spawn to `bash -c "exec ${{ inputs.start-command }}" &` so $! captures app PID not bash wrapper PID
- Change `npx tsx src/healer/wait-for-ready.ts` to `npx tsx ${{ github.action_path }}/src/healer/wait-for-ready.ts` (absolute path now that working-directory no longer anchors it)

**Task 2 — validator.ts + index.ts (HI-01 + HI-03 + ME-02):**
- Add `cwd?: string` param to validate() and thread into getExecOutput options.cwd
- Thread cwd from index.ts orchestrator into both validate() call sites (Step 4 sanity + Step 10 post-fix)
- Add outer catch block in index.ts that routes to no-fix-proposable issue and calls core.setFailed (D-09 no-silent-failures)
- Replace [] with ALLOWED_TOOLS import from security-contract.ts in adapter.runAgent() call

**Task 3 — forbidden-patterns.ts + diff-lint.test.ts (HI-02):**
- Narrow xpath-prefix regex from `/^\s*\/\//m` to `/(?:locator|waitForSelector|getBy\w+)\s*\(\s*['"\`]\/\//`
- Add 5 regression tests: 2 false-positive guards (TS comment, page.goto URL) + 3 true positives (locator, waitForSelector, getByText)

### 03-15-PLAN.md — Adapter Hardening

**Wave:** 1 (no dependencies; files_modified has zero overlap with 03-14)
**Files:** src/shared/security-contract.ts, src/healer/adapters/gemini.ts

**Task 1 — security-contract.ts (ME-01):**
- Export `MCP_PLAYWRIGHT_TOOL_PREFIX = 'browser_' as const`
- Commit must include `Security-Contract-Change: reviewed-by=playwright-healer-bot` trailer per file header protocol

**Task 2 — gemini.ts (ME-01 + ME-03 + LO-01):**
- Import MCP_PLAYWRIGHT_TOOL_PREFIX; replace `globMatch('browser_*', tool.name)` with `tool.name.startsWith(MCP_PLAYWRIGHT_TOOL_PREFIX)` in audit invariant
- Move systemPrompt from user-role content concatenation to `config.systemInstruction` in generateContent call
- Initialize `const mcpCallable = mcpToToolFn(mcpClient)` once before the while(true) loop; remove the per-iteration duplicate `const callable = mcpToToolFn(mcpClient)` + `callable.tool()` call pair

---

## Wave Structure

Both plans are Wave 1 (fully parallel — zero files_modified overlap):

```
Wave 1 ─┬─ 03-14 (action.yml, validator.ts, index.ts, forbidden-patterns.ts, diff-lint.test.ts)
         └─ 03-15 (security-contract.ts, gemini.ts)
```

Execute both with: `/gsd-execute-phase 03 --gaps-only`
Or individually: run each PLAN.md sequentially if parallelism is unavailable.

---

## Post-Gap-Closure Verification Expectations

After 03-14 and 03-15 are executed:

| Must-Have | Expected Status |
|-----------|----------------|
| SC-1: Broken selector fixture produces validated PR | Unblocked (HI-01 + HI-02 + HI-03 fixed) — requires live runner human verification |
| SC-2: Diff with waitForTimeout/nth-child blocked | Unblocked (HI-02 narrowed regex no longer false-positives on TS comments) |
| SC-3: Startup timeout → clean issue, no zombies | Was UNCERTAIN (live runner required) — ME-04 exec fix improves PID accuracy |
| SC-4: Deterministic failure routes to issue-fallback | Unblocked (HI-01 cwd fix; validator now runs against consumer workspace) |
| SC-5: Every bot commit contains [skip-healer] | Already VERIFIED — unchanged by gap closure |

Human verification items (SC-1, SC-3) remain required after gap closure — these are live-runner
behaviors that cannot be proven by unit tests.
