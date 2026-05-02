# Phase 5: Auto-Merge - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 adds opt-in auto-merge for high-confidence healer PRs to the v1 pipeline. When a consumer sets `enable_auto_merge: true` in `action.yml` inputs (or via `.github/playwright-healer.yml`), eligible PRs invoke GitHub's native auto-merge (`enablePullRequestAutoMerge` GraphQL mutation, squash strategy) so GitHub merges them once required CI checks pass.

A PR is eligible only when ALL of the following conditions hold (MRG-02):
1. `validation.passRate >= auto_merge_pass_rate` (default 1.0 = 10/10)
2. `proposal.fixClass` is in the `auto_merge_fix_classes` allow-list (default `'selectors'`)
3. The diff touches only paths matched by the FIX-06 `TEST_PATH_ALLOWLIST` AND none of the patched files match the new auto-merge-only config-file denylist

When auto-merge is disabled (default) or any condition fails, the PR opens normally for human review. The MRG-04 reasoning band — a step-summary table showing each condition + `matched`/`blocked by X` — renders on every heal that opens a PR, regardless of `enable_auto_merge` value, so consumers get a uniform decision audit.

Within scope: three new action inputs (`enable_auto_merge`, `auto_merge_pass_rate`, `auto_merge_fix_classes`), the eligibility evaluator, the GraphQL call, the soft-fail path on prereq mismatch, the reasoning-band renderer, and a minimal README "auto-merge prerequisites" stub.

