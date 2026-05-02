# Phase 5: Auto-Merge - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `05-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-02
**Phase:** 05-auto-merge
**Areas discussed:** Scope policy, Prereq failures
**Areas deferred to Claude's discretion:** Dedup × auto-merge interaction, CI-green safety check

---

## Gray-area selection

**User selected:** Scope policy, Prereq failures
**Not selected (defaulted via Claude's discretion in CONTEXT D-08/D-09/D-10):**

- **Dedup × auto-merge** — When PRI-04 dedup adds a comment to an existing open PR, how does auto-merge interact? (default locked at D-08: leave existing state untouched)
- **CI-green safety check** — Should the action probe required-status-checks before calling enableAutoMerge? (default locked at D-06: trust consumer per MRG-03)

Two items presented as **locked by REQUIREMENTS, no gray area**:

1. **Merge mechanism** — GitHub-native `enablePullRequestAutoMerge` GraphQL mutation, squash strategy. MRG-03 phrasing `gh pr merge --auto --squash` IS the GraphQL mutation; polling isn't a real option for a GitHub Action.
2. **Allow-list config surface** — Comma-separated string in `action.yml` + YAML array via `.github/playwright-healer.yml`; matches existing `enable_*_fixes` pattern.

---

## Scope policy

### Q1: How should the auto-merge scope check work given FIX-06 diff-lint already enforces TEST_PATH_ALLOWLIST?

| Option | Description | Selected |
|--------|-------------|----------|
| Same allowlist, restate (Recommended) | Defense-in-depth restatement at decision time — same regexes from `forbidden-patterns.ts`, always passes for healthy diffs but renders the condition explicitly in the MRG-04 reasoning band | (redirected) |
| Stricter subset for auto-merge | Narrower allowlist than diff-lint (e.g., exclude `playwright/` infra). Adds a second source-of-truth list — D-17 violation risk | |
| Exclude config files only | Reuse TEST_PATH_ALLOWLIST + add hardcoded denylist for `playwright.config.*`, `*.config.ts`, `*.config.js`, `.playwright/` files | |

**User's response (freeform redirect):** "The agent should be able to identify application issues outside of the test directory scope. A test failure may be the result of application behaviour rather than a deficiency in the test, and the correct resolution would be to modify the application rather than the test. In this scenario, the user should be able to configure whether: The healer raises an issue suggesting a change to the application, the healer raises a PR with a fix to the application (either no auto-merge or with auto-merge, configurable by the user)."

**Reflection:** Half of this is already shipped (PRI-05 routes deterministic failures to issue-fallback with "probable application bug" classification). The other half — opt-in app-code-fix PRs — is locked out at four layers (PROJECT.md Out of Scope; REQUIREMENTS PRI-05; CLAUDE.md agent `allowedTools`; FIX-06 diff-lint). Unblocking would reopen all four. Treated as v1.5/v2 scope, not Phase 5 implementation detail.

**User's choice between A (defer + stay in lane) and B (signal product pivot):** **A** — park as deferred, return to Phase 5 scope-policy question

**Final decision (CONTEXT D-02):** Same allowlist, restate (defense-in-depth, Phase 04 D-04 pattern)
**Captured in deferred:** Opt-in app-code fix capability — surface as candidate for Phase 5.x or v1.5 milestone

---

### Q2: Should auto-merge treat config files (playwright.config.ts, *.config.ts) inside test dirs as eligible?

| Option | Description | Selected |
|--------|-------------|----------|
| Always human review (Recommended) | Hardcoded denylist on auto-merge ONLY (not diff-lint): `playwright.config.*`, `*.config.ts`, `*.config.js`, `*.config.mjs`. PR opens; reasoning band renders `blocked by: configuration file change`. Diff-lint stays unchanged — D-17 single source of truth preserved | ✓ |
| Allow if other gates pass | Auto-merge treats config files identically to test files. Simplest impl but means a config tweak that incidentally fixes a flake gets merged without review | |

**User's choice:** Always human review (Recommended)
**Final decision (CONTEXT D-03):** Auto-merge-only config-file denylist overlay; lives next to the auto-merge gate, not in `forbidden-patterns.ts`

---

### Q3: Where does the auto-merge gate live in the code?

| Option | Description | Selected |
|--------|-------------|----------|
| New module + index.ts call (Recommended) | New `src/healer/auto-merge.ts` exporting pure `evaluateAutoMerge(args)` + IO `enableAutoMerge(args)`. Pure-vs-IO split mirrors validator.ts/pr-writer.ts | |
| Extend pr-writer.ts | Add the auto-merge decision + GraphQL call inside `openHealerPr` in `pr-writer.ts`. Less file scaffolding; pr-writer.ts already mixes Octokit + summary writes | ✓ |

**User's choice:** Extend pr-writer.ts (overrode the recommendation — co-locate with PR creation lifecycle)
**Final decision (CONTEXT D-04):** Auto-merge evaluator + GraphQL call extend `src/healer/pr-writer.ts`; private helpers `evaluateAutoMerge(args): AutoMergeDecision` + `enableAutoMerge(prNodeId, octokit)` live in the same file

---

## Prereq failures

### Q4: How should the action behave when `enablePullRequestAutoMerge` returns an error?

| Option | Description | Selected |
|--------|-------------|----------|
| Soft-fail: warn + leave PR open (Recommended) | Catch GraphQL error; render `::warning::` annotation; write `blocked by: repo not configured for auto-merge` to MRG-04 reasoning band; leave PR open; heal exit 0 | ✓ |
| Hard-fail the heal | Failed enable = healer exits non-zero. Pros: red CI consumer can't ignore. Cons: working heal flagged as failed run; reviewers may distrust the PR | |
| Pre-check repo settings before opening PR | Octokit branch-protection probe BEFORE openHealerPr; skip auto-merge attempt entirely if prereqs missing. Avoids the GraphQL round-trip but adds an API call to every heal | |

**User's choice:** Soft-fail: warn + leave PR open (Recommended)
**Final decision (CONTEXT D-05):** Soft-fail; `core.warning(...)`; reasoning-band entry; heal exit 0; PR stays open for human review

---

### Q5: Should the action probe required-status-checks before calling enableAutoMerge?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, probe and refuse (Recommended) | `octokit.rest.repos.getBranchProtection` call before enableAutoMerge; refuse if `required_status_checks` is empty. Closes the unsafe-instant-merge gap MRG-03 forbids | |
| No, trust consumer | Branch-protection setup is consumer's responsibility per MRG-03. Document prereq in README + SECURITY.md but don't probe at runtime | ✓ |
| Probe only when called | Probe inside the soft-fail handler; if enableAutoMerge succeeds, never spend the API call | |

**User's choice:** No, trust consumer
**Final decision (CONTEXT D-06):** No runtime probe. Document prereq prominently in README §auto-merge-prerequisites (Phase 5 ships minimal stub; Phase 6 owns full polish)

---

## Wrap-up

**Q6: Ready to write CONTEXT.md, or revisit?**

| Option | Selected |
|--------|----------|
| Write CONTEXT.md | ✓ |
| Revisit Dedup×auto-merge | |
| Revisit CI-green safety | |
| More on scope or prereqs | |

---

## Claude's Discretion (locked with documented defaults)

- **D-08: PRI-04 dedup × auto-merge** — Leave existing PR's auto-merge state untouched on comment-on-existing path. Auto-merge is a one-time decision at PR creation.
- **D-09: Reasoning-band rendering format** — Markdown table with `condition | result | reason` columns under a `## Auto-merge decision` heading. Pure-function emitter; pr-writer.ts joins to step summary.
- **D-10: README §auto-merge-prerequisites doc-scope** — Phase 5 ships minimal stub (just enough for the soft-fail link to resolve); Phase 6 owns DOC-01..05 polish.
- **D-11: Verification gate** — Re-run Phase 03.1 demo with `enable_auto_merge: false` (zero behavioral change) AND with `enable_auto_merge: true` against a branch-protection-configured fixture (happy path) before declaring Phase 5 complete.

## Deferred Ideas

- **Opt-in app-code fix capability** (user-surfaced 2026-05-02) — v1.5/v2 scope; reopens PROJECT.md Out of Scope, REQUIREMENTS PRI-05, FIX-06 diff-lint, agent allowedTools
- Custom merge strategy per fix class
- Auto-merge re-evaluation on PRI-04 dedup re-triggers (D-08 default may be revisited)
- Runtime probe of required-status-checks (D-06 default may be revisited)
- Reference auto-merge run artifact (Phase 06 deliverable)
- v2 trace-aware confidence band (REQUIREMENTS TRC-03, deferred)
- Per-PR auto-merge override via reviewer comment (would need webhook listener)
