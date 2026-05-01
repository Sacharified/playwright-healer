# Phase 4: Auto-Dispatch + Full Fix Classes + Deduplication - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase flips the v0 observability layer (log-only threshold detection from Phase 02) into a live healing pipeline:

1. **Auto-dispatch (DET-05/06/07)** — When ingest detects a threshold breach, fire `workflow_dispatch` on the healer workflow using the `healer-token` PAT, with a concurrency group preventing simultaneous heals on the same test.
2. **Full fix classes (FIX-07)** — Extend the agent prompt structure beyond Phase 03's selectors+waits to also handle assertions and slow-test optimizations. Each class is independently toggleable via CFG-04.
3. **Deduplication (PRI-04)** — When a re-trigger fires for a test that already has an open healer PR or issue, comment on the existing item rather than creating a duplicate.

Within scope: live dispatch wiring, assertions+slow prompts, dedup query against the GitHub API, re-enabling the diff-lint gate that 03.1 skipped (now load-bearing because non-selector fix classes have real anti-pattern surface).

Outside scope: auto-merge (Phase 05), README/release (Phase 06), provider expansion beyond what Phase 03 already supports, fix-class additions beyond the v1 four (logic-bug fixes are explicitly out of scope per PROJECT.md).

</domain>

<decisions>
## Implementation Decisions

### Auto-Dispatch Enablement

- **D-01: Opt-in via `enable-auto-dispatch` boolean input (default `'false'`)**
  Consumers explicitly flip live dispatch on after watching the log-only summary across a few runs. This matches MRG-01's safe-default philosophy from REQUIREMENTS ("auto-merge is opt-in; default review-requested") and lowers blast radius when a consumer's threshold is misconfigured. Log-only stays as the v0 default — DET-04 already shipped that surface in Phase 02.

- **D-02: New boolean input, not an extension of the `mode` enum**
  Add `enable-auto-dispatch` alongside the existing `mode: ingest | heal | dry-run`. Ingest-mode reads the flag and decides whether to fire `workflow_dispatch`. The two-workflow architecture (PROJECT.md key decision: ingest in main CI, heal dispatched separately) stays intact — `mode: heal` semantics are preserved for the dispatched run.

- **D-03: Concurrency group = `playwright-healer-${{ github.repository }}-${{ test_file }}-${{ test_title }}`**
  Matches DET-07's exact phrasing ("concurrency group keyed on test file + test title"). Slug both `test_file` and `test_title` (replace path separators, lowercase, truncate at a sane length — researcher to determine whether GitHub's group-name length cap forces a hash fallback). The healer workflow declares this group with `cancel-in-progress: false` (queue, don't cancel — we want both runs' detection evidence preserved if they raced).

- **D-04: SEC-05 heal-cap check happens at dispatch time (state-branch query) AND inside the healer (defense-in-depth)**
  Ingest queries the state branch for the per-test heal count over the rolling `flake-window-days` window before firing dispatch. If the count is at or above `max-heals-per-test-per-week` (default 3), no dispatch fires and a `::warning::` annotation surfaces "heal cap reached for {test} — manual review required." Healer's existing SEC-05 check from Phase 02 stays in place as backstop. Saves a workflow run + agent setup on the cap-already-hit path; backstop ensures the invariant holds even if ingest path drifts.

### Claude's Discretion

The user explicitly chose to let downstream agents decide on these areas based on REQUIREMENTS + the open backlog. Researcher and planner have latitude here, but should explicitly call out their choices in RESEARCH.md / PLAN.md so they're reviewable rather than implicit:

- **PRI-04 dedup update behavior** — comment-on-existing vs force-update-the-healer-branch vs hybrid (comment if PR is open and human-reviewed, force-update if untouched). Closed/merged PRs and issues need a separate routing rule. REQUIREMENTS PRI-04 phrasing leans toward "add a comment with new evidence" — researcher should validate that's the right behavior across all four classes (a force-update on an old healer PR rebases the prior fix away, which may surprise reviewers).

- **FIX-07 prompt structure** — single unified system prompt with class branches vs class-specific prompt files assembled per dispatch. Phase 03's prompt-assembler at `src/healer/prompt-assembler.ts` is the extension point. Researcher to determine whether the LLM picks the class as its first turn or whether ingest-side parser provides a class hint (look at error message shapes — `expect(...).toBe(...)` failures are obviously assertions; `Test timeout` is obviously slow; the parser already extracts these into `NdjsonTestEntry`).

- **CFG-04 default-on policy** — REQUIREMENTS says all four toggles default `true`. Researcher should confirm that's still right post-03.1 evidence (Gemini handled selectors well; can it handle the other three? If confidence is low for one, default it off and document a one-line opt-in).

