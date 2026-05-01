# Phase 4: Auto-Dispatch + Full Fix Classes + Deduplication — Pattern Map

**Mapped:** 2026-05-01
**Files analyzed:** 24 (7 new, 17 modified)
**Analogs found:** 23 in-repo exact + 1 partial (recipe from RESEARCH §Pattern 2 for the concurrency block)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| **NEW** `src/ingest/dispatch.ts` | service | request-response (Octokit POST) | `src/healer/pr-writer.ts` | exact — Octokit + PAT + summary write |
| **NEW** `src/ingest/classifier.ts` | utility | transform (errorSig → enum) | `src/ingest/report-parser.ts` `mapOutcome()` | exact — pure switch over error string |
| **NEW** `src/healer/prompts/assertions-no-trace.md` | prompt template | static template | `src/healer/prompts/selectors-no-trace.md` | exact — same skeleton + placeholders |
| **NEW** `src/healer/prompts/assertions-with-trace.md` | prompt template | static template | `src/healer/prompts/selectors-with-trace.md` | exact |
| **NEW** `src/healer/prompts/slow-no-trace.md` | prompt template | static template | `src/healer/prompts/waits-no-trace.md` | exact |
| **NEW** `src/healer/prompts/slow-with-trace.md` | prompt template | static template | `src/healer/prompts/waits-with-trace.md` | exact |
| **NEW** `fixture/tests/broken-assertion.spec.ts` | test fixture | test | `fixture/tests/broken-selector.spec.ts` | exact (mirror with assertion bug) |
| **MOD** `src/ingest/index.ts` | orchestrator | pipeline | `src/ingest/index.ts` (own Step 6/7 ordering) | exact — extend pipeline pattern |
| **MOD** `src/shared/loop-guard.ts` | middleware | request-response (boolean coerce) | `src/shared/loop-guard.ts` `shouldSkipIngest()` | exact — sibling function |
| **MOD** `src/shared/state-branch.ts` | service | file-I/O + git | `src/shared/state-branch.ts` `appendRecord()` | exact — same retry loop, new path |
| **MOD** `src/shared/types.ts` | model | type-only | `src/shared/types.ts` `NdjsonRecord` interface | exact — additive interface |
| **MOD** `src/shared/config.ts` | config | request-response (Zod) | `src/shared/config.ts` `skipDiffLint` field | exact — Zod string→bool transform |
| **MOD** `src/healer/dispatch-payload.ts` | model | request-response (Zod) | `src/healer/dispatch-payload.ts` (own schema) | exact — widen enum + flatten nested |
| **MOD** `src/healer/adapter.ts` | model | type-only | `src/healer/adapter.ts:17` (own `FixProposal.fixClass`) | exact — UPSTREAM type widen; both adapters' `parseFinalText` widens follow from this |
| **MOD** `src/healer/prompt-assembler.ts` | utility | transform | `src/healer/prompt-assembler.ts` (own logic) | exact — widen `fixClassHint` enum |
| **MOD** `src/healer/pr-writer.ts` | service | request-response (Octokit) | `src/healer/pr-writer.ts` (own create call) | exact — wrap with `findExistingOpenPr()` |
| **MOD** `src/healer/issue-writer.ts` | service | request-response (Octokit) | `src/healer/issue-writer.ts` (own create call) | exact — wrap with `findExistingOpenIssue()` |
| **MOD** `src/healer/index.ts` | orchestrator | pipeline | `src/healer/index.ts` Step 1+5 | exact — add Step 1.5 (Guard 3) |
| **MOD** `src/healer/types.ts` | model | type-only | `src/healer/types.ts` `FailureMode` union | exact — add `'cap-exceeded'` token |
| **MOD** `src/healer/adapters/github.ts` | adapter | transform | `parseFinalText()` line 312-351 | exact — widen enum literal check |
| **MOD** `src/healer/adapters/gemini.ts` | adapter | transform | `parseFinalText()` line 235-241 | exact — same widen as github.ts |
| **MOD** `src/healer/prompts/output-format.md` | prompt template | static template | own | exact — widen `fixClass` enum literal |
| **MOD** `action.yml` | config | declarative | own (`enable_*_fixes` + `INPUT_*` env block) | exact — append snake_case input + env line |
| **MOD** `.github/workflows/e2e-heal-self.yml` | workflow | declarative | (no in-repo concurrency analog) | partial — recipe from RESEARCH §Pattern 2 |

---

## Pattern Assignments

### NEW `src/ingest/dispatch.ts` (service, request-response)

**Analog:** `src/healer/pr-writer.ts` lines 1-87

**Imports pattern** (`pr-writer.ts:8-11`):
```typescript
import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';
import { SKIP_SENTINEL } from '../shared/loop-guard.js';
import type { ValidationResult } from './validator.js';
```

**Auth pattern — PAT-via-args constructor (`pr-writer.ts:66-67`):**
```typescript
export async function openHealerPr(args: OpenHealerPrArgs): Promise<string> {
  const octokit = new Octokit({ auth: args.patToken });
```
Apply identically: `new Octokit({ auth: args.patToken })`. NEVER use `@actions/github`'s built-in client — it is `GITHUB_TOKEN`-only and bot dispatches via `GITHUB_TOKEN` would not trigger downstream CI (Pitfall 1, also documented at `pr-writer.ts:3-7`).

**Core REST-call pattern** (`pr-writer.ts:72-79`):
```typescript
const { data: pr } = await octokit.pulls.create({
  owner: args.owner,
  repo: args.repo,
  title,
  head: args.branch,
  base: args.defaultBranch,
  body,
});
```
Mirror to:
```typescript
await octokit.rest.actions.createWorkflowDispatch({
  owner: args.owner,
  repo: args.repo,
  workflow_id: args.workflowFile,
  ref: args.ref,
  inputs: { commitSha, testFile, testTitle, fixClassHint, flakeRate, windowDays, runCount, concurrencyKey },
});
```

