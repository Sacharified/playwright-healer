# Phase 4: Auto-Dispatch + Full Fix Classes + Deduplication — Research

**Researched:** 2026-05-01
**Domain:** GitHub Actions workflow_dispatch wiring, Octokit dedup, four-class agent prompts, state-branch heal-cap query
**Confidence:** HIGH on dispatch/dedup APIs (verified from primary docs); MEDIUM on FIX-07 prompt design (no production evidence beyond selectors); HIGH on diff-lint compatibility (verified empirically against the 03.1 PR diff).

## Summary

Phase 4 is mostly **wiring + extension**, not new architecture. The substrate is in place:
- Phase 02 ships the threshold evaluator (DET-01..03), state branch read API, and SEC-05 Guards 0/1/2 in `loop-guard.ts`.
- Phase 03 ships the heal pipeline including `dispatch-payload.ts` (Zod schema for the cross-workflow contract), `pr-writer.ts` / `issue-writer.ts` (Octokit-based create calls), and the `prompt-assembler` + 7 prompt templates.
- Phase 03.1 demonstrated end-to-end heal on the selectors fix class via Gemini, with diff-lint and post-fix validation skipped behind feature flags.

Phase 04 closes five gaps:
1. **DET-05/06** — ingest-side `octokit.rest.actions.createWorkflowDispatch` call gated by a new `enable_auto_dispatch` boolean input (default `'false'`). The receive side already exists.
2. **DET-07** — `concurrency:` block on the healer workflow file (consumer-shipped, not action-internal). Provide a copy-paste recipe in the example workflow + document the slug+hash fallback because GitHub does not document a length cap.
3. **FIX-07** — extend `'selectors' | 'waits'` → `'selectors' | 'waits' | 'assertions' | 'slow'` across six type sites; add two new prompt templates (`assertions-no-trace.md`, `slow-no-trace.md`); ingest-side classifier maps `errorSignature` shape → `fixClassHint` (hybrid: classifier provides hint, LLM may override in proposal).
4. **PRI-04** — pre-create dedup queries via `octokit.rest.pulls.list({ head: 'owner:branch' })` and `octokit.rest.search.issuesAndPullRequests` against title pattern. Comment-only update on open artifacts; closed/merged artifacts get a fresh new artifact (the prior heal is no longer the live state).
5. **D-04 ingest-side heal cap** — extract a `countHealsForTest(testId, windowDays)` helper from a state-branch read; gate dispatch on it; keep the healer-side check as backstop. **Note: the healer-side Guard 3 has never been implemented** — Phase 04 implements it for the first time on both sides. REQUIREMENTS.md traceability marking SEC-05 "Phase 02 Complete" is wrong on the Guard-3 portion.

**Re-engaging the gates.** The diff-lint pass and post-fix-validation gates were skipped for the 03.1 demo. This research empirically verified `lintDiff()` against the 03.1 PR's actual diff (`#wrong-id` → `getByRole('button', { name: 'Submit' })`) and three representative diffs for each of the other classes — all pass cleanly. Diff-lint can be re-engaged in non-demo paths without regressing the working selector heal.

**Hardening backlog status.** WR-01 (gitconfig PAT leak) is **already shipped** in `fix-applier.ts` via inline `git -c http.extraheader` (commit 251271a, `fix(WR-01)`). CONTEXT.md marks it as Phase 04 work; the planner's task is verification-only, not a fresh implementation. WR-02 (`passRate: 1` sentinel) and WR-03 (unconditional `validate()` before skip-flag check) ride alongside the post-fix-validation re-engagement plan.

**Primary recommendation:** Do this phase in 5 plans of roughly equal size: (1) type extension + Zod payload widening + ingest-side dispatch wiring; (2) FIX-07 prompts + classifier; (3) PRI-04 dedup; (4) D-04 heal-cap query + healer-side Guard 3 + skip-flag-default flip + WR-01/02/03 verification/cleanup; (5) verification (e2e-heal-self.yml run with full gates on, plus a new fixture for assertions class). Do NOT collapse into fewer plans — five is the natural responsibility split and each is independently testable.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Threshold detection (read NDJSON, compute flake-rate) | Action / Ingest mode | — | Already shipped Phase 02 — pure function over state-branch records |
| Auto-dispatch trigger (`workflow_dispatch` REST call) | Action / Ingest mode | — | Phase 04 addition. Octokit call from ingest, gated by `enable_auto_dispatch` flag |
| Concurrency-group enforcement | Consumer's healer workflow YAML | — | GitHub Actions evaluates `concurrency:` on the healer workflow itself; the action cannot inject it. Document as part of the example workflow in Phase 06 |
| Per-test heal-cap query (read state branch) | Action / Ingest mode | Action / Heal mode (backstop) | D-04 — defense-in-depth pattern matching SEC-05's existing dual-check |
| Fix-class hint computation | Action / Ingest mode | LLM (override in proposal) | Hybrid classifier — `errorSignature` → `fixClassHint` is fast and deterministic; LLM gets final say in the JSON proposal |
| Prompt assembly per class | Action / Heal mode | — | Already shipped Phase 03 (selectors+waits); Phase 04 adds two more template files |
| Dedup query (open PR/issue lookup) | Action / Heal mode | — | Octokit calls inside `pr-writer.ts` and `issue-writer.ts` immediately before create |
| Diff-lint enforcement | Action / Heal mode | LLM system prompt (defense-in-depth) | D-17 single source of truth — already in place |

## User Constraints

> Copied verbatim from `04-CONTEXT.md`. The planner MUST honor these.

### Locked Decisions

**D-01: Opt-in via `enable-auto-dispatch` boolean input (default `'false'`)**
Consumers explicitly flip live dispatch on after watching the log-only summary across a few runs. This matches MRG-01's safe-default philosophy from REQUIREMENTS ("auto-merge is opt-in; default review-requested") and lowers blast radius when a consumer's threshold is misconfigured. Log-only stays as the v0 default — DET-04 already shipped that surface in Phase 02.

**D-02: New boolean input, not an extension of the `mode` enum**
Add `enable-auto-dispatch` alongside the existing `mode: ingest | heal | dry-run`. Ingest-mode reads the flag and decides whether to fire `workflow_dispatch`. The two-workflow architecture (PROJECT.md key decision: ingest in main CI, heal dispatched separately) stays intact — `mode: heal` semantics are preserved for the dispatched run.

**D-03: Concurrency group = `playwright-healer-${{ github.repository }}-${{ test_file }}-${{ test_title }}`**
Matches DET-07's exact phrasing ("concurrency group keyed on test file + test title"). Slug both `test_file` and `test_title` (replace path separators, lowercase, truncate at a sane length — researcher to determine whether GitHub's group-name length cap forces a hash fallback). The healer workflow declares this group with `cancel-in-progress: false` (queue, don't cancel — we want both runs' detection evidence preserved if they raced).

**D-04: SEC-05 heal-cap check happens at dispatch time (state-branch query) AND inside the healer (defense-in-depth)**
Ingest queries the state branch for the per-test heal count over the rolling `flake-window-days` window before firing dispatch. If the count is at or above `max-heals-per-test-per-week` (default 3), no dispatch fires and a `::warning::` annotation surfaces "heal cap reached for {test} — manual review required." Healer's existing SEC-05 check from Phase 02 stays in place as backstop. Saves a workflow run + agent setup on the cap-already-hit path; backstop ensures the invariant holds even if ingest path drifts.

> **Research note on D-04 (CRITICAL CORRECTION):** The healer-side Guard 3 (per-test heal cap) **does not yet exist**. `loop-guard.ts:3` says verbatim: *"Phase 02 checks only guards 0, 1, 2. Guard 3 (per-test heal cap) is Phase 04."* `maxHealsPerTestPerWeek` is in the Zod config but unreferenced outside config. REQUIREMENTS.md marks SEC-05 "Phase 02 Complete" — that traceability is wrong on the Guard-3 portion. Phase 04 implements the cap on **both** sides for the first time, not just the ingest side as CONTEXT D-04 implies.

### Claude's Discretion

- **PRI-04 dedup update behavior** — comment-on-existing vs force-update vs hybrid. REQUIREMENTS PRI-04 phrasing leans toward comment-only.
- **FIX-07 prompt structure** — single unified system prompt with class branches vs class-specific prompt files. Class-picker (heuristic vs LLM-decides).
- **CFG-04 default-on policy** — REQUIREMENTS says default-true for all four; researcher to confirm post-03.1 evidence.
- **Hardening backlog routing** — Default: WR-01 (security) ships in Phase 04; WR-02/WR-03 ship alongside post-fix-validation re-engagement; six PROJECT.md notes triaged in PLAN.md.

### Deferred Ideas (OUT OF SCOPE)