- **Hardening backlog routing** — The 9 items from 03.1 (3 code-review warnings + 6 PROJECT.md notes) need a home. Default routing: WR-01 (gitconfig PAT leak) is security-class and **must** ship inside Phase 04 plans; WR-02 (sentinel passRate=1 misrender) and WR-03 (unconditional validate before skip-flag check) ship alongside the post-fix-validation re-engagement (since 04 turns those skip flags off in non-demo paths); the 6 PROJECT.md items get triaged in PLAN.md — fold what's natural into the dispatch/dedup plans, defer the rest as 04.x gap-closure plans only if they're genuine blockers.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 04 scope and contracts
- `.planning/PROJECT.md` — Project core value, key decisions, current Phase 04 hardening backlog (last-updated paragraph)
- `.planning/REQUIREMENTS.md` — DET-05 (workflow_dispatch payload shape), DET-06 (PAT requirement), DET-07 (concurrency-group keying), FIX-07 (four fix classes), PRI-04 (dedup), SEC-05 (heal cap), CFG-04 (per-class toggles)
- `.planning/ROADMAP.md` §"Phase 4: Auto-Dispatch + Full Fix Classes + Deduplication" — Goal + 4 success criteria

### Phase 03 / 03.1 inheritance and lessons
- `.planning/phases/03.1-first-heal-end-to-end-demo/03.1-CONTEXT.md` — Demo decisions (skip flags, base-url interpolation, subpath-checkout fallback for cross-repo private actions)
- `.planning/phases/03.1-first-heal-end-to-end-demo/03.1-REVIEW.md` — 3 warnings (WR-01/WR-02/WR-03) and 3 info items the Phase 04 plans should triage
- `.planning/phases/03.1-first-heal-end-to-end-demo/03.1-VERIFICATION.md` — D-04 fallback evidence (subpath-checkout instead of `@main` ref)
- `.planning/phases/03-manual-healer-selectors-waits-issue-fallback/03-CONTEXT.md` — Manual-healer pipeline decisions; Phase 04 builds on these without re-litigating

### Phase 02 ingest/state-branch substrate (do not duplicate)
- `.planning/phases/02-ingest-state-branch-detection/02-RESEARCH.md` — 14 plan-ready patterns for state-branch concurrency, shard dedup, GC

### Existing source files Phase 04 will touch
- `src/ingest/threshold-evaluator.ts` — Pure detection function; Phase 04 adds dispatch wiring around it (comment at line 6 already says "DET-04: log-only in Phase 02 — no downstream dispatch")
- `src/ingest/summary-writer.ts` — Already foreshadows Phase 04 (line 20: "_Phase 04 enables auto-dispatch_")
- `src/ingest/index.ts` — Pipeline orchestrator; line 138 marks the DET-04 step that Phase 04 either replaces or augments
- `src/healer/dispatch-payload.ts` + `dispatch-payload.test.ts` — Zod schema for the `workflow_dispatch` payload; reused on the receive side
- `src/healer/pr-writer.ts` — PRI-04 dedup query lands here; the existing comment at line 3 already lists PRI-04 as Phase 04 work
- `src/healer/issue-writer.ts` — Mirror dedup logic; line 6 explicitly calls out "Phase 4 PRI-04 dedup will match against title + failure-mode token"
- `src/healer/index.ts` — Orchestrator. Phase 04 must un-skip diff-lint and post-fix-validation in non-demo paths (line 198 and 223-227 carry the 03.1 skip-flag gates)
- `src/healer/prompt-assembler.ts` + `src/healer/prompts/` — FIX-07 prompt structure decision lands here
- `src/shared/loop-guard.ts` — SEC-05 implementation (already shipped); Phase 04 reuses + adds an ingest-side query of the same per-test heal count
- `src/shared/state-branch.ts` — Read API for the heal-count query at dispatch time
- `action.yml` — `enable-auto-dispatch` input addition + dispatch step

### Anti-patterns and CI lints
- `CLAUDE.md` §"Security non-negotiables" — `persist-credentials: false`, `--allowed-origins`, allowed-tools list. Phase 04's diff-lint re-engagement enforces these on the new fix classes.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`dispatch-payload.ts`** — Zod schema for the workflow_dispatch JSON. Phase 04's ingest-side dispatcher serializes against this; healer-side already deserializes it.
- **`loop-guard.ts`** — `shouldSkipIngest()` already implements the SEC-05 per-test heal-count read. Ingest's pre-dispatch heal-cap check (D-04) extracts that read into a reusable helper or calls a sibling that returns the count without the boolean coercion.
- **`state-branch.ts`** — Append-only NDJSON + `--force-with-lease` retry loop is the durability substrate. Heal-count query is a read-only walk; no new write paths needed for D-04.
- **`prompt-assembler.ts`** + 7 `.md` template files in `prompts/` — Existing assembler combines templates by string interpolation. FIX-07 either adds two new templates (`assertions.md`, `slow-tests.md`) or branches the existing system-prompt template based on a class hint.
- **`pr-writer.ts` / `issue-writer.ts`** — PRI-04 dedup is a single Octokit search call (`gh search prs --repo X is:open in:title "{test_title}"` or the equivalent REST query) before the create call. The existing files already self-document Phase 04 as the home for this work.

