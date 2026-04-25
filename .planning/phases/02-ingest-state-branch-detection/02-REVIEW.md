---
phase: 02-ingest-state-branch-detection
reviewed: 2026-04-25T00:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - src/index.ts
  - src/ingest/index.ts
  - src/ingest/report-parser.ts
  - src/ingest/summary-writer.ts
  - src/ingest/threshold-evaluator.ts
  - src/shared/config.ts
  - src/shared/loop-guard.ts
  - src/shared/state-branch.ts
  - src/shared/types.ts
  - tests/_helpers/bare-repo.ts
  - tests/_helpers/fixture-report.ts
  - tests/integration/state-branch.test.ts
  - tests/unit/config.test.ts
  - tests/unit/loop-guard.test.ts
  - tests/unit/report-parser.test.ts
  - tests/unit/state-branch-gc.test.ts
  - tests/unit/threshold-evaluator.test.ts
  - vitest.config.ts
  - action.yml
  - package.json
  - .gitignore
  - CLAUDE.md
  - tests/fixtures/sample-report.json
  - tests/fixtures/sample-report-unreadable.json
  - tests/fixtures/sample-report-sharded.json
  - tests/fixtures/sample-runs.ndjson
findings:
  critical: 0
  warning: 2
  info: 6
  total: 8
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-25T00:00:00Z
**Depth:** standard
**Files Reviewed:** 25 (15 source + 10 test/fixture/config)
**Status:** issues_found

## Summary

Phase 02 (ingest + state branch + log-only detection) is in good shape architecturally. All the load-bearing security and contract invariants verified clean:

- **DET-04 enforcement**: `grep -rn "createWorkflowDispatch\|workflow_dispatch" src/` returns empty — log-only contract is honoured. Phase 04 will layer dispatch on top.
- **SEC-05 loop-guard ordering**: `shouldSkipIngest()` is the literal first call inside `run()` in `src/ingest/index.ts:46` — before any I/O, glob, env read, or git operation. Optional chaining on `head_commit?.author?.email` correctly handles `workflow_call`/`pull_request` events (Pitfall D).
- **D-07 secret masking ordering**: `src/index.ts:38-44` calls `getInput` + `setSecret` × 3 before any log line. The unconditional `setSecret(apiKey)` (even when empty) is correctly justified in the header comment — `core.setSecret('')` is a documented no-op, so the invariant holds with zero branching.
- **Worktree cleanup on all exit paths**: `src/ingest/index.ts:140-146` wraps the entire post-bootstrap pipeline in `try { … } finally { removeWorktree(...) }`, and `removeWorktree` itself is belt-and-suspenders (`git worktree remove --force` with `ignoreReturnCode: true`, then `fs.rmSync` regardless).
- **Concurrent-write safety**: `src/shared/state-branch.ts` uses ref-qualified `--force-with-lease=playwright-healer-state` (Pitfall C), atomic `writeFile + rename` for NDJSON (Pitfall B), and exponential backoff with jitter. Bootstrap-race recovery via recursion is bounded (the second call always takes the `lsRemote === 0` path).
- **D-13 / tool-naming contract**: No inline `mcp__*` literals outside `src/shared/security-contract.ts`.
- **No process.exit, no console.log, no console.warn** in `src/`.

The two Warnings below describe real but bounded correctness gaps — both surface only on input shapes that the existing fixtures don't cover, which is why the test suite passes despite them. The Info items are consistency / contract-tightening suggestions.

## Warnings

### WR-01: `walkSuites` drops outer-suite titles for nested `test.describe()` blocks

**File:** `src/ingest/report-parser.ts:45-137`
**Issue:**
The `walkSuites(suites, parentTitle, entries)` function carries a `parentTitle` parameter through recursion (line 54 passes `suiteTitle` as the recursive `parentTitle`), but the testId construction at lines 67-69 uses only the *local* `suiteTitle`:

```ts
const fullTitle = suiteTitle ? `${suiteTitle} > ${specTitle}` : specTitle;
const testId = `${filePath}::${fullTitle}`;
```

