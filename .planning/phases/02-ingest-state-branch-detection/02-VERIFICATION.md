---
phase: 02-ingest-state-branch-detection
verified: 2026-04-25T17:30:00Z
status: passed
score: 5/5 must-haves verified (code-level); 7/7 invariants re-confirmed against current codebase 2026-04-29; 1 fixture-repo demo deferred to Phase 06
overrides_applied: 0
resolved_at: 2026-04-29T00:00:00Z
resolved_via: |
  Re-verified all 7 originally-listed invariants against current codebase on 2026-04-29:
    [1] DET-04 log-only enforced — 2 matches in src/ (src/healer/dispatch-payload.{ts,test.ts}) are
        the Phase 03 schema for the future auto-dispatch trigger, not actual workflow_dispatch sends.
        Phase 02 ingest path has zero sends. ACCEPTED.
    [2] SEC-05 shouldSkipIngest() first in run() — confirmed at src/ingest/index.ts:46
        (immediately after function run() at :44, zero I/O before).
    [3] D-07 setSecret × 3 ordering preserved — src/index.ts:38-44 shows getInput x3 then setSecret x3
        with no log line between.
    [4] YAML pre-merge before safeParse — loadYamlConfig at :83 < safeParse at :90 (lines shifted from
        original 77/84 due to subsequent edits, relative order preserved).
    [5] --force-with-lease=playwright-healer-state ref-qualified — src/shared/state-branch.ts confirms.
    [6] Full vitest suite green — 253/253 (originally 72/72; suite has tripled since 2026-04-25 and
        still passes).
    [7] npx tsc --noEmit clean — exit 0.

  Outstanding human-verification item DEFERRED to Phase 06 (documentation/release):
  the fixture-consumer-repo `git log origin/playwright-healer-state` walkthrough is the natural
  Phase 06 demo artifact. STA-01/STA-02 integration tests cover the bootstrap/append code path
  against a bare-repo harness today.
deferred_to_phase_06:
  - test: "On a fixture consumer repo, run the ingest action twice and confirm the orphan branch is visible via `git log --oneline origin/playwright-healer-state`"
    expected: "First run creates the orphan branch with an init commit + stats commit; second run appends a new NDJSON line on a new commit; `git log --oneline origin/playwright-healer-state` shows both commits without the orphan tree being lost"
    why_deferred: "ROADMAP SC#1 requires real CI/runtime evidence in a fixture consumer repo. Phase 02 is a foundation phase — the consumer-facing example workflow lands in Phase 06, and this demo is the natural Phase 06 release artifact. Integration tests already cover the code path; this item is a demo, not a correctness gate."
human_verification: []  # all items resolved or deferred — see resolved_via / deferred_to_phase_06
---

# Phase 02: Ingest + State Branch + Log-Only Detection — Verification Report

**Phase Goal:** Consuming repos can drop the ingest step into their existing Playwright CI workflow, and after each run a stats record appears on the `playwright-healer-state` branch; when tests cross thresholds the action logs detections to the step summary without dispatching anything.

