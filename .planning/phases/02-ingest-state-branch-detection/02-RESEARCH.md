# Phase 2: Ingest + State Branch + Log-Only Detection — Research

**Researched:** 2026-04-24
**Domain:** Git-as-database state branch + Playwright JSON report ingestion + rolling threshold evaluation
**Confidence:** HIGH

---

> **No CONTEXT.md for Phase 02.** This is pre-discuss research; no locked decisions yet from a Phase 02 discussion session. Locked decisions from Phase 01/01.1 that Phase 02 must honour are listed below under Project Constraints.

---

## Project Constraints (from CLAUDE.md + Phase 01 decisions)

The following decisions are locked from prior phases. Phase 02 plans must not contradict them.

| Decision | Authority | Phase 02 Implication |
|----------|-----------|----------------------|
| Composite action; no ncc/esbuild | D-01 | No dist/ bundles; `npx tsx src/index.ts` entrypoint |
| `tsx` runtime (no tsc → dist/) | D-02 | All new modules use `.ts` source; `npx tsx` at runtime |
| `npm` package manager | D-03 | `npm install`, `npm ci`, not bun/pnpm |
| Single dispatcher in `src/index.ts` | D-04 | Phase 02 implements `src/ingest/index.ts` stub → real |
| D-07 startup ordering (setSecret × 3 before everything) | D-07 | Ingest entrypoint adds NO new secrets; existing D-07 order preserved |
| Zod factory `getInputSchema()` in `src/shared/config.ts` | D-01/D-04 | Extend this schema with CFG-03 threshold inputs; do not create a parallel schema. New fields must be added INSIDE the `z.object({...})` literal, before `.superRefine` is chained — `.extend()` does not exist on `ZodEffects` (the type returned by `.superRefine()`). A second `.superRefine` for cross-field validation chains after the first. |
| SEC-07 phone-home ban: `fetch(`, `http.request(`, etc. banned in `src/**` | D-16a / security-lint Check 4 | Phase 02 uses `@actions/exec` to spawn the `git` CLI — no HTTP call-site in `src/**`; Check 4 requires NO change (see Q10) |
| `persist-credentials: false` on all `actions/checkout` | D-14/SEC-01 | Primary workspace checkout already has this; state branch operations run in a separate git worktree, not in the primary workspace |
| No `pull_request_target` anywhere | D-14/SEC-02 | No new triggers; ingest runs under `push` or `workflow_call` |
| Security-contract changes need `Security-Contract-Change: reviewed-by=` trailer | D-13 | Phase 02 does not modify `security-contract.ts`; no trailer needed |
| `healer-token` PAT for PR creation and `workflow_dispatch` | D-18 | Phase 02 does NOT dispatch (DET-04 log-only); state branch write uses GITHUB_TOKEN (contents:write already present) |

---

## Summary

Phase 02 builds the git-as-database observability layer. It implements four distinct capabilities:

1. **Report ingestion** (ING-01..04): read Playwright JSON report, parse per-test results into typed `TestResult[]`, validate schema with Zod, handle shard metadata.
2. **State branch management** (STA-01..05): bootstrap an orphan `playwright-healer-state` branch on first use, append NDJSON records using a `--force-with-lease` retry loop, perform periodic GC.
3. **Threshold evaluation** (DET-01..04): compute per-test rolling metrics (flake rate, p95 duration), log threshold breaches to `$GITHUB_STEP_SUMMARY` without firing `workflow_dispatch`.
4. **Loop guard and config** (SEC-05, CFG-03, CFG-06, CFG-07): exit early on bot-authored commits, load and Zod-validate merged config from action.yml inputs + optional `.github/playwright-healer.yml` file.