**Step-summary pattern** (`pr-writer.ts:81-84`):
```typescript
await core.summary
  .addRaw(`## Healer PR opened\n\n[${title}](${pr.html_url})\n\n${body}`)
  .write();
```
Apply identically with `## Heal dispatched (DET-05)` heading.

**Args interface pattern** (`pr-writer.ts:13-28`):
```typescript
export interface OpenHealerPrArgs {
  patToken: string;
  owner: string;
  repo: string;
  ...
}
```
Mirror to `FireDispatchArgs` with the 8 inputs from RESEARCH §"Code Examples §1".

---

### NEW `src/ingest/classifier.ts` (utility, transform)

**Analog:** `src/ingest/report-parser.ts` lines 22-37 (`mapOutcome()`)

**Pure-switch pattern** (`report-parser.ts:29-37`):
```typescript
function mapOutcome(playwrightStatus: string): Outcome {
  switch (playwrightStatus) {
    case 'expected': return 'passed';
    case 'unexpected': return 'failed';
    case 'flaky': return 'flaky';
    case 'skipped': return 'skipped';
    default: return 'failed'; // defensive fallback for unknown values
  }
}
```

Adapt for substring-match (RESEARCH §"FIX-07 Architecture" classifier rules):
```typescript
type FixClassHint = 'selectors' | 'waits' | 'assertions' | 'slow';

export function classifyFixClass(errorSignature: string): FixClassHint {
  if (/Test timeout of|Test timed out/i.test(errorSignature)) return 'slow';
  if (/expect\(received\)|Expected:[\s\S]*Received:|assertion/i.test(errorSignature)) return 'assertions';
  if (/Element is not stable|intercepted/i.test(errorSignature)) return 'waits';
  if (/locator\.|waiting for locator|Target closed/i.test(errorSignature)) return 'selectors';
  return 'selectors'; // defensive fallback — most common class
}
```

**Type-import pattern** (`report-parser.ts:13`):
```typescript
import type { NdjsonTestEntry } from '../shared/types.js';
```
Mirror — import `FixClassHint` from a single source (recommend re-export from `dispatch-payload.ts` to avoid drift).

**Critical:** No `eval`, no `string interpolation` of the input — regex `.test()` only (RESEARCH §"Security Domain", "Untrusted error-signature passed to classifier"). The classifier MUST be pure and side-effect-free for unit testability.

---

### MOD `src/shared/loop-guard.ts` (middleware, request-response)

**Analog:** Same file — `shouldSkipIngest()` lines 22-47

**Boolean-decision-with-info-log pattern** (`loop-guard.ts:22-47`):
```typescript
export function shouldSkipIngest(): boolean {
  const payload = github.context.payload;

  if (payload.pull_request?.head?.repo?.fork === true) {
    core.info('SEC-05 Guard 0: Skipping ingest — fork PR detected');
    return true;
  }
  ...
  return false;
}
```

**Pattern to extract for D-04 (counting separated from boolean coerce):**

The analog is a single-shot boolean. Phase 04 needs both a count AND a boolean decision, so split into two exports per RESEARCH §"Code Examples §3":

```typescript
// 1) Pure count — used by ingest-side D-04 gate AND by healer-side Guard 3.
export async function countHealsForTest(
  testId: string,
  windowDays: number,
  worktreePath: string,
): Promise<number> { /* see RESEARCH §"Code Examples §3" */ }

// 2) Boolean wrapper — sibling of shouldSkipIngest, used by healer Step 1.5.
export async function shouldSkipHeal(
  testId: string,
  config: { maxHealsPerTestPerWeek: number; flakeWindowDays: number },
  worktreePath: string,
): Promise<{ skip: boolean; count: number }> {
  const count = await countHealsForTest(testId, config.flakeWindowDays, worktreePath);
  return { skip: count >= config.maxHealsPerTestPerWeek, count };
}
```

**Logging convention** (`loop-guard.ts:35`):
```typescript
core.info(`SEC-05 Guard 1: Skipping ingest — bot-authored commit detected (${BOT_EMAIL})`);
```
Mirror with `SEC-05 Guard 3: ...` prefix in any new log statements (matches the established Guard-N naming).

---

### MOD `src/shared/state-branch.ts` — `appendHealEvent()` helper

**Analog:** Same file — `appendRecord()` lines 167-249

**Today-path helper pattern** (`state-branch.ts:32-38`):
```typescript
export function todayPath(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `runs/${y}/${m}/${d}.ndjson`;
}
```
Add a sibling:
```typescript
export function todayHealPath(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `runs/${y}/${m}/${d}-heals.ndjson`;
}
```

**Append + force-with-lease retry loop** (`state-branch.ts:167-249`):
```typescript
for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  // 1. Sync to remote state before every attempt
  await getExecOutput('git', ['fetch', 'origin', STATE_BRANCH], { cwd: worktreePath });
  await getExecOutput('git', ['reset', '--hard', `origin/${STATE_BRANCH}`], { cwd: worktreePath });

  // 2. Ensure NDJSON directory exists
  fs.mkdirSync(path.join(worktreePath, path.dirname(ndjsonPath)), { recursive: true });

  // 3. Atomic append (temp rename prevents partial-write corruption — Pitfall B)
  const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
  const appended = existing + JSON.stringify(record) + '\n';
  const tmpPath = `${absPath}.tmp`;
  fs.writeFileSync(tmpPath, appended, 'utf8');
  fs.renameSync(tmpPath, absPath);

  // 4. Stage and commit in the worktree (never in process.cwd())
  await getExecOutput('git', ['add', ndjsonPath], { cwd: worktreePath });
  await getExecOutput(
    'git',
    ['-c', `user.email=${BOT_EMAIL}`, '-c', `user.name=${BOT_NAME}`,
     'commit', '-m', `stats: run ${record.runId} [skip-healer]`],
    { cwd: worktreePath },
  );

  // 5. Push with ref-qualified lease
  const push = await getExecOutput(
    'git',
    ['push', `--force-with-lease=${STATE_BRANCH}`, 'origin', STATE_BRANCH],
    { cwd: worktreePath, ignoreReturnCode: true },
  );
  if (push.exitCode === 0) return;

  // Exponential backoff + jitter
  const delayMs = 100 * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
  ...
}
```