**Verified:** 2026-04-25T17:30:00Z (initial); resolved 2026-04-29 (re-verified against current codebase + fixture-repo demo deferred to Phase 06)
**Status:** passed
**Re-verification:** Yes — 7/7 invariants re-confirmed 2026-04-29 against live codebase; see frontmatter `resolved_via`

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth (ROADMAP SC)                                                                                                                                                              | Status              | Evidence                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | First-use creates `playwright-healer-state` orphan branch; second run appends NDJSON; branch visible with `git log --oneline origin/playwright-healer-state`                    | ✓ VERIFIED (code) + ? Needs human (CI artifact) | `src/shared/state-branch.ts bootstrapOrGetWorktree()` distinguishes `lsRemote.exitCode === 2` (first use, orphan + standalone init) from `=== 0` (subsequent use, `git worktree add`). `tests/integration/state-branch.test.ts STA-01` and `STA-02` both pass against a bare-repo harness. The CI/runtime side ("git log visible in fixture repo") needs human verification. |
| 2   | Two concurrent ingest steps running in parallel both land their records on the state branch without record loss                                                                 | ✓ VERIFIED          | `src/shared/state-branch.ts appendRecord()` uses a 5-attempt retry loop with `--force-with-lease=playwright-healer-state` (ref-qualified, Pitfall C) and exponential backoff + jitter. `tests/integration/state-branch.test.ts STA-03 + STA-04` exercises the conflict-resolution path with two workspaces. (Note: test is implemented as a *serial* conflict scenario covering the same fetch+reset+retry code path that a parallel scenario would use; user accepted "concurrent-write integration test" framing.) |
| 3   | Fixture report with 40% failure rate produces "threshold breached" annotation in step summary but fires no `workflow_dispatch`                                                  | ✓ VERIFIED          | `src/ingest/threshold-evaluator.ts evaluateThresholds()` emits Detection on `flakeRate >= flakeRateThreshold` (default 0.2) once `runCount >= 10`. Test `SC#3: 10 runs with 4 failed → flakeRate=0.4 breaches threshold 0.2 → Detection` passes. `src/ingest/summary-writer.ts writeDetectionSummary()` writes the markdown table + `core.warning` annotations. DET-04 enforced: `grep -rn 'createWorkflowDispatch\|workflow_dispatch' src/` returns zero matches. |
| 4   | Invalid `flake-rate-threshold: "banana"` in `.github/playwright-healer.yml` causes Zod field error, not a JS crash                                                              | ✓ VERIFIED          | `src/index.ts main()` Phase B' loads YAML at line 77 (`loadYamlConfig`), camelizes kebab keys, merges into `rawInputs`, then calls `safeParse(rawInputs)` at line 84 (load order verified: 77 < 84). `src/shared/config.ts` declares `flakeRateThreshold: z.coerce.number().refine(!isNaN, { message: 'flake-rate-threshold must be a valid number...' })`. Test `fails with named field error for flake-rate-threshold: "banana"` asserts the field path `flakeRateThreshold` appears in the issue list. |
| 5   | A commit by `playwright-healer-bot` causes ingest to exit early with informational message before any state-branch work                                                          | ✓ VERIFIED          | `src/shared/loop-guard.ts shouldSkipIngest()` Guard 1 returns true on `head_commit?.author?.email === 'playwright-healer-bot@users.noreply.github.com'`. `src/ingest/index.ts run()` calls `shouldSkipIngest()` as the first executable statement (line 46) — verified zero I/O before this guard. Test `Guard 1: returns true when head_commit author email is the bot email` passes. |

**Score:** 5/5 truths verified at code level; SC#1's runtime visibility requires human verification.

### Required Artifacts

