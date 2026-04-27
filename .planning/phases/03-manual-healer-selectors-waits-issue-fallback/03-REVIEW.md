---
status: issues_found
total_findings: 11
blocking: 0
high: 3
medium: 4
low: 4
generated: 2026-04-27T00:00:00Z
---

# Phase 3: Code Review Report

**Reviewed:** 2026-04-27
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

Phase 3 lands the full heal pipeline (context bundler, Gemini adapter, diff-lint, fix-applier, validator, pr-writer, issue-writer, orchestrator, action.yml) against a well-specified architecture. The security non-negotiables are satisfied: `persist-credentials: false` is set on all checkout steps, no `pull_request_target` trigger exists, `ALLOWED_TOOLS` and `ALLOWED_ORIGIN_TEMPLATE` are imported from `security-contract.ts` (no inline literals), the agent has no `Bash`/`Write`/`Edit` access, fix application happens entirely outside the agent loop, and the PR writer uses `@octokit/rest` with the PAT — not `GITHUB_TOKEN`. No BLOCKING findings.

Three HIGH findings are correctness blockers: the validator and start-command run in the action's directory instead of the consumer's workspace (silent no-op), a diff-lint regex false-positives on TypeScript comments routing valid fixes to issue-fallback, and the orchestrator's broad `catch` only intercepts `BudgetExhausted` while leaving `DiffApplyFailure`, `AppStartupTimeout` re-thrown from a hypothetical path, and Playwright crash errors all escaping to an unhandled process exit — violating D-09's "no silent failures" invariant.

---

## High Issues

### HI-01: Validator and start-command run in action path, not consumer workspace

**File:** `action.yml:151-168` and `src/healer/validator.ts:51-71`

**Issue:** Step 5 sets `working-directory: ${{ github.action_path }}`, which means `bash -c "${{ inputs.start-command }}" &` executes the consumer's start command (e.g., `npm run dev`) from inside the action's own install directory, not the consumer's repository checkout. The resulting process can't find `package.json`, `.env`, or any consumer application files and silently fails (start-command exits immediately; wait-for-ready then times out filing a `app-startup-timeout` issue on every heal pass).

The same root cause affects Step 6 via the `working-directory: ${{ github.action_path }}` setting, which means `process.cwd()` inside the TypeScript process resolves to the action path. `validator.ts::validate()` calls `getExecOutput('npx', ['playwright', 'test', testFile, ...])` with no `cwd` option, so Playwright searches for `playwright.config.ts` and the `testFile` path relative to the action directory rather than `$GITHUB_WORKSPACE`. The orchestrator correctly computes `const cwd = process.env['GITHUB_WORKSPACE'] ?? process.cwd()` and threads it to `bundleContext` and `applyFix` — `validate` was missed.

**Severity reasoning:** This is a functionality blocker. Every heal pass on a real consumer repo will fail at either startup or validation. The security perimeter is intact; this is pure correctness.

**Suggested fix:**

1. In `action.yml` Step 5, remove `working-directory: ${{ github.action_path }}` (or change it to `${{ github.workspace }}`):

```yaml
- name: Spawn start-command + wait for ready (heal mode)
  if: inputs.mode == 'heal' && inputs.start-command != ''
  shell: bash
  # No working-directory — runs from GITHUB_WORKSPACE (the consumer checkout)
  env:
    ...
  run: |
    bash -c "${{ inputs.start-command }}" &
    echo $! > /tmp/playwright-healer-app-pid
    npx tsx ${{ github.action_path }}/src/healer/wait-for-ready.ts
```

2. Add `cwd` parameter to `validator.ts::validate()` and pass `$GITHUB_WORKSPACE`:

```typescript
// validator.ts
export async function validate(
  testFile: string,
  testTitle: string,
  rerunCount: number,
  cwd?: string,         // <-- add
): Promise<ValidationResult> {
  ...
  const result = await getExecOutput(
    'npx',
    ['playwright', 'test', testFile, '--grep', grepEscaped, '--retries=0', '--workers=1', '--reporter=json'],
    {
      ignoreReturnCode: true,
      cwd,              // <-- thread through
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
      silent: true,
    },
  );
  ...
}
```

3. Thread `cwd` from the orchestrator at both call sites:

```typescript
// index.ts — Step 4 (sanity) and Step 10 (post-fix)
const sanity = await validate(payload.testFile, payload.testTitle, config.rerunCount, cwd);
...
const validation = await validate(payload.testFile, payload.testTitle, config.rerunCount, cwd);
```

---

### HI-02: diff-lint xpath-prefix pattern false-positives on TypeScript comments

**File:** `src/healer/forbidden-patterns.ts:17` and `src/healer/diff-lint.ts:110-121`

**Issue:** The `xpath-prefix` pattern is `/^\s*\/\//m`. In `diff-lint.ts` it is applied to the raw content of every added line (after stripping the leading `+`). Any TypeScript single-line comment in a patched line — `// Fix: use getByRole instead of nth-child` — starts with `//` and matches the regex. This will route valid selector fixes to `diff-lint-blocked` and file a GitHub issue instead of a PR whenever the agent inserts a code comment. D-16 intends this pattern to catch XPath string literals that begin with `//` inside selector calls, not entire code lines.

**Severity reasoning:** This is a correctness bug that will surface in production for any agent-proposed fix that adds a code comment (very likely). It degrades the action's core value — a valid fix gets rejected and a false-negative issue is filed.

**Suggested fix:** Narrow the regex to only match `//` appearing inside a string literal context. One practical approach is to look for the pattern only when it appears as an argument to a locator call:

```typescript
// forbidden-patterns.ts — tighter version
{ name: 'xpath-prefix', re: /(?:locator|waitForSelector|getBy\w+)\s*\(\s*['"`]\/\// },
```

Alternatively, check whether the `//` appears inside quotes before flagging:

```typescript
{ name: 'xpath-prefix', re: /['"`]\/\// },
```

Either form avoids flagging `// This is a TypeScript comment` while still catching `page.locator('//div[3]')`.

---

### HI-03: Non-BudgetExhausted errors escape the orchestrator without filing an issue (D-09 violated)

**File:** `src/healer/index.ts:155-177` (Step 6 inner try/catch) and the outer `try` block at line 113

**Issue:** The inner catch at Step 6 only intercepts `BudgetExhausted`. Any other error thrown by `adapter.runAgent` propagates up through the outer `try` block and is caught by the `finally` (which only runs `supervisorStop()`), then rethrows. Similarly:

- `bundleContext` throws `Error('Path outside workspace')` if `assertWithinCwd` triggers — exits with no issue filed.
- `applyFix` throws `DiffApplyFailure` from `git apply` failures — exits with no issue filed.
- `validate` can throw if `getExecOutput` itself errors (Playwright binary not found, etc.) — exits with no issue filed.
- `assemblePrompt` throws if a prompt template file is missing (e.g., deployment packaging error) — exits with no issue filed.

D-09 requires "every non-PR exit produces a structured GitHub issue. No silent failures." The `catch` only partially implements this.

**Severity reasoning:** The action's core invariant (no human reading logs) is violated on a class of real failures. A consumer sees a red action run with no GitHub artifact and no actionable link.

**Suggested fix:** Add a broad catch wrapping the full try block body to file an issue on unexpected errors. Six D-09 tokens are locked; an `unexpected-error` seventh token is not listed, so map to the closest existing token or add it. The minimal fix:

```typescript
// index.ts outer try — add an explicit catch after the BudgetExhausted inner catch
export async function run(config: Config): Promise<void> {
  // ... Step 1 payload validation ...
  try {
    // Steps 2-11 ...
  } catch (err) {
    // BudgetExhausted is caught at the inner call site (Step 6). Any other
    // error that reaches here is an unexpected pipeline failure — file an issue
    // so the consumer has a GitHub artifact to act on (D-09 no-silent-failures).
    const msg = err instanceof Error ? err.message : String(err);
    core.error(`Unexpected healer pipeline error: ${msg}`);
    await fileIssue({
      config, owner, repo,
      testTitle: payload?.testTitle ?? '<unknown>',
      triggeringRunUrl,
      failureMode: 'no-fix-proposable',   // closest available D-09 token
      rootCause: `Unexpected pipeline error: ${msg}`,
      reproSteps: 'Check the action run log for the full stack trace.',
      suggestedManualFix: 'Inspect the error message above and file a bug against playwright-healer if it is reproducible.',
    });
    core.setFailed(msg);
  } finally {
    try { supervisorStop(); } catch { /* swallow */ }
  }
}
```

Note: `payload` must be hoisted out of the inner scope (declare before the try block so it's accessible in the catch).

---

## Medium Issues

### ME-01: Gemini audit invariant uses inline `'browser_*'` literal, contradicting D-13

**File:** `src/healer/adapters/gemini.ts:106`

**Issue:** The second half of the ALLOWED_TOOLS audit check is:

```typescript
globMatch('browser_*', tool.name)
```

The literal string `'browser_*'` is an inline MCP tool-name pattern. CONTEXT D-13 and the file's own header comment both ban inline literals for MCP tool names outside `security-contract.ts`. This also makes the actual enforcement logic invisible to security reviewers scanning `security-contract.ts`.

Additionally, the first half of the AND condition (`ALLOWED_TOOLS.some((p) => globMatch(p, canonical))`) is tautological for any Playwright MCP tool: `canonical = 'mcp__playwright__' + tool.name`, and `ALLOWED_TOOLS` contains `'mcp__playwright__*'`, so every Playwright tool passes. The real gating is entirely the inline `browser_*` literal, which is the opposite of what D-03 intended (canonical form drives the audit, adapters translate).

**Suggested fix:** Move the discriminant pattern to `security-contract.ts`:

```typescript
// security-contract.ts — add alongside ALLOWED_TOOLS
export const MCP_PLAYWRIGHT_TOOL_PREFIX = 'browser_' as const;
```

Then in `gemini.ts`:

```typescript
import { ALLOWED_TOOLS, ALLOWED_ORIGIN_TEMPLATE, MCP_PLAYWRIGHT_TOOL_PREFIX } from '../../shared/security-contract.js';
...
const covered =
  ALLOWED_TOOLS.some((p) => globMatch(p, canonical)) &&
  tool.name.startsWith(MCP_PLAYWRIGHT_TOOL_PREFIX);
```

---

### ME-02: Orchestrator passes `[]` to `adapter.runAgent` instead of `ALLOWED_TOOLS`

**File:** `src/healer/index.ts:156`

**Issue:**

```typescript
const result = await adapter.runAgent(context, systemPrompt, []);
```

The third argument, `allowedTools: readonly string[]`, is the Adapter interface's tool-surface contract. The Gemini adapter ignores it (the parameter is `_allowedTools`), but the Anthropic adapter — when implemented — is expected to forward this list to the SDK's `allowedTools` parameter. Passing `[]` means the future Anthropic adapter would call the SDK with an empty allowed-tools list, which in the Anthropic SDK means "all tools allowed" — a silent security regression when the adapter is implemented.

The correct value is `ALLOWED_TOOLS` from `security-contract.ts`.

**Suggested fix:**

```typescript
// index.ts — Step 6
import { ALLOWED_TOOLS } from '../shared/security-contract.js';
...
const result = await adapter.runAgent(context, systemPrompt, ALLOWED_TOOLS);
```

---

### ME-03: Gemini adapter places system prompt in user-role message, weakening injection isolation

**File:** `src/healer/adapters/gemini.ts:119-121`

**Issue:**

```typescript
const initialUserText = `${systemPrompt}\n\n---\n\n${contextSummary}`;
const contents: Content[] = [{ role: 'user', parts: [{ text: initialUserText } as Part] }];
```

The system prompt (containing role guardrails, forbidden patterns, and sandbox constraints) is concatenated directly into the first user message. The Google GenAI SDK supports `config.systemInstruction` for a true system-role message. By mixing the system prompt into user content, page-injected text in later user-role turns (tool results containing browser content, error messages, etc.) is co-located in the same role tier as the security guardrails. PITFALLS §Pitfall 4 specifically warns about prompt injection from page content undermining sandbox constraints.

**Suggested fix:** Use `config.systemInstruction` to separate the security-critical guardrails:

```typescript
const response = await ai.models.generateContent({
  model: opts.model,
  contents,                          // user-turn content only (context bundle)
  config: {
    systemInstruction: systemPrompt, // system role — isolated from user content
    tools: [mcpToToolFn(mcpClient)],
    automaticFunctionCalling: { disable: true },
  },
});
```

Update the initial `contents` to contain only the context bundle:

```typescript
const contents: Content[] = [
  { role: 'user', parts: [{ text: contextSummary } as Part] },
];
```

---

### ME-04: PID file records bash wrapper PID, not the application process PID

**File:** `action.yml:166-167`

**Issue:**

```yaml
bash -c "${{ inputs.start-command }}" &
echo $! > /tmp/playwright-healer-app-pid
```

`$!` captures the PID of the `bash -c` subprocess, not the PID of the application the start-command spawns. When the orchestrator's `stop()` helper sends `SIGTERM` to this PID (inner cleanup, D-12 layer 1), it terminates the bash wrapper but may not propagate the signal to the child process that is actually serving `base-url`. Residual application processes can linger and occupy the port until the outer `pkill -f "playwright-mcp"` post-step runs (which only targets the MCP process, not the app).

D-12 acknowledges `pkill -f "..."` as the outer safety net, so this is a degraded (but not absent) cleanup. However, `supervisorStop()` in the orchestrator's `finally` block reads the PID file and sends `SIGTERM` expecting to hit the app — it will hit the already-exited bash wrapper and `process.kill(pid)` will throw `ESRCH` (silently swallowed), leaving the app running.

**Suggested fix:** Use `setsid` and kill the process group, or use `exec` to replace the bash wrapper with the application process:

```yaml
run: |
  bash -c "exec ${{ inputs.start-command }}" &
  echo $! > /tmp/playwright-healer-app-pid
  npx tsx ${{ github.action_path }}/src/healer/wait-for-ready.ts
```

`exec` replaces the bash shell with the start-command process, so `$!` now holds the app's PID. Alternatively, after `&`, record the full process group: `echo "-$$" > /tmp/playwright-healer-app-pid` and in `stop()` use `process.kill(-pid)` (negative PID = kill process group).

---

## Low Issues

### LO-01: `mcpToTool(mcpClient)` called twice per iteration — second call re-initializes side effects

**File:** `src/healer/adapters/gemini.ts:133, 151-154`

**Issue:** `mcpToTool(mcpClient)` is called once inside `generateContent`'s `config.tools` (line 133) and again explicitly as `const callable = mcpToToolFn(mcpClient)` (line 151) before `callable.tool()` is called. The comment "ensures initialize side-effect" suggests this is intentional, but `mcpToTool` may not be idempotent — calling it twice per turn could re-initialize the transport or leak open handles. The SDK docs for `@google/genai` experimental MCP treat `mcpToTool` as a one-time setup, not a per-call factory.

**Suggested fix:** Initialize `mcpToTool` once before the loop and reuse the result:

```typescript
const mcpCallable = mcpToToolFn(mcpClient);
await mcpCallable.tool(); // one-time initialize side-effect

while (true) {
  budget.assertCanProceed();
  const response = await ai.models.generateContent({
    model: opts.model,
    contents,
    config: {
      tools: [mcpCallable],
      automaticFunctionCalling: { disable: true },
    },
  });
  ...
  const responseParts = await mcpCallable.callTool(functionCalls);
  ...
}
```

---

### LO-02: `assertWithinCwd` uses `path.sep` check but resolves `target` relative to `cwd` twice

**File:** `src/healer/context-bundler.ts:42-47`

**Issue:**

```typescript
function assertWithinCwd(target: string, cwd: string): void {
  const resolvedCwd = path.resolve(cwd);
  const resolvedTarget = path.resolve(cwd, target);
  ...
}
```

The first call site at line 51 passes `args.testFile` (a relative path from dispatch payload). The second call site at line 66 passes `path.relative(args.cwd, importAbs)` — a path that is already expressed relative to cwd. This is correct and works. However, the guard at line 44 (`resolvedTarget !== resolvedCwd`) is unreachable in practice: a file path equaling the directory path means `args.testFile === '.'`, which Zod rejects as min-length 1 at the dispatch-payload layer. The condition is dead code. This is a minor clarity issue — no security impact.

**Suggested fix:** Remove the redundant `=== resolvedCwd` check or add a comment explaining it:

```typescript
if (!resolvedTarget.startsWith(resolvedCwd + path.sep)) {
  throw new Error(`Path '${target}' resolves outside workspace '${cwd}'`);
}
```

---

### LO-03: `PR body filter removes empty strings but not null/undefined`

**File:** `src/healer/pr-writer.ts:63`

**Issue:**

```typescript
return lines.filter((l) => l !== '').join('\n');
```

`lines` includes `args.traceLink ? \`- [Playwright trace](${args.traceLink})\` : ''`. When `traceLink` is null the empty string is filtered out, which is correct. However, `args.validation.perRun.map(...)` returns one string per run. If `perRun` is empty (e.g., `rerunCount === 0` — prevented by Zod's `min(1)` but defensive coding matters), `perRunRow` is an empty string and `| ... |` renders as `|  |`, leaving a malformed table. Not a crash, but worth guarding.

**Suggested fix:** Add a guard when rendering the per-run table:

```typescript
const perRunRow = args.validation.perRun.length > 0
  ? args.validation.perRun.map((r, i) => `| ${i + 1} | ${r.status} | ${r.durationMs}ms |`).join('\n')
  : '| — | no reruns recorded | — |';
```

---

### LO-04: `wait-for-ready.ts` does not validate that HEALER_TOKEN and GH_OWNER/GH_REPO are non-empty before calling `openIssue`

**File:** `src/healer/wait-for-ready.ts:22-32` and `wait-for-ready.ts:43-55`

**Issue:** `readEnv()` defaults `HEALER_TOKEN`, `GH_OWNER`, and `GH_REPO` to `''` if the environment variables are absent. When `AppStartupTimeout` is caught, `openIssue` is called with `patToken: ''`, `owner: ''`, `repo: ''`. The Octokit call will fail with an authentication or URL error, and that failure is caught and logged to stderr — so the action falls back to `return 1`, which is correct behavior. But the logged error message says `'Failed to file app-startup-timeout issue'` without indicating *why* (empty token vs. GitHub API down vs. rate-limited). A maintainer debugging startup issues in a new consumer repo with a misconfigured `HEALER_TOKEN` env mapping will see a cryptic secondary failure.

**Suggested fix:** Add validation before attempting issue creation:

```typescript
if (!env.HEALER_TOKEN || !env.GH_OWNER || !env.GH_REPO) {
  console.error(
    'wait-for-ready: HEALER_TOKEN, GH_OWNER, or GH_REPO env vars are empty — cannot file startup-timeout issue. Check action.yml env block.',
  );
  return 1;
}
```

---

_Reviewed: 2026-04-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
