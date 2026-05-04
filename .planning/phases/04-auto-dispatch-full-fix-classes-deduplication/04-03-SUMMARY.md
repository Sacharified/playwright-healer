---
phase: 04-auto-dispatch-full-fix-classes-deduplication
plan: "03"
subsystem: healer/dedup
tags: [dedup, octokit, pr, issue, pri-04, tdd]
dependency_graph:
  requires: [04-02]
  provides: [PRI-04-pr-dedup, PRI-04-issue-dedup]
  affects: [src/healer/pr-writer.ts, src/healer/issue-writer.ts]
tech_stack:
  added: []
  patterns:
    - "dedup-before-create: query open artifacts before any Octokit create call"
    - "comment-on-existing: issues.createComment when artifact found; no force-update"
    - "defense-in-depth: dedup query failure logs warning and falls through to create"
    - "failureMode-scoped dedup: in:body failureMode qualifier prevents same-test/different-class collision"
key_files:
  created: []
  modified:
    - src/healer/pr-writer.ts
    - src/healer/pr-writer.test.ts
    - src/healer/issue-writer.ts
    - src/healer/issue-writer.test.ts
decisions:
  - "comment-only update for open PR/issue (not force-update): PRI-04 phrasing; avoids rewriting a diff under human review"
  - "failureMode included in issue dedup query via in:body to prevent cross-class collision per RESEARCH State Matrix row 6"
  - "dedup query failure is non-fatal: core.warning + fall-through to create (best-effort optimization, not hard gate)"
  - "head: owner:branch format for PR dedup (Pitfall 3 — bare branch name returns all open PRs)"
  - "is:issue is:open qualifier required in search query (Pitfall 4 — HTTP 422 without it)"
metrics:
  duration: "~8m"
  completed: "2026-05-01"
  tasks: 2
  files: 4
---

# Phase 04 Plan 03: PRI-04 Deduplication Summary

**One-liner:** PRI-04 dedup via pre-create open-artifact queries — comment on existing open PR/issue instead of creating duplicates; closed/merged artifacts always get a fresh create.

## What Was Built

### Task 1: PR dedup (`pr-writer.ts`)

Two new private helpers and a wrap of `openHealerPr`:

**`findExistingOpenPr(octokit, owner, repo, branch)`**
Calls `octokit.rest.pulls.list({ state: 'open', head: '${owner}:${branch}', per_page: 1 })`. The healer branch name is deterministic per `(test, sha)` so the head filter is exact (Pattern 3). Pitfall 3 mitigation: the head filter MUST be `${owner}:${branch}` format — a bare branch name returns all open PRs. Returns `{ number, html_url }` or null. Catches any error, logs `core.warning("PRI-04: dedup query failed for ...")`, and returns null (fall-through to create).

**`commentOnPr(octokit, owner, repo, prNumber, body)`**
Calls `octokit.rest.issues.createComment({ issue_number: prNumber, body })`. PRs are issues at the API level so this works uniformly.

**`openHealerPr` wrap:**
1. Call `findExistingOpenPr` BEFORE `pulls.create`
2. On hit: build comment body with `## Re-trigger evidence` header + `renderPrBody(args)` content (carries rootCause, fixClass, validation pass-rate, cost) + attribution footer; call `commentOnPr`; write `## Healer PR updated (dedup)` to step summary; return existing `html_url`
3. On miss: original `pulls.create` path; write `## Healer PR opened` to step summary; return new `html_url`

### Task 2: Issue dedup (`issue-writer.ts`)

Two new private helpers and a wrap of `openIssue`:

**`findExistingOpenIssue(octokit, owner, repo, testTitle, failureMode)`**
Builds search query: `repo:owner/repo is:issue is:open in:title "[playwright-healer]" "${safeTitle}" "is unhealable" in:body "${failureMode}"`. Key decisions:
- `is:issue is:open` required (Pitfall 4 — HTTP 422 without qualifier)
- `safeTitle = testTitle.replace(/"/g, '')` neutralizes embedded quotes (T-04-04 — worst-case is a dedup false-negative creating a duplicate issue, not an exfiltration)
- `in:body "${failureMode}"` scopes match to the specific failure class; two issues for the same test with different failureModes do NOT collide — the query returns null for the new failureMode and a fresh issue is created (RESEARCH State Matrix row 6)
- failureMode is a typed union (`FailureMode`) so it's safe-by-construction — no escaping needed

