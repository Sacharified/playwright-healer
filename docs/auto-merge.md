# Auto-merge

playwright-healer can automatically merge its own fix PRs when a strict four-condition trust gate passes. This document expands the summary in the README and covers everything you need to enable auto-merge safely.

## Why auto-merge is opt-in

Healer PRs are code changes that affect your test reliability. They modify test files, adjust selectors, and touch assertion logic. Automatically merging those changes without a human review is a meaningful decision — one that introduces automation risk alongside automation value.

playwright-healer defaults `enable_auto_merge: false` so that you must consciously opt in. The four-condition trust gate makes the merge decision auditable: every auto-merged PR carries a reasoning band (fix class, post-fix pass rate, diff-lint outcome, security-contract status) so you can trace exactly why the action merged without a human approve.

## Required repository settings

All four of the following must be in place before setting `enable_auto_merge: true`. Missing any one will produce a `core.warning` annotation (soft-fail) rather than failing your workflow.

1. **Allow auto-merge** — Repository Settings → General → Pull Requests → "Allow auto-merge": enable this toggle. GitHub hides the merge button for auto-merge unless this is on.

2. **Allow squash merging** — Repository Settings → General → Pull Requests → "Allow squash merging": enable this toggle. playwright-healer calls `enablePullRequestAutoMerge` with `mergeMethod: SQUASH`. If squash merge is disabled, the GraphQL mutation will error and the action falls back to soft-fail.

3. **Branch protection rule with at least one required status check** — Repository Settings → Branches → Branch protection rules → add a rule for your default branch. Enable "Require status checks to pass before merging" and add at least one check (your CI suite, or the `playwright-healer / heal` job itself). GitHub will not auto-merge a PR if there are no required checks — the PR opens in a perpetually-open state.

4. **healer_token PAT scopes** — the `healer_token` secret must carry sufficient permissions to call the auto-merge GraphQL mutation:
   - Classic PAT: `repo` scope (includes `repo:status`, `repo:contents`, `repo:pull_request`)
   - Fine-grained PAT: `Contents: write` + `Pull requests: write` (minimum; `Issues: write` is also needed if you use the issue-fallback path)

## The reasoning band format

playwright-healer evaluates four conditions before setting auto-merge on a PR. All four must pass. If any fails, the PR is opened but auto-merge is not set — a human reviews instead.

| Condition | Configurable via | Pass criteria |
|-----------|-----------------|---------------|
| Post-fix validation pass rate | `auto_merge_pass_rate` (default: `1.0`) | Re-run pass rate ≥ configured threshold (default: 10/10) |
| Fix class within allowed set | `auto_merge_fix_classes` (default: `selectors`) | The fix's `fixClass` value is in the comma-separated allowed list |
| No forbidden patterns in diff | — (diff-lint gate, not configurable) | Diff contains no `waitForTimeout`, no positional CSS selectors, no weakened assertions, no edits outside test directories |
| No security-contract violations | — (audit invariant, not configurable) | Tool-naming audit passes: no `mcp__playwright__*` inline literals in applied patch |
| **All four pass** | — | Auto-merge is set via GitHub's native GraphQL mutation |

The reasoning band is written into the PR body so you can inspect exactly which conditions were evaluated and what their outcomes were.

## Soft-fail behavior matrix

When auto-merge cannot be set due to a GitHub API error, playwright-healer emits a `core.warning` annotation and leaves the PR open for manual merge. It does not fail your workflow. This table maps each error to its annotation text and the consumer action required.

| GitHub error | `core.warning` annotation | Consumer action |
|---|---|---|
| `allow_auto_merge` not enabled in repo settings | `Auto-merge is disabled in repository settings. Enable it via Settings → General → Pull Requests → Allow auto-merge.` | Enable the repository setting |
| No required status checks on default branch | `Branch protection requires at least one required status check. Configure via Settings → Branches → Branch protection rules.` | Add a required status check to your branch protection rule |
| Token lacks mutation permission | `healer_token lacks permission for auto-merge. Add Contents:write + Pull requests:write (fine-grained PAT) or repo scope (classic PAT).` | Update PAT scopes and re-add the secret |
| GraphQL mutation error (unexpected) | `Unexpected GitHub API error: <message>. PR requires manual merge.` | Inspect the message; manual merge the open PR |

The soft-fail behavior ensures your healing run always produces a PR artifact — even when auto-merge fails, you get a reviewed-and-approvable PR rather than a dropped fix.

## T-05-06 SKIP_SENTINEL preservation

Auto-merge PRs from playwright-healer include `[skip-healer]` in the commit message. This sentinel prevents the ingest loop from re-triggering on the merged heal commit — the next push to your default branch containing `[skip-healer]` is skipped by `shouldSkipIngest()` in `src/shared/loop-guard.ts`.

Without this sentinel, a merged heal PR could trigger the ingest workflow, append a new stats record, and — if the test still shows marginal flake in the rolling window — dispatch another heal run. The sentinel is playwright-healer's defense against this feedback loop.

## Live demo evidence

See `tests/fixture-app/uat-evidence-live-auto-merge.md` for the live demo evidence once captured (D-03). This file documents a successful auto-merge happy-path run against this repository once it is public and branch protection is enabled.