- **Replay/cache mode for prompt iteration** — Inherited from 03.1's deferred list. Skip for Phase 04.
- **Demo recording / reference artifact** — surface in Phase 06.
- **Public action repo** — project-level decision, not a Phase 04 decision.
- **Anthropic adapter exercise on full fix classes** — defer; Gemini-first per D-08.
- **Cross-shard dedup** — concurrency group catches it; no new logic required.
- **PR auto-rebase on stale healer branches** (PAT-03 v2) — out of v1 scope.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DET-05 | Live dispatch mode fires `workflow_dispatch` with self-contained JSON payload | Verified: `octokit.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id, ref, inputs })` is the canonical API. workflow_dispatch caps at 25 inputs / 1024 chars per input — the existing `DispatchPayload` (4 top-level + nested `recentRunStats`) fits comfortably if `recentRunStats` is JSON-encoded into a single input string. See "Code Examples §1". |
| DET-06 | Dispatch uses `healer-token` PAT (not `GITHUB_TOKEN`) | Verified: `octokit.rest.actions.createWorkflowDispatch` requires `repo` scope; PAT path is documented. Reuse `config.healerToken` (already wired through `src/index.ts:69` and used by `pr-writer.ts:67`). No new auth surface. |
| DET-07 | Concurrency group keyed on test file + test title | GitHub does NOT document a concurrency group name length cap (verified across `docs.github.com/en/actions/using-jobs/using-concurrency`, `docs.github.com/en/actions/reference/limits`, and a search for `"too long"` issues — no hits). For safety/debuggability use a slug+hash recipe; concurrency block lives in the **consumer's healer workflow YAML**, not the action. See "Code Examples §2". |
| FIX-07 | Healer supports all four fix classes; classes individually disabled via CFG-04 | Type contract widening across 6 sites (`dispatch-payload.ts`, `prompt-assembler.ts`, `adapter.ts`, `pr-writer.ts`, `github.ts:parseFinalText`, `output-format.md`). Two new prompt templates. Ingest-side classifier on `NdjsonTestEntry.errorSignature`. See "FIX-07 Architecture" below. |
| PRI-04 | Pre-create dedup query; comment on existing rather than create duplicate | `octokit.rest.pulls.list({ owner, repo, state: 'open', head: 'owner:branch' })` for PR dedup (deterministic on the `playwright-healer/<slug>-<sha>` branch name); `octokit.rest.search.issuesAndPullRequests` with `repo:X is:issue is:open in:title "<test title>"` for issue dedup. State matrix in "PRI-04 State Matrix" below. |

Adjacent (referenced but not new):
- **SEC-05** — Guard 3 (per-test heal cap) is the missing piece; Phase 04 implements it both at the ingest dispatch gate (D-04) and at the healer-side `shouldSkipHeal()` (a sibling to `shouldSkipIngest()` to be added in `loop-guard.ts`).
- **CFG-04** — four `enable-*-fixes` toggles already exist in config; Phase 04 wires them into the prompt assembler and dispatch-payload class-hint logic.

## Standard Stack

### Core (no version changes — reuse what's installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@octokit/rest` | 22.0.1 | `pulls.list`, `actions.createWorkflowDispatch`, `search.issuesAndPullRequests`, `issues.createComment` | Already used by `pr-writer.ts` and `issue-writer.ts`; same auth path (PAT via `config.healerToken`) |
| `@actions/core` | 3.0.1 | `core.warning(...)` for cap-hit / dispatch-skipped surfaces, `core.summary` for unified DET-05 + DET-04 summary table | Already used everywhere; pinned exactly per supply-chain mitigation |
| `@actions/github` | (peer of `@actions/core`) | `github.context.payload.inputs` deserialization on receive side, `github.context.repo` for `{owner, repo}` | Already used in `src/healer/index.ts:107` and `src/ingest/index.ts:98` |
| `zod` | 4.3.6 | Schema widening for `DispatchPayload` (`fixClassHint` enum extension) | Already in stack; `superRefine` pattern proven in `config.ts` |

### Supporting

