# Phase 3: Manual Healer (Selectors + Waits + Issue Fallback) — Pattern Map

**Mapped:** 2026-04-26
**Files analyzed:** 31 (18 source + 13 test/fixture/config)
**Analogs found:** 22 / 31 (9 greenfield)

> **Audience:** `gsd-planner`. Each pattern assignment cites a concrete analog in the existing codebase or — when no analog exists — links to the verified `03-RESEARCH.md` pattern that supplies the code shape. **All file paths are absolute or workspace-relative; line numbers refer to current `main` (commit `3c11fef`).**

---

## File Classification (one-line summary)

### Source files — `src/healer/`

| File | Role | Data flow | Closest analog | Greenfield? | Pattern note |
|------|------|-----------|----------------|-------------|--------------|
| `src/healer/index.ts` | entry-point / orchestrator | dispatch payload + Config → side effects (PR or issue) | `src/ingest/index.ts:44-147` | partial | Replicate the numbered-step `try { … } finally { cleanup }` shape; dynamic imports unnecessary (single mode) |
| `src/healer/adapter.ts` | type-only interface | n/a | `src/shared/types.ts` | adapt | Pure `export interface` file — copy the no-runtime-code style |
| `src/healer/adapters/gemini.ts` | IO adapter (LLM + MCP) | `ContextBundle, prompt, tools` → `FixProposal \| NoFixProposable` | none | **GREENFIELD** | Use 03-RESEARCH §"Pattern 1" (lines 360-450) verbatim; budget gate from same pattern |
| `src/healer/adapters/anthropic.ts` | stub | n/a → throws | 03-RESEARCH §"Example B" line 794-803 | partial | Same fail-loud style as Phase 1 D-09 stub (`src/healer/index.ts:4-6` current contents) |
| `src/healer/adapters/ollama.ts` | stub | n/a → throws | same | partial | Same as anthropic stub |
| `src/healer/app-supervisor.ts` | IO (process spawn + HTTP poll) | `start-command, base-url, timeout` → `void \| AppStartupTimeout` | none directly | **GREENFIELD** | Uses `child_process.spawn` (NOT `@actions/exec.getExecOutput`); see 03-RESEARCH §"Pattern 2" (line 452) + §"Pattern 3" (line 517). Borrow the `core.warning` style from `src/shared/state-branch.ts:230-234` only |
| `src/healer/context-bundler.ts` | IO (fs + git read-only) | `testFile, traceAttachmentPath \| null` → `ContextBundle` | `src/shared/state-branch.ts` (`getExecOutput` style for `git blame`) | partial | Use `getExecOutput('git', ['blame', …], { cwd })` shape from `state-branch.ts:67-91`; first-hop import resolution is greenfield (regex on `import` statements) |
| `src/healer/prompt-assembler.ts` | pure function | template files + variables → string | none directly | **GREENFIELD** | `fs.readFileSync` of templates + simple string concatenation; deterministic (snapshot test). 03-RESEARCH §"Pattern 1" mentions assembly but no excerpt — invent |
| `src/healer/prompts/role-guardrails.md` | static template | n/a | none | **GREENFIELD** | Content from CONTEXT D-05 §1 verbatim |
| `src/healer/prompts/selectors-with-trace.md` | static template | n/a | none | **GREENFIELD** | Content from CONTEXT D-05 §2 + D-07; injects `${FORBIDDEN_PATTERNS_TEXT}` |
| `src/healer/prompts/selectors-no-trace.md` | static template | n/a | none | **GREENFIELD** | Same + HEA-05 "reproduce live via Playwright MCP first" instruction |
| `src/healer/prompts/waits-with-trace.md` | static template | n/a | none | **GREENFIELD** | Content from CONTEXT D-05 §2 + D-07 (waits class) |
| `src/healer/prompts/waits-no-trace.md` | static template | n/a | none | **GREENFIELD** | Same + HEA-05 |
| `src/healer/prompts/output-format.md` | static template | n/a | none | **GREENFIELD** | JSON shape spec from CONTEXT D-05 §3 |
| `src/healer/prompts/termination.md` | static template | n/a | none | **GREENFIELD** | CONTEXT D-05 §4 |
| `src/healer/forbidden-patterns.ts` | frozen const + types | n/a | `src/shared/security-contract.ts:24-36` | adapt | **Direct copy of the `Object.freeze([…] as const)` pattern** — see excerpt §A below. CONTEXT D-17 explicitly authorizes this. Snapshot file optional (planner's call). |
| `src/healer/diff-lint.ts` | pure function | unified-diff string → `LintFinding[]` | `src/ingest/threshold-evaluator.ts:17-106` | adapt | Pure-function shape (no IO, no `@actions/core`); 03-RESEARCH §"Example D" (line 851) gives the regex matrix |
| `src/healer/fix-applier.ts` | IO (git ops) | `diff, defaultBranch` → branch name + commit SHA | `src/shared/state-branch.ts:57-152` (worktree + `getExecOutput`) | adapt | Reuse `getExecOutput('git', […], { cwd })` discipline; rebase + `git apply` are new commands but same shape. Commit message MUST include `[skip-healer]` (loop-guard sentinel — `src/shared/loop-guard.ts:12`) |
| `src/healer/validator.ts` | IO (subprocess + JSON) | test title → pass/fail counts | `src/shared/state-branch.ts` (`getExecOutput`) + `src/ingest/report-parser.ts` (Zod parse) | adapt | Argv assembly: `['playwright', 'test', '--grep', escapedTitle, '--retries=0', '--workers=1']`. Re-uses Playwright JSON parsing — extract a tiny subset of `report-parser.ts:140-161` (don't re-walk full suite tree; only need pass count) |
| `src/healer/budget.ts` | pure function / state class | tokens-in, USD-per-token → `usdSpent` | none directly | **GREENFIELD** | Mutable counter + pre-call gate; see 03-RESEARCH §"Pattern 1" lines 397-405 + 420-424 for the math |
| `src/healer/pr-writer.ts` | IO (Octokit) | `FixProposal + validation result + PAT` → PR URL | none in repo (Octokit not yet used) | **GREENFIELD** | New dep `@octokit/rest`; D-20. Title/branch shape: 03-RESEARCH §"Pattern 6" (line 633). Body must include `[skip-healer]` in commit msg (PRI-06). |
| `src/healer/issue-writer.ts` | IO (Octokit) | `FailureMode, evidence, PAT` → issue URL | none | **GREENFIELD** | 03-RESEARCH §"Example E" (line 877-925) is near-verbatim usable; six failure-mode tokens locked in CONTEXT D-09 |
| `src/healer/dispatch-payload.ts` | Zod schema | `unknown` → `DispatchPayload` | `src/shared/config.ts:23-82` (`z.object({…}).superRefine(…)`) | adapt | 03-RESEARCH §"Example C" (line 805-823) is the schema body; copy `safeParse → field-named-error → core.setFailed` flow from `src/index.ts:84-91` for the call site |
| `src/healer/types.ts` *(new)* | type-only | n/a | `src/shared/types.ts` | adapt | `ContextBundle`, `FixProposal`, `NoFixProposable` interfaces. Pure type file. Optional — could fold into `adapter.ts`; planner's call. |

### Test files — `src/healer/*.test.ts`

| File | Test type | Closest analog | Pattern note |
|------|-----------|----------------|--------------|
| `src/healer/diff-lint.test.ts` | pure-function unit | `tests/unit/threshold-evaluator.test.ts:1-80` | Synthetic inputs, no mocks; one `it` per regex pattern (positive + negative) |
| `src/healer/prompt-assembler.test.ts` | pure-function unit | same | Determinism + snapshot test; 03-VALIDATION confirms `snapshot` style |
| `src/healer/budget.test.ts` | pure-function unit | same | Pre-call gate + post-call accumulation |
| `src/healer/forbidden-patterns.test.ts` | const snapshot | `tests/unit/loop-guard.test.ts:31-37` (constant exports) | Verify shape + `Object.isFrozen()` |
| `src/healer/dispatch-payload.test.ts` | Zod schema | `tests/unit/config.test.ts:20-80` | Same `safeParse` + field-error pattern |
| `src/healer/app-supervisor.test.ts` | mocked-IO unit | `tests/unit/state-branch-gc.test.ts:12-60` | Mock `child_process.spawn` (not `@actions/exec`); mock HTTP via `nock` or simple stub server. Not a state-branch analog |
| `src/healer/context-bundler.test.ts` | mocked-IO unit | `tests/unit/state-branch-gc.test.ts:12-30` | Mock `@actions/exec.getExecOutput` for git blame; real fs for test source reads |
| `src/healer/validator.test.ts` | mocked-IO unit | same | Mock `@actions/exec`; assert argv contains `--grep`, `--retries=0`, `--workers=1` (VAL-01) |
| `src/healer/pr-writer.test.ts` | mocked-IO unit | `tests/unit/loop-guard.test.ts` (mock `@actions/github`) | Mock `Octokit` constructor; capture `octokit.pulls.create` args (PRI-01, PRI-02, PRI-06) |
| `src/healer/issue-writer.test.ts` | mocked-IO unit | same | Mock `Octokit`; capture `octokit.issues.create({title, body})`; verify `## Failure mode` token (D-09 / D-10) |
| `src/healer/index.test.ts` | mocked-IO component | `tests/unit/loop-guard.test.ts` (event payload mocking) | Mock all IO adapters + `@actions/github.context.payload`; assert routing tree (D-09 six branches + PRI-05) |
| `src/healer/adapters/gemini.test.ts` | mocked-IO unit | `tests/unit/state-branch-gc.test.ts:12-30` | Mock `@google/genai` + `@modelcontextprotocol/sdk` Client; queue `GenerateContentResponse` objects per turn |
| `src/healer/adapters/anthropic.test.ts` | stub error | `tests/unit/loop-guard.test.ts:31-37` (one-liner) | `expect(adapter.runAgent(…)).rejects.toThrow('anthropic adapter not implemented in Phase 3')` |
| `src/healer/adapters/ollama.test.ts` | stub error | same | same |
| `src/healer/fix-applier.test.ts` | real-git integration | `tests/integration/state-branch.test.ts:1-80` + `tests/_helpers/bare-repo.ts:1-42` | Reuse `makeBareRepo()` helper verbatim; assert commit message contains `[skip-healer]` |
| `tests/unit/config.test.ts` *(extend)* | Zod schema | self | Add CFG-04 toggles + `setupCommand`, `startCommand`, `startupTimeoutSeconds` (already present) — extend, don't rewrite |

### Fixtures (NEW)

| File | Pattern note |
|------|--------------|
| `tests/fixtures/playwright-rerun-passed.json` | Use `tests/_helpers/fixture-report.ts:18-49` (`makeFixtureReport`) to generate; checked-in for determinism |
| `tests/fixtures/playwright-rerun-failed.json` | same |
| `tests/fixtures/playwright-rerun-mixed.json` | 9 expected + 1 unexpected = 0.9 pass-rate |
| `tests/fixtures/unified-diff-clean.patch` | Hand-authored — no analog (greenfield static fixture) |
| `tests/fixtures/unified-diff-with-waitForTimeout.patch` | same — must trip `forbidden-patterns.ts` regex |
| `tests/fixtures/unified-diff-with-nth-child.patch` | same |
| `tests/fixtures/unified-diff-with-weakened-assertion.patch` | same — pair `.toBe` removal with `.toBeTruthy` addition in same hunk |
| `tests/fixtures/unified-diff-out-of-testdir.patch` | same — modify `src/foo.ts` (outside `TEST_PATH_ALLOWLIST`) |

### Modified files

| File | Pattern note |
|------|--------------|
| `action.yml` | Extend the existing `runs.using: composite` block (currently 3 steps, lines 98-136). Add: `setup-command` sync step, `start-command` background step + readiness probe, the heal step (renamed from "Run playwright-healer"), post-step `if: always()` cleanup. Keep `npm ci --production` and `actions/setup-node@<sha>` steps unchanged. See 03-RESEARCH §"Pattern 2" lines 458-516 for the verbatim shape |
| `package.json` | **Add three new deps:** `@google/genai` (1.50.1 verified), `@modelcontextprotocol/sdk` (typed `Client`), `@octokit/rest` (22.0.1 — currently only present as transitive dep of `@actions/github`; D-20 mandates the direct dep). Confirm `@playwright/mcp` exact-pinned at `0.0.70` (already done — package.json:19) |
| `src/index.ts` | **No change required.** Phase 1 already wired `case 'heal': const m = await import('./healer/index.js'); await m.run(config);` (line 104-108). Verify only |
| `src/shared/config.ts` | **Possible extension:** D-18 schema lives in a new `src/healer/dispatch-payload.ts`, NOT in shared config. CFG-04 per-fix-class toggles + `startupTimeoutSeconds` may need adding here — confirm against existing fields (line 38-72 already covers `setupCommand`, `startCommand`, `rerunCount`, `rerunPassRate`, `maxBudgetUsd`, `maxTurns`). Only `startupTimeoutSeconds` is genuinely missing |

---

## Detailed Analog Excerpts

### §A. Frozen security-contract pattern → `forbidden-patterns.ts`

**Source:** `src/shared/security-contract.ts:24-36`

```typescript
export const ALLOWED_TOOLS = Object.freeze([
  'Glob',
  'Grep',
  'Read',
  'mcp__playwright__*',
] as const);

export const ALLOWED_ORIGIN_TEMPLATE = (baseUrl: string): readonly string[] =>
  Object.freeze([baseUrl, 'http://localhost:*']);

export const FORBIDDEN_WORKFLOW_TRIGGERS = Object.freeze([
  'pull_request_target',
] as const);
```

**Apply to `forbidden-patterns.ts`:** copy the `Object.freeze([…] as const)` shape exactly. Also adopt the file-header comment style (security warning + `// downstream phases (2+) MUST import these constants` — adapted to: "diff-lint and prompt-assembler MUST import these — inline literals banned by D-13 grep-check"). Optionally add `forbidden-patterns.snapshot.json` mirroring `.planning/security-contract.snapshot.json` (15 lines — see existing).

---

### §B. Pure-function pattern → `diff-lint.ts`

**Source:** `src/ingest/threshold-evaluator.ts:17-30, 105-121`

```typescript
export function evaluateThresholds(
  records: NdjsonRecord[],
  config: EvaluatorConfig,
): Detection[] {
  const now = Date.now();
  const windowStart = now - config.flakeWindowDays * 24 * 60 * 60 * 1000;

  // 1. Filter to rolling window
  const windowRecords = records.filter(
    (r) => new Date(r.timestamp).getTime() >= windowStart,
  );
  // … numbered comments mark each phase …
  return detections;
}
```

**Apply to `diff-lint.ts`:**
- Pure function, no `@actions/core`, no IO, no exceptions for control flow.
- Numbered phase comments (`// 1. Walk hunks`, `// 2. Check forbidden lines`, `// 3. Check assertion weakening`, `// 4. Check path allowlist`).
- Return `LintFinding[]` (empty array = clean diff). 03-RESEARCH §"Example D" (line 866-874) is the function signature.

---

### §C. Pipeline orchestrator pattern → `healer/index.ts`

**Source:** `src/ingest/index.ts:44-147` (the *inner* orchestrator — NOT `src/index.ts` which is the outer dispatcher)

```typescript
export async function run(config: Config): Promise<void> {
  // ── Step 1: LOOP GUARD (SEC-05) — must be first ──────────────────────────
  if (shouldSkipIngest()) {
    return;
  }
  // ── Step 2: Config already merged + validated by src/index.ts main() ────
  // ── Step 3: REPORT PARSE (ING-01..04) ───────────────────────────────────
  // … numbered steps …

  let worktreePath: string | null = null;
  try {
    worktreePath = await bootstrapOrGetWorktree(remoteUrl, primaryCwd);
    await appendRecord(record, worktreePath);
    // … more steps …
  } finally {
    if (worktreePath) {
      await removeWorktree(worktreePath).catch((e: unknown) =>
        core.warning(`Worktree cleanup failed: ${String(e)}`),
      );
    }
  }
}
```

**Apply to `healer/index.ts`:**
- Numbered comment-headed steps (1. parse dispatch payload via Zod → 2. start app supervisor → 3. context bundler → 4. pre-fix sanity rerun → 5. adapter.runAgent → 6. diff-lint → 7. fix-applier → 8. validator → 9. pr-writer or issue-writer).
- `try { … } finally { await appSupervisor.stop(); await mcpClient.close(); }` shape (HEA-06 inner cleanup, CONTEXT D-12).
- Cleanup errors swallowed via `.catch(e => core.warning(…))` — matches the `removeWorktree` style.
- Dispatch-payload validation pattern from `src/index.ts:84-91`:
```typescript
const parsed = DispatchPayload.safeParse(github.context.payload.inputs);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  core.setFailed(`Invalid dispatch payload: ${msg}`);
  return;
}
```

---

### §D. Git-via-`@actions/exec` pattern → `fix-applier.ts`, `context-bundler.ts`

**Source:** `src/shared/state-branch.ts:67-91, 167-249`

```typescript
const lsRemote = await getExecOutput(
  'git',
  ['ls-remote', '--exit-code', 'origin', `refs/heads/${STATE_BRANCH}`],
  { cwd: primaryCwd, ignoreReturnCode: true },
);
// … later …
await getExecOutput(
  'git',
  ['-c', `user.email=${BOT_EMAIL}`,
   '-c', `user.name=${BOT_NAME}`,
   'commit', '-m', `stats: run ${record.runId} [skip-healer]`],
  { cwd: worktreePath },
);
// … and …
const push = await getExecOutput(
  'git',
  ['push', `--force-with-lease=${STATE_BRANCH}`, 'origin', STATE_BRANCH],
  { cwd: worktreePath, ignoreReturnCode: true },
);
if (push.exitCode === 0) return;
```

**Apply to `fix-applier.ts`:**
- Every `getExecOutput('git', …)` call MUST pass `{ cwd: worktreePath }` (Pitfall A in `state-branch.ts:8-11`).
- Use `ignoreReturnCode: true` for `git apply` (it returns non-zero on conflicts — handle as `LintFinding`-style structured failure).
- Bot identity inline via `-c user.email=… -c user.name=…` instead of `git config` (Phase 02 invariant).
- Commit message includes `[skip-healer]` (PRI-06 — see `loop-guard.ts:12`'s `SKIP_SENTINEL`).
- Sequence: `fetch origin` → `checkout -b playwright-healer/<test-slug>-<short-sha>` → `git apply --check` (lint) → `git apply` → `commit` → `push -u origin <branch>`. NOT `--force-with-lease` (PR branch is fresh).

**Apply to `context-bundler.ts`:** only the `getExecOutput('git', ['blame', '-p', filePath], { cwd })` call. First-hop import resolution does NOT use git — it's a regex over the test file's `import` statements then `fs.readFileSync` of each resolved path.

---

### §E. Vitest mocked-IO pattern → all IO-touching `*.test.ts`

**Source:** `tests/unit/state-branch-gc.test.ts:12-30`

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock @actions/exec so git calls succeed without a real git repo.
// MUST be declared before importing the module under test (Vitest hoists vi.mock).
vi.mock('@actions/exec', () => ({
  getExecOutput: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  info: vi.fn(),
}));

import { runGc } from '../../src/shared/state-branch.js';
```

**Apply to `validator.test.ts`, `fix-applier.test.ts` (when not using bare-repo helper), `context-bundler.test.ts`:**
- `vi.mock` declarations BEFORE `import` of the module under test (Vitest hoist requirement).
- Mock returns `{ stdout, stderr, exitCode }` — fixture-driven for stdout (e.g., paste real `git blame` output for `context-bundler.test.ts`).
- `vi.clearAllMocks()` in `beforeEach`.

**Apply to `pr-writer.test.ts`, `issue-writer.test.ts`:**
```typescript
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    pulls: { create: vi.fn().mockResolvedValue({ data: { html_url: 'https://…' } }) },
    issues: { create: vi.fn().mockResolvedValue({ data: { html_url: 'https://…' } }) },
  })),
}));
```

**Apply to `gemini.test.ts`:**
```typescript
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent: vi.fn() } })),
  mcpToTool: vi.fn().mockReturnValue({ tool: vi.fn(), callTool: vi.fn().mockResolvedValue([]) }),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'browser_navigate' }] }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));
