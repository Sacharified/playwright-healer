---
phase: 01-security-scaffold-composite-packaging
reviewed: 2026-04-24T17:10:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - .github/workflows/phase1-self-test.yml
  - .github/workflows/security-lint.yml
  - action.yml
  - src/healer/index.ts
  - src/index.ts
  - src/ingest/index.ts
  - src/shared/config.ts
  - src/shared/security-contract.ts
  - tsconfig.json
  - package.json
  - .gitignore
findings:
  critical: 0
  warning: 3
  info: 1
  total: 4
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-04-24T17:10:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

All eleven Phase 1 source files were reviewed against the must_haves from Plans 01–06 and the architectural constraints in CLAUDE.md and the PITFALLS research. The TypeScript source files (`src/shared/security-contract.ts`, `src/shared/config.ts`, `src/index.ts`, and the two stubs) are clean: D-07 startup ordering is correctly implemented, the Zod factory schema enforces `.min(1)` on all three secrets, `Object.freeze(...) as const` dual-layering is present on all constants, and no `process.exit` or inline security-contract literals appear in the dispatcher. `action.yml` correctly implements Pitfall 1 mitigation — the explicit `INPUT_*` env block exactly mirrors what `@actions/core.getInput` expects (including hyphen preservation). `package.json`, `tsconfig.json`, and `.gitignore` match the Plan 01 specifications verbatim. SHA pins for `actions/setup-node` and `actions/checkout` are present and in the 40-char hex format required by D-20.

Three warnings are concentrated in `.github/workflows/security-lint.yml` Check 3a (the security-contract trailer gate). Two are interrelated logic issues in the push-event range calculation that allow multi-commit pushes to partially bypass the trailer enforcement requirement. The third is a structural gap in Check 3b: the `ALLOWED_ORIGIN_TEMPLATE` function body is not actually read from the TypeScript module — the check hardcodes sentinel values instead. None of these affect runtime security or correctness of the action in Phase 1 (the contract is not yet used by agent code), but they weaken the CI gate before Phases 3+ when the contract values are load-bearing.

## Warnings

### WR-01: Security-lint Check 3a — push-event RANGE covers only the last commit

**File:** `.github/workflows/security-lint.yml:98`

**Issue:** For `push` events the trailer-gate uses `RANGE="HEAD~1..HEAD"`, which covers exactly one commit (the HEAD of the push). GitHub pushes can contain multiple commits in a single event. If a commit anywhere in the batch modifies `src/shared/security-contract.ts` or `.planning/security-contract.snapshot.json` without the required `Security-Contract-Change: reviewed-by=<handle>` trailer, but the final commit in the push does not touch those files, `CHANGED` evaluates to 0 and the entire trailer check is silently skipped. The attacker scenario: push three commits where commit 2 modifies the contract without a trailer and commit 3 makes an unrelated change. `HEAD~1..HEAD` = commit 3 only, `CHANGED` = 0, check exits 0.

The `pull_request` event path correctly uses `origin/$BASE_REF...HEAD`, which spans all commits in the branch. The push path has no equivalent coverage.

**Fix:** Replace the push-event `RANGE` with the full range from `github.event.before` to `HEAD`, with a guard for the all-zeros case (initial commit) and the existing null-tree fallback:

```bash
# push trigger — cover all commits in the push, not just HEAD
RANGE="${{ github.event.before }}..HEAD"
# Initial push: before = 0000...0000 — git can't use that as a rev
if [[ "${{ github.event.before }}" =~ ^0+$ ]]; then
  # First push to branch: use null tree as base
  RANGE="$(git hash-object -t tree /dev/null)..HEAD"
fi
```

This matches how `pull_request` events are handled and ensures every commit in a push is inspected.

---

### WR-02: Security-lint Check 3a — trailer presence check is "any one commit" not "all commits"

**File:** `.github/workflows/security-lint.yml:118`

**Issue:** The current logic checks whether at least one commit in the range has the `Security-Contract-Change: reviewed-by=` trailer (`TRAILER_COUNT -eq 0` → fail). With a multi-commit range this is insufficient: if commit A modifies the contract files without a trailer, and commit B (in the same push or PR) touches the same files but includes the trailer, `TRAILER_COUNT=1` and the check passes. Commit A's unreviewed change is shielded by commit B's trailer.

This is a weaker invariant than the D-13 design intent, which requires each change to carry the trailer to its own commit.

**Fix:** Enumerate the commits that touch the contract files and verify that every one of them carries the trailer:

```bash
# Get each commit SHA that touched the contract files
TOUCHING_COMMITS=$(git log "$RANGE" --format='%H' \
  -- src/shared/security-contract.ts .planning/security-contract.snapshot.json)

if [ -z "$TOUCHING_COMMITS" ]; then
  echo "OK: no security-contract changes in range; trailer check skipped"
  exit 0
fi

FAIL=0
while IFS= read -r sha; do
  MSG=$(git log -1 --format='%B' "$sha")
  if ! echo "$MSG" | grep -q '^Security-Contract-Change: reviewed-by='; then
    echo "::error::Commit $sha modifies security contract but lacks the 'Security-Contract-Change: reviewed-by=<handle>' trailer"
    FAIL=1
  fi
done <<< "$TOUCHING_COMMITS"

[ "$FAIL" -eq 0 ] || exit 1
echo "OK: all contract-touching commits carry the required trailer"
```

---

### WR-03: Security-lint Check 3b — ALLOWED_ORIGIN_TEMPLATE function body changes are invisible to the snapshot diff