No new libraries needed. The phase is wiring + extension only.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `octokit.actions.createWorkflowDispatch` | Direct `fetch` POST to `/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` | No benefit — Octokit is already a dependency; calling it directly preserves test-mocking patterns established in `pr-writer.test.ts` |
| `octokit.search.issuesAndPullRequests` for PR dedup | `octokit.pulls.list({ head: 'owner:branch' })` | **Use `pulls.list`** — the healer-branch name (`playwright-healer/<slug>-<sha>`) is deterministic per `(test, sha)` pair, so a `head:` filter is exact (no rate-limit budget spent on Search API; lower 5000-req/hr core limit vs 30-req/min Search limit) [VERIFIED: docs.github.com/en/rest/pulls/pulls#list-pull-requests] |
| Issue dedup via `issues.list` | `search.issuesAndPullRequests` | **Use Search API for issues** — issues are not branch-tied; matching by title pattern (`[playwright-healer] <test title> is unhealable`) is the only deterministic key. Search supports `in:title` qualifier directly. |
| Class-hint provided by ingest classifier | LLM picks class on first turn | **Hybrid: classifier provides hint, LLM may override in proposal**. The `errorSignature` (200-char Playwright error) is reliably class-discriminating for the four v1 classes — see "FIX-07 Architecture". Hybrid avoids "no fix proposable" outcomes when the classifier is wrong. |

**Installation:** No new dependencies. `npm ci --production` in the composite action remains unchanged.

**Version verification:**
- `@octokit/rest` 22.0.1 — pinned in `package.json` [VERIFIED: `package.json` line read 2026-05-01]
- `actions.createWorkflowDispatch` available since Octokit 16.x [VERIFIED: `octokit.github.io/rest.js/v22`]
- `pulls.list({ head: 'owner:branch' })` — supports `head` filter format `user:ref-name` [VERIFIED: `docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#list-pull-requests`]

## Architecture Patterns

### System Architecture Diagram

```
                Consumer's main CI
                        │
                        ▼
       ┌────────────────────────────────┐
       │  uses: playwright-healer       │
       │  with: mode: ingest            │
       │  with: enable_auto_dispatch:   │
       │        true            (NEW)   │
       └───────────────┬────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │ src/ingest/index.ts              │
        │  1. shouldSkipIngest()           │ ── SEC-05 Guards 0/1/2
        │  2. parseReport()                │
        │  3. appendRecord()               │
        │  4. evaluateThresholds()         │ ── DET-01..03 (existing)
        │  5. writeDetectionSummary()      │ ── DET-04 (existing log-only)
        │  6. (NEW) for each detection:    │
        │     a. countHealsForTest()       │ ── D-04 cap query
        │     b. classifyFixClass()        │ ── FIX-07 hint
        │     c. createWorkflowDispatch()  │ ── DET-05/06
        │     d. annotate summary          │
        └──────────────────────────────────┘
                       │
                       │ workflow_dispatch with payload:
                       │   { commitSha, testFile, testTitle,
                       │     fixClassHint, recentRunStats }
                       ▼
        ┌──────────────────────────────────┐
        │ Consumer's playwright-healer.yml │
        │  on: workflow_dispatch           │
        │  concurrency:                    │ ── DET-07 (consumer-shipped)
        │    group: playwright-healer-...  │
        │    cancel-in-progress: false     │
        │  jobs:                           │
        │   heal:                          │
        │    uses: playwright-healer       │
        │    with: mode: heal              │
        └───────────────┬──────────────────┘
                        │
                        ▼
        ┌──────────────────────────────────┐
        │ src/healer/index.ts              │
        │  1. parse DispatchPayload (Zod)  │ ── widened: 4 fix classes
        │  2. (NEW) shouldSkipHeal()       │ ── SEC-05 Guard 3 backstop
        │  3. Bundle context               │
        │  4. Sanity rerun (PRI-05)        │
        │  5. Assemble prompt              │ ── (NEW) per fixClassHint
        │  6. Run adapter                  │
        │  7. Diff-lint (RE-ENABLED)       │ ── skipDiffLint default flips
        │  8. Apply diff                   │
        │  9. Validate (RE-ENABLED)        │ ── skipPostFix default flips
        │ 10. (NEW) findExistingPr()       │ ── PRI-04
        │     OR findExistingIssue()       │
        │     → comment OR create          │
        └──────────────────────────────────┘
```

### Recommended Project Structure

No new directories. Files added or substantively modified:

```
src/
├── ingest/
│   ├── index.ts            # MODIFIED: step 9 — auto-dispatch loop
│   ├── dispatch.ts         # NEW: createWorkflowDispatch wrapper + cap query call
│   ├── classifier.ts       # NEW: errorSignature → fixClassHint
│   └── threshold-evaluator.ts  # unchanged (DET-01..03 pure function)
├── healer/
│   ├── index.ts            # MODIFIED: shouldSkipHeal call, FIX-07 routing, dedup
│   ├── dispatch-payload.ts # MODIFIED: widen fixClassHint enum
│   ├── prompt-assembler.ts # MODIFIED: route to assertions/slow templates
│   ├── prompts/
│   │   ├── assertions-no-trace.md  # NEW
│   │   ├── slow-no-trace.md        # NEW
│   │   ├── assertions-with-trace.md  # NEW (mirror)
│   │   ├── slow-with-trace.md        # NEW (mirror)
│   │   └── output-format.md          # MODIFIED: widen fixClass enum
│   ├── pr-writer.ts        # MODIFIED: findExistingPr + commentOnPr
│   ├── issue-writer.ts     # MODIFIED: findExistingIssue + commentOnIssue
│   └── adapters/
│       ├── github.ts       # MODIFIED: parseFinalText fixClass widening
│       └── gemini.ts       # MODIFIED: parseFinalText (if same shape)
├── shared/
│   ├── loop-guard.ts       # MODIFIED: add shouldSkipHeal + countHealsForTest helper
│   ├── state-branch.ts     # MODIFIED: add readWindowRecords export OR walker for healer side
│   └── config.ts           # MODIFIED: add enableAutoDispatch field
action.yml                   # MODIFIED: add enable_auto_dispatch input + INPUT_ENABLE_AUTO_DISPATCH env bridge
```

### Pattern 1: Octokit Workflow Dispatch (DET-05/06)

**What:** Fire `workflow_dispatch` from ingest using the consumer's `healer-token` PAT.
**When to use:** Inside `src/ingest/index.ts` Step 9, only when `config.enableAutoDispatch === true` AND a Detection survives the D-04 heal-cap gate.
**Example:**

```typescript
// src/ingest/dispatch.ts
// Source: docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';
import type { Detection } from '../shared/types.js';

export async function fireDispatch(args: {
  patToken: string;
  owner: string;
  repo: string;
  workflowFile: string;        // 'playwright-healer.yml' (consumer-configurable input)
  ref: string;                 // default branch — workflow_dispatch needs a ref
  detection: Detection;
  commitSha: string;
  fixClassHint: 'selectors' | 'waits' | 'assertions' | 'slow';
  recentRunStatsJson: string;  // pre-encoded — workflow_dispatch caps each input at 1024 chars
}): Promise<void> {
  const octokit = new Octokit({ auth: args.patToken });

  // Extract testFile and testTitle from testId ("filePath::title")
  const [testFile, testTitle] = args.detection.testId.split('::', 2);

  await octokit.rest.actions.createWorkflowDispatch({
    owner: args.owner,
    repo: args.repo,
    workflow_id: args.workflowFile,
    ref: args.ref,
    inputs: {
      commitSha:    args.commitSha,
      testFile,
      testTitle,
      fixClassHint: args.fixClassHint,
      recentRunStats: args.recentRunStatsJson,  // JSON-encoded sub-object
    },
  });

  core.info(`Phase 04: dispatched heal for "${testTitle}" (${testFile}) — fixClassHint=${args.fixClassHint}`);
}
```

**Constraints discovered from primary docs:**
- `inputs:` accepts at most **25** properties [VERIFIED: github.blog/changelog/2025-12-04 — raised from 10 in Dec 2025]
- Each input value capped at **1024 characters** [VERIFIED: GitHub community discussion #120093]
- `ref` is REQUIRED — workflow_dispatch must specify the branch the workflow runs from
- PAT needs `repo` scope [VERIFIED: docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event]

### Pattern 2: Concurrency Group Slug+Hash (DET-07)

**What:** A consumer-side `concurrency:` block keyed on `(repository, testFile, testTitle)`.
**When to use:** In the consumer's healer workflow file. Phase 06 ships this in the example workflow; Phase 04 documents it.
**Example:**

```yaml
# .github/workflows/playwright-healer.yml (CONSUMER-SHIPPED)
on:
  workflow_dispatch:
    inputs:
      commitSha:    { required: true }
      testFile:     { required: true }
      testTitle:    { required: true }
      fixClassHint: { required: true }
      recentRunStats: { required: false }

# DET-07 — slug + hash keeps the group under any plausible cap and stays unique even on truncation
concurrency:
  group: >
    playwright-healer-${{ github.repository }}-${{
      hashFiles('/dev/null') /* placeholder; see note */
    }}
  cancel-in-progress: false
```

**Reality check:** GitHub does NOT expose a string-hash function in workflow expressions, only `hashFiles(...)`. The clean recipe must compute the hash inside ingest before dispatch and pass it as a dispatch input:

```typescript
// In ingest/dispatch.ts — compute concurrency key alongside payload
import { createHash } from 'node:crypto';
function buildConcurrencyKey(testFile: string, testTitle: string): string {
  // Slug: lowercase, [^a-z0-9]+ → '-', truncate to 40 each
  const fileSlug  = slug(testFile, 40);
  const titleSlug = slug(testTitle, 40);
  // Hash: 8-char SHA-1 of the canonical "{file}::{title}" identifier — stable across
  // truncation collisions
  const hash = createHash('sha1').update(`${testFile}::${testTitle}`).digest('hex').slice(0, 8);
  return `${fileSlug}-${titleSlug}-${hash}`;
}

function slug(s: string, maxLen: number): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, maxLen);
}
```

The dispatch payload then carries `concurrencyKey` as a 6th input, and the healer workflow reads it:

```yaml
concurrency:
  group: playwright-healer-${{ github.repository }}-${{ inputs.concurrencyKey }}
  cancel-in-progress: false
```

**Length budget:** `playwright-healer-` (18) + `owner/repo` (≤39 + 1 + ≤100 typical) + `-` + `40+1+40+1+8` = ~250 chars worst case. No documented cap; well within any reasonable HTTP-path-derived limit.

### Pattern 3: Octokit PR Dedup by Branch Head (PRI-04)

**What:** Query for an existing open PR matching the deterministic `playwright-healer/<slug>-<sha>` branch name before calling `pulls.create`.
**When to use:** Inside `pr-writer.ts` `openHealerPr()`, immediately before the `octokit.pulls.create` call.
**Example:**

```typescript
// src/healer/pr-writer.ts (modified — PRI-04 dedup)
// Source: docs.github.com/en/rest/pulls/pulls#list-pull-requests
async function findExistingOpenPr(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ number: number; html_url: string } | null> {
  // `head` filter format: `user:ref-name` (literal docs phrasing; works for orgs too)
  const { data: prs } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${branch}`,
    per_page: 1,
  });
  return prs.length > 0 ? { number: prs[0].number, html_url: prs[0].html_url } : null;
}