`parentTitle` is dead code. For a Playwright report produced by nested `test.describe()` blocks (e.g. `describe('auth') > describe('login') > test('form submit')`), the resulting `testId` becomes `tests/...::login > form submit` instead of the expected `tests/...::auth > login > form submit`. The two specs can then collide across describe groups, producing a phantom flake-rate detection.

The existing fixture `sample-report.json` and the unit tests only cover single-level suites with empty `"suites": []`, so the path is never exercised — confirmed by reading `tests/fixtures/sample-report.json` and `tests/unit/report-parser.test.ts:31`.

**Fix:**
Either (a) consume `parentTitle` in the testId and pass `${parentTitle} > ${suiteTitle}` when recursing, or (b) drop the unused parameter. The first option preserves the documented contract (`{filePath}::{suiteTitle} > {specTitle}`). Suggested patch:

```ts
function walkSuites(suites: unknown[], parentTitle: string, entries: NdjsonTestEntry[]): void {
  for (const suite of suites) {
    if (!suite || typeof suite !== 'object') continue;
    const s = suite as Record<string, unknown>;

    const localTitle = typeof s['title'] === 'string' ? s['title'] : '';
    const suiteTitle = parentTitle
      ? (localTitle ? `${parentTitle} > ${localTitle}` : parentTitle)
      : localTitle;

    if (Array.isArray(s['suites'])) {
      walkSuites(s['suites'] as unknown[], suiteTitle, entries);
    }
    // …rest unchanged; spec processing already uses `suiteTitle`
  }
}
```

Add a unit-test fixture with two-level `describe` nesting (e.g. assert `testId === 'tests/x.spec.ts::auth > login > form submit'`) to lock in the fix.

---

### WR-02: All-corrupt-on-disk reports record as "tests: []" instead of "report-unreadable"

**File:** `src/ingest/index.ts:67-118`
**Issue:**
The ingest loop tracks `reportUnreadable` only when (a) zero glob matches OR (b) `parseReport()` returns `reportUnreadable: true` for a *parsable-as-JSON* report that fails the Zod shape check. The intermediate failure mode — files matched on disk, but every file fails `JSON.parse` (line 76-83 catches and `continue`s) — leaves `reportUnreadable === false` and `allEntries === []`. The record is then emitted with `tests: []` and treated as a "successful run with zero tests" by `evaluateThresholds`, which then under-counts the run window. The ING-03 contract intent ("any unreadable report → tagged unreadable") is broken for this case.

```ts
for (const reportFile of reportFiles) {
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  } catch (err) {
    core.warning(`ING-01: Could not read/parse ${reportFile}: ${String(err)}. Skipping.`);
    continue;   // ← never sets reportUnreadable
  }
  ...
}
```

**Fix:**
Track per-file parse failure and promote to `reportUnreadable` when no file ever produced entries:

```ts
let anyFileParsed = false;
for (const reportFile of reportFiles) {
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  } catch (err) {
    core.warning(`ING-01: Could not read/parse ${reportFile}: ${String(err)}. Skipping.`);
    continue;
  }
  anyFileParsed = true;
  const parsed = parseReport(rawJson);
  if (parsed.reportUnreadable) {
    reportUnreadable = true;
  } else {
    allEntries = allEntries.concat(parsed.entries);
  }
}
if (!anyFileParsed && reportFiles.length > 0) {
  reportUnreadable = true;
}
```

Add a unit test that points the glob at a directory of corrupt JSON and asserts the recorded entry has `outcome === 'report-unreadable'`.

## Info

### IN-01: `outcome: 'timed-out'` is unreachable from real Playwright reports

**File:** `src/ingest/report-parser.ts:29-37`, `src/ingest/threshold-evaluator.ts:64,117`, `src/shared/types.ts:21`
**Issue:**
`mapOutcome()` consumes Playwright's `test.status` enum (`'expected' | 'unexpected' | 'flaky' | 'skipped'`) and never produces `'timed-out'`. Playwright surfaces timeouts via `result.status === 'timedOut'`, which the parser does not inspect. Therefore the `'timed-out'` branch in `evaluateThresholds` (line 64) and the `worstOutcome` priority (line 117) are dead in production — only synthetic test data in `threshold-evaluator.test.ts:142` produces it.