### Established Patterns
- **Defense-in-depth gates** — SEC-05 is checked twice (loop-guard at ingest, healer at dispatch-receive); D-04 extends this idea. Phase 04 must NOT remove the existing healer-side check.
- **Skip flags as Zod-transformed booleans** — 03.1 introduced three `skipDeterministic | skipPostFixValidation | skipDiffLint` flags following the `z.string().default('false').transform(v => v === 'true')` pattern. Phase 04's `enable-auto-dispatch` follows the same pattern (default `'false'`, opt-in true).
- **Two-workflow architecture** — Ingest runs in main CI; healer runs in a separate `workflow_dispatch`-triggered workflow. Phase 04 must not collapse them into one (PROJECT.md key decision).
- **`mode: ingest | heal | dry-run`** — The mode enum is a load-bearing dispatcher (`src/index.ts` routes by it). Phase 04 adds a flag that ingest mode reads, NOT a new mode value.

### Integration Points
- `src/ingest/index.ts:~138` (DET-04 step summary) — Auto-dispatch step inserts after detection, before summary write. Step writes the dispatch result (fired / skipped / cap-hit / log-only) into the same step summary so consumers see one unified table.
- `action.yml` env block — `INPUT_ENABLE-AUTO-DISPATCH` env var bridge added alongside existing `INPUT_*` (the snake_case action input convention from the recent rename means the input is `enable_auto_dispatch` in YAML; env var is `INPUT_ENABLE-AUTO-DISPATCH` per `@actions/core`'s hyphen convention — check the most recent action.yml after `091015d`/`63646d3` commits).
- `src/healer/index.ts` orchestrator — Receives the dispatch payload; existing flow stays the same. The new `enable-auto-dispatch` flag is ingest-side only; the healer doesn't read it.
- `src/healer/pr-writer.ts` / `issue-writer.ts` — PRI-04 dedup wraps the existing create calls. Add a `findExisting()` Octokit query before each create.

</code_context>

<specifics>
## Specific Ideas

- The 03.1 demo proved the pipeline works on selectors. Phase 04 must preserve that working path — diff-lint and post-fix-validation re-engaging is the biggest behavioral change, and if it breaks Gemini's working selector heal, that's a regression. PLAN.md should include a "re-run the 03.1 demo with full gates on" verification before declaring Phase 04 complete.

- WR-01 from 03.1-REVIEW.md is the only security-class warning in the backlog. The fix is small (move `git config` from `--global` to `--local`, OR add a cleanup step). It should land in Phase 04 because Phase 04's success criteria include consumers running on shared/self-hosted infra.

- REQUIREMENTS PRI-04 phrasing ("queries for existing open PRs/issues with the same test identifier and updates the existing one (adding a comment with new evidence) rather than creating duplicates") leans toward comment-only as the safe default. Researcher should validate that's right; if the LLM produces a materially better fix on re-trigger, the prior PR's diff is now wrong — comment-only would leave the wrong fix open.

</specifics>

<deferred>
## Deferred Ideas

- **Replay/cache mode for prompt iteration** — Inherited from 03.1's deferred list. Useful when iterating on the new fix-class prompts but adds infrastructure. Skip for Phase 04; reconsider if FIX-07 prompts need 5+ tuning iterations.

- **Demo recording / reference artifact** — 03.1's PR #1 + fixture-ci.yml run is the canonical reference. Phase 04 may want a second reference artifact for an assertions or slow-test heal — surface in Phase 06 (release/docs), not now.

- **Public action repo** — Inherited from 03.1; surfaces again because cross-repo private-action access keeps biting. Project-level decision, not a Phase 04 decision. Defer to Phase 05/06 or earlier as a separate user-driven choice.

- **Anthropic adapter exercise on full fix classes** — 03.1 deferred this. Phase 04 sticks with Gemini for the new classes (matches D-08 from 03.1). If a class consistently fails on Gemini, file a 04.x gap to test Anthropic.

- **Cross-shard dedup** — REQUIREMENTS ING-04 already records shard metadata; Phase 04 dedup is per-test, but if two shards both detect the same test as flaky and both reach threshold simultaneously, the concurrency group catches it. No new logic required.

- **PR auto-rebase on stale healer branches** (PAT-03 from REQUIREMENTS v2) — Out of v1 scope; left here for v2 reference.

</deferred>

---

*Phase: 04-auto-dispatch-full-fix-classes-deduplication*
*Context gathered: 2026-05-01*