async function commentOnPr(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  // Issue comments work for PRs too — PRs are issues with extra fields
  await octokit.rest.issues.createComment({
    owner, repo, issue_number: prNumber, body,
  });
}
```

**Why `pulls.list` not `search.issuesAndPullRequests`:**
- The branch name `playwright-healer/<slug>-<sha>` is **deterministic per (test, sha)** — `pulls.list({ head })` returns 0-or-1 result with zero ambiguity
- Search API has 30 req/min limit; core API has 5000 req/hr — dedup runs before every PR-creating heal
- `head` filter requires the format `user:ref-name` — for the consumer's repo `Sacharified/playwright-healer-test`, the head is `Sacharified:playwright-healer/<slug>-<sha>` [VERIFIED: docs.github.com/en/rest/pulls/pulls#list-pull-requests]

### Pattern 4: Octokit Issue Dedup by Title Search (PRI-04)

**What:** Issues are not branch-tied — match by title pattern via the Search API.
**When to use:** Inside `issue-writer.ts` `openIssue()` immediately before `issues.create`.
**Example:**

```typescript
async function findExistingOpenIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  testTitle: string,
): Promise<{ number: number; html_url: string } | null> {
  // Title format LOCKED per D-09: `[playwright-healer] <test title> is unhealable`
  // Search API requires `is:issue` or `is:pull-request` qualifier or returns HTTP 422
  const q = `repo:${owner}/${repo} is:issue is:open in:title "[playwright-healer]" "${testTitle}" "is unhealable"`;
  const { data } = await octokit.rest.search.issuesAndPullRequests({ q, per_page: 1 });
  return data.items.length > 0
    ? { number: data.items[0].number, html_url: data.items[0].html_url }
    : null;
}
```

**Note on rate limits:** Search API is 30 req/min for authenticated requests [CITED: docs.github.com/en/rest/rate-limit]. Each heal makes at most one search call before issue create, so 30 heals/min is the practical ceiling — well above any realistic threshold.

### PRI-04 State Matrix

The CONTEXT discretion area asks for a state matrix; here it is:

| Existing artifact | Action | Rationale |
|-------------------|--------|-----------|
| Open PR for same `(test, sha)` branch | **Comment with new evidence** | Force-update would rewrite the diff a human may already be reviewing. Comment lists new `rootCause`, `rationale`, validation pass-rate, cost-spent. |
| Open PR for same test, different `sha` (rare — would mean prior heal didn't merge before re-trigger) | **Create new PR** (different branch name) | Different SHA means the underlying commit context changed; the prior PR's diff may not even apply cleanly. Old PR stays open for human comparison. |
| Closed-unmerged PR for same test | **Create new PR** | Maintainer rejected the prior heal; current re-trigger is fresh evidence. Don't reopen the closed PR (loses the rejection signal). |
| Merged PR for same test | **Create new PR** | Prior heal landed but the test is **re-flaking** — that's a different signal (the fix didn't stick or a new failure mode emerged). New PR is correct. |
| Open issue for same test, same `failureMode` | **Comment with new evidence** | Same as open-PR rationale. |
| Open issue for same test, different `failureMode` | **Create new issue** | E.g., prior issue was `agent-budget-exhausted`, this one is `validation-failed` — different actionable diagnostic. |
| Closed issue for same test | **Create new issue** | Prior issue resolved (deleted, fixed manually, won't-fix); re-flake is a new signal. |

**Implementation note:** The closed/merged PR path needs a single boolean flag `forceCreate` or equivalent — the existing `pulls.list({ state: 'open' })` query already excludes them, so the default behavior is correct.

### FIX-07 Architecture

CONTEXT explicitly invites the researcher to recommend prompt structure and class-hint origin. Recommendation:

**Prompt structure: per-class template files (not unified)**

The existing `prompt-assembler.ts` already follows this pattern: `${args.fixClassHint}-${traceTag}.md`. Phase 04 adds two more files (`assertions-no-trace.md`, `slow-no-trace.md`) and the trace-having mirrors. **No restructuring needed.** This keeps each class's prompt self-contained, easier to A/B test, and avoids one giant prompt where every class's guidelines compete for attention.

**Class-hint origin: hybrid (ingest classifier provides default, LLM may override)**

Three options were considered:
1. **Ingest-only:** classifier sets `fixClassHint`; LLM is locked into that class. Risk: classifier wrong → "no fix proposable".
2. **LLM-only:** `fixClassHint` is optional; LLM picks on first turn. Risk: agent burns tokens deciding before reproducing.
3. **Hybrid (recommended):** classifier provides hint; LLM may emit a different `fixClass` in the proposal. Best of both — fast deterministic default, LLM has escape hatch.

**Classifier rules** (from `NdjsonTestEntry.errorSignature`, the 200-char-truncated Playwright error message):

| Signature substring | → `fixClassHint` |
|---------------------|------------------|
| `Test timeout of` / `Test timed out` | `slow` |
| `expect(received).` / `Expected:` followed by `Received:` / `assertion` | `assertions` |
| `locator.` / `waiting for locator(...)` / `Target closed` (DOM-resolution failures) | `selectors` |
| `Element is not stable` / `intercepted` (race conditions) | `waits` |
| Anything else (unknown error shape) | `selectors` (fallback — most common; healer can no-fix-propose if wrong) |

This matches the four CFG-04 toggles: `enable_selector_fixes`, `enable_wait_fixes`, `enable_assertion_fixes`, `enable_slow_fixes`. Disabled classes are not selectable — if the classifier returns `assertions` and `enable_assertion_fixes: false`, the dispatch is suppressed with a `::warning::` "test would heal as assertions class but that class is disabled".

**LLM override path:** the agent's JSON proposal allows `fixClass` to be any of the 4 enum values. If it differs from `fixClassHint`, log it as `core.info('Agent overrode fixClassHint: hinted=X, chose=Y')` and proceed with the agent's pick. The PR body shows the chosen class.

### CFG-04 Default-On Policy (researcher recommendation)

CONTEXT discretion area: "REQUIREMENTS says default-true for all four; researcher to confirm post-03.1 evidence."

**Recommendation: default-true for all four, with documented opt-out per class.**

Rationale:
- The 03.1 demo proved Gemini handles selectors well. There is **no production evidence base** for the other three classes — defaulting to false means consumers never exercise them and the project never discovers whether they work.
- The diff-lint pass (re-engaged in Phase 04) is the safety net. Empirical verification (this research, see "Diff-Lint Compatibility Verification" below): all four sample fix-class diffs pass diff-lint cleanly when written correctly; only intentional weakening fails. The `out-of-test-dir` allowlist prevents catastrophic blast radius regardless of class.
- Per-class disable is one-line opt-out (`enable_assertion_fixes: 'false'`). Consumers worried about a specific class can flip it off without abandoning the whole feature.

**Mitigation: surface the class-confidence band in the PR body** (a Phase 06 docs item, not Phase 04 code change). The PR template already shows `fixClass` — Phase 06 README documents that selectors is the only class with broad production evidence, so reviewers calibrate accordingly.

### Anti-Patterns to Avoid

- **Don't rebuild the dispatch payload schema in `src/ingest/dispatch.ts`.** Import `DispatchPayload` from `src/healer/dispatch-payload.ts` — it's the cross-workflow contract. Widening `fixClassHint` happens in **one** place.
- **Don't search for the bot's identity in dedup.** Title is the dedup key (deterministic), not author. The `[playwright-healer]` prefix is the namespace.
- **Don't auto-close stale healer PRs in PRI-04.** That's PAT-03 (v2 deferred). Phase 04's job is "don't create a duplicate"; cleanup of stale healer state is out of scope.
- **Don't put concurrency in `action.yml`.** GitHub Actions evaluates `concurrency:` on the workflow file, which is consumer-shipped. The action can document and recommend; it cannot enforce.
- **Don't read the entire state branch corpus for the heal-cap query.** Reuse the `readWindowRecords()` walker pattern from `src/ingest/index.ts:154` — same windowed walk, but filter by `testId` and count `fix-applier` commits / dispatch records. (Implementation note: state branch records do not currently track per-test heal counts. See "Open Questions §1".)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Workflow_dispatch HTTP call | Custom `fetch` POST with auth/retry | `octokit.rest.actions.createWorkflowDispatch` | Built-in retry, rate-limit handling, error-message normalization; matches existing `pr-writer.ts` patterns |
| PR/issue title pattern matching | Custom string parsing | `octokit.rest.search.issuesAndPullRequests` with `in:title` qualifier | GitHub-side index; respects `is:issue` / `is:pull-request` partition |
| Branch-name → PR lookup | `git ls-remote` + scrape | `octokit.rest.pulls.list({ head: 'owner:branch' })` | Branch filter is a query parameter, single API call |
| Dispatch input size budgeting | Manual chunking across multiple inputs | JSON-encode `recentRunStats` into a single string input | 25-input cap is comfortable; 1024-char-per-input is the real constraint, but `{ flakeRate, windowDays, runCount }` JSON-stringifies under 100 chars |
| Concurrency group slug | Custom hash collision avoidance | `crypto.createHash('sha1')` — already in Node stdlib | Standard library; deterministic |
| Per-class system-prompt construction | Single mega-prompt with branches | Per-class `.md` files combined by `prompt-assembler.ts` | Existing pattern; smaller blast radius per template; A/B testable |

**Key insight:** Almost everything Phase 04 needs is already in the stack. The temptation will be to over-engineer the dispatch payload encoding or the dedup query. The cost of the standard answer (Octokit + JSON-encoded sub-payload) is one extra `JSON.parse(inputs.recentRunStats)` on the receive side and zero new dependencies.

## Common Pitfalls

### Pitfall 1: workflow_dispatch input length cap (1024 chars per input)

**What goes wrong:** A test with a long file path (e.g., `packages/foo/src/components/very-long-component-name/__tests__/integration/some-feature.test.ts`) plus a long title pushes the dispatch input past 1024 chars. GitHub silently truncates, the receive-side Zod parse fails on the malformed payload, and the heal exits with `Invalid dispatch payload`.

**Why it happens:** Per-input cap is documented but not in the API error response — the failure surfaces only at the receive side. [CITED: github.com/orgs/community/discussions/120093]

**How to avoid:**
- `testFile` and `testTitle` typically fit (<1024 each); use them as separate inputs, not concatenated.
- `recentRunStats` JSON-encodes to ~80 chars; safe.
- Add a pre-dispatch length check in `dispatch.ts`: if any input value > 1000 chars, log `core.warning` and skip dispatch with `::warning::` annotation rather than firing a doomed call.

**Warning signs:** First sign is a `Invalid dispatch payload: testTitle: String must contain at least 1 character` (truncation hit a boundary) on the receive side.

### Pitfall 2: workflow_dispatch needs a `ref:` parameter

**What goes wrong:** `createWorkflowDispatch` returns 422 if `ref` is omitted. The default branch isn't auto-resolved.

**Why it happens:** The endpoint requires the workflow to run on a specific branch. Even a workflow file that exists only on `main` must be dispatched with `ref: 'main'`.

**How to avoid:** Read `github.event.repository.default_branch` from `@actions/github` context (the orchestrator already does this for the heal step at `action.yml:251` via `HEALER_DEFAULT_BRANCH`). Pass the same value to `createWorkflowDispatch`. Fallback `'main'` if the env is empty.

**Warning signs:** HTTP 422 from the dispatch call. Octokit surfaces this as a thrown error with the message `Reference does not exist`.

### Pitfall 3: `pulls.list({ head })` filter format is `user:ref`, not just `ref`

**What goes wrong:** Calling `pulls.list({ head: 'playwright-healer/foo-abc1234' })` (raw branch) returns ALL open PRs, not just the matching one. Dedup query becomes a broad scan and the boolean "exists" check is always true after the first heal lands any PR.

**Why it happens:** GitHub's REST API requires the format `user:ref-name` to disambiguate cross-fork PRs. [CITED: docs.github.com/en/rest/pulls/pulls#list-pull-requests]

**How to avoid:** Always prefix the head with `${owner}:`. The owner is `github.context.repo.owner` (already available in `pr-writer.ts`).

**Warning signs:** Dedup query returns more than 1 result; logs show "duplicate PR detected" on every heal even when the prior PR's branch name is different.

### Pitfall 4: `issuesAndPullRequests` requires `is:` qualifier

**What goes wrong:** A search query without `is:issue` or `is:pull-request` returns HTTP 422 [CITED: octokit search docs]. Dedup query throws and the issue create call never happens — heal exits with an unhandled error.

**How to avoid:** Always include `is:issue` (or `is:pull-request`) in the `q:` string. Two separate calls if both are needed (issues and PRs cannot be searched in the same call).

**Warning signs:** HTTP 422 from `search.issuesAndPullRequests`.

### Pitfall 5: concurrency group case-insensitivity

**What goes wrong:** A test titled `Login Flow` and another titled `login flow` collide on the concurrency group because GitHub treats group names case-insensitively. [CITED: docs.github.com/en/actions/using-jobs/using-concurrency — "the concurrency group name is case insensitive"]

**How to avoid:** Lowercase the slug aggressively (already in `slugify()` in `src/healer/index.ts:42`); the SHA-1 hash component preserves case-distinct uniqueness when needed.

**Warning signs:** Two heals for case-variant test titles serialize where they shouldn't.

### Pitfall 6: SEC-05 Guard 3 was never implemented (mis-stated in REQUIREMENTS traceability)

**What goes wrong:** Plans assume the healer's SEC-05 check exists ("the existing SEC-05 backstop in the healer"). It does not. `loop-guard.ts:3` says verbatim: "Phase 02 checks only guards 0, 1, 2. Guard 3 (per-test heal cap) is Phase 04." `maxHealsPerTestPerWeek` is in the Zod config but referenced nowhere outside `config.ts` and one test fixture. REQUIREMENTS.md marks SEC-05 "Phase 02 Complete" — that traceability is wrong on the Guard-3 portion.

**How to avoid:** Phase 04 implements the cap on **both** sides for the first time. CONTEXT D-04 reads as "ingest adds the cheap pre-dispatch check; healer keeps existing SEC-05 backstop." The second half is misleading; treat it as "Phase 04 implements both the ingest-side query AND the healer-side `shouldSkipHeal()` defense-in-depth backstop."

**Warning signs:** Looking for "Guard 3" in `loop-guard.ts` and finding only the comment that says it's deferred to Phase 04.

### Pitfall 7: state-branch heal-count records don't exist yet

**What goes wrong:** The state branch stores `NdjsonRecord` (per-CI-run stats), not heal events. The cap query needs to count "how many times has this `testId` been healed in the last N days" — that signal is currently absent from the schema.

**How to avoid:** Two options:
1. **Approximate:** count `[skip-healer]` commits on PR branches matching `playwright-healer/<slug-prefix>-*`. Cheap (single `git log`), but indirect (counts attempts that opened PRs, misses agent-budget-exhausted issues).
2. **Add a new schema:** extend NDJSON with a sibling `runs/YYYY/MM/DD-heals.ndjson` that records `{ timestamp, testId, outcome: 'pr-opened' | 'issue-opened' | 'cap-reached', dispatchRunId }`. Append-only; same `--force-with-lease` retry loop. The healer writes a heal record on every exit path (both PR and issue paths).

**Recommendation: option 2** — it's the right schema and it's a small addition (one new file path, one new write-on-exit call). The data is needed for any future v2 cost dashboard (OBS-01) too.

**Warning signs:** A planner trying to count heals from `NdjsonTestEntry.outcome` — which is the test's outcome, not a heal event.

### Pitfall 8: composite action runtime spawn — INPUT_* env vars use underscores now

**What goes wrong:** Phase 01.2 fixed the hyphen-stripping bug by switching to `./node_modules/.bin/tsx`, AND the recent `63646d3` rename converted all action inputs from kebab-case to snake_case. The current env vars are `INPUT_ENABLE_AUTO_DISPATCH` (snake_case), NOT `INPUT_ENABLE-AUTO-DISPATCH` (kebab-case as CONTEXT.md `<code_context>` says). CONTEXT.md is stale on this point.

**How to avoid:** Inspect `action.yml:222-251` (the env block); every `INPUT_*` key uses underscores. The new `INPUT_ENABLE_AUTO_DISPATCH` follows that pattern. `core.getInput('enable_auto_dispatch')` reads it via the new `@actions/core` v3 normalization (which maps either form transparently — `getInput` accepts the YAML name directly).

**Warning signs:** Adding `INPUT_ENABLE-AUTO-DISPATCH` (hyphenated) to the env block. The composite gate line `./node_modules/.bin/tsx src/index.ts` does its own env-resolution via @actions/core's input table; using the wrong env name produces a silent default-`'false'` result (no error).

### Pitfall 9: WR-01 was already fixed — don't duplicate the work

**What goes wrong:** A planner reads the 03.1 REVIEW saying `action.yml:215` writes a global gitconfig PAT and adds a fix task. But the actual current code (commit `251271a`, "fix(WR-01): replace global git config PAT with inline extraheader on push") already replaces this with `git -c http.https://github.com/.extraheader=Authorization: basic <b64>` inside `fix-applier.ts:127-130`. The action.yml `git config --global` step is GONE; the comment block at `action.yml:213` describes what was removed.