Outside scope: app-code fix capability (deferred — see `<deferred>`), runtime probe of branch-protection settings (consumer's responsibility per MRG-03), full README/example-workflow polish (Phase 06), v2 trace-aware confidence bands (REQUIREMENTS TRC-03, deferred).

</domain>

<decisions>
## Implementation Decisions

### Inputs and config (Phase 04 D-01 pattern carried forward)

- **D-01: Three new `action.yml` inputs, all snake_case, all string-with-Zod-transform**
  - `enable_auto_merge` — `z.string().default('false').transform(v => v === 'true')` (matches Phase 04 `enable_auto_dispatch` exactly; default-OFF safe-default per MRG-01)
  - `auto_merge_pass_rate` — `z.coerce.number().min(0).max(1).default(1.0)` (separate from `rerun_pass_rate` 0.9; MRG-02 requires the stricter 1.0 default)
  - `auto_merge_fix_classes` — `z.string().default('selectors')` parsed downstream into `string[]` via comma-split + trim (matches the existing `enable_*_fixes` per-class pattern; YAML-array form via `.github/playwright-healer.yml` works through CFG-06's existing merger)
  - `INPUT_*` env-var names use the Phase 01.2-validated hyphen convention (`INPUT_ENABLE_AUTO_MERGE`, etc.). Researcher to confirm @actions/core hyphen behavior is unchanged for snake_case inputs.

### Scope policy (MRG-02 condition 3)

- **D-02: Auto-merge restates the FIX-06 `TEST_PATH_ALLOWLIST` at decision time as defense-in-depth**
  Same regexes from `src/healer/forbidden-patterns.ts` (`/(?:^|\/)tests\//`, `/(?:^|\/)e2e\//`, `/(?:^|\/)playwright\//`) are re-evaluated by the auto-merge gate. By the time a PR exists, FIX-06 has already blocked any path outside this list — so this gate always passes in practice for a healthy diff-lint pipeline. The point is **explicit reasoning-band rendering** (MRG-04 demands every condition surface): the band renders `scope: matched (tests/, e2e/, playwright/)` rather than implicitly assuming diff-lint already covered it. Mirrors Phase 04 D-04 SEC-05 cap pattern (checked at ingest AND healer).

- **D-03: Auto-merge adds a SECOND, stricter overlay denylist for config files**
  `playwright.config.*`, `*.config.ts`, `*.config.js`, `*.config.mjs` — match anywhere in the patched file path. A diff to `playwright/playwright.config.ts` or `e2e/utils.config.ts` passes FIX-06 (path segment matches `playwright/` or `e2e/`) but FAILS the auto-merge config-file denylist. Reasoning band renders `blocked by: configuration file change (playwright.config.ts)`. PR still opens for human review — only the auto-merge enable is suppressed. **Diff-lint stays unchanged** so the D-17 single-source-of-truth contract for `forbidden-patterns.ts` is preserved; the denylist lives next to the auto-merge gate, not in `forbidden-patterns.ts`.

### Code location

- **D-04: Auto-merge gate code extends `src/healer/pr-writer.ts`, no new module**
  `pr-writer.ts` already mixes Octokit calls, summary writes, and the PRI-04 dedup branch — the auto-merge gate is conceptually "post-create PR steering" and belongs in the same lifecycle. Concretely: after `pulls.create` returns the PR URL (and on the no-existing-PR branch only — see D-08 below for dedup interaction), `openHealerPr` calls a new private helper `evaluateAutoMerge(args): AutoMergeDecision` (pure function returning `{ eligible: boolean, conditions: Array<{ name, result, reason }> }`) and, when `eligible: true` AND `args.config.enableAutoMerge === true`, calls `enableAutoMerge(prNodeId, octokit)` (Octokit GraphQL). Both helpers live in `pr-writer.ts`. `src/healer/index.ts` step 11 stays untouched.

### Failure-mode handling (MRG-03)

- **D-05: Soft-fail on `enablePullRequestAutoMerge` GraphQL error — warn, render, leave PR open, exit 0**
  GitHub returns specific GraphQL errors when prereqs are missing (no branch protection rule on default branch / no required status checks / merge queue setting mismatch / squash-merge disallowed by repo settings). The healer catches the GraphQL error, emits a `core.warning('Auto-merge enable failed: <github error message> — leaving PR open for review. See README §auto-merge-prerequisites.')` annotation, writes `auto_merge: blocked by: repo not configured for auto-merge — see README §auto-merge-prerequisites` to the MRG-04 reasoning band, and returns the PR URL normally. Heal exit code stays 0 — the heal succeeded; only the auto-merge upgrade failed. Matches the safe-default philosophy: review-requested PR is the always-acceptable v1 outcome.

- **D-06: NO runtime probe of repo branch-protection / required-status-checks before calling enableAutoMerge**
  Per REQUIREMENTS MRG-03 ("never merges without CI having passed") branch protection is a consumer prerequisite, not a runtime gate. The action does not call `octokit.rest.repos.getBranchProtection` defensively. Two reasons: (1) the GraphQL mutation itself surfaces actionable errors when prereqs are missing — a separate probe is redundant API spend; (2) probing requires an extra Octokit token scope (`repo` admin reads) that consumers may not have granted to `healer_token`. **Documented in README** as a hard prerequisite alongside the existing `healer_token` scope requirements (Phase 06 deliverable; Phase 05 ships the stub).

### Validation gate interaction (carried forward from Phase 03 + WR-02)

- **D-07: Auto-merge MUST treat `validation.total === 0` (skipped) as ineligible**
  Phase 03's WR-02 fix establishes that `total: 0` signals "post-fix validation was skipped" (demo mode, `skipPostFixValidation: true`). The auto-merge gate explicitly tests `validation.total > 0 && validation.passRate >= autoMergePassRate` — never `passRate >= threshold` alone. Reasoning band renders `pass_rate: blocked by: validation skipped (demo mode)` on the skip path. By construction, consumers running with `skipPostFixValidation=true` never auto-merge.

### Claude's Discretion

The user explicitly chose to leave these as Claude's-discretion decisions for downstream agents (researcher and planner). Reasonable defaults are documented below; researcher/planner SHOULD call out their final choice in `RESEARCH.md` / `PLAN.md` rather than leaving it implicit:

- **D-08: PRI-04 dedup × auto-merge interaction default — leave existing PR's auto-merge state untouched**
  When `findExistingOpenPr()` matches and the heal routes to comment-on-existing instead of create-new (Phase 04 PRI-04), the auto-merge gate is **NOT re-evaluated** for the existing PR. Auto-merge is a one-time decision at PR creation — the comment is new evidence for human review, not a trigger to flip merge eligibility. A comment never enables auto-merge that wasn't enabled at creation; a comment never disables auto-merge already enabled. Researcher should validate this is right; the alternative (re-evaluate on every comment) risks surprising reviewers who saw the PR in one state and find it merging itself after a comment lands.

- **D-09: Reasoning-band rendering** — table per condition with `condition | result | reason` columns (markdown). Pure function emits a `string[]` of band-line summaries from the `AutoMergeDecision` shape; `pr-writer.ts` joins them into the step summary with a `## Auto-merge decision` heading. Format is unspecified at this level; planner picks the exact column shape.

- **D-10: README §auto-merge-prerequisites scope split between Phase 5 and Phase 6**
  Phase 5 ships a MINIMAL stub — just enough for the soft-fail warning's "see README §auto-merge-prerequisites" link to resolve. Phase 6 (Documentation + Release) owns the full README + DOC-01..05 polish. The stub lists: (a) consumer must enable branch protection on default branch with at least one required status check, (b) `healer_token` PAT must have `repo` scope (already required), (c) repo settings must allow squash merging. Planner decides whether the stub lives in README.md or a separate `docs/auto-merge.md`.

- **D-11: Verification before declaring Phase 5 complete** — re-run the Phase 03.1 demo on `Sacharified/playwright-healer-test` with `enable_auto_merge: false` (default) to confirm zero behavioral change for default consumers; then re-run with `enable_auto_merge: true` against a fixture repo configured with branch protection to confirm the auto-merge happy path. Mirrors Phase 04's "re-run the 03.1 demo with full gates on" verification (`04-CONTEXT.md` <specifics>).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 5 scope and contracts

- `.planning/PROJECT.md` — Project core value; "Out of Scope" enumerates "Fixing application bugs (non-test code logic errors)" — preserved by Phase 5 (D-02/D-03 keep the test-paths-only invariant)
- `.planning/PROJECT.md` Key Decisions row 14 — "Auto-merge is opt-in per repo and per fix class; default is review-requested" (D-01 default-OFF derives from this)
- `.planning/REQUIREMENTS.md` — MRG-01 (opt-in, default false), MRG-02 (eligibility conditions), MRG-03 (`gh pr merge --auto --squash` Octokit equivalent), MRG-04 (reasoning band)
- `.planning/REQUIREMENTS.md` PRI-05 — Deterministic failure routing; auto-merge inherits this gate via the existing pipeline (no Phase 5 work needed, but constraint must not be regressed)
- `.planning/ROADMAP.md` §"Phase 5: Auto-Merge" — Goal + 4 success criteria

### Phase 04 inheritance and patterns

- `.planning/phases/04-auto-dispatch-full-fix-classes-deduplication/04-CONTEXT.md` — D-01 opt-in default-OFF boolean input pattern (Phase 5 D-01 mirrors this); D-04 defense-in-depth pattern (Phase 5 D-02 mirrors this); PRI-04 comment-only dedup behavior (Phase 5 D-08 inherits)
- `.planning/phases/03.1-first-heal-end-to-end-demo/03.1-REVIEW.md` — WR-02 (`passRate=1` sentinel misrender on `total=0`); Phase 5 D-07 inherits this constraint

### Existing source files Phase 5 will touch

- `src/healer/pr-writer.ts` — Extension point per D-04; auto-merge evaluator + GraphQL call land here. Existing `findExistingOpenPr` + `commentOnPr` + summary-write code stays unchanged on the dedup path
- `src/healer/forbidden-patterns.ts` — `TEST_PATH_ALLOWLIST` re-imported by the auto-merge gate (D-02); D-17 single source of truth preserved (Phase 5 does NOT extend this file with the config-file denylist — that lives next to the auto-merge gate)
- `src/healer/diff-lint.ts` — Already enforces `TEST_PATH_ALLOWLIST` at FIX-06; Phase 5 does NOT modify this file
- `src/healer/validator.ts` — `ValidationResult` interface (`passed`, `total`, `passRate`, `perRun`); auto-merge gate consumes this; D-07 enforces `total > 0` check
- `src/healer/index.ts` — Orchestrator; step 11 (`openHealerPr` call) is the only integration point. Phase 5 changes the implementation behind `openHealerPr`, not the call site.
- `src/shared/config.ts` — Zod schema; three new fields added (D-01). Existing Phase 04 `enableAutoDispatch` row is the canonical pattern to copy
- `action.yml` — Three new inputs (D-01) + corresponding `INPUT_*` env-var rows. Phase 01.2 hyphen convention applies

### Researcher must verify before planning

- **`healer_token` PAT scope coverage for `enablePullRequestAutoMerge` GraphQL mutation** — confirm the `repo` scope already required for PR creation also covers this mutation (likely yes, but unverified). Document in canonical refs if a finer scope (`merge_pull_request`?) is needed.
- **Octokit GraphQL syntax for `enablePullRequestAutoMerge`** — exact mutation shape (input variables: `pullRequestId`, `mergeMethod: SQUASH`, `commitHeadline?`, `commitBody?`); error-shape catalog so the soft-fail path (D-05) can render specific reasons (`PullRequestNotMergeable` vs `MergeQueueNotEnabled` vs etc.)
- **GitHub branch-protection prereq matrix** — exact set of repo settings that must hold for `enablePullRequestAutoMerge` to succeed (branch protection ON default branch / required status checks ≥ 1 / squash merging allowed / `Allow auto-merge` toggle on)

### Anti-patterns and CI lints

- `CLAUDE.md` §"Security non-negotiables" — `agent allowedTools` invariant. Phase 5 does NOT extend agent tools. Auto-merge runs entirely in the post-agent fix-applier/pr-writer layer.
- `CLAUDE.md` §"Fix application is outside the agent loop" — preserved by Phase 5 (auto-merge is fix-applier-side, not agent-side)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/healer/pr-writer.ts`** — Extension point for D-04. Already wires Octokit + summary writes + the PRI-04 dedup branch; auto-merge evaluator + GraphQL call drop in alongside `findExistingOpenPr` and `pulls.create`. Existing exports (`renderPrBody`, `openHealerPr`, `OpenHealerPrArgs`) are stable; auto-merge adds private helpers + extends `OpenHealerPrArgs` with `enableAutoMerge`, `autoMergePassRate`, `autoMergeFixClasses`.
- **`src/healer/forbidden-patterns.ts` `TEST_PATH_ALLOWLIST`** — Re-imported by the auto-merge gate. D-17 single source of truth preserved (no edits to this file for Phase 5).
- **`src/healer/validator.ts` `ValidationResult`** — `total > 0 && passRate >= threshold` is the canonical eligibility shape (D-07 inherits WR-02).
- **`src/shared/config.ts` Phase 04 `enableAutoDispatch` row (line 116)** — Exact template for D-01's three new boolean/number/string inputs with Zod transforms.
- **`@octokit/rest`** — Already a runtime dep (used in `pr-writer.ts:8`). The `graphql` method is available without adding `@octokit/graphql` separately.

### Established Patterns

- **Opt-in default-OFF boolean input via `z.string().default('false').transform(v => v === 'true')`** (Phase 04 D-01; Phase 5 D-01 mirrors)
- **Defense-in-depth across two layers** (Phase 04 D-04 SEC-05 cap pattern; Phase 5 D-02 mirrors for scope check)
- **D-17 single source of truth for path/forbidden patterns** — `forbidden-patterns.ts` is the only place the test-path regex lives; Phase 5 imports rather than duplicates
- **Pure-function evaluator + IO call site** — validator.ts (`validate()` returns `ValidationResult`, called from index.ts; pure result consumed by pr-writer.ts) is the precedent. Phase 5 follows: `evaluateAutoMerge(args): AutoMergeDecision` is pure; `enableAutoMerge(...)` is the IO call site
- **Soft-fail with structured warning + step summary** — `pr-writer.ts:104-109` (PRI-04 dedup query failure pattern) is the precedent for D-05's failure handling

### Integration Points

- `src/healer/pr-writer.ts:154` (post-`pulls.create`) — Auto-merge evaluator runs after the PR is created on the no-existing-PR branch only. On the dedup branch (line 138-151) the evaluator is skipped per D-08.
- `src/healer/pr-writer.ts:165` (existing `core.summary.addRaw('## Healer PR opened\n\n...')`) — Reasoning band appends here as a `## Auto-merge decision` section (always emitted when a PR opens, regardless of `enable_auto_merge` value, so MRG-04 condition surfacing is uniform)
- `src/shared/config.ts:121` (`.superRefine` block) — Phase 5 may add a refine: when `enableAutoMerge=true` AND `autoMergeFixClasses` is empty after parsing, fail Zod with a clear message (defensive against `auto_merge_fix_classes: ''` misconfig)
- `action.yml` env block — Three new `INPUT_*` rows after the Phase 04 `INPUT_ENABLE_AUTO_DISPATCH` group (lines 128-132 region)

</code_context>

<specifics>
## Specific Ideas

- **Verification path** (D-11): re-run the Phase 03.1 demo on `Sacharified/playwright-healer-test` with `enable_auto_merge: false` (default) to confirm zero behavioral change for default consumers; then run with `enable_auto_merge: true` against a fixture repo configured with branch protection to confirm the happy path. PLAN.md MUST include both runs as success-criteria gates before declaring Phase 5 complete (mirrors Phase 04's "re-run the 03.1 demo with full gates on" pattern in `04-CONTEXT.md` <specifics>).

- **WR-02 carry-forward** (D-07): never auto-merge a heal where `validation.total === 0`. Phase 03.1 demo path (`skipPostFixValidation: true`) sets `total: 0` deliberately — auto-merge MUST exit ineligible on that path. The renderPrBody comment at `pr-writer.ts:32-39` is the canonical guidance.

- **Default `auto_merge_fix_classes='selectors'` is conservative and intentional**. Phase 04 added assertions/slow/waits as new fix classes but only selectors had a live demo (Phase 03.1 PR #1). Until Phase 06 ships demo evidence for the other three, conservative auto-merge keeps trust intact. Consumers extend the list at their own risk.

- **Reasoning band always renders, even when `enable_auto_merge: false`**. SC#1 requires that with `enable_auto_merge: false`, the action "never calls the merge API" — but the reasoning band is informational, not a merge call. Rendering it on every heal lets consumers see what the auto-merge decision WOULD have been before flipping the flag on, which is exactly the validation pattern Phase 04 D-01 used for `enable_auto_dispatch` (log-only first, live second).

</specifics>

<deferred>
## Deferred Ideas

- **Opt-in app-code fix capability** — Surfaced 2026-05-02 by user during Phase 5 discuss. Today the v1 contract scopes fixes to test code only (PROJECT.md "Out of Scope" + REQUIREMENTS PRI-05 + FIX-06 diff-lint + agent `allowedTools`). User's framing: "a test failure may be the result of application behaviour rather than a deficiency in the test, and the correct resolution would be to modify the application rather than the test", with consumer-configurable PR/issue routing. **Half is already shipped**: PRI-05 routes deterministic failures (0/N reruns pass) to issue-fallback with "probable application bug" classification. **Half is genuinely new scope**: an opt-in capability where the agent proposes app-code diffs (requires reopening agent allowedTools + FIX-06 diff-lint allowlist + introducing a new auto-merge fix class + likely a stricter validation/confidence gate). Treat as a candidate for Phase 5.x or v1.5 milestone, not Phase 5 scope.

- **Custom merge strategy per fix class** — Squash for selectors, merge-commit for slow-test optimizations, rebase for waits, etc. Speculative; squash-only matches MRG-03 phrasing exactly and squash gives the cleanest commit history for bot-authored PRs. Reconsider if a fix class produces logically grouped multi-commit branches.

- **Auto-merge re-evaluation on PRI-04 dedup re-triggers** — D-08 locks the default at "leave existing state untouched". Researcher may revisit if there's a strong argument for re-evaluating on each comment.

- **Runtime probe of required-status-checks list** — D-06 locks at "trust consumer per MRG-03". Revisit if consumers report unsafe instant-merges in production (i.e., `enableAutoMerge` succeeded on a repo with zero required checks and the PR merged before any CI ran).

- **Reference auto-merge run artifact** — Phase 03.1 PR #1 is the selectors-class demo reference; an analogous `enable_auto_merge: true` demo run on `Sacharified/playwright-healer-test` is a Phase 06 (release/docs) deliverable, not Phase 5.

- **v2 trace-aware confidence band** — REQUIREMENTS TRC-03 deferred to v2. v1 auto-merge uses the heuristic `passRate × fixClass × pathScope` band per MRG-02; trace-aware upgrade is post-v1.

- **Per-PR auto-merge override comment** — A reviewer commenting `/healer auto-merge` on an open healer PR triggering the enable mutation post-creation. Out of v1 scope; would need a webhook listener which the action doesn't have.

</deferred>

---

*Phase: 05-auto-merge*
*Context gathered: 2026-05-02*