**`commentOnIssue(octokit, owner, repo, issueNumber, body)`**
Calls `octokit.rest.issues.createComment({ issue_number: issueNumber, body })`.

**`openIssue` wrap:**
1. Call `findExistingOpenIssue` BEFORE `issues.create`
2. On hit: build comment body with `## Re-trigger evidence (failureMode: \`...\`)` header + `renderIssueBody(args)` + attribution footer; call `commentOnIssue`; write `## Healer issue updated (dedup)` to step summary; return existing `html_url`
3. On miss: original `issues.create` path; write `## Healer issue opened` to step summary; return new `html_url`

## PRI-04 State Matrix Coverage

| Matrix Row | Disposition | How Implemented |
|------------|-------------|-----------------|
| Open PR for same `(test, sha)` branch | Comment | `findExistingOpenPr` returns hit; `commentOnPr` called |
| Open PR for same test, different sha | Create new | Different sha → different branch name → head filter returns empty |
| Closed-unmerged PR | Create new | `state: 'open'` filter excludes closed PRs |
| Merged PR | Create new | `state: 'open'` filter excludes merged PRs |
| Open issue, same test, same failureMode | Comment | `findExistingOpenIssue` returns hit; `commentOnIssue` called |
| Open issue, same test, different failureMode | Create new | `in:body "${failureMode}"` causes miss for different class |
| Closed issue | Create new | `is:open` qualifier excludes closed issues |

## Return Value Uniformity

Both `openHealerPr` and `openIssue` return `html_url` whether the dedup-comment path or the create path was taken. Plan 04 (heal-cap + state-machine) can write heal events AFTER these functions return using the `html_url` uniformly — no branching needed in the caller.

## Tests Added

- `src/healer/pr-writer.test.ts`: 18 new tests (7 dedup behaviors + multi-assertion variants) + 7 pre-existing tests restructured for `.rest` mock namespace. Total: 25 tests (was 7).
- `src/healer/issue-writer.test.ts`: 17 new tests (7 dedup behaviors + variants) + 9 pre-existing tests restructured for `.rest` mock namespace. Total: 26 tests (was 9).
- Full suite: 365 tests passing (was 336; +29 net).

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `05fa064` | test(04-03) | RED: failing tests for PR dedup |
| `533c5a8` | feat(04-03) | GREEN: PR dedup implementation |
| `f273c76` | test(04-03) | RED: failing tests for issue dedup |
| `99ab432` | feat(04-03) | GREEN: issue dedup implementation |

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

**Mock restructure (planned, not a deviation):** Both test files required restructuring the Octokit mock from `{ pulls: {...}, issues: {...} }` to `{ rest: { pulls: {...}, issues: {...}, search: {...} } }` because the new dedup helpers use `.rest.*` APIs. This was anticipated in the plan's action section and confirmed by the advisor review.

## Known Stubs

None — all dedup paths are fully wired. Both `openHealerPr` and `openIssue` perform live Octokit calls on the dedup and comment paths.

## Threat Flags

None — no new network endpoints or auth surfaces beyond what the plan's threat model already covers (T-04-03, T-04-04 are mitigated in code: PAT never echoed; `safeTitle` strips quotes).

## Self-Check: PASSED

- `src/healer/pr-writer.ts` exists and contains `findExistingOpenPr` (2 matches), `commentOnPr` (2 matches), `Healer PR updated (dedup)` (1 match), `PRI-04: dedup query failed` (1 match)
- `src/healer/issue-writer.ts` exists and contains `findExistingOpenIssue` (2 matches), `commentOnIssue` (2 matches), `is:issue is:open in:title` (1 match), `Healer issue updated (dedup)` (1 match), `issue dedup query failed` (1 match), `replace(/"/g` (1 match)
- Commits 05fa064, 533c5a8, f273c76, 99ab432 all present in git log
- TypeScript: `tsc --noEmit` clean (no output)
- Full suite: 365/365 passing