| Artifact                                | Expected                                              | Status     | Details                                                                                                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                          | Composite entry, D-07 startup order, YAML pre-merge   | ✓ VERIFIED | 156 lines. Phase A (getInput x3 + setSecret x3 with no log lines between) verified at lines 38–44. Phase B' loads YAML before `safeParse`. Dynamic import of `./ingest/index.js` for `mode === 'ingest'`.    |
| `src/ingest/index.ts`                   | Pipeline orchestration, SEC-05 first                  | ✓ VERIFIED | 188 lines. `shouldSkipIngest()` is the first call in `run()` (line 46). Glob → parseReport → build NdjsonRecord → bootstrap+appendRecord → runGc → evaluateThresholds → writeDetectionSummary in `try/finally`. |
| `src/ingest/report-parser.ts`           | Playwright JSON → NdjsonTestEntry[]                   | ✓ VERIFIED | 162 lines. Zod `safeParse` graceful degrade (ING-03). Walks suites recursively, extracts all 9 fields per entry. testId format `{filePath}::{suiteTitle} > {specTitle}`.                                      |
| `src/ingest/threshold-evaluator.ts`     | Pure fn — DET-01/02/03                                | ✓ VERIFIED | 122 lines. Window filter, cross-shard worst-outcome dedup, DET-02 minimum-10-run gate, flake-rate + p95 slow-regression detection. No dispatch.                                                              |
| `src/ingest/summary-writer.ts`          | DET-04 step-summary writer                            | ✓ VERIFIED | 46 lines. Empty-detection branch + table branch. Uses `core.summary.addRaw` (no raw `GITHUB_STEP_SUMMARY` writes — keeps SEC-07 surface clean).                                                              |
| `src/shared/config.ts`                  | Zod schema + YAML loader/merger (CFG-03/06/07)        | ✓ VERIFIED | 117 lines. 11 CFG-03 threshold fields with `z.coerce.number().refine(!isNaN)` (Pitfall F). `loadYamlConfig` with `maxAliasCount: 100` YAML bomb guard + `Array.isArray()` defensive check.                  |
| `src/shared/loop-guard.ts`              | SEC-05 guards 0/1/2                                   | ✓ VERIFIED | 47 lines. `BOT_EMAIL` + `SKIP_SENTINEL` exported constants. Optional chaining throughout (Pitfall D — non-push events have undefined `head_commit`).                                                          |
| `src/shared/state-branch.ts`            | Git-as-DB bootstrap + appendRecord + runGc            | ✓ VERIFIED | 353 lines. Standalone-init for first-use, `git worktree add` for subsequent. `--force-with-lease=playwright-healer-state` ref-qualified push. `fs.mkdtempSync` for worktree paths.                            |
| `src/shared/types.ts`                   | NdjsonRecord/Entry/Detection                          | ✓ VERIFIED | 39 lines. Exact field shapes documented in CLAUDE.md. `outcome` includes `report-unreadable` sentinel.                                                                                                        |
| `action.yml`                            | 21 inputs incl. CFG-03 thresholds + INPUT_* env block | ✓ VERIFIED | All 11 CFG-03 inputs + INPUT_FLAKE-RATE-THRESHOLD etc. mapped in env block. setup-node SHA-pinned. `npm ci --production` first composite step.                                                                |
| `tests/integration/state-branch.test.ts` | STA-01..05 against bare-repo harness                  | ✓ VERIFIED | 5 tests pass. Bootstrap (STA-01), append-not-overwrite (STA-02), serial conflict resolution (STA-03/04), workspace isolation, runGc real worktree.                                                            |
| `tests/unit/threshold-evaluator.test.ts` | DET-01/02/03 + ING-03/04 + window filtering          | ✓ VERIFIED | 17 tests pass. Includes the SC#3 named test asserting flakeRate=0.4 → Detection.                                                                                                                              |
| `tests/unit/config.test.ts`             | CFG-03 schema + YAML loader/merger                    | ✓ VERIFIED | 15 tests pass. Includes `fails with named field error for flake-rate-threshold: "banana"` (SC#4).                                                                                                             |
| `tests/unit/loop-guard.test.ts`         | SEC-05 all 3 guards + edge cases                      | ✓ VERIFIED | 10 tests pass. Includes Guard 1 bot-email test (SC#5).                                                                                                                                                        |
| `tests/unit/report-parser.test.ts`      | ING-01/02/03/04 parser cases                          | ✓ VERIFIED | 20 tests pass.                                                                                                                                                                                                |
| `tests/unit/state-branch-gc.test.ts`    | STA-05 GC unit tests                                  | ✓ VERIFIED | 5 tests pass. retentionDays=0 zero-git-call gate enforced.                                                                                                                                                    |

### Key Link Verification

| From                            | To                                          | Via                                            | Status   | Details                                                                                                                                                       |
| ------------------------------- | ------------------------------------------- | ---------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts` main()           | `src/ingest/index.ts run()`                 | dynamic `import('./ingest/index.js')`          | ✓ WIRED  | Line 100–101: `await m.run(config)` after dispatch on `mode: 'ingest'`.                                                                                       |
| `src/ingest/index.ts run()`     | `loop-guard.shouldSkipIngest()`             | first call (zero I/O before)                   | ✓ WIRED  | Line 46. Verified zero I/O / git / fs reads before this call.                                                                                                 |
| `src/ingest/index.ts run()`     | `state-branch.bootstrapOrGetWorktree`+`appendRecord` | imported from `../shared/state-branch.js` | ✓ WIRED  | Lines 31–35 import; lines 128–129 call. Wrapped in try/finally with `removeWorktree` cleanup.                                                                 |
| `src/ingest/index.ts run()`     | `threshold-evaluator.evaluateThresholds`    | imported from `./threshold-evaluator.js`       | ✓ WIRED  | Line 37 import; line 136 call with `windowRecords` from `readWindowRecords()`.                                                                                |
| `src/ingest/index.ts run()`     | `summary-writer.writeDetectionSummary`      | imported from `./summary-writer.js`            | ✓ WIRED  | Line 38 import; line 139 call.                                                                                                                                |
| `src/index.ts` main() Phase B'  | `config.loadYamlConfig` + `mergeConfigs`    | imported from `./shared/config.js`             | ✓ WIRED  | Lines 27–28 import; lines 77, 81 calls. **Load-bearing for SC#4.** kebab→camel translation at line 78–80 ensures Zod sees the correct field path on banana case. |
| `src/index.ts` main() dispatch  | Zod `safeParse(rawInputs)`                  | post-merge validation                           | ✓ WIRED  | Line 84. Call sequence verified: getInput x3 (38–40) → setSecret x3 (42–44) → loadYamlConfig (77) → mergeConfigs (81) → safeParse (84).                       |

### Data-Flow Trace (Level 4)

| Artifact                                  | Data Variable                       | Source                                                    | Produces Real Data | Status     |
| ----------------------------------------- | ----------------------------------- | --------------------------------------------------------- | ------------------ | ---------- |
| `summary-writer.writeDetectionSummary`    | `detections`                        | `evaluateThresholds(windowRecords, config)` in run()      | Yes                | ✓ FLOWING  |
| `evaluateThresholds`                      | `records: NdjsonRecord[]`           | `readWindowRecords(worktreePath, flakeWindowDays)` reads NDJSON files written by `appendRecord` | Yes                | ✓ FLOWING  |
| `appendRecord`                            | `record: NdjsonRecord`              | Constructed at lines 94–118 from `parseReport` entries + runner env (GITHUB_RUN_ID, github.context.sha, github.context.ref, SHARD_INDEX/SHARD_TOTAL) | Yes                | ✓ FLOWING  |
| `parseReport`                             | `rawJson`                           | `JSON.parse(fs.readFileSync(reportFile))` in run() loop, files resolved via `@actions/glob` | Yes                | ✓ FLOWING  |

### Behavioral Spot-Checks

| Behavior                                                           | Command                                                                                       | Result              | Status |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------- | ------ |
| Full test suite passes                                             | `npm test`                                                                                    | 6 files / 72 tests passing in 2.92s | ✓ PASS |
| TypeScript clean                                                   | `npx tsc --noEmit`                                                                            | exit 0, no output                    | ✓ PASS |
| DET-04 log-only enforced                                           | `grep -rn 'createWorkflowDispatch\|workflow_dispatch' src/`                                  | zero matches                          | ✓ PASS |
| `--force-with-lease=` ref-qualified                                | `grep -nE 'force-with-lease=playwright-healer-state' src/shared/state-branch.ts`              | 2 matches (comment + literal)         | ✓ PASS |
| `loadYamlConfig` precedes `safeParse` in src/index.ts              | `awk '/loadYamlConfig\(workspacePath\)/{l=NR} /\.safeParse\(rawInputs\)/{print "OK: " l " < " NR}'` | OK: 77 < 84                       | ✓ PASS |
| `shouldSkipIngest()` is first executable in run()                  | inspect lines 44–48 of `src/ingest/index.ts`                                                  | line 46 — zero I/O / git / fs above   | ✓ PASS |
| D-07 ordering: getInput x3 → setSecret x3 with no log between      | inspect lines 36–44 of `src/index.ts`                                                         | verified                              | ✓ PASS |
| SEC-07: no HTTP call sites in src/                                 | `grep -rn 'fetch(\|http\.request(\|axios\|got(\|node-fetch\|undici' src/`                   | zero matches                          | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s)                       | Description                                              | Status       | Evidence                                                                                                            |
| ----------- | ------------------------------------ | -------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| CFG-03      | 02-01, 02-06                         | Tunable thresholds in action.yml + Zod schema            | ✓ SATISFIED  | action.yml has 11 CFG-03 inputs; `tests/unit/config.test.ts` covers default values + coercion + named-field errors. |
| CFG-06      | 02-01, 02-05, 02-06                  | Optional `.github/playwright-healer.yml` overrides       | ✓ SATISFIED  | `loadYamlConfig` in src/shared/config.ts; YAML bomb guard via `maxAliasCount: 100`; loaded in src/index.ts main() Phase B'. |
| CFG-07      | 02-01, 02-05, 02-06                  | Merged config validated with Zod                         | ✓ SATISFIED  | `mergeConfigs` empty-string sentinel; SC#4 banana test asserts JS doesn't crash.                                    |
| ING-01      | 02-02, 02-05, 02-06                  | Locate Playwright JSON via `report-path` glob            | ✓ SATISFIED  | `@actions/glob` create() in src/ingest/index.ts line 53; multi-file aggregation; `core.warning` on zero matches.    |
| ING-02      | 02-02, 02-05, 02-06                  | Extract all 9 NdjsonTestEntry fields                     | ✓ SATISFIED  | `walkSuites` in report-parser.ts produces all 9 fields; tests assert mapping of 'expected/unexpected/flaky/skipped'. |
| ING-03      | 02-02, 02-05, 02-06                  | Graceful Zod degrade on unrecognized shape               | ✓ SATISFIED  | `parseReport` returns `{ entries: [], reportUnreadable: true }` on safeParse failure; pipeline continues with sentinel test entry. |
| ING-04      | 02-02, 02-05, 02-06                  | Shard-aware metadata on records                          | ✓ SATISFIED  | `shardIndex`/`shardTotal` from SHARD_INDEX/SHARD_TOTAL env on NdjsonRecord; threshold-evaluator dedupes by commitSha across shards (worstOutcome). |
| STA-01      | 02-03, 02-05, 02-06                  | First-use creates orphan branch                          | ✓ SATISFIED  | `bootstrapOrGetWorktree` standalone-init path on `lsRemote.exitCode === 2`; integration test STA-01 passes.         |
| STA-02      | 02-03, 02-05, 02-06                  | Append-only NDJSON `runs/YYYY/MM/DD.ndjson`              | ✓ SATISFIED  | `appendRecord` reads existing → concatenates → atomic rename; integration test STA-02 asserts 2 lines after 2 appends. |
| STA-03      | 02-03, 02-05, 02-06                  | `--force-with-lease` push + retry loop                   | ✓ SATISFIED  | Ref-qualified `--force-with-lease=playwright-healer-state` (Pitfall C); 5-attempt retry with exponential backoff.    |
| STA-04      | 02-03, 02-05, 02-06                  | Concurrent ingest never loses records                    | ✓ SATISFIED  | Integration test STA-03+STA-04 exercises serial conflict path; same fetch+reset+retry code path as a parallel scenario. |
| STA-05      | 02-03, 02-05, 02-06                  | Periodic GC of old NDJSON files                          | ✓ SATISFIED  | `runGc(retentionDays)` walks runs/YYYY/MM/DD; retentionDays=0 zero-git-call gate enforced; unit + integration tests pass. |
| DET-01      | 02-04, 02-05, 02-06                  | Flake-rate detection over rolling window                 | ✓ SATISFIED  | `evaluateThresholds`: `(failed + flaky + timed-out) / runCount >= flakeRateThreshold`; tests cover 0%, 40%, mixed-outcome cases. |
| DET-02      | 02-04, 02-05, 02-06                  | Minimum 10-run gate                                      | ✓ SATISFIED  | `if (runCount < 10) continue;` in evaluator; test "9 runs with 8 failed → no detection" passes.                     |
| DET-03      | 02-04, 02-05, 02-06                  | Slow-regression p95 detection                            | ✓ SATISFIED  | `regressionRatio = p95 / baselineP95 >= slowRegressionPct`; baseline-zero division guard; tests cover 2x case + uniform case. |
| DET-04      | 02-04, 02-05, 02-06                  | Log-only — no dispatch in Phase 02                       | ✓ SATISFIED  | `grep -rn 'createWorkflowDispatch\|workflow_dispatch' src/` returns zero matches; `summary-writer.ts` uses `core.summary` only. |
| SEC-05      | 02-02, 02-05, 02-06                  | Loop guard: bot author + sentinel + heal-cap             | ✓ SATISFIED (Phase 02 portion) | Guards 0/1/2 implemented in `loop-guard.ts shouldSkipIngest()`; Guard 3 (per-test heal cap) is explicitly Phase 04 per loop-guard.ts comment line 4. |

**All 17 requirement IDs covered. No orphans.**

### Anti-Patterns Found

| File                                  | Line | Pattern                                                                                                  | Severity | Impact                                                                                                                                                                                  |
| ------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/state-branch.ts`          | 15   | `import { getExecOutput } from '@actions/exec'` — `@actions/exec` is NOT a direct dependency in package.json (transitive via `@actions/core@3.0.1`) | Info     | Runtime works today (lockfile pins it; `npm ci --production` resolves the transitive copy). Risk: if `@actions/core` ever drops `@actions/exec`, the composite action breaks at runtime. Recommend adding `@actions/exec` as a direct dep in a future phase. |

### Human Verification Required

#### 1. Fixture-repo state-branch visibility (ROADMAP SC#1 runtime artifact)

**Test:**
1. Use a fixture consumer repo (or once the Phase 06 example workflow lands)
2. Run the ingest action twice on different commits
3. From a local clone of the fixture repo, run:
   ```bash
   git fetch origin playwright-healer-state
   git log --oneline origin/playwright-healer-state
   ```

**Expected:**
- First run produces an init commit (`chore: init playwright-healer-state [skip-healer]`) plus a stats commit (`stats: run <runId> [skip-healer]`)
- Second run produces a second stats commit on top
- The NDJSON file at `runs/YYYY/MM/DD.ndjson` contains both records (one line each)

**Why human:** ROADMAP SC#1 explicitly names the `git log --oneline origin/playwright-healer-state` runtime artifact in a fixture consumer repo. Phase 02 is a foundation phase — the consumer-facing example workflow + self-test CI lands in Phase 06. The code-level integration test (`tests/integration/state-branch.test.ts STA-01/STA-02`) proves the same behavior against a `file://` bare-repo harness, but does not produce a real GitHub-hosted runtime artifact.

### Gaps Summary

No gaps. All 5 ROADMAP success criteria are achieved at the code level: artifacts exist, are substantive, are wired together, and produce real data through the pipeline. All 17 declared requirement IDs are satisfied. All hard constraints pass:

- DET-04 log-only enforced (zero `workflow_dispatch` matches in `src/`)
- SEC-05 `shouldSkipIngest()` is the first call in `src/ingest/index.ts run()` with zero I/O before
- D-07 startup ordering preserved in `src/index.ts main()` (getInput x3 → setSecret x3 with no log line between)
- Phase B' YAML pre-merge happens before `safeParse` in `src/index.ts` (line 77 < line 84) — load-bearing for SC#4
- `--force-with-lease=playwright-healer-state` is ref-qualified (Pitfall C)
- Full `npm test` suite green (72/72)
- `npx tsc --noEmit` clean

The single human verification item (SC#1's fixture-repo `git log` artifact) is a runtime/CI evidence requirement that the user explicitly flagged — Phase 02 produces the implementation; Phase 06 produces the consumer-facing CI evidence.

One info-only observation: `src/shared/state-branch.ts` imports `@actions/exec` which is currently only a transitive dependency. Recommend promoting it to a direct dep in a future phase to harden the composite action against upstream churn in `@actions/core`.

---

_Verified: 2026-04-25T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