**How to avoid:** Inspect `fix-applier.ts:127-135` to confirm the inline credential pattern. Phase 04's WR-01 work is **a verification check** — confirm no `git config --global url.insteadOf` regression has crept back in — not a fresh implementation.

**Warning signs:** A plan with a "Fix WR-01" task; should be a "Verify WR-01 still fixed" check (one assertion in a test or a security-lint grep).

## Runtime State Inventory

> Phase 04 is mostly code/config changes (no rename), but it adds a new state-branch schema (heal events) and changes the default value of three skip flags. Worth listing.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (NEW) `runs/YYYY/MM/DD-heals.ndjson` on `playwright-healer-state` branch — heal-event log | Schema addition; backfill not required (empty history is the cap=0 baseline) |
| Live service config | `concurrency.group` block in consumer's `playwright-healer.yml` workflow file | DOC item — example workflow in Phase 06; Phase 04 documents the recipe in PLAN.md |
| OS-registered state | None | None — verified by grep |
| Secrets/env vars | (CHANGED) `INPUT_ENABLE_AUTO_DISPATCH` env var added to `action.yml` Step 6 env block; no new secret | Code edit only |
| Build artifacts | (NEW) two prompt template files (`assertions-no-trace.md`, `slow-no-trace.md`) shipped in `node_modules/playwright-healer/src/healer/prompts/` post-`npm ci` — composite action loads them at runtime via `prompt-assembler.ts:18` `path.join(__dirname, 'prompts')` | None — automatic when consumer reinstalls |

## Common Hardening Backlog Triage

The 03.1 surfaced 9 backlog items (3 code-review warnings + 6 PROJECT.md notes). Triage:

| # | Item | Phase 04 routing | Status |
|---|------|------------------|--------|
| WR-01 | gitconfig PAT leak | **VERIFY ONLY** | Already shipped (commit 251271a) — Phase 04 plan adds a one-line security-lint grep to prevent regression |
| WR-02 | `passRate: 1` in skipPostFix sentinel | Plan 4 (with skip-flag flip) | When `skipPostFixValidation` defaults to `false`, the sentinel path is non-default. WR-02 fix is still needed for demo paths — flip `passRate: 0` and special-case `total === 0` in `pr-writer.ts` |
| WR-03 | unconditional `validate()` before skip-flag check | Plan 4 (with skip-flag flip) | One-line fix — wrap step 4 in `if (!config.skipDeterministicCheck)` block |
| 03.1#1 | `clean: true` collides with subpath checkout | Already resolved in 03.1 (commit `98b8efc`) | No action |
| 03.1#2 | `gemini-2.5-pro` not free-tier | Already resolved in fixture; CLAUDE.md still lists pro as default | DOC update — note in CLAUDE.md and Phase 06 README that flash is recommended for free-tier consumers |
| 03.1#3 | fix-applier `git add -A` scope leak | Already resolved (commit `cccef3c` — `--3way --index`) | No action |
| 03.1#4 | fix-applier no-force push | Already resolved (`--force` per `fix-applier.ts:133`) | No action |
| 03.1#5 | `--3way` fetch-depth warning | Open — non-fatal | Defer to 04.x gap-closure if it bites; Phase 04 plan ignores |
| 03.1#6 | `--force-with-lease` stale-info on shallow clones | Resolved by switching to `--force` (#4) | No action |

**Net:** Phase 04 only needs to address WR-02 and WR-03 (both small fixes, both naturally co-located with the skip-flag default flip).

## Code Examples

### Operation 1: Auto-dispatch invocation from ingest

```typescript
// src/ingest/index.ts — Step 9 (NEW, after writeDetectionSummary)
// Source: built from primary docs (createWorkflowDispatch + Octokit patterns)
import { fireDispatch } from './dispatch.js';
import { classifyFixClass } from './classifier.js';
import { countHealsForTest } from '../shared/loop-guard.js';

if (config.enableAutoDispatch) {
  for (const detection of detections) {
    // D-04: pre-dispatch heal-cap query
    const healCount = await countHealsForTest(
      detection.testId,
      config.flakeWindowDays,
      worktreePath,
    );
    if (healCount >= config.maxHealsPerTestPerWeek) {
      core.warning(
        `playwright-healer: heal cap reached for "${detection.testId}" ` +
        `(${healCount} >= ${config.maxHealsPerTestPerWeek}) — manual review required`,
      );
      continue;
    }

    // FIX-07: classify error → fix-class hint
    const sampleEntry = /* lookup latest entry for testId in windowRecords */;
    const fixClassHint = classifyFixClass(sampleEntry?.errorSignature ?? '');

    // CFG-04: skip dispatch if class disabled
    const enabledFor: Record<typeof fixClassHint, boolean> = {
      selectors: config.enableSelectorFixes,
      waits:     config.enableWaitFixes,
      assertions: config.enableAssertionFixes,
      slow:      config.enableSlowFixes,
    };
    if (!enabledFor[fixClassHint]) {
      core.warning(`playwright-healer: ${fixClassHint} fix class disabled — skipping dispatch for ${detection.testId}`);
      continue;
    }

    await fireDispatch({
      patToken: config.healerToken,
      owner: github.context.repo.owner,
      repo:  github.context.repo.repo,
      workflowFile: 'playwright-healer.yml',  // could be a config input later
      ref: process.env.GITHUB_REF_NAME ?? 'main',
      detection,
      commitSha: github.context.sha,
      fixClassHint,
      recentRunStatsJson: JSON.stringify({
        flakeRate: detection.value,
        windowDays: detection.windowDays,
        runCount: detection.runCount,
      }),
    });
  }
}
```

### Operation 2: PR dedup before create

```typescript
// src/healer/pr-writer.ts (modified — replace existing pulls.create call)
export async function openHealerPr(args: OpenHealerPrArgs): Promise<string> {
  const octokit = new Octokit({ auth: args.patToken });
  const title = `[playwright-healer] Fix flaky ${args.testTitle}`;
  const body  = renderPrBody(args);

  // PRI-04 dedup
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
  const { data: pr } = await octokit.rest.pulls.create({
    owner: args.owner, repo: args.repo,
    title, head: args.branch, base: args.defaultBranch, body,
  });
  await core.summary
    .addRaw(`## Healer PR opened\n\n[${title}](${pr.html_url})\n\n${body}`).write();
  return pr.html_url;
}
```

### Operation 3: Healer-side Guard 3 (SEC-05 backstop)

```typescript
// src/shared/loop-guard.ts (NEW function, sibling of shouldSkipIngest)
import * as fs from 'fs';
import * as path from 'path';

/**
 * Returns the count of heal events for a given testId within the rolling window.
 * Reads runs/YYYY/MM/DD-heals.ndjson on the state branch. NEW in Phase 04.
 *
 * Heal events are written by pr-writer.ts (outcome: 'pr-opened') and
 * issue-writer.ts (outcome: 'issue-opened'). cap-reached is recorded by
 * the dispatch gate itself and counts toward the cap.
 */
export async function countHealsForTest(
  testId: string,
  windowDays: number,
  worktreePath: string,
): Promise<number> {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  let count = 0;
  for (let daysBack = 0; daysBack <= windowDays; daysBack++) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - daysBack);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const filePath = path.join(worktreePath, 'runs', String(y), m, `${day}-heals.ndjson`);
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)) {
      try {
        const ev = JSON.parse(line) as { testId: string; timestamp: string };
        if (ev.testId === testId && new Date(ev.timestamp).getTime() >= cutoff) count += 1;
      } catch { /* skip malformed */ }
    }
  }
  return count;
}

/**
 * Healer-side SEC-05 Guard 3 backstop. Called from src/healer/index.ts before
 * the agent runs (after Step 1 payload validation, before Step 2 adapter select).
 * Files an issue with failureMode='cap-exceeded' if the cap is hit.
 */
export async function shouldSkipHeal(
  testId: string,
  config: { maxHealsPerTestPerWeek: number; flakeWindowDays: number },
  worktreePath: string,
): Promise<{ skip: boolean; count: number }> {
  const count = await countHealsForTest(testId, config.flakeWindowDays, worktreePath);
  return { skip: count >= config.maxHealsPerTestPerWeek, count };
}
```

(Note: `FailureMode` enum needs a 7th token `'cap-exceeded'` — small addition to `src/healer/types.ts`. The existing 6 tokens are LOCKED per D-09; widening is consistent with that decision.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `workflow_dispatch` capped at 10 inputs | 25 inputs | Dec 2025 (`github.blog/changelog/2025-12-04`) | We have plenty of headroom — `DispatchPayload` uses 5 inputs; a future `concurrencyKey` 6th still fits |
| `actions/checkout@v4` | `actions/checkout@v6.0.2` (SHA `de0fac2e...`) | Already pinned in `e2e-heal-self.yml:47` | No change for Phase 04 |
| `--force-with-lease` for healer branch push | Plain `--force` (bot-exclusive namespace) | 03.1 (`fix-applier.ts:122-126`) | No change for Phase 04; preserve the choice and the rationale comment |
| Action input names kebab-case | snake_case (`api_key`, `enable_auto_dispatch`, etc.) | commit `63646d3` | All new inputs follow snake_case; CONTEXT.md `<code_context>` is stale on this |

**Deprecated/outdated:**
- The 10-input `workflow_dispatch` cap referenced in `dispatch-payload.ts` comments — informational only; Phase 04 doesn't approach that limit.

## Diff-Lint Compatibility Verification (empirical)

CONTEXT specifics line 116 asks: "PLAN.md should include a 're-run the 03.1 demo with full gates on' verification before declaring Phase 04 complete." That's a verification step, but the **research-time** question is: does diff-lint pass on representative outputs of all four classes?

**Tested empirically** (this research session) using `lintDiff()` against four diffs:

| Diff | Findings | Verdict |
|------|----------|---------|
| The actual 03.1 PR diff (`#wrong-id` → `getByRole('button', {name:'Submit'})`) | `[]` | PASS — selector heal compatible with full gates |
| Assertions-class sample (`expect(...).toBe(1)` → `await expect(...).toHaveText('1')`) | `[]` | PASS — strengthening assertions passes |
| Slow-class sample (removing `await page.waitForTimeout(5000)`, replacing with `await expect(...).toBeVisible()`) | `[]` | PASS — `waitForTimeout` only flagged when **added** (lines starting with `+`); removed lines don't trigger the pattern |
| Weakening sample (`toBe(42)` → `toBeTruthy()`) | `[ASSERTION_WEAKENING_PAIRS match]` | CORRECTLY FAILS — exactly what the gate is supposed to catch |

**Conclusion:** Re-engaging diff-lint in Phase 04 is safe across all four classes. The 03.1 demo's selector heal would have passed diff-lint cleanly; the skip-flag was a conservative-default for the bottleneck demo, not a workaround for a real issue.