`appendHealEvent()` is the **same retry loop with two diffs**:
1. `ndjsonPath = todayHealPath()` instead of `todayPath()`
2. Commit message: `heal: ${event.testId} ${event.outcome} [skip-healer]` (the `[skip-healer]` sentinel is **load-bearing** — Guard 2 must skip these commits, otherwise dispatching the heal triggers re-ingest infinitely).

**Critical invariants** (`state-branch.ts:8-13` comment block):
- Every `getExecOutput('git', ...)` MUST include `{ cwd: worktreePath }` (Pitfall A — workspace contamination)
- `--force-with-lease=playwright-healer-state` (ref-qualified, NOT bare `--force-with-lease`) — Pitfall C
- After exhausted retries: `core.warning()` only, no throw (Assumption A1)
- `[skip-healer]` sentinel in EVERY commit message

---

### MOD `src/shared/types.ts` — `HealEvent` interface

**Analog:** Same file — `NdjsonRecord` interface lines 5-15

**Type-only addition pattern** (`types.ts:5-15`):
```typescript
export interface NdjsonRecord {
  schemaVersion: 1;
  timestamp: string;      // ISO 8601 UTC
  runId: string;          // GITHUB_RUN_ID
  ...
}
```

Mirror exactly for `HealEvent` per RESEARCH §"Heal-Event Write Sites":
```typescript
export interface HealEvent {
  schemaVersion: 1;
  timestamp: string;     // ISO 8601 UTC
  testId: string;        // "{filePath}::{title}" — same key as NdjsonTestEntry.testId
  outcome: 'pr-opened' | 'issue-opened' | 'cap-reached';
  dispatchRunId: string; // GITHUB_RUN_ID at write time
  prUrl?: string;        // populated for 'pr-opened' only
  issueUrl?: string;     // populated for 'issue-opened' only
}
```

---

### MOD `src/shared/config.ts` — `enableAutoDispatch`

**Analog:** Same file — `skipDiffLint` line 110

**Zod string→boolean transform pattern** (`config.ts:107-110`):
```typescript
// Same z.string() pattern as CFG-04 but inverted default: these flags DEFAULT OFF.
// .default('false').transform(v => v === 'true') → absent or 'false' → false; 'true' → true.
skipDeterministicCheck: z.string().default('false').transform(v => v === 'true'),
skipPostFixValidation:  z.string().default('false').transform(v => v === 'true'),
skipDiffLint:           z.string().default('false').transform(v => v === 'true'),
```

Apply IDENTICALLY for `enableAutoDispatch` (CONTEXT D-01: opt-in, default `'false'`):
```typescript
enableAutoDispatch: z.string().default('false').transform(v => v === 'true'),
```

**DO NOT use `.default(true)` (the CFG-04 toggle pattern, line 90-93):**
```typescript
enableSelectorFixes:  z.string().default('true').transform(v => v !== 'false'),
```
That is the wrong default polarity. CONTEXT D-01 locks `enable_auto_dispatch` to default-OFF.

**Comment near the line** — copy the `// Same pattern as ... but inverted default ...` template so the next reader sees the polarity choice was deliberate.

---

### MOD `src/healer/dispatch-payload.ts` — schema widening

**Analog:** Same file lines 12-22

**Existing schema (Phase 03):**
```typescript
export const DispatchPayload = z.object({
  commitSha:    z.string().regex(/^[0-9a-f]{7,40}$/i, 'commitSha must be a hex SHA'),
  testFile:     z.string().min(1),
  testTitle:    z.string().min(1),
  fixClassHint: z.enum(['selectors', 'waits']),
  recentRunStats: z.object({
    flakeRate:  z.number().min(0).max(1),
    windowDays: z.number().int().min(1),
    runCount:   z.number().int().min(0),
  }).optional(),
});
```

**Phase 04 widening** (RESEARCH §"Open Questions §3 — CLOSED"):
```typescript
export const DispatchPayload = z.object({
  commitSha:    z.string().regex(/^[0-9a-f]{7,40}$/i, 'commitSha must be a hex SHA'),
  testFile:     z.string().min(1),
  testTitle:    z.string().min(1),
  fixClassHint: z.enum(['selectors', 'waits', 'assertions', 'slow']),  // widened
  // FLAT — replaces nested recentRunStats. workflow_dispatch inputs are strings;
  // z.coerce.number() handles "0.42" → 0.42.
  flakeRate:      z.coerce.number().min(0).max(1).optional(),
  windowDays:     z.coerce.number().int().min(1).optional(),
  runCount:       z.coerce.number().int().min(0).optional(),
  concurrencyKey: z.string().min(1),  // required from Phase 04 forward
});
```

**Why flat:** RESEARCH "Pitfall 1" — workflow_dispatch inputs cap at 1024 chars each; nesting via JSON-encode would add a parse-failure mode on the receive side. 8 flat inputs ≪ 25 cap.

---

### MOD `src/healer/adapter.ts` — `FixProposal.fixClass` widen (UPSTREAM type)

**Analog:** Same file line 17 (`FixProposal` interface)

**Existing interface** (`adapter.ts:15-20`):
```typescript
export interface FixProposal {
  rootCause: string;
  fixClass: 'selectors' | 'waits';
  diff: string;
  rationale: string;
}
```

**Phase 04 widen — single-line change:**
```typescript
fixClass: 'selectors' | 'waits' | 'assertions' | 'slow';
```

