---
phase: 05-auto-merge
reviewed: 2026-05-02T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/healer/pr-writer.ts
  - src/healer/pr-writer.test.ts
  - src/healer/index.ts
  - src/healer/index.test.ts
  - src/shared/config.ts
  - src/shared/config.test.ts
  - action.yml
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-05-02
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

All seven Phase 05 files were reviewed with focus on the auto-merge gate correctness, D-02..D-08 decision compliance, the GraphQL mutation wrapper, `extractPatchedFiles` edge cases, and D-13 MCP tool-name literal ban.

The gate implementation is sound. All four locked decisions with direct code expressions were verified:

- **D-02 (scope check)**: `evaluateAutoMerge` correctly re-imports `TEST_PATH_ALLOWLIST` from `forbidden-patterns.ts` and evaluates the scope condition independently, as required for reasoning-band rendering.
- **D-07 (validation skipped)**: `total === 0` is explicitly tested before `passRate >= threshold`, blocking auto-merge on demo-mode paths.
- **D-08 (dedup bypass)**: The gate runs only on the no-existing-PR branch; the dedup comment path returns before any gate evaluation or GraphQL call. Test IN8 covers this.
- **D-05 (soft-fail)**: `enableAutoMerge` catches both `GraphqlResponseError` and all other thrown errors, returns a result object in both cases, and never throws. The heal exit code stays 0 on mutation failure.
- **T-05-06 (SKIP_SENTINEL preserved)**: The GraphQL mutation variables contain only `pullRequestId` and `mergeMethod: 'SQUASH'`. `commitHeadline`, `commitBody`, `expectedHeadOid`, `authorEmail`, and `clientMutationId` are all absent — squash commit reuses the PR body which already contains `SKIP_SENTINEL`. Test EA2 covers this explicitly.
- **D-13 (MCP literal ban)**: No `mcp__playwright__*` or `mcp__*` literals appear in any reviewed file.
- **CONFIG_FILE_DENYLIST (D-03)**: Catches `playwright.config.{ts,js,mjs,cjs}`, `vitest.config.ts`, `utils.config.ts` in test subdirs, etc. The constraint on extension alternation (`ts|js|mjs|cjs`) correctly prevents false positives on `playwright.config.json` or `playwright.config.yaml`.
- **action.yml**: Three new inputs (`enable_auto_merge`, `auto_merge_pass_rate`, `auto_merge_fix_classes`) and their `INPUT_*` env rows are present and correct.

Three informational findings are documented below — all are edge-case polish items. None affect correctness for the committed use-cases.

## Info

### IN-01: `extractPatchedFiles` has no direct unit tests; quoted-path diffs silently yield empty list

**File:** `src/healer/pr-writer.ts:53-64`
**Issue:** `extractPatchedFiles` is exported and used in production (`index.ts:359`) but is only mocked in `index.test.ts:47` — it has zero direct tests. The task brief explicitly asked about multi-hunk, rename, and no-newline-at-eof handling; none of these cases are tested.

A secondary edge case follows from the regex: `+++ "b/path"` (git's quoted-path format — used when `core.quotepath=true` and the filename contains non-ASCII or special characters) returns `null` from the regex and is silently dropped from the patched-file list. If a non-ASCII-named config file were patched, both the scope and config_files conditions would vacuously pass (empty `patchedFiles` is "matched" per the empty-list comment at line 88). In practice, bot-authored test-path diffs will not contain non-ASCII filenames, and diff-lint upstream already enforces the same allowlist — so the gate still fails safe — but the behavior differs from what the comment implies.

**Fix:** Add a `describe('extractPatchedFiles')` block in `pr-writer.test.ts` covering:
- Standard single-hunk diff (baseline)
- Multi-hunk diff (two `+++ b/` headers in one diff string)
- Rename (old `--- a/old.ts`, new `+++ b/new.ts` — both should produce only `new.ts`)
- Deletion (`+++ /dev/null` — should be excluded; the existing check handles this)
- No-newline-at-eof marker (trailing `\\ No newline at end of file` after hunk lines — does not affect `+++` parsing, confirm with a test)
- Windows CRLF line endings (`\r\n` — the existing `\s*$` trailing-trim handles this, confirm with a test)

Optionally, document the quoted-path limitation in the JSDoc comment at line 46 so future maintainers know the boundary.

---

### IN-02: CONFIG_FILE_DENYLIST pattern 1 is fully subsumed by pattern 2; the comment claiming pattern-level reasoning-band naming is inaccurate

**File:** `src/healer/pr-writer.ts:27-30`
**Issue:** The module-level comment (line 24-26) states: "Two regexes evaluated separately so the reasoning band can name the matched pattern." This is inaccurate in two ways:

1. `isConfigFile()` calls `.some()` and returns a `boolean` — it does not expose which pattern matched. The reasoning-band reason string (line 151) names the file (`configuration file change (${configHit})`), not the pattern. Pattern 1 cannot currently contribute distinct reasoning-band content.

2. Pattern 1 (`/(?:^|\/)playwright\.config\.(?:ts|js|mjs|cjs)$/`) is a strict subset of pattern 2 (`/(?:^|\/)[^/]+\.config\.(?:ts|js|mjs|cjs)$/`). Every path matched by pattern 1 is also matched by pattern 2. Pattern 1 never causes a file to be blocked that pattern 2 would allow.

The practical behavior is correct — the denylist correctly blocks all targeted file patterns. Only the comment and the structural justification for two patterns are misleading.

**Fix:** Update the comment to read: "Two regexes for defense-in-depth readability: pattern 1 is specific to `playwright.config.*` (the most common case); pattern 2 catches any `*.config.{ts,js,mjs,cjs}`. Pattern 1 is technically subsumed by pattern 2 — both are retained for explicit documentation of intent." No code change required.

---

### IN-03: The `renderAutoMergeBand` defensive `unknown` branch is reachable if `enableAutoMerge` returns `{ enabledAt: '' }` (empty string)

**File:** `src/healer/pr-writer.ts:261-263`
**Issue:** The `else` / "unknown" branch at line 261-263 is reached when `enabledFlag=true`, `decision.eligible=true`, and `enableResult` has neither a truthy `errorMessage` nor a truthy `enabledAt`. In JavaScript, an empty string `''` is falsy, so if the GitHub GraphQL mutation were to return `enabledAt: ""` (empty string), the success branch at line 258-259 would not fire and the outcome row would read `| auto_merge | unknown | gate state inconsistent |`. The `enabledAt` field is typed as `string` (not `string | null`), so an empty-string return is unexpected from the live API but not impossible through test mocking.

This defensive branch is otherwise correct as an unreachable-in-production safety net. The test suite does not cover this branch.

**Fix:** Consider strengthening the success check from `enableResult?.enabledAt` to `enableResult?.enabledAt != null` (truthy is insufficient for typed strings), or tighten the TypeScript type to `enabledAt: string` (non-optional, non-empty). Alternatively, document the branch explicitly:

```typescript
} else {
  // Unreachable in practice: enableAutoMerge always returns either
  // { enabledAt: <ISO-string> } on success or { errorMessage: <string> } on failure.
  // Defensive for type-narrowing completeness only.
  outcomeRow = `| auto_merge | unknown | gate state inconsistent |`;
}
```

---

_Reviewed: 2026-05-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