(The post-fix-validation gate's compatibility is a runtime question — fixture-ci.yml passing is empirical evidence that the fix is correct, but the local validator runs Playwright with `--retries=0 --workers=1` against the consumer's start-command app instance. If that environment differs from CI, the validator may be too strict. Treat this as a deferred Phase 04 risk — verify by running `e2e-heal-self.yml` with `skip_post_fix_validation: 'false'` and confirming the heal still lands the PR.)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The healer-side Guard 3 (per-test heal cap) does not yet exist; Phase 04 implements it for the first time | Pitfall 6, Code Examples §3 | If Guard 3 actually exists and was missed in grep, Phase 04 plans add a redundant check — wasteful but not harmful. **Verified by `grep -rn 'maxHealsPerTestPerWeek\|Guard 3' src/`** — only config + test fixture references found. [VERIFIED] not [ASSUMED]. |
| A2 | State branch records do not currently track per-test heal counts; Phase 04 needs a new `runs/YYYY/MM/DD-heals.ndjson` schema | Pitfall 7 | If a planner picks the "approximate from `[skip-healer]` commits" alternative instead, no risk — both paths satisfy D-04. The new schema is the cleaner answer but option (1) is acceptable. |
| A3 | GitHub does not document a concurrency-group name length cap | Pattern 2 | If a cap exists at e.g. 255 chars and emerges in production, the slug+hash recipe in this research already keeps the group under ~250 chars. Robust. [VERIFIED via 3 doc fetches + community search — no cap documented anywhere] |
| A4 | The classifier rules (errorSignature → fixClassHint) cover the four v1 classes deterministically | FIX-07 Architecture | If a class of error message doesn't match any rule, the fallback is `selectors` — the most common class. Worst case: agent emits `no-fix-proposable` and the heal routes to issue-fallback. Acceptable degradation. [ASSUMED — no production evidence base for assertions/slow] |
| A5 | Octokit `pulls.list({ head: 'owner:branch' })` returns 0 or 1 result for a deterministic healer-branch name | Pattern 3 | If somehow two open PRs exist (e.g., bot was double-dispatched and the second won the race despite concurrency group), dedup picks `prs[0]` — comment lands on whichever GitHub returns first, which is fine. |
| A6 | Octokit Search API rate limit (30 req/min authenticated) is comfortably above realistic dedup-call throughput | Pattern 4, Pitfall 4 | Each heal makes ≤1 search call. 30 heals/min would saturate; realistic threshold-detection cadence is ≤1/hour per repo. No risk. [CITED: docs.github.com/en/rest/rate-limit] |
| A7 | The classifier's substring rules handle Playwright's i18n / version-evolved error messages | FIX-07 Architecture | Playwright's error messages are the de-facto API and have been stable across recent versions. Verifying against `@playwright/test` 1.60.x release notes is a Phase 04 sanity check, not a research blocker. [ASSUMED] |
| A8 | All four CFG-04 toggles default `'true'` (per REQUIREMENTS) is the right default-on policy post-03.1 | CFG-04 Default-On Policy | The recommendation defends default-true on the basis that diff-lint is the safety net and consumers can per-class opt out. If a class consistently produces broken patches in early adoption, flip its default to `'false'` in a 04.x patch — no architectural change. |

**Items needing user confirmation before execution:** A4, A7, A8 are `[ASSUMED]`. A1, A2, A3, A5, A6 are verified. A4 + A7 (classifier reliability) and A8 (default-on policy) are the discretion-area decisions CONTEXT explicitly invites — flag them in PLAN.md so the planner can surface them in plan-check.

## Open Questions

1. **Heal-event schema vs `[skip-healer]` commit count for D-04 cap query (Pitfall 7)** — option (2) (new NDJSON schema) is recommended; option (1) (count `[skip-healer]` commits) is acceptable. Planner picks one; lock the choice in PLAN.md.
   - What we know: Both satisfy D-04's intent.
   - What's unclear: Whether an OBS-01 v2 cost dashboard would prefer option (2)'s richer event log.
   - Recommendation: Option (2). Small one-time addition; future-proof.

2. **Workflow file name for dispatch** — DET-05 says "default `.github/workflows/playwright-healer.yml`". Should that be a `healer_workflow_file` action input (configurable) or hard-coded?
   - What we know: Hard-coded matches REQUIREMENTS phrasing.
   - What's unclear: Whether multi-workflow consumers (e.g., separate per-environment heal workflows) need to override.
   - Recommendation: Make it a config input (`healer_workflow_file`, default `'playwright-healer.yml'`). One-line cost; makes the action more reusable.

3. **`recentRunStats` payload encoding** — JSON-encoded into a single dispatch input, or expanded to 3 separate inputs (`flakeRate`, `windowDays`, `runCount`)?
   - What we know: Either fits the 25-input cap.
   - What's unclear: Whether keeping `recentRunStats` as a Zod-validated nested object on the receive side (current shape in `dispatch-payload.ts:17`) is friction-worth-it.
   - Recommendation: 3 separate inputs. Keeps Zod schema flat; receive-side `JSON.parse` is one less failure mode. Update `DispatchPayload` accordingly.

4. **Diff-lint re-engagement default flip — opt-in or opt-out?** — Phase 04 turns `skipDiffLint` default from `'true'` (demo) to `'false'` (production). But does the demo workflow `e2e-heal-self.yml` need to keep it on?
   - What we know: `e2e-heal-self.yml:141` explicitly sets `skip_diff_lint: 'false'` — the diff-lint is already enabled in the e2e workflow.
   - What's unclear: Whether the project default change is purely cosmetic since the demo already opts in.
   - Recommendation: Flip the default. The demo's explicit `skip_diff_lint: 'false'` becomes redundant (harmless) and any new consumer gets the safe default.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@octokit/rest` | DET-05/06, PRI-04 | ✓ | 22.0.1 | — |
| `@actions/core` | core.warning, core.summary, getInput | ✓ | 3.0.1 (pinned) | — |
| `@actions/github` | github.context.payload | ✓ | (peer of @actions/core) | — |
| `zod` | DispatchPayload widening | ✓ | 4.3.6 | — |
| `node:crypto` | concurrency key SHA-1 | ✓ | (Node stdlib) | — |
| GitHub Actions runner with `actions: write` | dispatch the healer workflow via PAT | ✓ (consumer-provided) | — | — |
| `healer-token` PAT with `repo` scope | createWorkflowDispatch | ✓ (consumer-provided, already required) | — | — |

