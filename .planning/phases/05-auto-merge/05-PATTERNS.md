# Phase 5: Auto-Merge — Pattern Map

**Created:** 2026-05-02
**Note:** Authored inline by orchestrator after subagent spawning experienced timeouts. Coverage is concrete and grep-verifiable.

This document maps each new piece of code to its closest analog in the existing codebase. Planner should read the analog file before writing the corresponding plan task.

---

## File-by-File Mapping

### `src/healer/pr-writer.ts` — extension only (D-04)

| New element | Closest analog | Why this analog |
|-------------|----------------|-----------------|
| `evaluateAutoMerge(args): AutoMergeDecision` (pure) | `src/ingest/threshold-evaluator.ts:17` `evaluateThresholds(records, config): Detection[]` | Same shape: pure function takes data + config subset → decision array. No I/O. Returns a structured decision rather than a boolean — matches D-09 "string[] of band-line summaries". |
| `enableAutoMerge(octokit, prNodeId): EnableAutoMergeResult` (IO + soft-fail) | `src/healer/pr-writer.ts:88` `findExistingOpenPr(octokit, owner, repo, branch)` | Same try/catch shape with `core.warning` + return null/result on failure. Same Octokit-via-instance access pattern. Same place in the file. |
| `renderAutoMergeBand(decision, enabledFlag, enableResult): string[]` (pure markdown) | `src/healer/pr-writer.ts:31` `renderPrBody(args): string` | Both build a `string[]` of lines and `.join('\n')`. Same project conventions for markdown table rows (`\| col \| col \|` with header separator). |
| `CONFIG_FILE_DENYLIST` module-scope frozen array | `src/healer/forbidden-patterns.ts:39` `TEST_PATH_ALLOWLIST` | `Object.freeze([... ] as const)` shape — immutable RegExp tuple at module scope. NOT in forbidden-patterns.ts itself (D-03 / D-17 — the SSOT file is for diff-lint+prompt-assembler shared patterns; the auto-merge config-file overlay is a third consumer with different semantics). |
| `AutoMergeDecision` / `AutoMergeCondition` interfaces | `src/healer/validator.ts:24` `ValidationResult` interface | Stable, exported, structured-data shape. Frozen field set. Used in tests via type-import. |
| `OpenHealerPrArgs` extension (3 new fields + `patchedFiles`) | `src/healer/pr-writer.ts:13` existing `OpenHealerPrArgs` | Add the four fields; type stays exported. Phase 04 widened this interface (`fixClass` enum to all four classes) — same convention. |
| `extractPatchedFiles(diff: string): string[]` helper (parse `+++ b/path` lines) | `src/healer/diff-normalizer.ts` (parses unified diff structurally) | Diff parsing convention already exists. New helper is small (~10 lines, regex against `^\+\+\+ b/(.+)$` per `\n`-delimited lines). Lives in `pr-writer.ts` as a private helper since the gate is its only consumer. |

---

### `src/shared/config.ts` — extension only

| New element | Closest analog | Why this analog |
|-------------|----------------|-----------------|
| `enableAutoMerge: z.string().default('false').transform(v => v === 'true')` | `src/shared/config.ts:116` `enableAutoDispatch: z.string().default('false').transform(v => v === 'true')` | Phase 04 D-01 default-OFF boolean pattern. Phase 5 D-01 explicitly mirrors this. **Do not** use `z.coerce.boolean()` (Pitfall: `Boolean('false') === true`). |
| `autoMergePassRate: z.coerce.number().min(0).max(1).default(1.0)` | `src/shared/config.ts:69` `rerunPassRate: z.coerce.number()...min(0).max(1).default(0.9)` | Pass-rate field convention. Different default (1.0 vs 0.9 — see CONTEXT D-01 for why). |
| `autoMergeFixClasses: z.string().default('selectors')` | `src/shared/config.ts:90-93` per-class toggle group `enableSelectorFixes`, etc. | Comma-string-with-default convention. The split-to-array happens at the gate call site (NOT in the schema) — keeps the schema producing a stable type. Researcher reasoning in 05-RESEARCH.md §"Operation 2". |
| New `superRefine` block for `enable_auto_merge=true ∧ classes=''` | `src/shared/config.ts:121` existing `superRefine` for `provider !== 'ollama' && apiKey.length === 0` | Same `ctx.addIssue({code: ZodIssueCode.custom, path, message})` shape. Append a second condition to the existing superRefine — do NOT chain a second `.superRefine`. |

---

### `action.yml` — extension only