```

---

### §F. Real-git integration pattern → `fix-applier.test.ts`

**Source:** `tests/integration/state-branch.test.ts:14-45` + `tests/_helpers/bare-repo.ts:20-41`

```typescript
import { makeBareRepo, BareRepoContext } from '../_helpers/bare-repo.js';
import {
  bootstrapOrGetWorktree, appendRecord, removeWorktree, todayPath, runGc,
} from '../../src/shared/state-branch.js';

describe('state-branch — STA-01..05', () => {
  let ctx: BareRepoContext;
  beforeEach(() => { ctx = makeBareRepo(); });
  afterEach(() => { ctx.cleanup(); });

  it('STA-01: bootstrap creates orphan playwright-healer-state branch on first use', async () => {
    const wt = await bootstrapOrGetWorktree(ctx.remoteUrl, ctx.primaryWs1);
    try {
      const { execSync } = await import('child_process');
      const branches = execSync(`git branch -a`, { cwd: ctx.remoteDir }).toString();
      expect(branches).toContain('playwright-healer-state');
    } finally {
      await removeWorktree(wt);
    }
  });
});
```

**Apply to `fix-applier.test.ts`:**
- Reuse `makeBareRepo()` verbatim — yields `{ remoteDir, primaryWs1, primaryWs2, remoteUrl, cleanup }`.
- Seed `primaryWs1` with a fake `tests/checkout.spec.ts` containing `getByText('Buy now')` (the "broken" selector).
- Apply a fix-applier-generated diff that swaps for `getByRole('button', { name: 'Buy now' })`.
- Assert: `git log -1 --format=%B` on the PR branch contains `[skip-healer]`; the branch was successfully pushed to `remoteDir`.

---

### §G. Zod-validated input pattern → `dispatch-payload.ts`

**Source:** `src/shared/config.ts:23-82`

```typescript
export function getInputSchema() {
  return z.object({
    mode: ModeEnum,
    setupCommand: z.string().default(''),
    // …
    healerToken: z.string().min(1, { message: 'healer-token is required and must be non-empty' }),
    flakeRateThreshold: z.coerce.number()
      .refine((v) => !isNaN(v), {
        message: 'flake-rate-threshold must be a valid number (e.g. 0.2)',
      })
      .min(0).max(1).default(0.2),
    // …
  }).superRefine((v, ctx) => {
    if (v.provider !== 'ollama' && v.apiKey.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiKey'],
        message: 'api-key is required and must be non-empty unless provider is ollama',
      });
    }
  });
}
```

**Apply to `dispatch-payload.ts`:**
- Top-level `z.object({…})` (no factory function needed — single use site).
- Field-level `.regex(/^[0-9a-f]{7,40}$/i, 'commitSha must be a hex SHA')` for `commitSha`.
- `z.enum(['selectors', 'waits'])` for `fixClassHint`.
- `recentRunStats` as `.optional()` (D-18 — manual dispatcher may omit).
- 03-RESEARCH §"Example C" (line 805-823) is the schema body verbatim — copy it.

**Call site** in `healer/index.ts` mirrors `src/index.ts:84-91`:
```typescript
const parsed = DispatchPayload.safeParse(github.context.payload.inputs);
if (!parsed.success) {
  core.setFailed(`Invalid dispatch payload: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return;
}
```

---

### §H. Stub adapter pattern → `anthropic.ts`, `ollama.ts`

**Source:** Current `src/healer/index.ts:1-7` (Phase 1 stub style)

```typescript
// src/healer/index.ts
import type { Config } from '../shared/config.js';

export async function run(_config: Config): Promise<never> {
  throw new Error('heal mode not implemented until Phase 3');
}
```

**Apply to `src/healer/adapters/anthropic.ts`:**
```typescript
import type { Adapter } from '../adapter.js';

export const anthropicAdapter: Adapter = {
  async runAgent() {
    throw new Error('anthropic adapter not implemented in Phase 3');
  },
};
```
Same shape for `ollama.ts` (substitute provider name). 03-RESEARCH §"Example B" (line 794-803) confirms this verbatim.

---

### §I. core.summary write pattern → step-summary parity (D-11)

**Source:** `src/ingest/summary-writer.ts:8-44` and `src/index.ts:144-152`

```typescript
let md = '## playwright-healer — Threshold Breaches (log-only)\n\n';
md += `> Detection mode: **log-only** (Phase 04 enables auto-dispatch)\n\n`;
md += `| Test | Reason | Value | Threshold | Runs in Window |\n`;
// …
await core.summary.addRaw(md).write();
```

**Apply to:** the step-summary writes inside `pr-writer.ts` and `issue-writer.ts` (D-11 step-summary parity). One line: `await core.summary.addRaw(md).write();` — chainable `.addHeading` / `.addRaw` / `.write` style. **Never echo secrets** (`apiKey`, `healerToken`) — lift the redaction style from `src/index.ts:118-141`.

---

## Greenfield Landmines

Files / patterns with **no codebase analog**. Planner should schedule extra reading time for these and budget for invent-from-scratch tasks:

| File / pattern | Closest reference | Risk |
|----------------|-------------------|------|
| `src/healer/adapters/gemini.ts` — manual tool-use loop with `automaticFunctionCalling.disable: true`, `mcpToTool(client)`, audit-invariant on `client.listTools()`, manual budget accounting | 03-RESEARCH §"Pattern 1" lines 360-450 (verified against installed `@google/genai@1.50.1` source) | High — single biggest unknown of Phase 3; SDK API verified but our integration is greenfield |
| `src/healer/app-supervisor.ts` — `child_process.spawn` (NOT `@actions/exec`) for long-running app + HTTP polling + PID file write | 03-RESEARCH §"Pattern 2" line 452 (action.yml shape) + §"Pattern 3" line 517 (probe shape). `state-branch.ts` is NOT a structural analog despite both touching subprocesses | High — different IO primitive than rest of codebase; needs cooperative shutdown semantics |
| `src/healer/prompt-assembler.ts` + 7 markdown templates | CONTEXT D-05/D-06/D-07/D-08; no code excerpt | Low — straightforward fs reads + concatenation, but template *content* must mirror the binding decisions exactly |
| `src/healer/budget.ts` | 03-RESEARCH §"Pattern 1" lines 397-405, 420-424 | Low — small mutable counter, but pricing ($1.25/M input, $10.00/M output) must be sourced from a constant (don't inline) |
| `src/healer/pr-writer.ts` (Octokit PAT auth) | 03-RESEARCH §"Pattern 6" line 633; PROJECT.md "PAT required" | Medium — first Octokit consumer in the project; `@octokit/rest` not currently a direct dep (only transitive) |
| `src/healer/issue-writer.ts` | 03-RESEARCH §"Example E" lines 877-925 | Low — example is near-verbatim usable; six failure-mode tokens locked in CONTEXT D-09 |
| `src/healer/context-bundler.ts` first-hop import resolution | none — invent: regex `/^import .+ from ['"](.+)['"]/gm` → resolve relative paths → `fs.readFileSync` | Medium — TS path aliases (`@/`) edge case; document scope as "relative imports only" if not handling tsconfig paths |
| Static `.md` prompt templates × 7 | CONTEXT decisions only | Low — content fidelity to D-05..D-08 is the gate, not code quality |
| Diff-fixture `.patch` files × 5 | none — hand-author small unified diffs | Low — keep deliberately tiny (5-10 lines each) |

---

## Cross-Cutting Patterns Applied to Multiple Files

### Loop-guard sentinel discipline (PRI-06)
**Source:** `src/shared/loop-guard.ts:12` exports `SKIP_SENTINEL = '[skip-healer]'`.
**Apply to:** every commit message produced by `fix-applier.ts` and the PR body's commit-message template in `pr-writer.ts`. Import the constant — don't inline-literal (D-13 grep-check banned).

### Security-contract import discipline
**Source:** `src/shared/security-contract.ts:24-32`.
**Apply to:** `gemini.ts` MUST import `ALLOWED_TOOLS` (audit-invariant per CONTEXT D-03) and `ALLOWED_ORIGIN_TEMPLATE(baseUrl)` (Playwright MCP `--allowed-origins` per SEC-03 / D-21). Inline literals like `'browser_navigate'` are CI-blocked.

### Secret masking discipline (D-07 inheritance)
**Source:** `src/index.ts:38-44` already calls `core.setSecret(apiKey/healerToken/githubToken)` BEFORE any log line. Phase 3 inherits this; **no `core.info`/`core.warning` in any healer file may interpolate `config.apiKey` or `config.healerToken`**. Adapter error paths must scrub.

### Field-named Zod errors → `core.setFailed`
**Source:** `src/index.ts:84-91`.
**Apply to:** `dispatch-payload.ts` call site in `healer/index.ts`. Same `safeParse → issues.map → setFailed → return` shape.

### Numbered-step pipeline orchestration
**Source:** `src/ingest/index.ts:44-147` (numbered comment headers; `try { … } finally { cleanup }`).
**Apply to:** `src/healer/index.ts` (~9 numbered steps).

### Frozen-const + snapshot security style
**Source:** `src/shared/security-contract.ts:24-36` + `.planning/security-contract.snapshot.json:1-15`.
**Apply to:** `src/healer/forbidden-patterns.ts` (CONTEXT D-17 explicitly authorizes; snapshot file is planner's call).

---

## No Analog Found (summary)

Files with no in-repo match (greenfield, see "Greenfield Landmines" section above for references):

| File | Reason |
|------|--------|
| `src/healer/adapters/gemini.ts` | First LLM SDK integration — no prior consumer in repo |
| `src/healer/app-supervisor.ts` | First long-running subprocess supervisor — `state-branch.ts` is short-lived `getExecOutput` |
| `src/healer/prompts/*.md` (7 files) | First prompt template directory |
| `src/healer/prompt-assembler.ts` | First template assembler |
| `src/healer/budget.ts` | First per-run cost tracker |
| `src/healer/pr-writer.ts` | First direct Octokit consumer (no `@octokit/rest` dep yet) |
| `src/healer/issue-writer.ts` | Same |
| `tests/fixtures/unified-diff-*.patch` (5 files) | First hand-authored diff fixtures |
| Test of mocked HTTP probe in `app-supervisor.test.ts` | First HTTP-mocking test in the repo |

---

## Metadata

**Analog search scope:** `src/`, `tests/`, `action.yml`, `package.json`, `.planning/security-contract.snapshot.json`.
**Files scanned:** 17 source files + 8 test/helper files + 4 config files = 29 files read.
**Pattern extraction date:** 2026-04-26.
**Verified against:** current `main` (commit `3c11fef`).

---

## PATTERN MAPPING COMPLETE

**Phase:** 3 — Manual Healer (Selectors + Waits + Issue Fallback)
**Files classified:** 31 (18 source + 13 test/fixture/config)
**Analogs found:** 22 / 31 (9 greenfield)

### Coverage
- Files with exact analog (role + data flow match): 5 (`forbidden-patterns.ts`, `dispatch-payload.ts`, stub adapters × 2, extended `config.test.ts`)
- Files with role-match analog (similar shape, adapt): 17 (orchestrators, pure functions, Zod schemas, vitest patterns, git ops)
- Files with no analog (greenfield): 9 (Gemini adapter, app-supervisor, 7 prompt templates + assembler + budget + 2 Octokit writers + 5 patch fixtures — counted as categories above)

### Key Patterns Identified
- **Numbered-step orchestrator** with `try { … } finally { cleanup }` — mirror `src/ingest/index.ts` for `src/healer/index.ts`
- **Pure-function modules** with no `@actions/core` and no IO — mirror `src/ingest/threshold-evaluator.ts` for `diff-lint`, `prompt-assembler`, `budget`
- **`@actions/exec` git ops** with `{ cwd }` discipline + `[skip-healer]` commit messages — mirror `src/shared/state-branch.ts` for `fix-applier.ts`
- **Zod safeParse → field-named-error → `core.setFailed`** — mirror `src/index.ts:84-91` for dispatch-payload validation
- **Frozen-const security style** — mirror `src/shared/security-contract.ts` for `forbidden-patterns.ts`
- **Vitest `vi.mock` declared before `import` of SUT** — mirror `tests/unit/state-branch-gc.test.ts`

### File Created
`/Users/sacha/dev/playwright-healer/.planning/phases/03-manual-healer-selectors-waits-issue-fallback/03-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns in PLAN.md files. Greenfield files (Gemini adapter, app-supervisor, prompt templates, Octokit writers) are explicitly flagged so planner can budget appropriate task time and prefer 03-RESEARCH §"Pattern 1/2/3/6" + §"Example A-E" excerpts for those modules.