No missing dependencies. No fallback paths needed.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (already in stack — 259 tests pass post-03.1) |
| Config file | `vitest.config.ts` (or implicit defaults; verified by `npx vitest run` working) |
| Quick run command | `./node_modules/.bin/vitest run --reporter=dot src/ingest/dispatch.test.ts src/ingest/classifier.test.ts src/healer/pr-writer.test.ts src/healer/issue-writer.test.ts` |
| Full suite command | `./node_modules/.bin/vitest run` (current count: 259, expected: ≥ 280 post-Phase 04) |
| Phase gate | `./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit` green; `e2e-heal-self.yml` dispatch with all skip flags `false` lands a PR |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DET-05 | Threshold breach with `enable_auto_dispatch: true` calls `octokit.actions.createWorkflowDispatch` once with the correct payload | unit | `./node_modules/.bin/vitest run src/ingest/dispatch.test.ts -t "DET-05"` | ❌ Wave 0 |
| DET-05 | Empty detections → 0 dispatch calls | unit | `./node_modules/.bin/vitest run src/ingest/dispatch.test.ts -t "no-detections"` | ❌ Wave 0 |
| DET-05 | `enable_auto_dispatch: false` → 0 dispatch calls regardless of detections | unit | `./node_modules/.bin/vitest run src/ingest/dispatch.test.ts -t "flag-off"` | ❌ Wave 0 |
| DET-06 | `createWorkflowDispatch` is called with `auth: healerToken`, NOT githubToken | unit | (same file as DET-05; assertion on Octokit constructor mock) | ❌ Wave 0 |
| DET-07 | Concurrency key is deterministic for same `(testFile, testTitle)`; differs when either changes | unit | `./node_modules/.bin/vitest run src/ingest/dispatch.test.ts -t "concurrency-key"` | ❌ Wave 0 |
| DET-07 | Generated key is ≤ 250 chars even for pathological-length inputs | unit | (same file; property test with worst-case inputs) | ❌ Wave 0 |
| DET-07 (e2e) | Two simultaneous dispatches for same test → only one heal runs (concurrency block evaluates) | manual / e2e | `gh workflow run e2e-heal-self.yml` × 2 in rapid succession; verify `gh run list` shows queued, not parallel | manual-only (requires GitHub Actions to evaluate concurrency) |
| FIX-07 | Each of 4 classes routes to its prompt template | unit | `./node_modules/.bin/vitest run src/healer/prompt-assembler.test.ts -t "FIX-07"` | partial (test file exists; new cases) |
| FIX-07 | Classifier maps each error-signature shape to expected class | unit | `./node_modules/.bin/vitest run src/ingest/classifier.test.ts` | ❌ Wave 0 |
| FIX-07 | LLM proposal `fixClass: 'assertions'` overrides `fixClassHint: 'selectors'` correctly | unit | `./node_modules/.bin/vitest run src/healer/index.test.ts -t "fixClass-override"` | partial (extend existing) |
| FIX-07 | Disabled class (`enable_assertion_fixes: false`) suppresses dispatch | unit | (in dispatch.test.ts) | ❌ Wave 0 |
| FIX-07 (e2e) | Fixture test with assertion-class root cause produces a PR with `fixClass: 'assertions'` | manual / e2e | New fixture file in `fixture/tests/broken-assertion.spec.ts`; new dispatch flag in e2e workflow | manual-only |
| PRI-04 | `pulls.list({ head: 'owner:branch' })` returns existing → comment, no create | unit | `./node_modules/.bin/vitest run src/healer/pr-writer.test.ts -t "PRI-04 dedup"` | partial (extend) |
| PRI-04 | No existing PR → create as before | unit | (same file; existing test stays green) | partial (regression check) |
| PRI-04 | Closed-merged PR ignored; new PR created | unit | (same file) | partial |
| PRI-04 | Existing open issue → comment, no create | unit | `./node_modules/.bin/vitest run src/healer/issue-writer.test.ts -t "PRI-04 dedup"` | partial |
| SEC-05 (Guard 3) | `countHealsForTest` returns correct count from `runs/.../DD-heals.ndjson` | unit | `./node_modules/.bin/vitest run src/shared/loop-guard.test.ts -t "Guard 3"` | partial (extend) |
| SEC-05 (Guard 3) | Healer-side `shouldSkipHeal` files cap-exceeded issue and exits | unit | `./node_modules/.bin/vitest run src/healer/index.test.ts -t "cap-exceeded"` | ❌ Wave 0 |
| WR-01 (verify) | No `git config --global` regression in action.yml or any source | static / lint | `! grep -rn 'git config --global' action.yml src/` (negative grep in security-lint.yml) | partial (security-lint extension) |

### Sampling Rate

- **Per task commit:** `./node_modules/.bin/vitest run --reporter=dot --pool=forks` (touched files only via vitest's auto-detect)
- **Per wave merge:** `./node_modules/.bin/vitest run` full suite + `npx tsc --noEmit`
- **Phase gate:** Full suite green AND `e2e-heal-self.yml` run on a fresh dispatch with all skip flags `false` AND `gh workflow run` produces a PR matching the title pattern AND fixture-ci.yml passes on that PR.

### Wave 0 Gaps

- [ ] `src/ingest/dispatch.ts` + `src/ingest/dispatch.test.ts` — DET-05/06/07 unit coverage
- [ ] `src/ingest/classifier.ts` + `src/ingest/classifier.test.ts` — FIX-07 errorSignature → fixClassHint mapping
- [ ] `src/healer/prompts/assertions-no-trace.md` + `assertions-with-trace.md` + `slow-no-trace.md` + `slow-with-trace.md` — FIX-07 templates
- [ ] `src/shared/loop-guard.test.ts` — extend existing tests for `countHealsForTest` + `shouldSkipHeal`
- [ ] `fixture/tests/broken-assertion.spec.ts` — new fixture for the e2e assertion-class verification
- [ ] `e2e-heal-self.yml` extension — second job for assertion-class fixture (or a separate workflow file)
- [ ] Security-lint extension — grep for `git config --global` regression (WR-01 verify)

*(All other tests are extensions of existing files — no framework-install needed.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `healer_token` PAT for dispatch (DET-06) and PR/issue dedup (PRI-04). Already registered with `core.setSecret` at startup; pattern unchanged from Phase 03. |
| V3 Session Management | no | Stateless action invocation. |
| V4 Access Control | yes | Dispatch fires only when `enable_auto_dispatch === true` AND heal-cap not hit AND fix-class enabled. Three explicit gates. |
| V5 Input Validation | yes | `DispatchPayload` Zod schema widens but stays strict. Classifier's `errorSignature` input is treated as untrusted (regex-only, never `eval`). |
| V6 Cryptography | minimal | `crypto.createHash('sha1')` for concurrency-key uniqueness — collision-resistance only, not a cryptographic primitive. SHA-1 is acceptable here (non-security context). |

### Known Threat Patterns for {action / Octokit / GitHub Actions}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Workflow-dispatch loop (heal triggers ingest triggers heal) | Repudiation / DoS | SEC-05 Guards 0/1/2 (existing) + Guard 3 (NEW Phase 04). Bot-author + `[skip-healer]` sentinel + per-test cap break the loop at three layers. |
| PAT exfiltration via runner workspace gitconfig | Information Disclosure | WR-01 mitigation already in place — `git -c http.extraheader` per-invocation, no `~/.gitconfig` writes. Phase 04 adds a security-lint regression check. |
| Dispatch payload injection (consumer fork submits crafted payload) | Tampering | `DispatchPayload` Zod schema rejects malformed inputs at parse time; SEC-05 Guard 0 (`fork === true`) suppresses ingest entirely on fork PRs. |
| Untrusted error-signature passed to classifier | Tampering | Classifier uses regex `.test()` only — no string interpolation, no `eval`. Worst case: misclassification → no-fix-proposable. |
| Title-pattern injection in issue dedup | Tampering | Search query is parameterized via Octokit; the testTitle is treated as a literal string within the `q:` query. Octokit handles escaping. |
| Concurrency-key DoS (attacker makes group names collide) | DoS | Hash component (SHA-1 of canonical id) makes collision intentional; consumer must control the test ID, which they already do. No new attack surface. |

## Sources

### Primary (HIGH confidence)

- `docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event` — workflow_dispatch endpoint params, scope requirement
- `docs.github.com/en/rest/pulls/pulls#list-pull-requests` — `head: 'user:ref-name'` filter format
- `docs.github.com/en/rest/rate-limit` — Search API 30 req/min
- `docs.github.com/en/actions/using-jobs/using-concurrency` — concurrency group case-insensitivity, no documented length cap
- `docs.github.com/en/actions/reference/limits` — workflow / job limits (no string-length limits documented)
- `github.blog/changelog/2025-12-04-actions-workflow-dispatch-workflows-now-support-25-inputs` — input cap raised from 10 to 25
- `octokit.github.io/rest.js/v22` — Octokit API surface for v22.0.1 (matches installed version)
- Codebase reads: `src/healer/index.ts`, `src/healer/dispatch-payload.ts`, `src/healer/pr-writer.ts`, `src/healer/issue-writer.ts`, `src/healer/diff-lint.ts`, `src/healer/forbidden-patterns.ts`, `src/healer/fix-applier.ts`, `src/ingest/index.ts`, `src/ingest/threshold-evaluator.ts`, `src/ingest/summary-writer.ts`, `src/shared/loop-guard.ts`, `src/shared/state-branch.ts`, `src/shared/config.ts`, `src/healer/adapters/github.ts`, `action.yml`, `.github/workflows/e2e-heal-self.yml`
- Empirical: `lintDiff()` runs against the 03.1 PR diff + 3 representative class diffs (this research session)

### Secondary (MEDIUM confidence)

- `github.com/orgs/community/discussions/120093` — workflow_dispatch input length 1024 chars (community discussion, not official docs)
- `github.com/actions/runner/issues/1425` — historical context on the 10-input cap
- `bytegoblin.io` blog on workarounds — illustrative only, not authoritative

### Tertiary (LOW confidence)

- None — every claim used is verified against either primary docs or the codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library is already in the stack at a verified version
- Architecture: HIGH — wiring extends existing patterns; no new architectural surface
- Pitfalls: HIGH — pitfalls 1-5 verified from primary docs; pitfalls 6-9 verified by codebase reads (state of source files at HEAD)
- FIX-07 prompt design: MEDIUM — no production evidence base for assertions/slow classes; classifier rules need empirical tuning post-Phase 04
- CFG-04 default-on policy: MEDIUM — recommendation rests on diff-lint as safety net; first real-world evidence comes from Phase 04 itself

**Research date:** 2026-05-01
**Valid until:** 2026-05-31 (30 days for stable APIs); shorter if Octokit 23.x ships with breaking changes to `actions.createWorkflowDispatch` (no rumored deprecation as of research date).