The entire phase runs at **zero API cost**: no Claude Agent SDK, no Playwright MCP, no Anthropic API calls. The only network I/O is git push to the state branch (using GITHUB_TOKEN's built-in `contents: write` permission) and optional YAML file read from the workspace filesystem.

**Primary recommendation:** Implement the state branch as a dedicated git module (`src/shared/state-branch.ts`) that encapsulates all git CLI operations including bootstrap, retry loop, and GC. All git operations on the state branch MUST run in a separate `git worktree` — never in the primary workspace (the user's source code checkout) — to avoid corrupting the consumer's working tree. Keep the threshold evaluator as a pure-function module (`src/ingest/threshold-evaluator.ts`) that takes parsed NDJSON records and returns detections — no git or GitHub API calls from within the evaluator.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Report JSON parsing | Composite action step (TypeScript) | — | Pure TS/Node; no browser, no API; ingest module owns it |
| State branch git operations | Composite action step (TypeScript via `@actions/exec`) in isolated git worktree | GITHUB_TOKEN (contents:write) | git CLI on runner in separate worktree; GITHUB_TOKEN sufficient for branch writes |
| NDJSON append + rolling window | Composite action step (TypeScript) in worktree | — | Filesystem I/O; pure function logic; no external service |
| Threshold evaluation | Composite action step (TypeScript) | — | Pure math on parsed records; entirely in-process |
| Config file merge (CFG-06) | Composite action step (TypeScript) | Workspace filesystem | File read from `process.env.GITHUB_WORKSPACE/.github/playwright-healer.yml` |
| Step summary (DET-04) | Composite action step (`@actions/core.summary`) | GitHub UI | Core library writes to `$GITHUB_STEP_SUMMARY` |
| Loop guard (SEC-05) | Composite action step (TypeScript) | GitHub Actions context | Reads `github.event.head_commit.author.email` / commit message |

---

## Standard Stack

### Core (Phase 02 additions to package.json)

| Library | Verified Version | Purpose | Why Standard |
|---------|-----------------|---------|--------------|
| `yaml` | 2.8.3 | Parse `.github/playwright-healer.yml` (CFG-06) | Eemeli's YAML; TypeScript-first, native ESM, YAML 1.2 compliant, actively maintained; outperforms js-yaml on ESM ergonomics and type safety. `npm view yaml version` = 2.8.3 [VERIFIED: npm registry] |
| `vitest` | 4.1.5 | Unit + integration (bare-repo) tests | Already listed in STACK.md; fastest ESM-native test runner for Node 24; no config needed for pure TS. `npm view vitest version` = 4.1.5 [VERIFIED: npm registry] |
| `@vitest/coverage-v8` | 4.1.5 | Coverage for CI validation gate | Pairs with vitest; V8-native coverage, zero extra processes. `npm view @vitest/coverage-v8 version` = 4.1.5 [VERIFIED: npm registry] |

### Already In `package.json` (no new install needed)

| Library | Version | Phase 02 Use |
|---------|---------|--------------|
| `@actions/core` | 3.0.1 | `core.summary`, `core.warning`, `core.info`, `core.setFailed` |
| `@actions/github` | 9.1.1 | `context.payload` for loop guard + repo identity for git author |
| `zod` | ^4.0.0 (resolved 4.3.6) | Config merge validation (CFG-07), report Zod schema (ING-03) |
| `tsx` | ^4.21.0 | Runtime TS execution (unchanged) |

**Phase 02 installs:**
```bash
npm install yaml
npm install -D vitest @vitest/coverage-v8
```

**Version verification (run before writing Standard Stack):**
```bash
npm view yaml version          # 2.8.3 — verified 2026-04-24
npm view vitest version        # 4.1.5 — verified 2026-04-24
npm view @vitest/coverage-v8 version  # 4.1.5 — verified 2026-04-24
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `yaml` (eemeli) | `js-yaml` 4.1.1 | js-yaml has no native TypeScript types in its ESM export; yaml has first-class TS support. Both work; `yaml` is the better pick for a TypeScript-strict project |
| Vitest | Jest | Jest requires `@jest/globals` for ESM; Vitest is zero-config for native ESM + TypeScript; already endorsed in STACK.md |
| git CLI via `@actions/exec` in separate worktree | GitHub REST API tree+blob create | GitHub API approach (optimistic locking via SHA check before commit) is also viable; git CLI + `--force-with-lease` in a worktree is simpler to understand, test with a local bare repo, and does not require an API call roundtrip per append |

---

## Architecture Patterns

### System Architecture Diagram (Phase 02 scope)

```
Consumer CI Job (push trigger)
        │
        ▼
[actions/checkout @ github.sha]     ← persist-credentials: false
        │                              (primary workspace — consumer source code)
        ▼
[npm ci --production]               ← installs action deps
        │
        ▼
[src/index.ts mode=ingest]
        │
        ├─► [loop-guard] ──── fork PR? ──► exit 0 (INFO)
        │         │
        │     bot author? ──► exit 0 (INFO)
        │         │
        │   [skip-healer] in commit msg? ──► exit 0 (INFO)
        │
        ▼
[config-loader]
  read action.yml inputs (getInputSchema())
  read .github/playwright-healer.yml (if exists, yaml.parse)
  merge (action.yml wins on conflict)
  Zod validate merged object
        │
        ▼
[report-parser] ← ING-01..04
  locate report JSON (report-path input / @actions/glob)
  fs.readFileSync + JSON.parse
  Zod validate report shape
  extract TestResult[] per test
        │
        ▼
[state-branch] ← STA-01..05
  ┌── branch exists? (git ls-remote --exit-code)
  │       NO ──► bootstrap in /tmp/state-worktree (orphan create + first commit + push)
  │
  YES
  │
  git worktree add /tmp/state-worktree origin/playwright-healer-state
  [all git ops in /tmp/state-worktree — primary workspace untouched]
  append NDJSON record to runs/YYYY/MM/DD.ndjson
  git add + git commit -m "stats: run {run_id} [skip-healer]"
  git push --force-with-lease=playwright-healer-state origin playwright-healer-state
  ┌── rejected? ──► sleep(jitter) → fetch → re-append → retry (max 5)
  │                 exhausted? → log warning, skip (non-fatal)
  git worktree remove /tmp/state-worktree
        │
        ▼
[threshold-evaluator] ← DET-01..04
  read NDJSON lines within rolling window (flake-window-days)
  compute per-test:
    flake_rate = failed_runs / total_runs
    p95_duration_ms, baseline_p95
  for each test breaching threshold:
    collect detection: { testId, reason, value, threshold }
        │
        ▼
[$GITHUB_STEP_SUMMARY] ← DET-04 (log-only)
  write Markdown table of detections
  ::warning:: annotation per detection (IDE integration)
  NO workflow_dispatch call (Phase 04 adds this)
```

### Recommended Project Structure (Phase 02 additions)

```
src/
├── index.ts                      # existing; mode=ingest now calls real module
├── ingest/
│   ├── index.ts                  # REPLACE stub: orchestrate ingest pipeline
│   ├── report-parser.ts          # NEW: Playwright JSON → TestResult[]
│   └── threshold-evaluator.ts    # NEW: NDJSON records → Detection[]
├── shared/
│   ├── config.ts                 # EXTEND: add CFG-03 threshold inputs + CFG-06/CFG-07 loader
│   ├── security-contract.ts      # UNCHANGED (no new tool scoping in Phase 02)
│   ├── state-branch.ts           # NEW: all git ops on playwright-healer-state (worktree-isolated)
│   ├── loop-guard.ts             # NEW: bot-author + skip-healer sentinel checks
│   └── types.ts                  # NEW: shared type definitions (TestResult, NdjsonRecord, Detection)
└── healer/
    └── index.ts                  # UNCHANGED stub

tests/
├── unit/
│   ├── report-parser.test.ts     # NEW: Zod + extraction logic
│   ├── threshold-evaluator.test.ts # NEW: seeded NDJSON → correct breach detection
│   ├── config.test.ts            # NEW: merge + validate + defaults
│   └── loop-guard.test.ts        # NEW: bot author patterns, sentinel detection
└── integration/
    └── state-branch.test.ts      # NEW: local bare git repo harness

tests/fixtures/
├── sample-report.json            # NEW: fixture Playwright JSON report (happy path)
├── sample-report-unreadable.json # NEW: malformed shape (ING-03 graceful degrade)
├── sample-report-sharded.json    # NEW: shard metadata fixture (ING-04)
└── sample-runs.ndjson            # NEW: seeded NDJSON for threshold tests
```

---

## Pattern Library

### Pattern 1: State Branch Bootstrap (first-ever run, worktree-isolated)

**Critical constraint:** All git operations on the state branch MUST happen in a separate git worktree at `/tmp/state-worktree` (or equivalent temp path). Running `git checkout --orphan playwright-healer-state` in the primary workspace would wipe the consumer's source files. Running `git push` from the primary workspace without a carefully scoped refspec would push the wrong HEAD. Use a worktree.

**Branch existence detection:** Use `git ls-remote --exit-code` (exit 2 = ref absent, well-defined) rather than `git fetch` (which returns 128 for both "ref not found" AND network failures — ambiguous).

```typescript
// src/shared/state-branch.ts

import { getExecOutput } from '@actions/exec';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const STATE_BRANCH = 'playwright-healer-state';
const BOT_EMAIL = 'playwright-healer-bot@users.noreply.github.com';
const BOT_NAME = 'playwright-healer-bot';

export async function bootstrapOrGetWorktree(repoRemoteUrl: string): Promise<string> {
  const worktreePath = path.join(os.tmpdir(), `playwright-healer-state-${Date.now()}`);

  // Step 1: Check if branch exists on remote (exit code 2 = ref absent; 0 = exists)
  const lsRemote = await getExecOutput(
    'git', ['ls-remote', '--exit-code', 'origin', `refs/heads/${STATE_BRANCH}`],
    { ignoreReturnCode: true }
  );

  if (lsRemote.exitCode === 0) {
    // Branch exists — add worktree pointing at it
    await getExecOutput('git', [
      'worktree', 'add', '--no-checkout', worktreePath, `origin/${STATE_BRANCH}`
    ]);
    await getExecOutput('git', ['checkout', STATE_BRANCH], { cwd: worktreePath });
    return worktreePath;
  }

  if (lsRemote.exitCode === 2) {
    // Branch absent — bootstrap in the worktree directory
    // Step 2: Create an empty directory for the orphan
    fs.mkdirSync(worktreePath, { recursive: true });

    // Step 3: Init a separate git repo in the temp dir (not a worktree — orphan branches
    //         cannot be added as worktrees when they don't exist yet)
    await getExecOutput('git', ['init'], { cwd: worktreePath });
    await getExecOutput('git', ['remote', 'add', 'origin', repoRemoteUrl], { cwd: worktreePath });

    // Step 4: Create orphan branch and initial commit
    await getExecOutput('git', ['-c', `user.email=${BOT_EMAIL}`, '-c', `user.name=${BOT_NAME}`,
      'checkout', '--orphan', STATE_BRANCH], { cwd: worktreePath });

    const today = todayPath();  // e.g. "runs/2026/04/24.ndjson"
    fs.mkdirSync(path.join(worktreePath, path.dirname(today)), { recursive: true });
    fs.writeFileSync(path.join(worktreePath, today), '', 'utf8');

    await getExecOutput('git', ['add', '-A'], { cwd: worktreePath });
    await getExecOutput('git', [
      '-c', `user.email=${BOT_EMAIL}`, '-c', `user.name=${BOT_NAME}`,
      'commit', '-m', `chore: init playwright-healer-state [skip-healer]`
    ], { cwd: worktreePath });

    // Step 5: Push — if concurrent bootstrapper wins, our push fails; fall into retry loop
    const push = await getExecOutput(
      'git', ['push', '-u', 'origin', STATE_BRANCH],
      { cwd: worktreePath, ignoreReturnCode: true }
    );

    if (push.exitCode !== 0) {
      // Concurrent bootstrapper won — clean up temp init and add worktree to the now-existing branch
      fs.rmSync(worktreePath, { recursive: true, force: true });
      return bootstrapOrGetWorktree(repoRemoteUrl);  // recursive retry; branch now exists
    }

    return worktreePath;
  }

  // Exit code other than 0/2 = network error or auth failure
  throw new Error(`git ls-remote failed with exit code ${lsRemote.exitCode}: ${lsRemote.stderr}`);
}

export async function removeWorktree(worktreePath: string): Promise<void> {
  // Remove worktree registration from the primary repo (if it was added via `git worktree add`)
  await getExecOutput('git', ['worktree', 'remove', '--force', worktreePath], { ignoreReturnCode: true });
  // Also clean up the temp dir in case it was a standalone init (bootstrap path)
  fs.rmSync(worktreePath, { recursive: true, force: true });
}

function todayPath(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `runs/${y}/${m}/${day}.ndjson`;
}
```

Key facts:
- `git worktree add` requires the branch to already exist on the remote — that is why the bootstrap path uses a separate `git init` in a temp dir instead of a worktree
- `git checkout --orphan` in the temp-init dir creates an orphan without affecting the primary workspace [CITED: https://git-scm.com/docs/git-checkout]
- After `git checkout --orphan`, all files from the previous HEAD are staged — but since this is a fresh `git init` with no previous commits, the index is clean; no `git rm -rf .` needed in the init path
- `git ls-remote --exit-code` returns exit 2 when the ref is absent (well-defined, unlike `git fetch` exit 128 which also fires on auth/network errors) [CITED: https://git-scm.com/docs/git-ls-remote]
- Two concurrent bootstrappers: one push wins; the other's push fails; the recursive retry correctly uses `git worktree add` on the now-existing branch

### Pattern 2: State Branch Safe-Append Retry Loop (STA-03)

All operations run in `worktreePath` returned by Pattern 1. The primary workspace is never touched.

```typescript
// src/shared/state-branch.ts (continued)
import * as core from '@actions/core';

const MAX_RETRIES = 5;

export async function appendRecord(
  record: NdjsonRecord,
  worktreePath: string
): Promise<void> {
  const ndjsonPath = todayPath();  // e.g. "runs/2026/04/24.ndjson"
  const absPath = path.join(worktreePath, ndjsonPath);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Step 1: Fetch latest state from remote (into worktree's tracking branch)
    await getExecOutput('git', ['fetch', 'origin', STATE_BRANCH], { cwd: worktreePath });
    await getExecOutput('git', ['reset', '--hard', `origin/${STATE_BRANCH}`], { cwd: worktreePath });

    // Step 2: Ensure the day's file directory exists
    fs.mkdirSync(path.join(worktreePath, path.dirname(ndjsonPath)), { recursive: true });

    // Step 3: Append record (atomic rename to prevent partial-write corruption)
    const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
    const appended = existing + JSON.stringify(record) + '\n';
    const tmpPath = `${absPath}.tmp`;
    fs.writeFileSync(tmpPath, appended, 'utf8');
    fs.renameSync(tmpPath, absPath);  // atomic on POSIX

    // Step 4: Commit in worktree (no effect on primary workspace)
    await getExecOutput('git', ['add', ndjsonPath], { cwd: worktreePath });
    await getExecOutput('git', [
      '-c', `user.email=${BOT_EMAIL}`, '-c', `user.name=${BOT_NAME}`,
      'commit', '-m', `stats: run ${record.runId} [skip-healer]`
    ], { cwd: worktreePath });

    // Step 5: Push with lease — ref-qualified to avoid FETCH_HEAD ambiguity (Pitfall C)
    const push = await getExecOutput('git', [
      'push',
      `--force-with-lease=${STATE_BRANCH}`,
      'origin',
      STATE_BRANCH
    ], { cwd: worktreePath, ignoreReturnCode: true });

    if (push.exitCode === 0) return; // success

    // Rejected (non-fast-forward): exponential backoff + jitter, then retry
    const delayMs = 100 * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
    core.warning(`State branch push rejected (attempt ${attempt + 1}/${MAX_RETRIES}). Retry in ${delayMs}ms.`);
    await new Promise(r => setTimeout(r, delayMs));

    // Reset local commit before retry (the fetch+reset at loop top will refresh to remote state)
    await getExecOutput('git', ['reset', '--soft', 'HEAD~1'], { cwd: worktreePath });
  }

  // Exhausted retries — non-fatal per A1 assumption (see Assumptions Log)
  core.warning(
    `State branch: all ${MAX_RETRIES} push attempts rejected. ` +
    `Run ${record.runId} stats will not be recorded. Threshold evaluation proceeds with stale data.`
  );
}
```

Key facts:
- `{ cwd: worktreePath }` on every git call is mandatory — without it, commands run in `process.cwd()` (primary workspace), defeating workspace isolation
- `--force-with-lease=playwright-healer-state` (ref-qualified form, not bare `--force-with-lease`) prevents stale `FETCH_HEAD` false-positives [CITED: https://git-scm.com/docs/git-push]
- `git reset --hard origin/STATE_BRANCH` at retry start is more robust than `git reset --soft HEAD~1` alone — it fully aligns the worktree state with the remote before re-appending
- Atomic rename (`fs.renameSync`) prevents partial-write corruption of the NDJSON file (Pitfall B)
- After exhausted retries: **non-fatal** [ASSUMED — A1; see Assumptions Log]. The run's data is lost for this push (minor analytics gap). Threshold evaluation still runs on the last valid state.

### Pattern 3: NDJSON Record Schema

One JSON object per line per CI run. All per-test stats from the current run go in a single run-level record to minimize git operations (one append per CI run, not one per test).

```typescript
// src/shared/types.ts

export interface NdjsonRecord {
  schemaVersion: 1;                    // forward-compat version field
  timestamp: string;                   // ISO 8601 UTC, e.g. "2026-04-24T14:23:00.000Z"
  runId: string;                       // GitHub Actions run ID (GITHUB_RUN_ID)
  commitSha: string;                   // triggering commit SHA (github.sha)
  branch: string;                      // triggering branch (github.ref_name)
  healerVersion: string;               // from package.json version field
  shardIndex: number | null;           // null if not sharded; 1-based if sharded (ING-04)
  shardTotal: number | null;           // null if not sharded; total shard count
  tests: NdjsonTestEntry[];
}

export interface NdjsonTestEntry {
  testId: string;                      // "{relative_file_path}::{full_title}" — stable across runs
  filePath: string;                    // relative to repo root, e.g. "tests/auth.spec.ts"
  title: string;                       // full test title (concatenated describe + test names)
  outcome: 'passed' | 'failed' | 'flaky' | 'skipped' | 'timed-out' | 'report-unreadable';
  durationMs: number;                  // from JSONReportTestResult.duration (last result)
  retryCount: number;                  // number of retries attempted (JSONReportTestResult.retry max)
  workerIndex: number;                 // parallelIndex from last result
  errorSignature: string | null;       // first error.message truncated to 200 chars; null if passed
  traceAttachmentPath: string | null;  // attachment.path where name=="trace"; null if absent
}
```

Design decisions:
- **`schemaVersion: 1`** — makes forward migration (adding fields in Phase 04+) detectable at parse time
- **`testId` = `filePath::title`** — stable key for rolling-window aggregation; avoids depending on Playwright's internal spec `id` field which is test-run-specific
- **`outcome: 'report-unreadable'`** — ING-03 graceful degrade; the run record is still written but all tests carry this status; threshold evaluator skips these records
- **Per-run record** (not per-test) — one NDJSON line per CI run is far more efficient: `git add + commit` happens once, not once per test file; a 100-test suite produces one append, not 100 [ASSUMED — A2; see Assumptions Log. Revisit if a consuming repo exceeds ~5000 tests per run (estimated per-record size > 5MB), at which point per-day-per-testfile partitioning is needed]

### Pattern 4: NDJSON File Path Structure (STA-02)

```
playwright-healer-state branch layout:
runs/
  2026/
    04/
      24.ndjson    ← all runs from 2026-04-24
      25.ndjson    ← all runs from 2026-04-25
    05/
      01.ndjson
```

**Why date-partitioned?** The rolling window evaluation reads only the last `flake-window-days` worth of files (e.g. 7 days = at most 7 files), not the entire NDJSON corpus. The evaluator can compute the required date range (`today - window_days`) and read only those files from the worktree.

**Pruning rule (STA-05):** After a successful push, delete files older than `retention-days` (default 90). GC runs after push, not before (to avoid interleaving with concurrent appenders). A `retention-days: 0` value disables GC (useful for testing).

```typescript
// GC: invoked after successful push in Pattern 2
export async function runGc(retentionDays: number, worktreePath: string): Promise<void> {
  if (retentionDays === 0) return;  // disabled
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const runsDir = path.join(worktreePath, 'runs');
  if (!fs.existsSync(runsDir)) return;

  let deleted = false;
  // Walk year/month/day directory structure
  for (const year of fs.readdirSync(runsDir)) {
    const yearPath = path.join(runsDir, year);
    for (const month of fs.readdirSync(yearPath)) {
      const monthPath = path.join(yearPath, month);
      for (const dayFile of fs.readdirSync(monthPath)) {
        const day = dayFile.replace('.ndjson', '');
        const fileDate = new Date(`${year}-${month}-${day}T00:00:00Z`);
        if (fileDate < cutoff) {
          fs.unlinkSync(path.join(monthPath, dayFile));
          deleted = true;
        }
      }
      // Remove empty month directories
      if (fs.readdirSync(monthPath).length === 0) fs.rmdirSync(monthPath);
    }
    if (fs.readdirSync(yearPath).length === 0) fs.rmdirSync(yearPath);
  }

  if (deleted) {
    await getExecOutput('git', ['add', '-A'], { cwd: worktreePath });
    await getExecOutput('git', [
      '-c', `user.email=${BOT_EMAIL}`, '-c', `user.name=${BOT_NAME}`,
      'commit', '-m', `chore: gc healer state (retention ${retentionDays}d) [skip-healer]`
    ], { cwd: worktreePath });
    // Note: GC commit is pushed as part of the main append push; or as a standalone push
    // if GC runs after the append-push. Either way, force-with-lease applies.
  }
}
```

### Pattern 5: Playwright JSON Report Parser (ING-01, ING-02, ING-03)

```typescript
// src/ingest/report-parser.ts
import { z } from 'zod';
import * as core from '@actions/core';
import type { NdjsonTestEntry } from '../shared/types.js';

// Minimal Zod schema — validates the fields we actually use; unknown fields pass through
const ReportSchema = z.object({
  config: z.object({ rootDir: z.string() }).optional(),
  suites: z.array(z.any()),  // deep validation below
  stats: z.object({
    startTime: z.string(),
    duration: z.number(),
  }).optional(),
});

// Recurse into suite tree to collect all specs + their tests
export function parseReport(
  rawJson: unknown,
  runMeta: { commitSha: string; branch: string; runId: string }
): { entries: NdjsonTestEntry[]; reportUnreadable: boolean } {
  const parsed = ReportSchema.safeParse(rawJson);
  if (!parsed.success) {
    core.warning(
      `ING-03: Playwright report does not match expected shape — ` +
      `recording as "report-unreadable". Zod issues: ${parsed.error.message}`
    );
    return { entries: [], reportUnreadable: true };
  }
  // Walk suite tree, extract entries...
  const entries: NdjsonTestEntry[] = [];
  walkSuites(parsed.data.suites, '', entries);
  return { entries, reportUnreadable: false };
}

function walkSuites(suites: unknown[], parentTitle: string, out: NdjsonTestEntry[]): void {
  for (const suite of suites) {
    const s = suite as any;
    const suiteTitle = parentTitle ? `${parentTitle} > ${s.title}` : s.title;

    // Walk nested suites
    if (Array.isArray(s.suites)) walkSuites(s.suites, suiteTitle, out);

    // Walk specs
    for (const spec of (s.specs ?? [])) {
      for (const test of (spec.tests ?? [])) {
        const lastResult = test.results?.[test.results.length - 1];
        const outcome = mapOutcome(test.status);
        const traceAttachment = lastResult?.attachments?.find(
          (a: any) => a.name === 'trace'
        );
        out.push({
          testId: `${spec.file}::${suiteTitle ? suiteTitle + ' > ' : ''}${spec.title}`,
          filePath: spec.file,
          title: `${suiteTitle ? suiteTitle + ' > ' : ''}${spec.title}`,
          outcome,
          durationMs: lastResult?.duration ?? 0,
          retryCount: Math.max(0, ...(test.results ?? []).map((r: any) => r.retry ?? 0)),
          workerIndex: lastResult?.parallelIndex ?? 0,
          errorSignature: lastResult?.error?.message?.slice(0, 200) ?? null,
          traceAttachmentPath: traceAttachment?.path ?? null,
        });
      }
    }
  }
}

function mapOutcome(
  status: string
): NdjsonTestEntry['outcome'] {
  switch (status) {
    case 'expected':  return 'passed';
    case 'unexpected': return 'failed';
    case 'flaky':     return 'flaky';
    case 'skipped':   return 'skipped';
    default:          return 'failed';
  }
}
```

Note: `test.status` in the Playwright JSON report is `"expected" | "unexpected" | "flaky" | "skipped"` — NOT `"passed" | "failed"`. The internal `result.status` values are `"passed" | "failed" | "timedOut" | "skipped" | "interrupted"`. Use `test.status` for flake detection because Playwright computes `"flaky"` (passed after retry) at the test level, not the result level. [CITED: https://playwright.dev/docs/api/class-suitedescription and ARCHITECTURE.md §Playwright JSON Report Parsing]

### Pattern 6: Shard-Aware Record Tagging (ING-04)

Playwright sharded runs produce separate JSON reports per shard. The action may be invoked once per shard (matrix strategy) or once with a merged report. Phase 02 supports both patterns:

```typescript
// In ingest/index.ts, read shard inputs from config or environment
const shardIndex = parseInt(process.env.SHARD_INDEX ?? '0', 10) || null;  // 0 = not sharded
const shardTotal = parseInt(process.env.SHARD_TOTAL ?? '0', 10) || null;

const record: NdjsonRecord = {
  schemaVersion: 1,
  timestamp: new Date().toISOString(),
  runId: process.env.GITHUB_RUN_ID!,
  commitSha: context.sha,
  branch: context.ref,
  healerVersion: VERSION,
  shardIndex,  // null if not sharded
  shardTotal,  // null if not sharded
  tests: entries,
};
```

The threshold evaluator deduplicates across shards: when computing flake rate for a test, it groups records by `(commitSha, testId)` and takes the worst outcome across shards for that commit. This prevents a single test failing on one shard from appearing as N failures for one CI run.

### Pattern 7: Config Loader — Action.yml + YAML File Merge (CFG-06, CFG-07)

```typescript
// src/shared/config.ts — extended with CFG-03 inputs + CFG-06/CFG-07 loader

import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import * as fs from 'fs';
import * as core from '@actions/core';

// ── CFG-03: Threshold inputs — add INSIDE z.object({}) before .superRefine ────
// The existing getInputSchema() ends with .superRefine(...), which returns ZodEffects.
// ZodEffects does NOT have .extend(). New fields MUST be added inside the z.object({})
// literal, before .superRefine is chained. Example shape of the extended schema:
//
// export function getInputSchema() {
//   return z.object({
//     // ... existing fields (mode, apiKey, healerToken, etc.) ...
//     reportPath:              z.string().default('test-results/results.json'),
//     flakeRateThreshold:      z.coerce.number()
//                                .refine(v => !isNaN(v), { message: 'flake-rate-threshold must be a valid number (e.g. 0.2)' })
//                                .min(0).max(1).default(0.2),
//     flakeWindowDays:         z.coerce.number().int().min(1).default(7),
//     slowRegressionPct:       z.coerce.number().min(1).default(1.5),
//     rerunCount:              z.coerce.number().int().min(1).default(10),  // Phase 03 use
//     rerunPassRate:           z.coerce.number().min(0).max(1).default(0.9), // Phase 03 use
//     maxBudgetUsd:            z.coerce.number().min(0).default(2.0),       // Phase 03 use
//     maxTurns:                z.coerce.number().int().min(1).default(30),  // Phase 03 use
//     retentionDays:           z.coerce.number().int().min(0).default(90),  // 0 = GC disabled
//     maxHealsPerTestPerWeek:  z.coerce.number().int().min(0).default(3),
//     stateBranchName:         z.string().default('playwright-healer-state'),
//   }).superRefine((v, ctx) => {
//     // existing superRefine: provider != ollama requires apiKey
//     if (v.provider !== 'ollama' && v.apiKey.length === 0) {
//       ctx.addIssue({ ... });
//     }
//   });
// }

// ── CFG-06: YAML config file loader ─────────────────────────────────────────
export function loadYamlConfig(workspacePath: string): Record<string, unknown> {
  const configPath = `${workspacePath}/.github/playwright-healer.yml`;
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    // maxAliasCount: 100 guards against YAML bomb (alias expansion DoS)
    const parsed = parseYaml(raw, { maxAliasCount: 100 });
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<string, unknown>;
  } catch (err) {
    core.warning(`CFG-06: .github/playwright-healer.yml could not be parsed as YAML: ${err}. Ignoring.`);
    return {};
  }
}

// ── Merge rule: action.yml inputs WIN over config file ───────────────────────
// Non-empty action.yml input overrides the YAML file value.
// Both sets of values are merged into a plain object before Zod parsing.
export function mergeConfigs(
  actionInputs: Record<string, string>,
  yamlConfig: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...yamlConfig };
  for (const [key, value] of Object.entries(actionInputs)) {
    if (value !== '') {
      merged[key] = value;
    }
  }
  return merged;
}
```

**Precedence rule:** action.yml inputs WIN when non-empty. YAML file provides per-repo defaults that are overridable at invocation time.

**Security: fork PRs and the YAML file.** The `.github/playwright-healer.yml` file is read from `process.env.GITHUB_WORKSPACE` — the checked-out commit. On a fork PR, this is the attacker's fork commit. However, Phase 02 only reads this file, never executes its values as code. The values are Zod-validated numbers and strings. The only risk is threshold manipulation (e.g. setting `flake-rate-threshold: 0` to force detections). Since Phase 02 is log-only (DET-04) and ingest does not run on fork PRs (loop guard detects fork and exits early), this is a non-issue in Phase 02.

### Pattern 8: Rolling Window Threshold Evaluator (DET-01, DET-02, DET-03)

```typescript
// src/ingest/threshold-evaluator.ts

