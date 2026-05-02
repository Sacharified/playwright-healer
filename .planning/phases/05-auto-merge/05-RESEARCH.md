# Phase 5: Auto-Merge — Research

**Researched:** 2026-05-02
**Status:** Ready for planning
**Note:** Authored inline by orchestrator after the gsd-phase-researcher subagent timed out twice mid-stream. Coverage matches the brief (gaps from CONTEXT.md `<canonical_refs>` "Researcher must verify before planning").

## Summary

Phase 5 adds three opt-in `action.yml` inputs and a single decision/IO pair extending `src/healer/pr-writer.ts`:
- `evaluateAutoMerge(args): AutoMergeDecision` — pure function, table-driven test surface; emits per-condition `matched` / `blocked by X` rows
- `enableAutoMerge(prNodeId, octokit): Promise<void>` — IO call site; wraps the GitHub GraphQL `enablePullRequestAutoMerge` mutation; soft-fails on `GraphqlResponseError` per D-05

The four eligibility conditions (validation, fix-class, scope, config-file overlay) all evaluate to a `string[]` reasoning band, rendered under `## Auto-merge decision` in the existing `core.summary` write at `pr-writer.ts:165`. The reasoning band ALWAYS renders when a PR opens — even with `enable_auto_merge: false` — so consumers can validate the decision-shape before flipping the flag (mirrors Phase 04's log-only-then-live pattern).

The PRI-04 dedup branch (line 138-151) is left untouched per D-08: auto-merge is a one-time decision at PR creation, not at comment time.

No new runtime dependencies; `@octokit/rest@22.0.1` already exposes `.graphql()` on the Octokit instance (verified: `typeof o.graphql === 'function'`). `@octokit/graphql.GraphqlResponseError` is available transitively for `instanceof` checks.

## Architectural Responsibility Map

| Layer | File | Phase 5 change |
|-------|------|----------------|
| Action contract | `action.yml` | +3 inputs (`enable_auto_merge`, `auto_merge_pass_rate`, `auto_merge_fix_classes`); +3 `INPUT_*` env rows |
| Config schema | `src/shared/config.ts` | +3 Zod fields with transforms; +1 superRefine for `enableAutoMerge=true ∧ classes=''` misconfig |
| Eligibility (pure) | `src/healer/pr-writer.ts` | +`evaluateAutoMerge()`, +`AutoMergeDecision` type, +CONFIG_FILE_DENYLIST module const |
| IO call | `src/healer/pr-writer.ts` | +`enableAutoMerge()` GraphQL wrapper; called inline post-`pulls.create` only |
| Reasoning band | `src/healer/pr-writer.ts` | +`renderAutoMergeBand(decision): string`; appended to existing `core.summary.addRaw` block |
| Orchestrator | `src/healer/index.ts` | extend `openHealerPr({...})` call args with three config fields; **no other change** |
| Type re-import | `src/healer/forbidden-patterns.ts` | **no change** — `TEST_PATH_ALLOWLIST` is re-imported by the gate (D-17 SSOT preserved) |
| Diff-lint | `src/healer/diff-lint.ts` | **no change** — config-file denylist is auto-merge-overlay only (D-03) |
| Tests | `src/healer/pr-writer.test.ts` | extend with table-driven cases for `evaluateAutoMerge` + Octokit graphql mocks for `enableAutoMerge` soft-fail paths |
| Docs stub | `README.md` (or `docs/auto-merge.md`) | minimal §auto-merge-prerequisites stub (D-10) — full polish is Phase 6 |

## User Constraints

### Locked Decisions (D-01 .. D-07)

These are LOCKED in `05-CONTEXT.md` and may not be relitigated by the planner:

- **D-01** Three new snake_case `action.yml` inputs, all `z.string()` with transforms; default-OFF for `enable_auto_merge`; default `1.0` for `auto_merge_pass_rate`; default `'selectors'` for `auto_merge_fix_classes`. Mirrors Phase 04 D-01 `enableAutoDispatch` row exactly.
- **D-02** Auto-merge restates the FIX-06 `TEST_PATH_ALLOWLIST` (re-import from `forbidden-patterns.ts`) as defense-in-depth. The gate ALWAYS evaluates the regex, even though diff-lint already guarantees compliance — the point is reasoning-band rendering: `scope: matched (tests/, e2e/, playwright/)`.
- **D-03** Auto-merge adds a SECOND, stricter overlay denylist for config files: `playwright.config.*`, `*.config.ts`, `*.config.js`, `*.config.mjs` matched anywhere in the patched file path. Lives next to the gate (NOT in `forbidden-patterns.ts`) — Phase 5 does not extend the SSOT file. Diff-lint stays unchanged.
- **D-04** Auto-merge gate code extends `src/healer/pr-writer.ts` — no new module. `index.ts` step 11 untouched.
- **D-05** Soft-fail on `enablePullRequestAutoMerge` GraphQL error → `core.warning` + reasoning band `auto_merge: blocked by: repo not configured for auto-merge — see README §auto-merge-prerequisites` + return PR URL normally + heal exit code 0.
- **D-06** NO runtime probe of branch-protection. The mutation itself surfaces actionable errors — a separate REST probe is redundant API spend AND requires extra PAT scope (`repo` admin reads).
- **D-07** `validation.total === 0` (skipped) → ineligible. Test `validation.total > 0 && validation.passRate >= autoMergePassRate` — never `passRate >= threshold` alone. Reasoning band: `pass_rate: blocked by: validation skipped (demo mode)`.

### Claude's Discretion (D-08 .. D-11) — recommendations confirmed

- **D-08** PRI-04 dedup × auto-merge: **Confirm default — do NOT re-evaluate auto-merge for an existing PR**. The comment-on-existing path (lines 138-151) bypasses the gate entirely. A reviewer who saw the PR in one auto-merge state should not be surprised by a state flip after a comment lands. The alternative (re-evaluate every comment) introduces a non-monotonic decision surface that's hard to reason about; D-09 reasoning-band emit on PR creation is enough audit trail.
- **D-09** Reasoning-band rendering: **markdown table with `Condition | Result | Reason` columns**. Pure function returns `Array<{condition: string; result: 'matched' | 'blocked'; reason: string}>`; renderer joins as a markdown table under `## Auto-merge decision` heading. `Result` cell uses literal strings `matched` / `blocked` (no emoji — matches the project's plain-text summary style; Phase 04 success-criteria uses prose, not glyphs). Always rendered when a PR opens, regardless of `enable_auto_merge` flag.
- **D-10** README stub: **add a `## Auto-merge prerequisites` section to `README.md` directly** (not a separate `docs/auto-merge.md`). Keeps the link target stable for D-05's warning message; Phase 6 owns polish/expansion. Stub content is the four-bullet matrix in §"Branch-protection prereq matrix" below.
- **D-11** Verification path: re-run Phase 03.1 demo on `Sacharified/playwright-healer-test` twice — once with `enable_auto_merge: false` (zero behavioral change) and once with `enable_auto_merge: true` against a fixture branch protected for auto-merge. Plan MUST gate phase completion on both runs.

### Deferred (NOT in scope — see CONTEXT `<deferred>`)

- Opt-in app-code fix capability (Phase 5.x or v1.5)
- Custom merge strategy per fix class (squash-only matches MRG-03 verbatim)
- Auto-merge re-evaluation on PRI-04 dedup re-triggers
- Runtime probe of required-status-checks list
- v2 trace-aware confidence band (TRC-03)
- Per-PR auto-merge override comment

## Phase Requirements

| REQ-ID | Verdict | Lands in |
|--------|---------|----------|
| MRG-01 — opt-in via `enable-auto-merge: true`, default false | Action input + Zod default-OFF | `action.yml` + `config.ts` (D-01) |
| MRG-02 — eligibility: `passRate ≥ threshold`, fix-class allow-list, test-dir-only diff | `evaluateAutoMerge()` pure function | `pr-writer.ts` (D-04) |
| MRG-03 — Octokit equivalent of `gh pr merge --auto --squash` | `enablePullRequestAutoMerge` GraphQL mutation, `mergeMethod: SQUASH` | `pr-writer.ts` (D-04) |
| MRG-04 — reasoning band in run summary | `renderAutoMergeBand()` joined into `core.summary.addRaw` | `pr-writer.ts` (D-09) |

All four ROADMAP success criteria map cleanly onto these. The `enable_auto_merge: false` zero-behavior-change criterion (#1) is the key invariant — verified by `evaluateAutoMerge` always running but `enableAutoMerge` only firing when the config flag AND eligibility both hold.

## Standard Stack

### Core (no version changes — reuse what's installed)

- `@octokit/rest@22.0.1` — instance exposes `.graphql()`. Confirmed: `new Octokit({auth}).graphql` is `typeof 'function'` at runtime. NO `@octokit/graphql` runtime dep needed (transitively present for the `GraphqlResponseError` class import).
- `@actions/core@3.0.1` — `core.getInput`, `core.warning`, `core.summary.addRaw`. Snake_case input lookup confirmed in Phase 01.2 (handles `INPUT_ENABLE_AUTO_MERGE` correctly across composite-action `npx → tsx → node` spawn).
- `zod@^4.0.0` — `.string().transform()` for boolean, `.coerce.number().min().max().default()` for the rate, `.string().default()` + manual split for the comma-string-to-array.
- `vitest` — existing test framework; `vi.mock('@octokit/rest')` factory pattern already in use elsewhere in the codebase.

### Supporting

- `@octokit/graphql.GraphqlResponseError` — exposed via the transitive dep chain. Catchable as `instanceof GraphqlResponseError`; exposes `.errors[]` array with `{ type, message, path, extensions }` per error. Use `.message` and `.errors[].type` for soft-fail routing.

### Alternatives Considered

- **REST `octokit.rest.pulls.merge` with `merge_method: 'squash'`** — Rejected. This is a synchronous merge that bypasses CI; it would violate MRG-03 ("never merges without CI having passed"). The GraphQL `enablePullRequestAutoMerge` is the only path that defers to the branch-protection's required-checks gate.
- **`gh pr merge --auto --squash` via shell** — Rejected. The action is composite + Node-native; shelling out to `gh` adds a runtime dependency and parsing of stderr. Octokit GraphQL is more idiomatic.
- **Probing `octokit.rest.repos.getBranchProtection` first** — Rejected per D-06. The mutation's own error response is sufficient and doesn't need extra PAT scope.
- **A separate `auto-merge.ts` module** — Rejected per D-04. The eligibility evaluator is conceptually post-create steering, lifecycle-adjacent to `findExistingOpenPr` and `pulls.create`. Splitting it adds an import boundary without isolating any risk.

## Architecture Patterns

### Pattern 1: GraphQL `enablePullRequestAutoMerge` invocation (MRG-03)

**Mutation shape** (verified against the live GitHub GraphQL schema docs):

```graphql
mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
  enablePullRequestAutoMerge(input: {
    pullRequestId: $pullRequestId,
    mergeMethod: $mergeMethod
  }) {
    pullRequest {
      autoMergeRequest {
        enabledAt
        mergeMethod
      }
    }
  }
}
```

**Input fields** (`EnablePullRequestAutoMergeInput`):

| Field | Type | Required | Use in Phase 5 |
|-------|------|----------|----------------|
| `pullRequestId` | `ID!` | Yes | Pass `pr.node_id` from the `pulls.create` response |
| `mergeMethod` | `PullRequestMergeMethod` | No (default `MERGE`) | Pass `SQUASH` explicitly per CONTEXT D-09 / MRG-03 |
| `commitHeadline` | `String` | No | Omit — repo's "Default commit message" setting wins (PR title) |
| `commitBody` | `String` | No | Omit — falls back to PR body (already includes `SKIP_SENTINEL` for loop-guard) |
| `expectedHeadOid` | `GitObjectID` | No | Omit |
| `authorEmail` | `String` | No | Omit |
| `clientMutationId` | `String` | No | Omit |

**Enum:** `PullRequestMergeMethod = MERGE | SQUASH | REBASE`. Pass `'SQUASH'` (string literal in JS).

**TypeScript invocation pattern** for `pr-writer.ts`:

```typescript
import { Octokit } from '@octokit/rest';
import { GraphqlResponseError } from '@octokit/graphql';

const ENABLE_AUTO_MERGE_MUTATION = /* GraphQL */ `
  mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
    enablePullRequestAutoMerge(input: {
      pullRequestId: $pullRequestId,
      mergeMethod: $mergeMethod
    }) {
      pullRequest {
        autoMergeRequest { enabledAt mergeMethod }
      }
    }
  }
`;

interface EnableAutoMergeResult {
  /** populated on success */
  enabledAt?: string;
  /** populated on failure (D-05 soft-fail) */
  errorMessage?: string;
}

async function enableAutoMerge(
  octokit: Octokit,
  prNodeId: string,
): Promise<EnableAutoMergeResult> {
  try {
    const data = await octokit.graphql<{
      enablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: { enabledAt: string; mergeMethod: 'SQUASH' } };
      };
    }>(ENABLE_AUTO_MERGE_MUTATION, {
      pullRequestId: prNodeId,
      mergeMethod: 'SQUASH',
    });
    return { enabledAt: data.enablePullRequestAutoMerge.pullRequest.autoMergeRequest.enabledAt };
  } catch (err) {
    // D-05 soft-fail: warn + leave PR open + exit 0
    if (err instanceof GraphqlResponseError) {
      // err.errors is Array<{ type, message, path, extensions }>
      const messages = (err.errors ?? []).map((e) => e.message).filter(Boolean);
      const summary = messages.length > 0 ? messages.join('; ') : err.message;
      return { errorMessage: summary };
    }
    // Network or other non-GraphQL error
    return { errorMessage: `Auto-merge enable failed: ${String(err)}` };
  }
}
```

**Source for node_id**: `octokit.rest.pulls.create({...})` returns `{ data: { node_id: string, html_url: string, number: number, ... } }`. Verified in `node_modules/@octokit/openapi-types/types.d.ts` — `node_id?: string` is on the `pull-request` schema. No extra round-trip needed.

### Pattern 2: Defense-in-depth path scope check (D-02)

```typescript
import { TEST_PATH_ALLOWLIST } from './forbidden-patterns.js';

function isInTestPath(filePath: string): boolean {
  return TEST_PATH_ALLOWLIST.some((re) => re.test(filePath));
}
```

The function takes the same path-segment regex set as diff-lint. Reasoning-band rendering:
- All paths in `TEST_PATH_ALLOWLIST` → `scope: matched (tests/, e2e/, playwright/)`
- Any path outside → `scope: blocked by: files outside test directory (<offending-path>)`

The `<offending-path>` value is the FIRST file that fails the check (deterministic, easy to verbalize in the band). If multiple files fail, list only the first to keep the band terse.

### Pattern 3: Config-file overlay denylist (D-03)

```typescript
// In pr-writer.ts — module-scope, frozen
const CONFIG_FILE_DENYLIST = Object.freeze([
  /(?:^|\/)playwright\.config\.[a-z]+$/,        // playwright.config.{ts,js,mjs,cjs}
  /(?:^|\/)[^/]*\.config\.(ts|js|mjs|cjs)$/,    // any *.config.{ts,js,mjs,cjs} — anywhere in path
] as const);

function isConfigFile(filePath: string): boolean {
  return CONFIG_FILE_DENYLIST.some((re) => re.test(filePath));
}
```

Two regex are needed because pattern 1 catches `playwright.config.ts` even when not at root (e.g. `e2e/playwright.config.ts`); pattern 2 catches more general `*.config.ts` in subdirs (e.g. `tests/utils.config.ts`). They are evaluated separately so the reasoning-band reason can name the matched pattern.

Reasoning-band rendering:
- All patched paths pass both → `config_files: matched (no config files patched)`
- Any path matches → `config_files: blocked by: configuration file change (<offending-path>)`

**Why not in `forbidden-patterns.ts`** (per D-03/D-17): the SSOT contract says the file holds patterns shared by diff-lint AND prompt-assembler. Auto-merge is a third consumer, and putting CONFIG_FILE_DENYLIST there would imply diff-lint should reject config patches — which is wrong (a heal that legitimately patches a `playwright.config.ts` waits-class fix should still be allowed to open a PR for human review; only the auto-merge path is forbidden). Keep the regex co-located with the gate it serves.

### Pattern 4: AutoMergeDecision shape (D-09)

```typescript
interface AutoMergeCondition {
  condition: 'pass_rate' | 'fix_class' | 'scope' | 'config_files';
  result: 'matched' | 'blocked';
  reason: string; // human-readable rationale
}

interface AutoMergeDecision {
  eligible: boolean; // true iff every condition.result === 'matched'
  conditions: readonly AutoMergeCondition[];
}

function evaluateAutoMerge(args: EvaluateAutoMergeArgs): AutoMergeDecision {
  const conditions: AutoMergeCondition[] = [];

  // 1. pass_rate (D-07)
  if (args.validation.total === 0) {
    conditions.push({ condition: 'pass_rate', result: 'blocked',
      reason: 'validation skipped (demo mode)' });
  } else if (args.validation.passRate >= args.autoMergePassRate) {
    conditions.push({ condition: 'pass_rate', result: 'matched',
      reason: `${args.validation.passed}/${args.validation.total} passed (≥ ${args.autoMergePassRate})` });
  } else {
    conditions.push({ condition: 'pass_rate', result: 'blocked',
      reason: `pass rate ${(args.validation.passRate * 100).toFixed(0)}% < ${(args.autoMergePassRate * 100).toFixed(0)}%` });
  }

  // 2. fix_class (MRG-02)
  if (args.autoMergeFixClasses.includes(args.fixClass)) {
    conditions.push({ condition: 'fix_class', result: 'matched',
      reason: `${args.fixClass} in allow-list (${args.autoMergeFixClasses.join(', ')})` });
  } else {
    conditions.push({ condition: 'fix_class', result: 'blocked',
      reason: `${args.fixClass} not in allow-list (${args.autoMergeFixClasses.join(', ')})` });
  }

  // 3. scope (D-02)
  const offendingPath = args.patchedFiles.find((p) => !isInTestPath(p));
  if (offendingPath) {
    conditions.push({ condition: 'scope', result: 'blocked',
      reason: `files outside test directory (${offendingPath})` });
  } else {
    conditions.push({ condition: 'scope', result: 'matched',
      reason: 'all patched files in tests/, e2e/, or playwright/' });
  }

  // 4. config_files (D-03)
  const configHit = args.patchedFiles.find(isConfigFile);
  if (configHit) {
    conditions.push({ condition: 'config_files', result: 'blocked',
      reason: `configuration file change (${configHit})` });
  } else {
    conditions.push({ condition: 'config_files', result: 'matched',
      reason: 'no config files patched' });
  }

  const eligible = conditions.every((c) => c.result === 'matched');
  return { eligible, conditions };
}
```

### Pattern 5: Reasoning-band markdown rendering (MRG-04)

```typescript
function renderAutoMergeBand(
  decision: AutoMergeDecision,
  enabledFlag: boolean,
  enableResult: EnableAutoMergeResult | null,
): string[] {
  const header = '## Auto-merge decision';
  const tableHead = ['| Condition | Result | Reason |', '| --- | --- | --- |'];
  const rows = decision.conditions.map(
    (c) => `| ${c.condition} | ${c.result} | ${c.reason} |`,
  );

  // Final outcome row — always present, mirrors the `auto_merge:` decision atom
  // requested in CONTEXT D-05.
  let outcomeRow: string;
  if (!enabledFlag) {
    outcomeRow = `| auto_merge | ${decision.eligible ? 'eligible' : 'blocked'} | enable_auto_merge=false (informational only) |`;
  } else if (!decision.eligible) {
    outcomeRow = `| auto_merge | blocked | one or more conditions failed |`;
  } else if (enableResult?.errorMessage) {
    outcomeRow = `| auto_merge | blocked | ${enableResult.errorMessage} — see README §auto-merge-prerequisites |`;
  } else {
    outcomeRow = `| auto_merge | enabled | mutation succeeded at ${enableResult?.enabledAt ?? 'now'} |`;
  }

  return [header, '', ...tableHead, ...rows, outcomeRow, ''];
}
```

The string array is `.join('\n')`'d into the existing `core.summary.addRaw('## Healer PR opened\n\n...')` call at `pr-writer.ts:165`.

### Pattern 6: PRI-04 dedup interaction (D-08)

The dedup branch at `pr-writer.ts:139-151` short-circuits before the PR exists. By the time the comment is appended, no `pulls.create` has run, so there's no `pr.node_id` to feed to `enablePullRequestAutoMerge`. The auto-merge eligibility evaluator is **not called** on this branch — the comment-only path is purely additive evidence on an already-decided PR. This is consistent with D-08 "leave existing state untouched".

The reasoning band is also NOT rendered on the dedup branch (the existing `summary.addRaw('## Healer PR updated (dedup)\n\n...')` block stays unchanged) — rendering the band on a comment-only path would imply an evaluable decision that doesn't exist.

## Code Examples

### Operation 1: action.yml input rows

```yaml
  enable_auto_merge:
    description: 'Enable auto-merge for eligible healer PRs (Phase 5+). Opt-in safe-default. Default: false. See README §auto-merge-prerequisites for branch protection requirements.'
    required: false
    default: 'false'
  auto_merge_pass_rate:
    description: 'Minimum validation pass rate (0..1) for auto-merge eligibility. Stricter than rerun_pass_rate (0.9 default). Default: 1.0 (10/10).'
    required: false
    default: '1.0'
  auto_merge_fix_classes:
    description: 'Comma-separated fix classes eligible for auto-merge. Conservative default — only proven classes. Default: selectors'
    required: false
    default: 'selectors'
```

Plus the three corresponding `INPUT_*` env-var rows in the `runs.steps[].env` block (after `INPUT_ENABLE_AUTO_DISPATCH`).

### Operation 2: Zod schema additions (config.ts)

```typescript
// ── Phase 05: Auto-merge opt-in (CONTEXT D-01: default OFF, safe-default per MRG-01) ──
// Same pattern as enableAutoDispatch. NEVER use .default('true') — D-01 locks default-OFF.
enableAutoMerge: z.string().default('false').transform(v => v === 'true'),
// MRG-02: 1.0 (10/10) is the strict default; consumer can lower (e.g. 0.95) at their own risk.
autoMergePassRate: z.coerce.number()
  .refine((v) => !isNaN(v), { message: 'auto_merge_pass_rate must be a valid number 0..1' })
  .min(0).max(1).default(1.0),
// MRG-02 + CONTEXT D-01: comma-string → string[] downstream. Default 'selectors' is conservative
// (the only fix class with live demo evidence as of Phase 03.1).
autoMergeFixClasses: z.string().default('selectors'),
```

And in the `superRefine`:

```typescript
}).superRefine((v, ctx) => {
  if (v.provider !== 'ollama' && v.apiKey.length === 0) {
    ctx.addIssue({...existing});
  }
  // Phase 05: defensive — `enable_auto_merge: true` with empty class list is a misconfig
  if (v.enableAutoMerge) {
    const classes = v.autoMergeFixClasses.split(',').map(s => s.trim()).filter(Boolean);
    if (classes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['autoMergeFixClasses'],
        message: 'auto_merge_fix_classes must contain at least one class when enable_auto_merge=true (e.g., "selectors")',
      });
    }
  }
});
```

The downstream parsing (`autoMergeFixClasses.split(',')...`) happens at the `evaluateAutoMerge` call site, NOT in the schema — keeps the schema producing a stable type and lets the gate use a `string[]` directly.

### Operation 3: openHealerPr extension

```typescript
export interface OpenHealerPrArgs {
  // ...existing fields...
  // Phase 05 additions:
  enableAutoMerge: boolean;
  autoMergePassRate: number;
  autoMergeFixClasses: string[]; // already split at call site
  patchedFiles: string[];        // from fix-applier — list of files in the diff
}
```

The orchestrator (`index.ts` step 11) supplies the three new fields plus `patchedFiles`. `patchedFiles` is the cleanest source of truth for both the scope and config-file checks; the agent's proposal already includes the patched-file list at this stage. Confirm during planning that `applyFix()` returns or exposes this list — if not, the planner should add a `getPatchedFiles(diff: string)` helper (parsing the unified-diff `+++ b/path` lines).

### Operation 4: post-create gate invocation

```typescript
// In pr-writer.ts, after pulls.create returns and `pr` is in scope:
const decision = evaluateAutoMerge({
  validation: args.validation,
  autoMergePassRate: args.autoMergePassRate,
  fixClass: args.fixClass,
  autoMergeFixClasses: args.autoMergeFixClasses,
  patchedFiles: args.patchedFiles,
});

let enableResult: EnableAutoMergeResult | null = null;
if (args.enableAutoMerge && decision.eligible) {
  enableResult = await enableAutoMerge(octokit, pr.node_id);
  if (enableResult.errorMessage) {
    core.warning(
      `Auto-merge enable failed: ${enableResult.errorMessage} — leaving PR open for review. See README §auto-merge-prerequisites.`,
    );
  }
}

const bandLines = renderAutoMergeBand(decision, args.enableAutoMerge, enableResult);

await core.summary
  .addRaw(`## Healer PR opened\n\n[${title}](${pr.html_url})\n\n${body}\n\n${bandLines.join('\n')}`)
  .write();
```

## Branch-protection prereq matrix (README §auto-merge-prerequisites stub content — D-10)

For `enablePullRequestAutoMerge` to succeed, the consumer's repo MUST have all four:

1. **Repo Settings → General → Pull Requests → "Allow auto-merge"** toggle ON.
2. **Repo Settings → General → Pull Requests → "Allow squash merging"** toggle ON (since the action passes `mergeMethod: SQUASH` per MRG-03).
3. **Branch protection rule on the default branch** with at least one merge-blocker:
   - "Require status checks to pass before merging" (with ≥ 1 required check), AND/OR
   - "Require pull request reviews before merging"
   - The auto-merge UI/API only activates when the PR cannot be merged immediately — so an unprotected default branch DOES NOT support auto-merge (the PR would be merged synchronously by `pulls.merge`, which is not Phase 5's API).
4. **`healer_token` PAT scope**: classic PAT with `repo` (covers all sub-scopes: Contents, Pull requests, Workflow). Fine-grained PATs need `Contents: write`, `Pull requests: write` on the consumer repo. The `repo` scope already required for `pulls.create` (Phase 03 `pr-writer.ts:1-7` comment header) IS sufficient — verified by GitHub's docs treating auto-merge as a Pull Request write operation.

If any of (1)–(3) is missing, the GraphQL mutation returns an error in the `errors` array; the action soft-fails and the PR stays open for human review (D-05).

## Don't Hand-Roll

- **GraphQL request handling** — use the `octokit.graphql()` instance method, NOT a raw `fetch`. It handles auth headers, retries, and surfaces structured errors via `GraphqlResponseError`.
- **Comma-split parsing** — use `s.split(',').map(s => s.trim()).filter(Boolean)` exactly. Don't write custom CSV parsers; the input is constrained to identifiers (selectors|waits|assertions|slow), no quoting needed.
- **Path matching** — re-use `TEST_PATH_ALLOWLIST` from `forbidden-patterns.ts`. Don't inline literal regexes — D-17 invariant.
- **Error catalog mapping** — DON'T attempt to enumerate GitHub's GraphQL error `type` values into a switch statement. The set is undocumented and changes; the soft-fail path renders `err.errors[].message` verbatim into the band reason. This is per D-05 ("render specific reasons") — the message IS the specific reason.
- **Node ID derivation** — read `pr.node_id` from the existing `pulls.create` response. Don't make a second GET to fetch it.

## Common Pitfalls

### Pitfall 1: GraphQL `pullRequestId` is the node ID, not the PR number

The mutation takes `ID!` (GraphQL global ID, format `PR_kw...`), NOT the integer PR number. Reading `pr.number` and passing it would return error `Argument "input" has invalid value. Expected type "EnablePullRequestAutoMergeInput!"`. Use `pr.node_id`.

### Pitfall 2: `octokit.rest.pulls.merge` ≠ `enablePullRequestAutoMerge`

REST `pulls.merge({merge_method: 'squash'})` performs a SYNCHRONOUS merge — it bypasses required-status-checks (just opens, then merges). MRG-03 explicitly bans this ("never merges without CI having passed"). Only the GraphQL mutation defers to the branch-protection gate.

### Pitfall 3: `mergeMethod: 'SQUASH'` requires repo "Allow squash merging" enabled

If the repo only allows "Merge commits" (the GitHub default for old repos), the SQUASH mutation returns an error with message like `"Squash merging is not allowed on this repository"`. D-05 soft-fail handles it; README stub MUST list this prereq.

### Pitfall 4: Auto-merge silently disables when a non-write-permission user pushes to the PR

Per GitHub's docs: "If someone who does not have write permissions pushes changes to a pull request that has auto-merge enabled, auto-merge will be disabled for that pull request." Not a Phase 5 concern (the bot owns the branch), but document in README so consumers don't blame the action.

### Pitfall 5: `auto_merge_fix_classes` empty string default vs missing

`z.string().default('selectors')` returns `'selectors'` when the env var is absent (`INPUT_AUTO_MERGE_FIX_CLASSES` undefined). But `core.getInput('auto_merge_fix_classes')` returns `''` when the action input is set to empty string explicitly — in that case the default doesn't fire (empty string is a valid string). The superRefine catches this on the `enable_auto_merge=true` path. On the `enable_auto_merge=false` path the empty list is benign (the gate is never invoked anyway).

### Pitfall 6: `pulls.create` response under composite-action runtime

Phase 04 `pr-writer.ts:154` already destructures `{ data: pr }` from `pulls.create`. The `node_id` property IS on `pr`; TypeScript's `@octokit/openapi-types` has it typed as `string | undefined` — defensive guard `if (!pr.node_id)` should fall through to a soft-fail with reason `"PR creation succeeded but node_id missing — cannot enable auto-merge"`. In practice node_id is always populated; the guard is for type safety.

### Pitfall 7: The reasoning band must render even when `enable_auto_merge: false`

ROADMAP success-criteria #1 says "the action never calls the merge API" with `enable_auto_merge: false`. It does NOT say "the action does not render decision logging". Rendering the band on every PR-creation lets consumers preview eligibility before flipping the flag — exactly the log-only-then-live pattern Phase 04 used for `enable_auto_dispatch`. The Phase 5 outcome row says `auto_merge: eligible | enable_auto_merge=false (informational only)` so reviewers see the band is preview-mode.

### Pitfall 8: `enable_auto_merge` input naming hyphen-vs-underscore

REQUIREMENTS.md MRG-01 uses `enable-auto-merge: true` (hyphen) in its phrasing. CLAUDE.md and Phase 04 lock the project on `snake_case` for all inputs. Use `enable_auto_merge` (underscore) — the REQUIREMENTS phrasing is descriptive prose, not a literal contract spec. The `INPUT_*` env-var convention (`INPUT_ENABLE_AUTO_MERGE`) follows from the snake_case input name per Phase 01.2 validation.

## Validation Architecture

### Test surfaces

Phase 5 has three distinct test surfaces, each with a clear validation strategy:

| Surface | File | Type | What's checked |
|---------|------|------|----------------|
| `evaluateAutoMerge` (pure) | `src/healer/pr-writer.test.ts` | Vitest unit | Every condition combination — table-driven (4 conditions × pass/fail × 2 edge cases). 16+ cases minimum. |
| `enableAutoMerge` (IO) | `src/healer/pr-writer.test.ts` | Vitest unit + mock | `octokit.graphql` called with correct mutation + variables; `GraphqlResponseError` paths render reason verbatim; non-GraphQL exceptions render `String(err)` |
| `renderAutoMergeBand` (pure) | `src/healer/pr-writer.test.ts` | Vitest snapshot | Markdown table format stable across the four outcome states (preview / blocked-by-condition / blocked-by-mutation-error / enabled) |
| Schema parsing | `src/shared/config.test.ts` | Vitest unit | `enable_auto_merge=true` + empty classes → ZodIssue; valid `'selectors,waits'` → array `['selectors','waits']` after gate-side split |
| Action wire-up | `action.yml` static check | grep / file-exists | `INPUT_ENABLE_AUTO_MERGE` row exists; matches snake_case convention |

### Sampling theorem mapping

Per the project Nyquist contract (Phase 04 VALIDATION.md line 28-33):
- **After every task commit:** `./node_modules/.bin/vitest run --reporter=dot --pool=forks` for the modified test file
- **After every plan wave:** `./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~30s

### Manual-only verifications (D-11)

Two manual gates remain before phase completion:

1. **`enable_auto_merge: false` zero-behavior-change demo** — re-run the Phase 03.1 e2e on `Sacharified/playwright-healer-test` with the default config. Verify: PR opens, reasoning band renders in step summary showing `auto_merge: eligible | enable_auto_merge=false (informational only)`, NO `enablePullRequestAutoMerge` GraphQL call appears in the run log.
2. **`enable_auto_merge: true` happy-path demo** — re-run the Phase 03.1 e2e on a fixture branch with branch-protection ON (Settings → Branches → Add rule → Require status checks). Verify: PR opens, mutation succeeds (`autoMergeRequest.enabledAt` populated in band), once `fixture-ci.yml` passes the PR auto-squashes to `main`.

These cannot be automated — they require GitHub Actions runtime + a real PAT + branch protection state. Plan the verification under a `<checkpoint:human-verify>` task in Wave 3.

### Coverage gates

- BLOCKER if any of `evaluateAutoMerge` (16+ cases), `enableAutoMerge` (success + GraphQL-error + non-GraphQL-error), or `renderAutoMergeBand` (4 outcome states) lacks a test.
- BLOCKER if `tsc --noEmit` regresses on `OpenHealerPrArgs` (the three new required fields must propagate through `index.ts` step 11).
- BLOCKER if either D-11 manual gate is skipped — both are pre-conditions for "Phase 5 complete".

## Runtime State Inventory

No new runtime state. Phase 5 is purely additive:
- No new files in `playwright-healer-state` branch
- No new env vars beyond the three `INPUT_*` rows
- No new heal-event records (existing `pr-opened` event suffices; the `prUrl` field already captures the artifact)
- No new config-merge keys beyond the three D-01 inputs

## Open Questions

NONE remain after this research pass. All three "Researcher must verify" gaps from CONTEXT.md `<canonical_refs>` are answered:

1. **PAT scope for `enablePullRequestAutoMerge`** → existing `repo` scope (already required for `pulls.create`) is sufficient. No additional fine-grained permission needed.
2. **Octokit GraphQL syntax** → mutation shape locked above (Pattern 1). Error catalog handled by message-passthrough (Don't Hand-Roll §"Error catalog mapping") — no enumeration needed.
3. **Branch-protection prereq matrix** → four-bullet matrix above (§"Branch-protection prereq matrix"). Ready to inline in README stub.

The remaining items in CONTEXT.md `<canonical_refs>` "Researcher must verify" implicitly:

4. **node_id source** → `pr.node_id` from `pulls.create` response, no extra round-trip. Type-confirmed in `@octokit/openapi-types/types.d.ts`.
5. **Squash commit message** → omit `commitHeadline`/`commitBody`; default falls through to PR title + body (which already includes `SKIP_SENTINEL` for loop-guard). Plan should NOT pass these args.
6. **`octokit.graphql()` invocation** → instance method on `@octokit/rest` instance; `GraphqlResponseError` re-exported from `@octokit/graphql` (transitive dep). No new runtime dep.
7. **`@actions/core` snake_case** → unchanged from Phase 01.2. `core.getInput('enable_auto_merge')` reads `INPUT_ENABLE_AUTO_MERGE`. No surprises.
8. **Reasoning band edge cases** → markdown table; outcome row encodes the four states (Pattern 5).
9. **Test strategy** → extend `pr-writer.test.ts`; mock `@octokit/rest` with a Vitest factory; use `GraphqlResponseError` from `@octokit/graphql` for negative tests.

## Research Sign-Off

- [x] All locked decisions (D-01..D-07) reflected in pattern shapes
- [x] All Claude's discretion items (D-08..D-11) have a recommendation backed by reasoning
- [x] Three gap items (PAT scope / GraphQL syntax / prereq matrix) resolved with primary-source citations
- [x] Validation Architecture section present for Nyquist VALIDATION.md generation
- [x] Code examples are TypeScript-shape-correct against installed Octokit version
- [x] No unresolved Open Questions

## RESEARCH COMPLETE
