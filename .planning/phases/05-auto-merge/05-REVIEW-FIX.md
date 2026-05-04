---
phase: 05-auto-merge
fixed_at: 2026-05-02T09:01:55Z
review_path: .planning/phases/05-auto-merge/05-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-05-02T09:01:55Z
**Source review:** .planning/phases/05-auto-merge/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### IN-02: CONFIG_FILE_DENYLIST pattern 1 subsumed by pattern 2; inaccurate comment

**Files modified:** `src/healer/pr-writer.ts`
**Commit:** 122dc31
**Applied fix:** Removed Pattern 1 (`/(?:^|\/)playwright\.config\.(?:ts|js|mjs|cjs)$/`) from `CONFIG_FILE_DENYLIST` since it is fully subsumed by Pattern 2 (`/(?:^|\/)[^/]+\.config\.(?:ts|js|mjs|cjs)$/`). Updated the block comment to drop the inaccurate claim that "two regexes are evaluated separately so the reasoning band can name the matched pattern" — `isConfigFile()` returns a `boolean` and does not expose which regex matched. The new comment correctly explains that Pattern 1 was technically subsumed and has been removed. All 79 existing config-file tests (CF1-CF7) continued to pass.

---

### IN-03: `renderAutoMergeBand` `unknown` branch reachable on empty-string `enabledAt`

**Files modified:** `src/healer/pr-writer.ts`
**Commit:** 1e49e6c
**Applied fix:** Replaced the falsy check `enableResult?.enabledAt` with the explicit `enableResult?.enabledAt !== undefined` on the success branch. This ensures that `enabledAt: ''` (empty string, falsy but a valid typed string) correctly routes to the success row rather than falling through to the `unknown` defensive branch. Updated the `else` comment to read: "Unreachable in practice: enableAutoMerge always returns either { enabledAt: <ISO-string> } on success or { errorMessage: <string> } on failure. Defensive for type-narrowing completeness only." Existing RB5 test (populated-`enabledAt` path) continued to pass.

---

### IN-01: `extractPatchedFiles` has no direct unit tests; quoted-path silently yields empty list

**Files modified:** `src/healer/pr-writer.test.ts`
**Commit:** f27cece
**Applied fix:** Added `extractPatchedFiles` to the import in `pr-writer.test.ts`. Added two new `describe` blocks covering all reviewer-requested edge cases:

- `EPF1` — standard single-hunk diff extracts the correct path
- `EPF2` — multi-hunk diff (two `+++ b/` headers) returns both paths
- `EPF3` — rename diff extracts only the `b/` (new) path, not the `a/` (old) path
- `EPF4` — deletion (`+++ /dev/null`) is excluded from the result list
- `EPF5` — no-newline-at-eof marker does not affect `+++` parsing
- `EPF6` — Windows CRLF line endings are handled by the `\s*$` trailing trim
- `EPF7` — empty diff string returns `[]`
- `EPF8` — diff with no `+++ b/` headers returns `[]`
- `EPF-QP` — git quoted-path format (`+++ "b/path"`) returns `[]`, documenting the limitation as intentional: bot-authored test-path diffs do not contain non-ASCII filenames, and diff-lint upstream enforces the same allowlist, so the gate still fails safe. No parser change was made.

Test count grew from 79 to 88. All 88 pass.

---

_Fixed: 2026-05-02T09:01:55Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