**Critical ordering:** `adapter.ts` is the **upstream type definition** consumed by both `gemini.ts` and `github.ts` `parseFinalText()` functions. Widen `adapter.ts` FIRST; the adapter `parseFinalText` widens (next two pattern blocks below) follow mechanically. If the adapters widen first without `adapter.ts`, TypeScript will reject the `as 'selectors' | 'waits' | 'assertions' | 'slow'` cast.

**Also widens** the `pr-writer.ts:23` `fixClass` field on `OpenHealerPrArgs` (it imports the type). Tracked in shared-pattern §"FIX-07 enum widening cascade" below.

---

### MOD `src/healer/prompt-assembler.ts` — widen enum

**Analog:** Same file lines 20-26 (the `AssemblePromptArgs` interface)

**Existing pattern** (`prompt-assembler.ts:20-26`):
```typescript
export interface AssemblePromptArgs {
  fixClassHint: 'selectors' | 'waits';
  traceAttachmentPath: string | null;
  testTitle: string;
  testFile: string;
  baseUrl: string;
}
```

**Phase 04 change — single-line widen:**
```typescript
fixClassHint: 'selectors' | 'waits' | 'assertions' | 'slow';
```

**File-routing pattern is unchanged** (`prompt-assembler.ts:30-31`):
```typescript
const traceTag = args.traceAttachmentPath !== null ? 'with-trace' : 'no-trace';
const fixClassFile = `${args.fixClassHint}-${traceTag}.md`;
```
This already string-interpolates the class name — adding `assertions-no-trace.md` etc. requires zero code change in `prompt-assembler.ts` beyond the type widen. New `.md` files dropped into `prompts/` are picked up automatically.

---

### NEW `src/healer/prompts/assertions-no-trace.md` (prompt template)

**Analog:** `src/healer/prompts/selectors-no-trace.md` lines 1-22

**Template skeleton** (`selectors-no-trace.md:1-22`):
```markdown
# Fix class: selectors (no trace available — reproduce live via Playwright MCP)

The Playwright trace.zip is missing or expired. Before proposing a fix, you MUST:

1. Use the Playwright MCP browser tools to navigate to `{{BASE_URL}}`.
2. Reproduce the failure path described in `{{TEST_FILE}}` (test title: `{{TEST_TITLE}}`).
3. Inspect the DOM at the failing step to identify the correct locator.

Use no more than 10 browser tool calls before proposing a fix. If you cannot reproduce the failure, emit `no-fix-proposable` with the tool-call log as evidence.

[class-specific guidance: hierarchy, examples]

Forbidden ({{FORBIDDEN_PATTERNS}}):
- [class-specific anti-patterns]

Constraint: do NOT relax existing assertions while fixing the [class-name]. The diff-lint pass detects assertion weakening.
```

**Placeholders to use** (verified from `prompt-assembler.ts:48-53`):
- `{{BASE_URL}}`, `{{TEST_FILE}}`, `{{TEST_TITLE}}`, `{{FORBIDDEN_PATTERNS}}`

**For `assertions-no-trace.md`** — copy the skeleton, replace the class-specific block with assertion strengthening guidance (e.g., `.toBe(value)` over `.toBeTruthy()`, `await expect(locator).toHaveText(...)` over checking `textContent`); copy the "Forbidden" stanza unchanged (the `{{FORBIDDEN_PATTERNS}}` interpolation surfaces the diff-lint list automatically).

**For `slow-no-trace.md`** — same skeleton; class-specific guidance addresses test parallelism, expect-timeout extension, removing redundant `await page.goto()` calls. Mirror the `waits-no-trace.md` "replace sleep-based waits" structure (`waits-no-trace.md:11-15`).

**For the `-with-trace` mirrors** — analogs are `selectors-with-trace.md` / `waits-with-trace.md` (same `prompts/` dir). The trace-having variant typically points the agent at the trace as the primary evidence source instead of "reproduce live."

---

### MOD `src/healer/prompts/output-format.md` — widen `fixClass` enum

**Analog:** Same file line 8

**Existing line:**
```
"fixClass": "selectors" | "waits",
```

**Phase 04 widen:**
```
"fixClass": "selectors" | "waits" | "assertions" | "slow",
```

The remainder of the file (hunk-header rules, no-fix-proposable shape, diff structure) is unchanged.

---

### MOD `src/healer/pr-writer.ts` — `findExistingOpenPr()` + `commentOnPr()`

**Analog:** Same file — existing `openHealerPr()` lines 66-87

**Existing create-call pattern** (`pr-writer.ts:66-79`):
```typescript
export async function openHealerPr(args: OpenHealerPrArgs): Promise<string> {
  const octokit = new Octokit({ auth: args.patToken });

  const title = `[playwright-healer] Fix flaky ${args.testTitle}`;
  const body = renderPrBody(args);

  const { data: pr } = await octokit.pulls.create({
    owner: args.owner,
    repo: args.repo,
    title,
    head: args.branch,
    base: args.defaultBranch,
    body,
  });
```