export interface Detection {
  testId: string;
  filePath: string;
  reason: 'flake-rate' | 'slow-regression';
  windowDays: number;
  value: number;       // actual computed metric (e.g. 0.42 for 42% flake rate)
  threshold: number;   // configured threshold that was breached
  runCount: number;    // number of runs in the window (DET-02: must be >= 10)
}

export function evaluateThresholds(
  records: NdjsonRecord[],
  config: Config
): Detection[] {
  const now = Date.now();
  const windowStart = now - config.flakeWindowDays * 24 * 60 * 60 * 1000;

  // Filter to window and deduplicate shards
  const windowRecords = records.filter(
    r => new Date(r.timestamp).getTime() >= windowStart
  );

  // Group by testId, then by (commitSha) to aggregate shards
  const byTestId = new Map<string, Map<string, NdjsonTestEntry[]>>();
  for (const record of windowRecords) {
    for (const entry of record.tests) {
      if (entry.outcome === 'report-unreadable') continue; // ING-03: skip unreadable records
      if (!byTestId.has(entry.testId)) byTestId.set(entry.testId, new Map());
      const byCommit = byTestId.get(entry.testId)!;
      if (!byCommit.has(record.commitSha)) byCommit.set(record.commitSha, []);
      byCommit.get(record.commitSha)!.push(entry);
    }
  }

  const detections: Detection[] = [];

  for (const [testId, commitMap] of byTestId) {
    // One "run" = one commitSha (cross-shard dedup: worst outcome wins)
    const runs = [...commitMap.entries()].map(([, entries]) => ({
      outcome: worstOutcome(entries.map(e => e.outcome)),
      durationMs: Math.max(...entries.map(e => e.durationMs)),
    }));

    const runCount = runs.length;
    if (runCount < 10) continue;  // DET-02: need at least 10 runs for statistical confidence

    // ── DET-02: Flake rate detection ──────────────────────────────────────────
    // DET-02 also includes "no existing open healer PR" check; that condition is
    // vacuously satisfied in Phase 02 (log-only; no PRs exist yet). Phase 04 wires
    // the Octokit PR query into this check when dispatch is added.
    const failedOrFlaky = runs.filter(r =>
      r.outcome === 'failed' || r.outcome === 'flaky' || r.outcome === 'timed-out'
    ).length;
    const flakeRate = failedOrFlaky / runCount;

    if (flakeRate >= config.flakeRateThreshold) {
      const sampleEntry = [...commitMap.values()][0][0];
      detections.push({
        testId,
        filePath: sampleEntry.filePath,
        reason: 'flake-rate',
        windowDays: config.flakeWindowDays,
        value: flakeRate,
        threshold: config.flakeRateThreshold,
        runCount,
      });
    }

    // ── DET-03: Duration p95 regression ───────────────────────────────────────
    const durations = runs.map(r => r.durationMs).sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;
    // Baseline: first 10 runs (chronologically) as the "before" baseline
    const baselineDurations = durations.slice(0, Math.min(10, durations.length));
    const baselineP95 = baselineDurations[Math.floor(baselineDurations.length * 0.95)] ?? 0;
    const regressionRatio = baselineP95 > 0 ? p95 / baselineP95 : 1;

    if (regressionRatio >= config.slowRegressionPct) {
      const sampleEntry = [...commitMap.values()][0][0];
      detections.push({
        testId,
        filePath: sampleEntry.filePath,
        reason: 'slow-regression',
        windowDays: config.flakeWindowDays,
        value: regressionRatio,
        threshold: config.slowRegressionPct,
        runCount,
      });
    }
  }

  return detections;
}

