---
phase: 05-auto-merge
fixed_at: 2026-05-02T00:00:00Z
review_path: .planning/phases/05-auto-merge/05-REVIEW.md
iteration: 1
findings_in_scope: 0
fixed: 0
skipped: 0
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-05-02
**Source review:** .planning/phases/05-auto-merge/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Fix scope: `critical_warning` (CR-* and WR-* findings only)
- Findings in scope: 0
- Fixed: 0
- Skipped: 0

## Fixed Issues

None — no critical or warning findings were present in the review. The review contains 3 INFO findings (IN-01, IN-02, IN-03) which fall outside the `critical_warning` scope and were not addressed.

## Info Findings Not Addressed (scope: critical_warning)

The following 3 informational findings were identified by the reviewer but are excluded from this fix run because `fix_scope` is set to `critical_warning`. None affect correctness for committed use-cases.

### IN-01: `extractPatchedFiles` has no direct unit tests; quoted-path diffs silently yield empty list

**File:** `src/healer/pr-writer.ts:53-64`
**Reason not fixed:** INFO severity is outside `critical_warning` scope.
**Original issue:** `extractPatchedFiles` has zero direct unit tests. The regex also silently drops `+++ "b/path"` (git quoted-path format), causing non-ASCII-named config files to pass both scope and config_files conditions via an empty `patchedFiles` list. Behavior fails safe in practice (diff-lint upstream enforces the same allowlist), but the comment implies different behavior.

### IN-02: CONFIG_FILE_DENYLIST pattern 1 is fully subsumed by pattern 2; comment is inaccurate

**File:** `src/healer/pr-writer.ts:27-30`
**Reason not fixed:** INFO severity is outside `critical_warning` scope.
**Original issue:** The module-level comment claims two regexes exist so the reasoning band can name the matched pattern, but `isConfigFile()` only returns a `boolean` and never exposes which pattern matched. Pattern 1 is also a strict subset of pattern 2 — it is never independently decisive. The comment is misleading; the practical behavior is correct.

### IN-03: `renderAutoMergeBand` defensive `unknown` branch reachable via empty-string `enabledAt`

**File:** `src/healer/pr-writer.ts:261-263`
**Reason not fixed:** INFO severity is outside `critical_warning` scope.
**Original issue:** If `enableAutoMerge` returns `{ enabledAt: '' }` (empty string, falsy), the success branch does not fire and the outcome row reads `unknown / gate state inconsistent`. The type is `string` (not `string | null`) so this is unexpected from the live API but possible through test mocking. The defensive branch is correct; the test suite does not cover it.

## To Address Info Findings

Re-run the fixer with `fix_scope: all` to include INFO findings in the next iteration:

```
/gsd-code-review-fix --all
```

Or address the findings manually:
- **IN-01**: Add `describe('extractPatchedFiles')` tests in `src/healer/pr-writer.test.ts`; optionally document the quoted-path limitation in the JSDoc comment at line 46.
- **IN-02**: Update the comment at lines 24-26 of `src/healer/pr-writer.ts` to accurately describe the subsumption relationship.
- **IN-03**: Strengthen the success check from `enableResult?.enabledAt` to `enableResult?.enabledAt != null`, or add a JSDoc comment documenting the defensive branch is unreachable in practice.

---

_Fixed: 2026-05-02_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