**Fix:**
Either (a) extend `mapOutcome()` to inspect the last result's `status` field and emit `'timed-out'` when `lastResult.status === 'timedOut'` (preserving the priority semantics), or (b) drop `'timed-out'` from the outcome union and the evaluator branches. Option (a) is consistent with the documented intent in `worstOutcome`'s docstring.

---

### IN-02: `branch` field stores fully-qualified ref instead of short branch name

**File:** `src/ingest/index.ts:99`, `src/shared/types.ts:11`
**Issue:**
`branch: github.context.ref` evaluates to `'refs/heads/main'` (or `'refs/pull/N/merge'` on PRs). The integration-test fixture and the sample NDJSON corpus use the short form `'main'`. `NdjsonRecord.branch` has no JSDoc clarifying which form is expected; downstream Phase 04 dispatch logic that filters by branch will trip over this inconsistency.

**Fix:**
Either pin the contract to short form (`github.context.ref.replace(/^refs\/heads\//, '')` and document it in `types.ts`) or pin to fully-qualified ref and update fixtures/tests. Short form is the more usual GitHub idiom.

---

### IN-03: Synthetic `report-unreadable` entry uses the literal `'report-unreadable'` for `testId` and `title`

**File:** `src/ingest/index.ts:103-117`
**Issue:**
When `reportUnreadable === true`, the synthesised entry sets `testId: 'report-unreadable'` and `title: 'report-unreadable'`. A real test happening to use that string would collide. Astronomically unlikely but the magic-string sentinel pattern is fragile.

**Fix:**
Either prefix the sentinel with a character disallowed in real testIds (e.g. `'__report-unreadable__'`) or model "the whole report failed" as an out-of-band field on `NdjsonRecord` (e.g. `reportStatus: 'ok' | 'unreadable'`) instead of a synthetic test entry. The latter is a cleaner schema — but is a contract change, so flag for Phase 04 alignment, not an immediate fix.

---

### IN-04: NDJSON record `runId` falls back to `'local'` when `GITHUB_RUN_ID` is unset

**File:** `src/ingest/index.ts:97`
**Issue:**
`runId: process.env.GITHUB_RUN_ID ?? 'local'`. In a real GitHub runner this is always set; the `'local'` fallback is for local manual invocations. But two local runs in a row will both record `runId: 'local'`, which `appendRecord`'s commit message uses (`stats: run local [skip-healer]`). Not a bug — it just makes the audit trail less useful in local debugging. Worth a nearby comment so future readers know the fallback is deliberate.

**Fix:**
Add an inline comment, or use `process.pid + Date.now()` as the fallback for uniqueness when running outside Actions.

---

### IN-05: Glob with non-JSON matches produces N parse warnings per ingest

**File:** `src/ingest/index.ts:53-91`
**Issue:**
A user-configured `report-path: 'test-results/**'` will match every file in the directory; non-JSON files produce a `core.warning` per file. The ingest still completes correctly, but the Actions log gets noisy. Defaults (`test-results/results.json`) avoid this; only user misconfiguration triggers it.

**Fix:**
Either filter to `*.json` after glob, or document the recommended glob pattern in `action.yml`'s `report-path` description.

---

### IN-06: `runGc` walks `runs/` under the worktree but does not push the GC commit

**File:** `src/shared/state-branch.ts:263-331` (and the docstring at line 258)
**Issue:**
The function intentionally does not push: "GC commit is NOT pushed here; the next `appendRecord` push will carry it." This is fine when the call ordering in `src/ingest/index.ts` is preserved (`appendRecord` precedes `runGc`, and `runGc` precedes the next append on a future ingest). But in the current pipeline, `appendRecord` runs *before* `runGc`, so the GC commit only ships on the *next* ingest's `appendRecord`. If a project ingests rarely, retention prunes can lag by one full ingest cycle. Worth surfacing in the docstring or, better, swapping the order so `runGc` runs *before* `appendRecord` (which would push both commits in one shot).

**Fix:**
Swap step 6 and step 5 in `src/ingest/index.ts` (run GC first, then append + push), and update the docstring. Alternatively, keep the order and explicitly document the one-cycle lag.

---

_Reviewed: 2026-04-25T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