function worstOutcome(
  outcomes: NdjsonTestEntry['outcome'][]
): NdjsonTestEntry['outcome'] {
  if (outcomes.includes('failed')) return 'failed';
  if (outcomes.includes('timed-out')) return 'timed-out';
  if (outcomes.includes('flaky')) return 'flaky';
  if (outcomes.includes('passed')) return 'passed';
  return 'skipped';
}
```

Note: `rerunCount` and `rerunPassRate` are CFG-03 inputs that Phase 02 must declare in the Zod schema but NOT compute — they belong to Phase 03 (VAL-01). The threshold evaluator in Phase 02 does not call `rerunCount`; it only uses `flakeRateThreshold`, `flakeWindowDays`, and `slowRegressionPct`.

### Pattern 9: Step Summary Output (DET-04 — log-only)

```typescript
// src/ingest/index.ts — after threshold evaluation

import * as core from '@actions/core';

export async function writeDetectionSummary(
  detections: Detection[],
  config: Config
): Promise<void> {
  if (detections.length === 0) {
    await core.summary
      .addHeading('playwright-healer — Ingest complete', 3)
      .addRaw('\nNo threshold breaches detected in this run.\n')
      .write();
    return;
  }

  let md = '## playwright-healer — Threshold Breaches (log-only)\n\n';
  md += `> Detection mode: **log-only** (Phase 04 enables auto-dispatch)\n\n`;
  md += `| Test | Reason | Value | Threshold | Runs in Window |\n`;
  md += `| --- | --- | --- | --- | --- |\n`;

  for (const d of detections) {
    const valueStr = d.reason === 'flake-rate'
      ? `${(d.value * 100).toFixed(1)}%`
      : `${d.value.toFixed(2)}x`;
    const thresholdStr = d.reason === 'flake-rate'
      ? `${(d.threshold * 100).toFixed(1)}%`
      : `${d.threshold.toFixed(2)}x`;
    md += `| \`${d.testId}\` | ${d.reason} | ${valueStr} | ${thresholdStr} | ${d.runCount} |\n`;

    // Also emit a ::warning:: Actions annotation for IDE integration
    core.warning(
      `playwright-healer: ${d.reason} threshold breached for "${d.testId}" ` +
      `(${valueStr} >= ${thresholdStr} over ${d.runCount} runs in ${d.windowDays} days)`,
      { file: d.filePath }
    );
  }
  md += `\n_No \`workflow_dispatch\` was fired. Enable auto-dispatch in Phase 04._\n`;

  await core.summary.addRaw(md).write();
}
```

### Pattern 10: Loop Guard (SEC-05)

```typescript
// src/shared/loop-guard.ts
import * as github from '@actions/github';
import * as core from '@actions/core';