| New element | Closest analog | Why this analog |
|-------------|----------------|-----------------|
| `enable_auto_merge:` input row | `action.yml:128` `enable_auto_dispatch:` input row | Phase 04 default-OFF opt-in convention. Same `description / required: false / default: 'false'` shape. |
| `auto_merge_pass_rate:` input row | `action.yml` existing `rerun_pass_rate:` block | Same numeric-as-string convention with `default: '1.0'`. |
| `auto_merge_fix_classes:` input row | `action.yml` existing per-class `enable_*_fixes:` rows | String-with-default convention; default `'selectors'` (single class as the conservative starting point). |
| `INPUT_ENABLE_AUTO_MERGE` env entry | `action.yml:266` `INPUT_ENABLE_AUTO_DISPATCH: ${{ inputs.enable_auto_dispatch }}` | Phase 01.2 hyphen convention validated. Place the three new rows under the existing `INPUT_ENABLE_AUTO_DISPATCH` line (266) for grouping. |

---

### `src/healer/index.ts` — minimal extension (call args only)

| New element | Closest analog | Why this analog |
|-------------|----------------|-----------------|
| Pass `enableAutoMerge`, `autoMergePassRate`, `autoMergeFixClasses` (split), `patchedFiles` (extracted from `proposal.diff`) to `openHealerPr({...})` | `src/healer/index.ts:354` existing `openHealerPr({...})` call | The call site already accepts a single args object with all relevant config + per-heal data. Add four fields. **Do not** add new processing logic to index.ts — the gate's split-and-evaluate happens inside pr-writer.ts. |

The split of `autoMergeFixClasses` (comma-string → string[]) happens at the index.ts call site (one line: `config.autoMergeFixClasses.split(',').map(s => s.trim()).filter(Boolean)`). The `patchedFiles` extraction can either happen at the index.ts call site (one line: `extractPatchedFiles(proposal.diff)`) OR be done inside `evaluateAutoMerge` if the args carry the raw diff. Planner picks; latter is slightly cleaner since the helper stays private to pr-writer.ts.

---

### `src/healer/pr-writer.test.ts` — extension only

| New test group | Closest analog (line) | Test pattern |
|----------------|------------------------|--------------|
| `describe('pr-writer — MRG-02 evaluateAutoMerge — pass_rate condition', () => {...})` | `src/healer/pr-writer.test.ts:282` `WR-02 (Test 3: sentinel passRate=0 total=0 renders skipped)` | Table-driven cases (passRate above/below threshold; total=0; pass-rate exactly equals threshold). Uses `mkArgs()` helper at line 30. |
| `describe('pr-writer — MRG-02 evaluateAutoMerge — fix_class condition', ...)` | similar | Table cases: `selectors` in default allow-list; `waits` not in default; `assertions` in extended allow-list `'selectors,waits,assertions'`; empty allow-list rejects everything. |
| `describe('pr-writer — D-02 evaluateAutoMerge — scope condition', ...)` | similar | Cases per `TEST_PATH_ALLOWLIST` regex: `tests/foo.spec.ts` matched; `e2e/foo.spec.ts` matched; `playwright/foo.spec.ts` matched; `src/foo.ts` blocked; `packages/x/tests/foo.spec.ts` matched (monorepo); empty diff (no patched files) — edge case planner decides outcome. |
| `describe('pr-writer — D-03 evaluateAutoMerge — config_files condition', ...)` | similar | Cases: `playwright.config.ts` blocked; `e2e/playwright.config.ts` blocked; `tests/utils.config.ts` blocked; `tests/foo.spec.ts` matched (no config); `tests/utils.ts` matched (not a config file); `*.config.cjs` blocked. |
| `describe('pr-writer — MRG-03 enableAutoMerge — happy path', ...)` | `src/healer/pr-writer.test.ts:140` PRI-04 dedup tests with `vi.mock('@octokit/rest')` | Mock `octokit.graphql` to resolve with `{enablePullRequestAutoMerge: {pullRequest: {autoMergeRequest: {enabledAt: '2026-...'}}}}`; assert mutation called with correct variables (`pullRequestId: 'PR_kw...'`, `mergeMethod: 'SQUASH'`). |
| `describe('pr-writer — D-05 enableAutoMerge — soft-fail GraphqlResponseError', ...)` | similar | Mock `octokit.graphql` to reject with `new GraphqlResponseError({errors: [{message: 'Branch is not protected', type: 'PROTECTED_BRANCH'}]})`; assert `core.warning` called with the message; assert `enableAutoMerge` returns `{errorMessage: 'Branch is not protected'}`. |
| `describe('pr-writer — D-05 enableAutoMerge — soft-fail non-GraphQL error', ...)` | similar | Mock to reject with `new Error('Network unreachable')`; assert returns `{errorMessage: 'Auto-merge enable failed: Error: Network unreachable'}`. |
| `describe('pr-writer — MRG-04 renderAutoMergeBand — preview mode', ...)` | `src/healer/pr-writer.test.ts:74` body-content describe block | Snapshot or table-row assertion on the four outcome states: preview (enableFlag=false), blocked-by-condition, blocked-by-mutation-error, enabled. |
| `describe('pr-writer — D-08 PRI-04 dedup × auto-merge — gate not invoked on comment path', ...)` | `src/healer/pr-writer.test.ts:155` PRI-04 dedup Test 2 | Set `mockPullsList` to return existing PR; call `openHealerPr` with `enableAutoMerge: true`; assert `octokit.graphql` was NEVER called; assert reasoning band NOT rendered in summary. |