**Phase 04 wrap pattern** (RESEARCH §"Code Examples §2"):
```typescript
export async function openHealerPr(args: OpenHealerPrArgs): Promise<string> {
  const octokit = new Octokit({ auth: args.patToken });
  const title = `[playwright-healer] Fix flaky ${args.testTitle}`;
  const body  = renderPrBody(args);

  // PRI-04 dedup — query BEFORE create
  const existing = await findExistingOpenPr(octokit, args.owner, args.repo, args.branch);
  if (existing) {
    await commentOnPr(octokit, args.owner, args.repo, existing.number,
      `## Re-trigger evidence\n\n${body}\n\n_Comment added by Phase 04 PRI-04 dedup; original PR remains open for review._`,
    );
    await core.summary
      .addRaw(`## Healer PR updated (dedup)\n\n[${title}](${existing.html_url})\n\nNew evidence appended as comment.`)
      .write();
    return existing.html_url;
  }

  // Original create path unchanged
  const { data: pr } = await octokit.pulls.create({ ... });
  ...
}
```

**Helper function pattern** — sibling to `renderPrBody()` (private, file-scope):
```typescript
async function findExistingOpenPr(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ number: number; html_url: string } | null> {
  const { data: prs } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${branch}`,   // CRITICAL: 'owner:ref-name' format — Pitfall 3
    per_page: 1,
  });
  return prs.length > 0 ? { number: prs[0].number, html_url: prs[0].html_url } : null;
}

async function commentOnPr(octokit: Octokit, owner: string, repo: string, prNumber: number, body: string): Promise<void> {
  await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
}
```

**Why `pulls.list({ head })` not Search API:** RESEARCH §Pattern 3 — branch name `playwright-healer/<slug>-<sha>` is deterministic per `(test, sha)`. Search has 30 req/min cap; `pulls.list` uses the 5000 req/hr core cap. Pitfall 3 documents the `owner:ref` format requirement explicitly.

**Type-cascade note:** `OpenHealerPrArgs.fixClass` (`pr-writer.ts:23`) widens transitively from `adapter.ts` — see "FIX-07 enum widening cascade" in Shared Patterns.

---

### MOD `src/healer/issue-writer.ts` — `findExistingOpenIssue()` + `commentOnIssue()`

**Analog:** Same file — existing `openIssue()` lines 43-60

**Existing create-call pattern** (`issue-writer.ts:43-53`):
```typescript
export async function openIssue(args: OpenIssueArgs): Promise<string> {
  const octokit = new Octokit({ auth: args.patToken });
  const title = `[playwright-healer] ${args.testTitle} is unhealable`;
  const body = renderIssueBody(args);

  const { data: issue } = await octokit.issues.create({
    owner: args.owner,
    repo: args.repo,
    title,
    body,
  });
```

**Phase 04 wrap** (RESEARCH §Pattern 4):
```typescript
async function findExistingOpenIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  testTitle: string,
): Promise<{ number: number; html_url: string } | null> {
  // Title format LOCKED per D-09: `[playwright-healer] <test title> is unhealable`
  // Search API requires `is:issue` qualifier — Pitfall 4 (HTTP 422 without it)
  const q = `repo:${owner}/${repo} is:issue is:open in:title "[playwright-healer]" "${testTitle}" "is unhealable"`;
  const { data } = await octokit.rest.search.issuesAndPullRequests({ q, per_page: 1 });
  return data.items.length > 0
    ? { number: data.items[0].number, html_url: data.items[0].html_url }
    : null;
}
```

**Comment helper** — same `octokit.rest.issues.createComment` call as `commentOnPr` (PRs are issues at the API level).

**Why Search API not `pulls.list`:** Issues are not branch-tied. The locked title pattern (`issue-writer.ts:45`) is the only deterministic key. Pitfall 4 documents the `is:issue` qualifier requirement.

---

### MOD `src/healer/index.ts` — Step 1.5 (Guard 3 backstop) + heal-event writes

**Analog:** Same file — Step 1 payload validation lines 106-114, plus Step 4 sanity-rerun lines 138-150

**Step 1 pattern (parse + setFailed-and-return on invalid):**
```typescript
const inputs = (github.context.payload as { inputs?: unknown }).inputs ?? {};
const parsed = DispatchPayload.safeParse(inputs);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  core.setFailed(`Invalid dispatch payload: ${msg}`);
  return;
}
const payload = parsed.data;
```

**Step 4 pattern (decision → fileIssue + return):**
```typescript
const sanity = await validate(...);
if (!config.skipDeterministicCheck && sanity.passRate === 0) {
  await fileIssue({
    config, owner, repo,
    testTitle: payload.testTitle,
    triggeringRunUrl,
    failureMode: 'deterministic-failure',
    rootCause: '...',
    reproSteps: '...',
    suggestedManualFix: '...',
  });
  return;
}
```

**Phase 04 — insert NEW Step 1.5 between Step 1 and Step 2** (RESEARCH §"Code Examples §3" + Pitfall 6):
```typescript
// ── Step 1.5: SEC-05 Guard 3 — per-test heal cap (Phase 04, NEW) ─────
// Bootstraps the state branch worktree to read runs/.../DD-heals.ndjson.
// On cap-hit: file `cap-exceeded` issue (a NEW FailureMode token — see types.ts mod)
// AND write a heal event with outcome='cap-reached' so the cap stays sticky.
const remoteUrl = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY ?? ''}.git`;
let worktreePath: string | null = null;
try {
  worktreePath = await bootstrapOrGetWorktree(remoteUrl, cwd);
  const testId = `${payload.testFile}::${payload.testTitle}`;
  const guard3 = await shouldSkipHeal(testId, config, worktreePath);
  if (guard3.skip) {
    await fileIssue({
      config, owner, repo,
      testTitle: payload.testTitle,
      triggeringRunUrl,
      failureMode: 'cap-exceeded',
      rootCause: `SEC-05 Guard 3: per-test heal cap reached (${guard3.count} >= ${config.maxHealsPerTestPerWeek}). Manual review required.`,
      reproSteps: 'Inspect prior heal artifacts for this test in the state branch heal log.',
      suggestedManualFix: 'A human must approve the next heal attempt by clearing the prior heal events or bumping max_heals_per_test_per_week.',
    });
    await appendHealEvent({
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      testId,
      outcome: 'cap-reached',
      dispatchRunId: process.env.GITHUB_RUN_ID ?? 'local',
    }, worktreePath);
    return;
  }
} finally {
  // worktree carries through to PR/issue write sites — keep alive until end of run()
  // OR remove here and re-bootstrap at write sites (cheaper to keep).
}
```

**Heal-event write at PR/issue success paths** — three sites per RESEARCH §"Heal-Event Write Sites":
1. After successful `octokit.pulls.create` (Step 11 of `index.ts`)
2. After successful `octokit.issues.create` inside `fileIssue()`
3. The cap-hit branch above

All three call the same `appendHealEvent()` helper from `state-branch.ts` to prevent drift.

**Critical:** the `[skip-healer]` sentinel in heal-event commit messages (see state-branch pattern above) is what makes Guard 2 skip these commits. If the sentinel is dropped, every heal will trigger re-ingest → SEC-05 loop.

---

### MOD `src/healer/types.ts` — `FailureMode` widen

**Analog:** Same file lines 16-22

**Existing union:**
```typescript
export type FailureMode =
  | 'app-startup-timeout'
  | 'agent-budget-exhausted'
  | 'no-fix-proposable'
  | 'diff-lint-blocked'
  | 'validation-failed'
  | 'deterministic-failure';
```

**Phase 04 — add 7th token (RESEARCH §"Code Examples §3" footnote):**
```typescript
| 'cap-exceeded';
```

This widens D-09's locked 6-token list to 7. RESEARCH explicitly notes this is consistent with the D-09 spirit (each token maps to a maintainer-actionable diagnostic).

---

### MOD `src/healer/adapters/github.ts` and `src/healer/adapters/gemini.ts` — `parseFinalText` widen

**Analog:** `src/healer/adapters/github.ts:312-351` (and identical pattern in `gemini.ts:235-241`)

**Existing pattern** (`github.ts:336-347`):
```typescript
if (
  typeof p.rootCause === 'string' &&
  (p.fixClass === 'selectors' || p.fixClass === 'waits') &&
  typeof p.diff === 'string' &&
  typeof p.rationale === 'string'
) {
  return {
    rootCause: p.rootCause,
    fixClass: p.fixClass as 'selectors' | 'waits',
    diff: p.diff,
    rationale: p.rationale,
  };
}
```

**Phase 04 widen — three-line change in BOTH files:**
```typescript
const VALID_CLASSES = ['selectors', 'waits', 'assertions', 'slow'] as const;
type FixClass = typeof VALID_CLASSES[number];

if (
  typeof p.rootCause === 'string' &&
  VALID_CLASSES.includes(p.fixClass as FixClass) &&
  typeof p.diff === 'string' &&
  typeof p.rationale === 'string'
) {
  return {
    rootCause: p.rootCause,
    fixClass: p.fixClass as FixClass,
    diff: p.diff,
    rationale: p.rationale,
  };
}
```

**Critical:** `adapter.ts` (the `FixProposal` interface) MUST widen first — see Shared Patterns §"FIX-07 enum widening cascade". TypeScript will reject the `as FixClass` cast otherwise.

**Critical:** keep both adapters in sync. RESEARCH §"FIX-07 Architecture" notes the Gemini adapter's parser is a near-clone of github.ts's; widen identically.

---

### MOD `src/ingest/index.ts` — Step 9 (auto-dispatch loop)

**Analog:** Same file — the existing pipeline structure lines 44-147

**Insertion point** (`index.ts:138-139`):
```typescript
// ── Step 8: STEP SUMMARY (DET-04 log-only) ───────────────────────────
await writeDetectionSummary(detections);
```

**Phase 04 — NEW Step 9 inserted AFTER Step 8** (RESEARCH §"Code Examples §1"):
```typescript
// ── Step 9: AUTO-DISPATCH (DET-05/06/07, Phase 04 NEW) ──────────────
if (config.enableAutoDispatch && detections.length > 0) {
  for (const detection of detections) {
    // D-04 ingest-side cap query (state branch read; cheap)
    const healCount = await countHealsForTest(detection.testId, config.flakeWindowDays, worktreePath);
    if (healCount >= config.maxHealsPerTestPerWeek) {
      core.warning(
        `playwright-healer: heal cap reached for "${detection.testId}" ` +
        `(${healCount} >= ${config.maxHealsPerTestPerWeek}) — manual review required`,
      );
      await appendHealEvent({ /* outcome: 'cap-reached' */ }, worktreePath);
      continue;
    }

    // FIX-07 hybrid classifier
    const sampleEntry = /* lookup latest entry for testId in windowRecords */;
    const fixClassHint = classifyFixClass(sampleEntry?.errorSignature ?? '');

    // CFG-04 per-class enable check
    const enabledFor = {
      selectors: config.enableSelectorFixes,
      waits:     config.enableWaitFixes,
      assertions: config.enableAssertionFixes,
      slow:      config.enableSlowFixes,
    } as const;
    if (!enabledFor[fixClassHint]) {
      core.warning(`playwright-healer: ${fixClassHint} fix class disabled — skipping dispatch for ${detection.testId}`);
      continue;
    }

    await fireDispatch({
      patToken: config.healerToken,
      owner: github.context.repo.owner,
      repo:  github.context.repo.repo,
      workflowFile: 'playwright-healer.yml',
      ref: github.context.payload.repository?.default_branch ?? 'main',
      detection,
      commitSha: github.context.sha,
      fixClassHint,
      flakeRate:  detection.reason === 'flake-rate' ? detection.value : 0,
      windowDays: detection.windowDays,
      runCount:   detection.runCount,
      concurrencyKey: buildConcurrencyKey(sampleEntry.filePath, sampleEntry.title),
    });
  }
}
```

**Critical placement:** the new step lives INSIDE the existing `try { ... } finally { removeWorktree() }` block (`index.ts:127-146`). The worktree must stay alive during the dispatch loop because `countHealsForTest()` reads from it.

**`ref` value choice** — `github.context.payload.repository?.default_branch` (NOT `GITHUB_REF_NAME`). RESEARCH §"Code Examples §1" comment lines 647-648 explain: feature branches as `ref` would dispatch a workflow that doesn't exist on that branch.

---

### MOD `action.yml` — `enable_auto_dispatch` input + env bridge

**Analog:** Same file — existing `enable_*_fixes` inputs (lines 107-122) AND `INPUT_*` env block (lines 220-249)

**Input declaration pattern** (`action.yml:107-110`):
```yaml
enable_selector_fixes:
  description: 'Enable selector-class fixes (Phase 3+). Default: true'
  required: false
  default: 'true'
```

**Mirror with default OFF (CONTEXT D-01):**
```yaml
enable_auto_dispatch:
  description: 'Enable live workflow_dispatch on threshold breach (Phase 4+). Opt-in safe-default. Default: false'
  required: false
  default: 'false'
```

**Env bridge pattern** (`action.yml:242-245`):
```yaml
INPUT_ENABLE_SELECTOR_FIXES: ${{ inputs.enable_selector_fixes }}
INPUT_ENABLE_WAIT_FIXES: ${{ inputs.enable_wait_fixes }}
INPUT_ENABLE_ASSERTION_FIXES: ${{ inputs.enable_assertion_fixes }}
INPUT_ENABLE_SLOW_FIXES: ${{ inputs.enable_slow_fixes }}
```

**Append:**
```yaml
INPUT_ENABLE_AUTO_DISPATCH: ${{ inputs.enable_auto_dispatch }}
```

**Snake_case naming is load-bearing** (RESEARCH §Pitfall 8 — CONTEXT.md `<code_context>` is stale on this point). Every existing `INPUT_*` key uses underscores; the new key follows. NEVER use `INPUT_ENABLE-AUTO-DISPATCH` (kebab-case is wrong; `core.getInput()` would silently default to `'false'`).

---

### MOD `.github/workflows/e2e-heal-self.yml` — `concurrency:` block

**Analog:** No in-repo workflow declares `concurrency`. Use the recipe from RESEARCH §"Pattern 2: Concurrency Group Slug+Hash (DET-07)".

**Recommended block** (RESEARCH lines 311-329):
```yaml
on:
  workflow_dispatch:
    inputs:
      commitSha:      { required: true }
      testFile:       { required: true }
      testTitle:      { required: true }
      fixClassHint:   { required: true }
      flakeRate:      { required: false }
      windowDays:     { required: false }
      runCount:       { required: false }
      concurrencyKey: { required: true }   # NEW Phase 04

concurrency:
  group: playwright-healer-${{ github.repository }}-${{ inputs.concurrencyKey }}
  cancel-in-progress: false
```

**Critical:**
- `cancel-in-progress: false` — queue, don't cancel (CONTEXT D-03: "we want both runs' detection evidence preserved if they raced")
- The group key reads `inputs.concurrencyKey` — pre-computed by `buildConcurrencyKey()` in ingest before dispatch (see RESEARCH lines 290-307: SHA-1 hash component prevents truncation collisions; `slug()` lowercases + replaces non-alphanumerics)
- `concurrency:` lives in the WORKFLOW file, not `action.yml` — GitHub evaluates concurrency at workflow scheduling time, not action-runtime (RESEARCH §"Anti-Patterns to Avoid", "Don't put concurrency in action.yml")

**Existing dispatch inputs in `e2e-heal-self.yml:20-36`** already declare `testFile`, `testTitle`, `fixClassHint`, `commitSha`. Phase 04 adds `concurrencyKey` (required), `flakeRate`, `windowDays`, `runCount` (optional) — see RESEARCH "Wave 0 Gaps" item.

---

### NEW `fixture/tests/broken-assertion.spec.ts`

**Analog:** `fixture/tests/broken-selector.spec.ts` (referenced in `e2e-heal-self.yml:24` — same shape, swap the bug class)

The 03.1 broken-selector fixture uses `#wrong-id` as the locator. The Phase 04 broken-assertion fixture uses an over-tight or wrong-text assertion (e.g., `.toHaveText('Submitted!')` against actual rendered text `'Submitted'` — a `'!'` punctuation mismatch the agent should fix by relaxing to `.toContainText('Submitted')` or by correcting the literal).

---

## Shared Patterns

### Authentication — PAT via `args.patToken`
**Source:** `src/healer/pr-writer.ts:67`
**Apply to:** `src/ingest/dispatch.ts`, plus dedup queries inside `pr-writer.ts` / `issue-writer.ts`
```typescript
const octokit = new Octokit({ auth: args.patToken });
```
**Rationale block** (`pr-writer.ts:3-7`): `@actions/github`'s built-in client is `GITHUB_TOKEN`-only; bot-authored artifacts via `GITHUB_TOKEN` do NOT trigger downstream CI (Pitfall 1, SC-1). Always pass the PAT explicitly.

---

### Step summary write
**Source:** `src/healer/pr-writer.ts:81-84`
**Apply to:** `src/ingest/dispatch.ts` (after each dispatch fire/skip/cap-hit) and `src/healer/pr-writer.ts` dedup-comment branch
```typescript
await core.summary.addRaw(`## Heading\n\n[link](${url})\n\n${body}`).write();
```
Surface dispatched/skipped/cap-hit/log-only outcomes in the SAME summary table the consumer already sees from DET-04 (CONTEXT `<code_context>` line 106).

---

### Zod string→boolean transform
**Source:** `src/shared/config.ts:108-110`
**Apply to:** `src/shared/config.ts` `enableAutoDispatch` field
```typescript
flagName: z.string().default('false').transform(v => v === 'true'),  // opt-in, default OFF
flagName: z.string().default('true').transform(v => v !== 'false'),  // default ON
```
Pick polarity per CONTEXT decision. CFG-04 toggles default ON; `enable_auto_dispatch` (D-01) defaults OFF.

---

### Append-to-state-branch with retry loop
**Source:** `src/shared/state-branch.ts:167-249` (`appendRecord`)
**Apply to:** `src/shared/state-branch.ts` new `appendHealEvent()` export
- 5 retries with exponential backoff + jitter
- `--force-with-lease=playwright-healer-state` (ref-qualified — Pitfall C)
- Atomic write via `.tmp` rename (Pitfall B)
- Every commit message MUST contain `[skip-healer]` sentinel (Guard 2 prerequisite)
- Exhausted retries → `core.warning()`, no throw

---

### SEC-05 / Guard naming convention
**Source:** `src/shared/loop-guard.ts:28, 35, 42`
**Apply to:** New `shouldSkipHeal()` and any new log statements
```typescript
core.info(`SEC-05 Guard ${N}: ...`);
```
Phase 04 uses Guard 3.

---

### Octokit dedup query before create
**Source:** RESEARCH §Pattern 3 + Pattern 4
**Apply to:** `src/healer/pr-writer.ts` and `src/healer/issue-writer.ts`
```typescript
const existing = await findExistingOpen<X>(...);
if (existing) {
  await commentOnX(...);
  await core.summary.addRaw(`## Healer X updated (dedup) ...`).write();
  return existing.html_url;
}
// fall through to existing create path
```

For PRs: `octokit.rest.pulls.list({ head: 'owner:branch' })` — exact, single-result. For issues: `octokit.rest.search.issuesAndPullRequests` with `is:issue is:open in:title` — title pattern is the dedup key.

---

### `[skip-healer]` sentinel discipline
**Source:** `src/shared/loop-guard.ts:13` + every commit message in `state-branch.ts`
**Apply to:** EVERY commit message generated by Phase 04 code paths (heal-event writes, ingest-dispatched workflow_dispatch event, fix-applier — already in place there)
```typescript
'commit', '-m', `<verb>: <subject> [skip-healer]`
```
Without this sentinel, the SEC-05 loop guard fails to skip the bot's own commits → re-ingest loop.

---

### Defense-in-depth dual-gate (D-04)
**Source:** Existing pattern — SEC-05 Guards 0/1/2 are checked in `shouldSkipIngest()` (ingest-side) AND would be checked again in `shouldSkipHeal()` (healer-side). Same evidence, two checkpoints.
**Apply to:** Heal-cap (Guard 3): ingest-side `countHealsForTest()` gates dispatch (cheap pre-check); healer-side `shouldSkipHeal()` is the backstop (defense-in-depth — RESEARCH §"Established Patterns" + Pitfall 6).
**Critical:** Phase 04 must NOT remove the healer-side check thinking the ingest-side is sufficient. The CONTEXT D-04 phrasing implies "healer-side already exists" — RESEARCH Pitfall 6 corrects this: it doesn't, Phase 04 implements both sides.

---

### FIX-07 enum widening cascade
**Apply to:** A single coordinated change across 6 type sites — all four classes (`'selectors' | 'waits' | 'assertions' | 'slow'`) must appear in lockstep, or TypeScript / parser checks reject mixed values.

**Cascade order** (top-down — earlier sites are upstream types; later sites are runtime parsers/templates):
1. `src/healer/adapter.ts:17` — `FixProposal.fixClass` (UPSTREAM TYPE — must widen FIRST)
2. `src/healer/dispatch-payload.ts:16` — `fixClassHint: z.enum([...])`
3. `src/healer/prompt-assembler.ts:21` — `AssemblePromptArgs.fixClassHint`
4. `src/healer/pr-writer.ts:23` — `OpenHealerPrArgs.fixClass` (transitively — depends on `adapter.ts`)
5. `src/healer/adapters/github.ts:338, 344` — `parseFinalText` runtime check + cast
6. `src/healer/adapters/gemini.ts:235, 241` — same as github.ts
7. `src/healer/prompts/output-format.md:8` — the JSON schema the agent emits

**Why "cascade":** The TypeScript compiler enforces (1) before any of (3)-(6) compile. Widening `parseFinalText` first will fail compilation because the cast target is the unwidened `adapter.ts` type. Always widen `adapter.ts` first; the rest follow.

**Out-of-band sites** (no enum change but coordinate semantics):
- `src/ingest/dispatch.ts` `FireDispatchArgs.fixClassHint` — receives the union from `classifier.ts`
- `src/ingest/classifier.ts` return type — defines the canonical `FixClassHint` for ingest

---

## No Analog Found

Files with no close in-repo match (planner uses RESEARCH directly):

| File | Role | Data Flow | Reason | Fallback |
|---|---|---|---|---|
| `.github/workflows/e2e-heal-self.yml` `concurrency:` block | workflow | declarative | No in-repo workflow uses `concurrency:` | Use RESEARCH §Pattern 2 verbatim |

---

## Metadata

**Analog search scope:**
- `src/shared/` (loop-guard, state-branch, config, types)
- `src/ingest/` (index, report-parser, threshold-evaluator, summary-writer)
- `src/healer/` (index, pr-writer, issue-writer, prompt-assembler, dispatch-payload, types, adapter, prompts/, adapters/)
- `action.yml`, `.github/workflows/`

**Files scanned:** 18 source files + 8 prompt templates + 3 workflows + action.yml

**Pattern extraction date:** 2026-05-01

**Confidence:**
- HIGH on 23/24 file analog matches — every Phase 04 file has a 1:1 or near-1:1 in-repo precedent
- The single partial match is `concurrency:` block placement, where RESEARCH §Pattern 2 supplies the recipe with primary-doc citations (concurrency-group case-insensitivity, no documented length cap)

**Stable extension principle:** Phase 04 is **wiring + extension** (RESEARCH summary line 9). The existing patterns are load-bearing — diverge only where RESEARCH explicitly directs (e.g., flat dispatch payload supersedes nested `recentRunStats`, dual heal-count gate adds a sibling to `shouldSkipIngest`).