**File:** `.github/workflows/security-lint.yml:133-145`

**Issue:** Check 3b reconstructs the expected contract object to diff against the snapshot. For `allowedOriginTemplate` it hardcodes the sentinel values `['<baseUrl>', 'http://localhost:*']` directly in the check script rather than deriving them from the TypeScript module. Because `ALLOWED_ORIGIN_TEMPLATE` is a function (not a constant array), it cannot be trivially serialized from the module. The consequence: if a future contributor changes the function body — for example, adds `http://127.0.0.1:*` or drops the localhost rule — the script's hardcoded reconstruction still produces `['<baseUrl>', 'http://localhost:*']`, the snapshot still contains the old value, and `diff` reports no difference. The change goes undetected, defeating the contract-enforcement purpose for the most security-sensitive of the three constants (origin allowlisting directly controls where the MCP browser may navigate).

The `ALLOWED_TOOLS` and `FORBIDDEN_WORKFLOW_TRIGGERS` arrays are correctly derived from the module via spread (`[...m.ALLOWED_TOOLS].sort()`), so only `allowedOriginTemplate` has this gap.

**Fix:** Use a known sentinel `baseUrl` to invoke the function and capture the actual returned array, instead of hardcoding the expected return value:

```bash
npx tsx --eval "
  import('./src/shared/security-contract.ts').then((m) => {
    const SENTINEL_BASE_URL = '<baseUrl>';
    const obj = {
      allowedOriginTemplate: [...m.ALLOWED_ORIGIN_TEMPLATE(SENTINEL_BASE_URL)].sort(),
      allowedTools: [...m.ALLOWED_TOOLS].sort(),
      forbiddenWorkflowTriggers: [...m.FORBIDDEN_WORKFLOW_TRIGGERS].sort(),
    };
    const sortKeys = (o) =>
      Array.isArray(o)
        ? [...o].sort()
        : typeof o === 'object' && o !== null
          ? Object.keys(o).sort().reduce((a, k) => { a[k] = sortKeys(o[k]); return a; }, {})
          : o;
    process.stdout.write(JSON.stringify(sortKeys(obj), null, 2) + '\n');
  });
" > /tmp/contract-from-ts.json
```

Using `<baseUrl>` as the sentinel keeps the output byte-identical to the current snapshot (`["<baseUrl>","http://localhost:*"]`), so the baseline comparison does not change. Future modifications to the function body will now surface as a diff.

---

## Info

### IN-01: config.ts — ModeEnum defined at module level rather than inside the factory

**File:** `src/shared/config.ts:3`

**Issue:** The factory pattern rationale documented in the comment is "lets tests override defaults without module-level state." The module-level `ModeEnum` has no defaults and is a pure enum (zero configurable state), so it does not violate the stated reason for the factory pattern. However, the asymmetry between the module-level `ModeEnum` and the factory-enclosed `.default('')` fields may confuse a future contributor who adds a new enum field with a configurable default and incorrectly places it at module level (reintroducing the shared-state risk the factory was meant to prevent).

This is a comment/clarity concern, not a correctness issue.

**Fix:** Move `ModeEnum` inside `getInputSchema()`, or add a one-line comment explaining why it is safe to leave outside:

```typescript
// ModeEnum has no defaults and is immutable — safe at module level.
// Fields with .default(...) MUST remain inside getInputSchema() to avoid shared state.
const ModeEnum = z.enum(['ingest', 'heal', 'dry-run'])
  .describe('mode must be one of: ingest, heal, dry-run');
```

---

## Verified Correct (Notable Items)

The following items were explicitly checked and found correct against the plan must_haves and architectural constraints:

- **D-07 startup ordering** (`src/index.ts`): All three `core.getInput` + `core.setSecret` calls for secrets occur before the first `safeParse` call. Verified line-by-line.
- **No `process.exit`** (`src/index.ts`): `core.setFailed(msg); return;` pattern used throughout. No `process.exit` calls present.
- **No inline security-contract literals** (`src/index.ts`): No occurrences of `mcp__playwright__*`, `pull_request_target`, or any `allowedTools` value outside `src/shared/security-contract.ts`.
- **Dynamic imports for stubs** (`src/index.ts`): `./ingest/index.js` and `./healer/index.js` are dynamically imported inside switch cases, not statically at module load.
- **Pitfall 1 mitigation** (`action.yml`): The explicit `env:` block maps all 8 inputs to `INPUT_*` env vars. The naming convention (hyphens preserved, uppercase, `INPUT_` prefix) exactly matches what `@actions/core.getInput` reads from `process.env`. Validated against `@actions/core` source.
- **Pitfall 5 mitigation**: All `actions/checkout` steps across both workflow files carry `persist-credentials: false`.
- **SHA pinning (D-20)**: `actions/setup-node` in `action.yml` uses `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e`; `actions/checkout` in both workflows uses `de0fac2e4500dabe0009e67214ff5f5447ce83dd`. Both are 40-char hex SHAs with tag comments.
- **Security-contract.ts invariants**: No imports, exactly 3 `export const` declarations, `Object.freeze(...) as const` dual-layering, header comment documents the two-step change protocol.
- **No `dist/` or `build` script**: `package.json` has no `build` script, no `main`/`bin` fields, `tsconfig.json` has `noEmit: true`, `.gitignore` excludes `dist/` and `build/`.
- **SEC-02 self-dogfooding**: `security-lint.yml` does not use `pull_request_target` as a trigger (it only appears in the grep pattern in Check 1).

---

_Reviewed: 2026-04-24T17:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