The existing mock setup at lines 1-24 is extended with `mockGraphql = vi.fn(); ... return { rest: {...}, graphql: mockGraphql }` inside the `Octokit` factory. **Do not** introduce a separate mock for `@octokit/graphql.GraphqlResponseError` — import the real class for the negative tests:

```typescript
import { GraphqlResponseError } from '@octokit/graphql';
// In the test body:
mockGraphql.mockRejectedValueOnce(
  new GraphqlResponseError(
    { method: 'POST', url: '/graphql', headers: {}, query: '...', variables: {} } as any,
    {},
    { data: null, errors: [{ message: 'Branch is not protected', type: 'PROTECTED_BRANCH', path: [], extensions: {}, locations: [{line:1,column:1}] }] } as any,
  )
);
```

---

### `src/shared/config.test.ts` — extension only

| New test group | Closest analog | Test pattern |
|----------------|----------------|--------------|
| `describe('config — Phase 05 enable_auto_merge default-OFF', ...)` | existing `enable_auto_dispatch` parsing tests | `INPUT_ENABLE_AUTO_MERGE` absent → `enableAutoMerge=false`; `'false'` → false; `'true'` → true; `'truthy'` → false (not equal to `'true'`). |
| `describe('config — Phase 05 auto_merge_pass_rate range', ...)` | existing `rerun_pass_rate` tests | Default `1.0`; `'0.9'` → `0.9`; `'1.5'` → ZodIssue; `'-0.1'` → ZodIssue; `'banana'` → ZodIssue. |
| `describe('config — Phase 05 auto_merge_fix_classes default + misconfig', ...)` | existing per-class toggle tests | Default `'selectors'`; `'selectors,waits'` parses (string remains string at schema layer); `enableAutoMerge=true && autoMergeFixClasses=''` → ZodIssue from superRefine; `enableAutoMerge=false && autoMergeFixClasses=''` → no error (gate never invoked). |

---

### `README.md` — additive new section (D-10 stub)

| New element | Closest analog | Why this analog |
|-------------|----------------|-----------------|
| `## Auto-merge prerequisites` section | Existing `## Inputs` and `## Outputs` sections in README.md | Same heading depth + bullet-list convention. Content from RESEARCH.md §"Branch-protection prereq matrix" — four bullets. Phase 6 owns full polish; Phase 5 ships only what D-05's warning message link target needs. |

---

## Anti-Patterns to Avoid

- **DO NOT** add a separate `auto-merge.ts` module. CONTEXT D-04 explicitly locates the code in `pr-writer.ts`. Resist the urge to extract for "modularity" — the helpers are private to one call site.
- **DO NOT** extend `forbidden-patterns.ts` with `CONFIG_FILE_DENYLIST`. CONTEXT D-03 explicitly says the overlay denylist lives next to the auto-merge gate. Adding it to forbidden-patterns.ts would imply diff-lint should reject config patches — wrong (a heal that legitimately patches `playwright.config.ts` to fix a `waits` class issue should still open a PR for human review; only the auto-merge path is forbidden).
- **DO NOT** call `octokit.rest.pulls.merge` instead of the GraphQL mutation. The REST `pulls.merge` performs a synchronous merge that bypasses CI — violates MRG-03.
- **DO NOT** probe `octokit.rest.repos.getBranchProtection` defensively before calling `enableAutoMerge`. CONTEXT D-06: GraphQL mutation surfaces actionable errors directly.
- **DO NOT** pass `commitHeadline` or `commitBody` to the mutation. They override the repo's default-commit-message setting and would strip the `SKIP_SENTINEL` from the squash-commit body (loop-guard would then NOT skip the bot's own commit on its next ingest run — circular dispatch risk).
- **DO NOT** re-evaluate auto-merge on the PRI-04 dedup branch. CONTEXT D-08: comment-only path bypasses the gate entirely.
- **DO NOT** enumerate GitHub's GraphQL error `type` values into a switch. The set is undocumented and changes; render `err.errors[].message` verbatim into the band.

---

## Coverage Sanity Check (planner verification)

- Every new code element has a concrete file:line analog above. ✓
- Every test surface has a concrete `describe(...)` block analog at a real line in `pr-writer.test.ts`. ✓
- Every D-XX from CONTEXT.md has a concrete pattern citation here OR in 05-RESEARCH.md. ✓
- No analog references a file that doesn't exist (verified by inline grep against the live tree). ✓

## PATTERN MAPPING COMPLETE