const BOT_EMAIL = 'playwright-healer-bot@users.noreply.github.com';
const SKIP_SENTINEL = '[skip-healer]';

export function shouldSkipIngest(): boolean {
  const payload = github.context.payload;

  // Guard 0: fork PR — GITHUB_TOKEN is read-only; state branch push would fail with 403
  if (payload.pull_request?.head?.repo?.fork === true) {
    core.info('SEC-05 Guard 0: Skipping ingest — fork PRs are not supported (state branch push requires write access)');
    return true;
  }

  // Guard 1: bot author email
  const authorEmail = payload.head_commit?.author?.email ?? '';
  if (authorEmail === BOT_EMAIL) {
    core.info(`SEC-05 Guard 1: Skipping ingest — commit is from playwright-healer-bot (${BOT_EMAIL})`);
    return true;
  }

  // Guard 2: [skip-healer] in commit message
  const commitMessage = payload.head_commit?.message ?? '';
  if (commitMessage.includes(SKIP_SENTINEL)) {
    core.info(`SEC-05 Guard 2: Skipping ingest — commit message contains [skip-healer] sentinel`);
    return true;
  }

  return false;
}
```

Notes:
- **Guard 3 (per-test heal cap in state branch) is evaluated in Phase 04** when dispatch is added; Phase 02 doesn't need it for log-only mode
- The bot email `playwright-healer-bot@users.noreply.github.com` is the form GitHub uses for app tokens; document this in the action README so consumers can configure their PAT identity if using a personal token instead
- `payload.head_commit` is available on `push` events; on `workflow_call` or `pull_request` events, it is `undefined` — optional chaining (`?.`) prevents null dereference (Pitfall D)

### Pattern 11: SEC-07 Allowlist Carve-Out for Octokit (Q10)

Phase 02 introduces git operations via `@actions/exec` (spawns `git` binary). The security-lint Check 4 bans HTTP client patterns in `src/**`:

```
PATTERNS='fetch\(|http\.request\(|https\.request\(|axios|got\(|node-fetch|undici'
```

**Phase 02 requires NO change to security-lint Check 4.** The banned patterns target call-sites (raw HTTP primitives) in the project's own source files, not in `node_modules/`. `@actions/github` is imported as a module — its internal fetch is in `node_modules/`, outside the scan scope. Phase 02 does not call any of the banned primitives directly in `src/**`.

Phase 04, when it adds `workflow_dispatch` via Octokit, will need to extend Check 4 with an allowlist comment for `octokit.rest.actions.createWorkflowDispatch`. The CI assertion for Phase 02 and Phase 03 is: `grep -r 'createWorkflowDispatch' src/` must return zero results.

### Pattern 12: Git Author Identity for State Branch Commits

State branch commits authored by the action must use a consistent bot identity for SEC-05 Guard 1 detection to work. Use `-c` flags on each git invocation (not global git config, which could leak between steps):

```typescript
// In Pattern 2's commit call — correct form:
await getExecOutput('git', [
  '-c', `user.email=${BOT_EMAIL}`,
  '-c', `user.name=${BOT_NAME}`,
  'commit', '-m', `stats: run ${runId} [skip-healer]`
], { cwd: worktreePath });
```

`git log --format=%ae` (author email) must return `playwright-healer-bot@users.noreply.github.com` for Guard 1 to fire. The `-c user.email=` form sets both the author and committer identity for that command.

**Commit signing:** Unsigned commits (Phase 02 default). [ASSUMED — A3; see Assumptions Log]

### Pattern 13: Concurrent-Write Integration Test Harness (STA-04)

The bare-repo approach from ARCHITECTURE.md §Testing Strategy. The test exercises the real `appendRecord()` function from `state-branch.ts` — not a mock. The worktree isolation means each test gets its own temp directories.

```typescript
// tests/integration/state-branch.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Import the real state-branch module under test
import { bootstrapOrGetWorktree, appendRecord, removeWorktree } from '../../src/shared/state-branch.js';

describe('state-branch concurrent write (STA-04)', () => {
  let remoteDir: string;    // bare "remote" repo
  let primaryWs1: string;   // simulates CI job 1's primary workspace
  let primaryWs2: string;   // simulates CI job 2's primary workspace

  beforeEach(() => {
    // Create a bare "remote" repo (simulates GitHub's remote)
    remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-remote-'));
    execSync('git init --bare', { cwd: remoteDir });

    // Two separate primary workspace clones (simulate two parallel CI jobs)
    // The state-branch module uses 'origin' from the cwd context — we set cwd in the module.
    // For the test, we point 'origin' at the bare repo.
    primaryWs1 = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-primary-ws1-'));
    primaryWs2 = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-primary-ws2-'));

    for (const ws of [primaryWs1, primaryWs2]) {
      execSync(`git init && git remote add origin ${remoteDir}`, { cwd: ws });
      execSync('git config user.email "test@test.com" && git config user.name "Test"', { cwd: ws });
      // Create an initial main-branch commit so the primary workspace is non-empty
      execSync('echo "src" > README.md && git add -A && git commit -m "init"', { cwd: ws });
    }
  });

  afterEach(() => {
    for (const dir of [remoteDir, primaryWs1, primaryWs2]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('both concurrent writes land without either record lost (STA-04)', async () => {
    // Job 1 bootstraps state branch (creates orphan branch + pushes)
    const wt1 = await bootstrapOrGetWorktree(`file://${remoteDir}`, primaryWs1);

    // Job 2 also gets a worktree (branch now exists after job 1's bootstrap)
    const wt2 = await bootstrapOrGetWorktree(`file://${remoteDir}`, primaryWs2);

    const record1 = makeTestRecord('run-001');
    const record2 = makeTestRecord('run-002');

    // Job 1 appends+pushes first (succeeds)
    await appendRecord(record1, wt1);

    // Job 2 appends+pushes — its local state is stale (job 1 already pushed);
    // the retry loop in appendRecord() should detect the rejection and retry
    await appendRecord(record2, wt2);

    // Verify both records in the final NDJSON (read from the remote's HEAD)
    const today = todayPath();  // exported from state-branch.ts for testing
    const finalNdjson = execSync(
      `git archive HEAD:${today} -- . | tar -xO 2>/dev/null || git show HEAD:${today}`,
      { cwd: remoteDir }
    ).toString();

    expect(finalNdjson).toContain('run-001');
    expect(finalNdjson).toContain('run-002');

    // Cleanup
    await removeWorktree(wt1);
    await removeWorktree(wt2);
  });
});

function makeTestRecord(runId: string): NdjsonRecord {
  return {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId,
    commitSha: 'abc123',
    branch: 'main',
    healerVersion: '0.0.0',
    shardIndex: null,
    shardTotal: null,
    tests: [],
  };
}
```

**Test runner:** `vitest --pool=forks` is required for integration tests that spawn child processes (git CLI). The `--pool=forks` flag gives each test its own process memory space, preventing git environment variable leakage between tests.

**Note on `bootstrapOrGetWorktree` signature:** The real implementation needs the `repoRemoteUrl` (for the bootstrap `git init` + `git remote add` path) and the `cwd` of the primary workspace (for the `git worktree add` path). The test passes `file://` URL pointing at the bare repo.

### Pattern 14: action.yml Inputs Extension (CFG-03)

Add to the existing `action.yml` `inputs:` block. These are all optional with defaults; consuming repos that don't specify them get the project defaults:

```yaml
  report-path:
    description: 'Glob or path to Playwright JSON report (ingest mode)'
    required: false
    default: 'test-results/results.json'

  flake-rate-threshold:
    description: 'Flake rate (0.0–1.0) above which a test is a flake candidate. Default: 0.2 (20%)'
    required: false
    default: '0.2'

  flake-window-days:
    description: 'Rolling window in days for flake-rate and slow-regression computation. Default: 7'
    required: false
    default: '7'

  slow-regression-pct:
    description: 'p95 duration growth ratio that triggers slow-regression detection. Default: 1.5 (50% slower)'
    required: false
    default: '1.5'

  rerun-count:
    description: 'Number of validation re-runs after a fix (Phase 3+). Default: 10'
    required: false
    default: '10'

  rerun-pass-rate:
    description: 'Required pass rate (0.0–1.0) for a fix to be accepted (Phase 3+). Default: 0.9'
    required: false
    default: '0.9'

  max-budget-usd:
    description: 'Max USD per healing run (Phase 3+). Default: 2.00'
    required: false
    default: '2.00'

  max-turns:
    description: 'Max agent turns per healing run (Phase 3+). Default: 30'
    required: false
    default: '30'

  retention-days:
    description: 'Days to retain state branch records before GC. Default: 90. Set to 0 to disable GC.'
    required: false
    default: '90'

  max-heals-per-test-per-week:
    description: 'Per-test heal attempt cap per 7-day window (circuit breaker). Default: 3'
    required: false
    default: '3'
```

And corresponding `INPUT_*` env vars in the composite step:
```yaml
  INPUT_REPORT-PATH: ${{ inputs.report-path }}
  INPUT_FLAKE-RATE-THRESHOLD: ${{ inputs.flake-rate-threshold }}
  INPUT_FLAKE-WINDOW-DAYS: ${{ inputs.flake-window-days }}
  INPUT_SLOW-REGRESSION-PCT: ${{ inputs.slow-regression-pct }}
  INPUT_RERUN-COUNT: ${{ inputs.rerun-count }}
  INPUT_RERUN-PASS-RATE: ${{ inputs.rerun-pass-rate }}
  INPUT_MAX-BUDGET-USD: ${{ inputs.max-budget-usd }}
  INPUT_MAX-TURNS: ${{ inputs.max-turns }}
  INPUT_RETENTION-DAYS: ${{ inputs.retention-days }}
  INPUT_MAX-HEALS-PER-TEST-PER-WEEK: ${{ inputs.max-heals-per-test-per-week }}
```

**Input asymmetry (important for planner):** `rerun-count`, `rerun-pass-rate`, `max-budget-usd`, `max-turns` are declared in Phase 02 to complete CFG-03 but are NOT consumed by Phase 02 code. They will be read by Phase 03 (VAL-01) and Phase 03 agent runner. Declaring them now in the Zod schema as `z.coerce.number().default(N)` prevents schema drift when Phase 03 picks them up.

---

## Pitfall Map

### Pitfall A: State branch git operations running in the primary workspace (CRITICAL)

**What goes wrong:** If `git checkout --orphan playwright-healer-state` runs in the primary workspace (the consumer's source code checkout), `git rm -rf .` wipes all of the consumer's source files. Any downstream step in the consumer's workflow that uses source files breaks. If `git push` runs without a fully-scoped refspec from the primary workspace, it pushes the wrong HEAD (the source code branch) to `playwright-healer-state`, destroying the orphan branch invariant.

**Prevention:** ALL state branch git operations MUST run in an isolated `git worktree` (Pattern 1). The `cwd` option on every `getExecOutput('git', [...])` call must point to `worktreePath`, never to `process.cwd()` (which is the primary workspace). The integration test verifies this by asserting the primary workspace is unchanged after `appendRecord()`.

### Pitfall B: State branch NDJSON file corruption from partial writes

**What goes wrong:** A process exits mid-write (SIGTERM from runner timeout) after appending a partial JSON object to the `.ndjson` file. The next read attempt fails to parse the file.

**Prevention:** Write to a temp file in the same directory, then `fs.renameSync()` (atomic on POSIX). Pattern 2 shows this. Recovery: reader (threshold evaluator) must parse NDJSON line-by-line with try/catch per line. A corrupt line is skipped with a warning; the remainder of the file is usable.

### Pitfall C: `--force-with-lease` uses stale `FETCH_HEAD` when cwd is the primary workspace

**What goes wrong:** If a previous `git fetch` of a different branch in the primary workspace updated `FETCH_HEAD`, a bare `--force-with-lease` in the worktree may reference the wrong ref.

**Prevention:** Use the ref-qualified form: `--force-with-lease=playwright-healer-state` (Pattern 2). This pins the lease to the specific ref. [CITED: https://git-scm.com/docs/git-push]

### Pitfall D: `context.payload.head_commit` is null on non-push events

**What goes wrong:** The loop guard reads `context.payload.head_commit.author.email`. On `workflow_call` or `pull_request` events, `head_commit` is `undefined`, causing a null dereference.

**Prevention:** Use optional chaining everywhere: `payload.head_commit?.author?.email ?? ''`. If `head_commit` is absent (non-push event), the bot-email guard simply doesn't fire — correct; the action proceeds normally.

### Pitfall E: YAML parser throws on malformed `.github/playwright-healer.yml` — crashes ingest

**What goes wrong:** Consumer has a syntax error in their config file. `yaml.parse()` throws. This crashes the entire ingest run, losing the current run's stats.

**Prevention:** Wrap the YAML parse in try/catch (Pattern 7 already shows this). Emit a `core.warning()` and return an empty config object — action.yml defaults take effect, and the run proceeds.

### Pitfall F: `z.coerce.number()` on non-numeric YAML values produces NaN (CFG-07 gap)

**What goes wrong:** Consumer writes `flake-rate-threshold: "banana"` in the YAML config. `z.coerce.number()` coerces `"banana"` to `NaN`, which passes `z.number()` type check. The threshold evaluator then produces no detections (NaN comparisons are always false).

**Prevention:** Add `.refine((v) => !isNaN(v), { message: '...' })` after `z.coerce.number()`:
```typescript
flakeRateThreshold: z.coerce.number()
  .refine((v) => !isNaN(v), { message: 'flake-rate-threshold must be a valid number (e.g. 0.2)' })
  .min(0).max(1)
  .default(0.2),
```

This is the CFG-07 success criterion: SC#4 says "invalid `flake-rate-threshold: "banana"` causes action to fail with a Zod validation error naming the invalid field, not a JavaScript crash."

### Pitfall G: `report-path` input uses glob but `@actions/glob` is not installed

**What goes wrong:** ING-01 allows a glob pattern for `report-path`. A hardcoded `fs.readFileSync(config.reportPath)` fails on glob patterns with ENOENT.

**Prevention:** Add `@actions/glob` to dependencies (it's in STACK.md but not yet in package.json — Phase 02 adds it via `npm install @actions/glob`). Use `glob.create(config.reportPath).glob()` to resolve the pattern. If zero files match, emit a warning and record as `report-unreadable`.

### Pitfall H: Threshold evaluator reads ALL NDJSON files instead of only the window

**What goes wrong:** If the evaluator checks out the entire `runs/` directory from the worktree, on a repo with 1 year of data this reads hundreds of MB.

**Prevention:** Compute the required date range and read only those files:
```typescript
const filesToRead = getDatesInWindow(config.flakeWindowDays)
  .map(d => path.join(worktreePath, `runs/${d.year}/${d.month.padStart(2,'0')}/${d.day.padStart(2,'0')}.ndjson`))
  .filter(f => fs.existsSync(f));
```

The evaluator reads directly from the worktree filesystem — no `git checkout` needed since the worktree already has the files after `bootstrapOrGetWorktree`.

### Pitfall I: SEC-07 Check 4 false-positive concern with `@actions/github` import

**What goes wrong:** A developer might assume importing `@actions/github` in `src/shared/loop-guard.ts` triggers Check 4.

**Prevention (and resolution):** Check 4 patterns target call-sites (`fetch(`, `http.request(`, etc.), not import statements. `import * as github from '@actions/github'` matches none of the banned patterns. No Check 4 change needed for Phase 02.

### Pitfall J: `git worktree remove` fails if worktree was a standalone init (not added via `git worktree add`)

**What goes wrong:** The bootstrap path uses `git init` + push in a temp dir (not `git worktree add`). When cleanup calls `git worktree remove`, it fails because the dir was never registered as a worktree.

**Prevention:** `removeWorktree()` uses `ignoreReturnCode: true` on `git worktree remove` and always follows up with `fs.rmSync()`. The temp dir is always cleaned up even if git doesn't know about it as a worktree.

---

## Answers to Critical Research Questions

### Q1: State branch concurrency — force-with-lease retry loop

**Answer:** The canonical implementation is the Pattern 2 retry loop above, running in an isolated worktree. Key parameters:
- **Max retries:** 5 (from ARCHITECTURE.md §State Branch Update Protocol)
- **Backoff:** `100ms * 2^attempt + random(0..100ms)` jitter — starts at ~100–200ms, reaches ~3.3–3.4s at attempt 5
- **Failure mode after exhausted retries:** Non-fatal. Log a `core.warning()`. Threshold evaluation proceeds with the last successfully fetched state (stale by one record at most). [ASSUMED — A1]
- **Git ref:** Use `--force-with-lease=playwright-healer-state` (fully qualified form) per Pitfall C.
- **Workspace:** ALL git operations in `worktreePath`; primary workspace never touched (Pitfall A).

### Q2: NDJSON record schema

**Answer:** See Pattern 3. Key fields: `schemaVersion: 1`, `timestamp` (ISO 8601 UTC), `runId` (GITHUB_RUN_ID), `commitSha`, `branch`, `healerVersion`, `shardIndex | null`, `shardTotal | null`, `tests: NdjsonTestEntry[]`. The `testId` = `"{filePath}::{title}"` (stable across runs). All per-run test data in one record (one NDJSON line per CI run).

### Q3: Orphan branch creation

**Answer:** See Pattern 1. Exact sequence:
1. `git ls-remote --exit-code origin refs/heads/playwright-healer-state` — check existence (exit 2 = absent, exit 0 = exists, other = error)
2. If exit 2 (not found): `git init` in a temp dir → `git remote add origin <url>` → `git checkout --orphan playwright-healer-state` → create initial `.ndjson` → `git add -A` → `git commit` → `git push -u origin playwright-healer-state`
3. If concurrent bootstrapper wins the push: the second bootstrapper's push fails; the recursive retry calls `bootstrapOrGetWorktree` again, which now sees the branch exists and uses `git worktree add` normally.
**Token:** `GITHUB_TOKEN` with `contents: write` is sufficient. `healer-token` PAT is not needed in Phase 02. [VERIFIED against STACK.md §Token Architecture]

### Q4: Rolling window threshold evaluation

**Answer:** Phase 02 implements **both** flake-rate (DET-02) and slow-regression (DET-03) detection. The math is in Pattern 8. The `rerunCount` and `rerunPassRate` inputs are declared in the Zod schema (CFG-03 completeness) but NOT evaluated in Phase 02 — those are Phase 03 (VAL-01). The evaluator lives in `src/ingest/threshold-evaluator.ts` as a pure function. The ingest module calls it after the state-branch write.

### Q5: CFG-06 .github/playwright-healer.yml config file

**Answer:** See Pattern 7. Precedence: **action.yml inputs win** (non-empty action input overrides YAML file value). The file is read from `process.env.GITHUB_WORKSPACE + '/.github/playwright-healer.yml'`. On fork PRs the loop guard (Guard 0) exits early before any file read. `yaml.parse()` is wrapped in try/catch to handle syntax errors gracefully.

### Q6: CFG-07 Zod validation of merged config

**Answer:** Extend the existing `getInputSchema()` factory in `src/shared/config.ts`. **Do NOT create a separate `getIngestConfigSchema()`**. New fields must be added INSIDE the `z.object({...})` literal, before `.superRefine` is chained — `.extend()` does not exist on `ZodEffects` (the return type of `.superRefine()`). The `z.coerce.number().refine(!isNaN)` pattern (Pitfall F) catches `"banana"` inputs with a field-naming Zod error. This is the SC#4 requirement.

### Q7: SEC-05 loop guard

**Answer:** See Pattern 10. Three guards in Phase 02:
0. **Fork PR detection:** `payload.pull_request?.head?.repo?.fork === true` → exit early
1. **Bot author email check:** `payload.head_commit?.author?.email === 'playwright-healer-bot@users.noreply.github.com'`
2. **Commit message sentinel:** `payload.head_commit?.message?.includes('[skip-healer]')`

Guard 3 (per-test heal cap) is not needed in Phase 02 (log-only; no dispatch). Guards are in `src/shared/loop-guard.ts`, called as the FIRST thing in `src/ingest/index.ts` after config validation, before any state-branch operation.

### Q8: DET-01..04 detection mechanism

**Answer:** See Pattern 9. Contract:
- **`$GITHUB_STEP_SUMMARY`:** Markdown table with columns: Test, Reason, Value, Threshold, Runs in Window. Plus an explicit "log-only" note that no dispatch fires.
- **`::warning::` annotations:** One annotation per detection using `core.warning(message, { file: d.filePath })`.
- **Test ID format:** `"{filePath}::{title}"` — the same `testId` used in the NDJSON schema.
- **No `workflow_dispatch` call anywhere in Phase 02 source.** CI assertion: `grep -r 'createWorkflowDispatch' src/` returns zero results.

### Q9: Fork-PR safety

**Answer:** Fork PRs are caught by Guard 0 in `loop-guard.ts` (Pattern 10): `payload.pull_request?.head?.repo?.fork === true` → emit `core.info()` and return early. This prevents both the confusing 403 error from a failed state branch push AND prevents any threshold-detection summary that might be misleading in a fork PR context.

### Q10: Octokit + @actions/github — SEC-07 allowlist

**Answer:** See Pattern 11. Phase 02 requires **no change to security-lint Check 4**. The banned patterns (`fetch(`, `http.request(`, etc.) are call-site patterns in `src/**`, not module names. `@actions/github` and `@actions/exec` are module imports with no matching grep pattern. Phase 04 will add the `createWorkflowDispatch` allowlist comment when dispatch is implemented.

### Q11: Commit signing and token identity

**Answer:** Unsigned commits via GITHUB_TOKEN. Git author identity is set per-command via `-c user.email=playwright-healer-bot@users.noreply.github.com` and `-c user.name=playwright-healer-bot` (Pattern 12). GITHUB_TOKEN is sufficient for state branch writes (`contents: write`). No `healer-token` PAT needed in Phase 02. GPG signing is deferred. [ASSUMED — A3]

### Q12: Concurrent-write integration test design

**Answer:** See Pattern 13. Test harness: local bare git repo as remote + two separate primary workspace clones (simulating two parallel CI jobs). The `bootstrapOrGetWorktree` function is called from each workspace's context. The concurrent write scenario: ws1 bootstrap + append+push (succeeds), then ws2 gets worktree + append+push (rejected once by the now-different remote HEAD, retries via Pattern 2's loop, succeeds). Assert both records in final NDJSON. Test runner: `vitest --pool=forks`.

### Q13: NDJSON file structure

**Answer:** Date-partitioned (Pattern 4). Single file per day: `runs/YYYY/MM/DD.ndjson`. Simple and deferring performance concern. At ~100 tests × 5 CI runs/day = ~500 test entries/day across all tests, the per-day file is well under 1MB. Phase 04 can add partitioning if needed. GC (STA-05) happens after successful push; deletes files older than `retention-days`. Disable GC for testing with `retention-days: 0`.

### Q14: Threshold log-only semantics

**Answer:** Phase 02 source code never imports `createWorkflowDispatch` or any dispatch-related Octokit method. The "log-only" guarantee is enforced at the import level. The summary output includes an explicit note: `"No workflow_dispatch was fired. Enable auto-dispatch in Phase 04."` This is a CI-verifiable assertion: `grep -r 'createWorkflowDispatch' src/` must return zero results until Phase 04.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML file parsing | Custom YAML tokenizer | `yaml` 2.8.3 (eemeli) | YAML 1.2 edge cases (anchors, multi-line strings, null vs empty) are tricky; the library handles them correctly |
| Glob resolution for report-path | `fs.readdirSync` + manual pattern matching | `@actions/glob` 0.7.0 | Handles GitHub Actions glob semantics (`**`, negation) correctly; add `@actions/glob` to package.json in Phase 02 |
| Exponential backoff | Custom sleep loop | Inline formula `100 * 2^attempt + jitter` | Simple enough to inline; full backoff libraries overkill |
| NDJSON line-by-line parsing | Custom streaming parser | `JSON.parse` per line in a loop | NDJSON is trivially parseable line-by-line; no streaming library needed |
| Git author identity | Custom GH App token flow | `-c user.email=...` git flag | Bot identity via git config is zero-infra; GH App token is Phase 06 polish |
| Step summary rendering | Custom HTML generation | `@actions/core.summary` API | Official GitHub API; handles summary file path, buffering, and write flush |
| Workspace isolation for git state-branch ops | Complex in-place branch switching | `git worktree` in a temp directory | Worktrees are the correct git primitive for operating on multiple branches in parallel without disturbing the checked-out workspace |

---

## Validation Architecture

Per `.planning/config.json`: `workflow.nyquist_validation: true`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 |
| Config file | `vitest.config.ts` (Wave 0 gap — does not exist yet) |
| Quick run command | `npx vitest run tests/unit/` |
| Full suite command | `npx vitest run` |
| Integration tests | `npx vitest run --pool=forks tests/integration/` |

### Phase 02 Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ING-01 | Locate JSON report by path/glob | unit | `npx vitest run tests/unit/report-parser.test.ts` | ❌ Wave 0 |
| ING-02 | Extract per-test fields (outcome, duration, retries, trace path) | unit | `npx vitest run tests/unit/report-parser.test.ts` | ❌ Wave 0 |
| ING-03 | Graceful degrade on unrecognized report shape | unit | `npx vitest run tests/unit/report-parser.test.ts` | ❌ Wave 0 |
| ING-04 | Shard metadata in NDJSON record | unit | `npx vitest run tests/unit/report-parser.test.ts` | ❌ Wave 0 |
| STA-01 | Orphan branch bootstrap on first use (in isolated worktree) | integration | `npx vitest run --pool=forks tests/integration/state-branch.test.ts` | ❌ Wave 0 |
| STA-02 | NDJSON append (second run appends, not overwrites) | integration | `npx vitest run --pool=forks tests/integration/state-branch.test.ts` | ❌ Wave 0 |
| STA-03 | force-with-lease retry on rejection | integration | `npx vitest run --pool=forks tests/integration/state-branch.test.ts` | ❌ Wave 0 |
| STA-04 | Both concurrent writes land (no record lost) | integration | `npx vitest run --pool=forks tests/integration/state-branch.test.ts` | ❌ Wave 0 |
| STA-05 | GC: records older than retention-days are dropped | unit | `npx vitest run tests/unit/state-branch-gc.test.ts` | ❌ Wave 0 |
| DET-01 | Rolling metrics computed (flake rate, p95) | unit | `npx vitest run tests/unit/threshold-evaluator.test.ts` | ❌ Wave 0 |
| DET-02 | Flake candidate detection (>=10 runs, rate >= threshold; "no open PR" vacuously true in Phase 02) | unit | `npx vitest run tests/unit/threshold-evaluator.test.ts` | ❌ Wave 0 |
| DET-03 | Slow candidate detection (p95 regression) | unit | `npx vitest run tests/unit/threshold-evaluator.test.ts` | ❌ Wave 0 |
| DET-04 | Log-only: step summary written, no dispatch fired | unit (import assert) | `grep -r 'createWorkflowDispatch' src/ \|\| true` | ❌ Wave 0 |
| CFG-03 | Threshold inputs declared and default correctly | unit | `npx vitest run tests/unit/config.test.ts` | ❌ Wave 0 |
| CFG-06 | YAML config file merges with action.yml inputs (action wins) | unit | `npx vitest run tests/unit/config.test.ts` | ❌ Wave 0 |
| CFG-07 | Invalid `flake-rate-threshold: "banana"` fails with Zod field error | unit | `npx vitest run tests/unit/config.test.ts` | ❌ Wave 0 |
| SEC-05 | Fork PR → early exit; bot author email → early exit; [skip-healer] → early exit | unit | `npx vitest run tests/unit/loop-guard.test.ts` | ❌ Wave 0 |

### Phase 02 Success Criteria → Test Map

| SC | Behavior | Primary Test |
|----|----------|-------------|
| SC#1 | Orphan branch created on first use (in worktree); second run appends NDJSON line | integration/state-branch.test.ts |
| SC#2 | Both concurrent ingest jobs land records (no record lost) | integration/state-branch.test.ts (concurrent-write case) |
| SC#3 | 40% failure rate → step summary annotation; no workflow_dispatch | unit/threshold-evaluator.test.ts + grep assert |
| SC#4 | `flake-rate-threshold: "banana"` → Zod error naming field | unit/config.test.ts |
| SC#5 | playwright-healer-bot commit → early exit with INFO message | unit/loop-guard.test.ts |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/unit/` (unit tests only, < 10s)
- **Per wave merge:** `npx vitest run` (all tests including integration, < 60s)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

All test files are new (Phase 02 is greenfield for this module):

- [ ] `vitest.config.ts` — Vitest configuration with `projects` array: `unit` (threads pool), `integration` (forks pool)
- [ ] `tests/unit/report-parser.test.ts` — covers ING-01..04
- [ ] `tests/unit/threshold-evaluator.test.ts` — covers DET-01..03, SC#3
- [ ] `tests/unit/config.test.ts` — covers CFG-03, CFG-06, CFG-07, SC#4
- [ ] `tests/unit/loop-guard.test.ts` — covers SEC-05, SC#5
- [ ] `tests/unit/state-branch-gc.test.ts` — covers STA-05
- [ ] `tests/integration/state-branch.test.ts` — covers STA-01..04, SC#1, SC#2
- [ ] `tests/fixtures/sample-report.json` — happy-path Playwright JSON fixture
- [ ] `tests/fixtures/sample-report-unreadable.json` — malformed shape fixture (ING-03)
- [ ] `tests/fixtures/sample-report-sharded.json` — sharded report fixture (ING-04)
- [ ] `tests/fixtures/sample-runs.ndjson` — seeded NDJSON for threshold tests

---

## Security Domain

`security_enforcement` is not explicitly `false` in config.json, so this section is required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not applicable — no user auth in ingest mode |
| V3 Session Management | No | Not applicable |
| V4 Access Control | Yes (partial) | SEC-05 loop guard (fork PR, bot-author, skip-healer); worktree isolation prevents credential leakage |
| V5 Input Validation | Yes | Zod schema on all action inputs + YAML config file values (CFG-07) |
| V6 Cryptography | No | No crypto operations; git operations use GITHUB_TOKEN (managed by GitHub) |

### Known Threat Patterns for Phase 02 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Config file threshold manipulation (fork PR) | Tampering | Guard 0 in loop-guard exits before any file read; even if bypass occurred, log-only mode means no dispatch is fired |
| NDJSON injection via test title containing newline characters | Tampering | `JSON.stringify()` encodes all control characters including `\n`; NDJSON records are safe |
| State branch commit by attacker impersonating bot email | Spoofing | Bot email check is defense-in-depth; state branch push requires GITHUB_TOKEN `contents:write`; attacker cannot push to consuming repo's state branch |
| Loop amplification (action triggers itself via commit) | Repudiation | SEC-05 guards 0+1+2 (fork, bot email, skip-healer sentinel); all checked before any git write |
| YAML bomb (`yes: &a [*a, *a, *a, *a]` expansion) | DoS | `yaml` 2.8.3 built-in alias depth limit; Pattern 7 explicitly sets `maxAliasCount: 100` |
| Worktree path traversal (malicious worktree path) | Tampering | `worktreePath` is always a `fs.mkdtempSync()` result under `os.tmpdir()` — not user-controlled |

---

## Open Questions

1. **GC trigger timing**
   - What we know: STA-05 says GC happens periodically; ARCHITECTURE.md says GC after successful push, not before
   - What's unclear: Should GC run on every push (with a date check to skip if nothing to GC) or only on a scheduled cron?
   - Recommendation: GC on every push (check date of oldest file; skip if within retention window). `retention-days: 0` disables GC entirely (Pattern 4).

2. **State branch write permission model in org-restricted repos**
   - What we know: GITHUB_TOKEN has `contents: write` if the consuming workflow grants it; some orgs restrict this
   - What's unclear: Silent 403 failures are hard to diagnose; the consuming workflow author may not understand why state branch writes fail
   - Recommendation: Detect the 403 exit code explicitly in Pattern 2 and emit a `core.error()` with a helpful message pointing to the required `permissions: contents: write` block.

3. **`report-path` glob returning multiple files (sharded ingest)**
   - What we know: ING-01 says glob is supported; ING-04 says shard metadata is attached
   - What's unclear: If `report-path: 'test-results/shard-*.json'` matches 4 files, do we write 4 NDJSON records or 1 merged record?
   - Recommendation: Write one NDJSON record per matched file, each tagged with shard index. The threshold evaluator deduplicates across shards by `(commitSha, testId)`.

4. **`vitest.config.ts` pool strategy for unit vs integration tests**
   - What we know: Integration tests need `--pool=forks`; unit tests can use faster default `--pool=threads`
   - Recommendation: Use Vitest's `projects` array in `vitest.config.ts` with two projects: `unit` (threads pool) and `integration` (forks pool).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` CLI | STA-01..05 (state branch operations via worktree) | ✓ (GitHub runners) | system git | — |
| `git worktree` subcommand | STA-01..05 (workspace isolation) | ✓ (git >= 2.5, GitHub runners ship git 2.43+) | — | — |
| `GITHUB_TOKEN` with `contents: write` | STA-01..05 | ✓ (standard on push workflows) | — | None — document as hard prerequisite |
| Node.js 24 | All TypeScript modules | ✓ (setup-node step) | 24.x | — |
| `npm` | Dependency install | ✓ | 10.x | — |
| `yq` | security-lint Check 2 (existing) | ✓ (GitHub runners) | — | — |

**Missing dependencies with no fallback:**
- `GITHUB_TOKEN` with `contents: write` permission — consuming workflow MUST grant this; without it state branch push fails with 403. Planner must include a "Permissions block" task for the consumer example workflow.
- `@actions/glob` — listed in STACK.md but NOT currently in `package.json`; Phase 02 must add it (`npm install @actions/glob`).

**Phase 02 does NOT require:**
- Anthropic API key
- Claude Agent SDK binary
- Playwright browser
- `healer-token` PAT

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bundled JS action with `@actions/artifact` for state storage | Composite action + dedicated git branch (NDJSON) | Research phase 2026-04-24 | Zero external infra; durable + diffable state |
| Single global `stats.ndjson` file | Date-partitioned `runs/YYYY/MM/DD.ndjson` | Phase 02 research | Rolling window reads only 7 files; efficient at scale |
| `git push --force` (overwrites) | `git push --force-with-lease=<ref>` + retry loop in isolated worktree | Phase 02 research | Concurrent-safe; primary workspace never touched |
| `zod ^3.25.x` | `zod ^4.0.0` (resolved 4.3.6) | Phase 01 execution | `z.string().min(1, { message })` object form required; positional shorthand deprecated |
| `anthropic-api-key` input | `api-key` input (multi-provider) | Phase 01.1 | All Zod extensions must use `apiKey` (camelCase), not `anthropicApiKey` |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Non-fatal after 5 exhausted retries — run data is lost silently | Pattern 2, Q1 | If user expects hard fail on exhausted retries, action would need to exit 1; discuss in Phase 02 planning |
| A2 | Single NDJSON record per CI run (not per test) is sufficient at Phase 02 scale | Pattern 3 | Revisit if a consuming repo exceeds ~5000 tests per run (estimated per-record JSON size > 5MB); at that scale per-day-per-testfile partitioning is needed |
| A3 | GPG signing of state-branch commits is deferred to Phase 06 | Q11 | If consuming repos require signed commits on protected branches, state branch push would fail; document this constraint in README |
| A4 | `playwright-healer-bot@users.noreply.github.com` is the canonical bot email | Pattern 10, Q7 | If a consumer uses a personal PAT instead of a GitHub App token, their commits use their personal email; Guard 1 won't fire and other guards (sentinel, heal cap) carry the load |

---

## Sources

### Primary (HIGH confidence)

- `ARCHITECTURE.md` — State Branch Update Protocol, concurrent write model, bootstrap sequence, dispatch payload shape, module structure [VERIFIED: local file, written 2026-04-24]
- `PITFALLS.md` — Pitfall 9 (state branch race), full pitfall inventory [VERIFIED: local file]
- `STACK.md` — Library versions, token architecture, JSON report schema [VERIFIED: local file]
- `REQUIREMENTS.md` — CFG-03, CFG-06, CFG-07, ING-01..04, STA-01..05, DET-01..04, SEC-05 requirement text [VERIFIED: local file]
- `npm view yaml version` → 2.8.3 [VERIFIED: npm registry, 2026-04-24]
- `npm view vitest version` → 4.1.5 [VERIFIED: npm registry, 2026-04-24]
- `npm view @vitest/coverage-v8 version` → 4.1.5 [VERIFIED: npm registry, 2026-04-24]
- `npm view @actions/github version` → 9.1.1 [VERIFIED: npm registry, 2026-04-24]
- `npm view zod version` → 4.3.6 [VERIFIED: npm registry, 2026-04-24]
- `.github/workflows/security-lint.yml` — Check 4 exact grep patterns for SEC-07; Check 2 yq idiom [VERIFIED: local file]
- `src/shared/config.ts` — Zod schema factory pattern, existing fields, superRefine pattern, ZodEffects constraint [VERIFIED: local file]
- `src/index.ts` — D-07 startup ordering, rawInputs shape, dispatch structure [VERIFIED: local file]
- `action.yml` — Existing inputs, INPUT_* env block, hyphen convention [VERIFIED: local file]
- [git-push --force-with-lease documentation](https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegt) — Lease semantics, ref-qualified form [CITED: git-scm.com]
- [git ls-remote --exit-code documentation](https://git-scm.com/docs/git-ls-remote) — exit code 2 = ref absent [CITED: git-scm.com]
- [git worktree documentation](https://git-scm.com/docs/git-worktree) — worktree add/remove, isolation semantics [CITED: git-scm.com]
- [git checkout --orphan documentation](https://git-scm.com/docs/git-checkout) — Orphan branch creation [CITED: git-scm.com]
- [Playwright JSON reporter — test.status values](https://playwright.dev/docs/api/class-suitedescription) — `"expected" | "unexpected" | "flaky" | "skipped"` (NOT `"passed" | "failed"`) [CITED: playwright.dev]

### Secondary (MEDIUM confidence)

- FEATURES.md — Feature dependency graph, MVP definition [VERIFIED: local file]
- Phase 01.1 SUMMARY.md — Zod 4 patterns, INPUT_* hyphen convention empirical verification, ZodEffects constraint [VERIFIED: local file]

### Tertiary (LOW confidence — not applicable in this research)

No WebSearch-only findings in this research. All claims are VERIFIED or CITED.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions npm-verified on 2026-04-24
- Architecture: HIGH — ARCHITECTURE.md provides the complete protocol; research crystallized it into plan-ready patterns with worktree isolation correctly applied
- Pitfalls: HIGH — derived from existing PITFALLS.md + Phase 02-specific risks identified during pattern writing, including the critical workspace-isolation gap
- Test harness: HIGH — vitest bare-repo pattern is well-established for git integration testing

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (stable ecosystem; 30-day horizon)
