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
| Zod factory `getInputSchema()` in `src/shared/config.ts` | D-01/D-04 | Extend this schema with CFG-03 threshold inputs; do not create a parallel schema |
| SEC-07 phone-home ban: `fetch(`, `http.request(`, etc. banned in `src/**` | D-16a / security-lint Check 4 | Octokit git operations ARE the Phase 02 allowlist carve-out (see Q10) |
| `persist-credentials: false` on all `actions/checkout` | D-14/SEC-01 | State-branch checkout step must also set it |
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

**Primary recommendation:** Implement the state branch as a dedicated git module (`src/shared/state-branch.ts`) that encapsulates all git CLI operations including bootstrap, retry loop, and GC. Keep the threshold evaluator as a pure-function module (`src/ingest/threshold-evaluator.ts`) that takes parsed NDJSON records and returns detections — no git or GitHub API calls from within the evaluator.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Report JSON parsing | Composite action step (TypeScript) | — | Pure TS/Node; no browser, no API; ingest module owns it |
| State branch git operations | Composite action step (shell/TS via `@actions/exec`) | GITHUB_TOKEN (contents:write) | git CLI on runner; GITHUB_TOKEN sufficient for branch writes |
| NDJSON append + rolling window | Composite action step (TypeScript) | — | Filesystem I/O; pure function logic; no external service |
| Threshold evaluation | Composite action step (TypeScript) | — | Pure math on parsed records; entirely in-process |
| Config file merge (CFG-06) | Composite action step (TypeScript) | Workspace filesystem | File read from `${{ github.workspace }}/.github/playwright-healer.yml` |
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
| git CLI via `@actions/exec` | GitHub REST API tree+blob create | GitHub API approach (optimistic locking via SHA check before commit) is also viable; git CLI + `--force-with-lease` is simpler to understand, test with a local bare repo, and does not require an API call roundtrip per append |

---

## Architecture Patterns

### System Architecture Diagram (Phase 02 scope)

```
Consumer CI Job (push trigger)
        │
        ▼
[actions/checkout @ github.sha]     ← persist-credentials: false
        │
        ▼
[npm ci --production]               ← installs action deps
        │
        ▼
[src/index.ts mode=ingest]
        │
        ├─► [loop-guard] ──── bot author? ──► exit 0 (INFO)
        │         │
        │      [skip-healer] in commit msg? ──► exit 0 (INFO)
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
  git fetch origin playwright-healer-state
  ┌── branch exists? ─── NO ──► bootstrap (orphan create + first commit + push)
  │
  YES
  │
  git checkout playwright-healer-state -- runs/YYYY/MM/DD.ndjson
  append NDJSON record to file
  git add + git commit -m "stats: run {run_id} [skip-healer]"
  git push --force-with-lease origin playwright-healer-state
  ┌── rejected? ──► sleep(jitter) → fetch → re-append → retry (max 5)
  │                 exhausted? → log warning, skip (non-fatal)
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
│   ├── state-branch.ts           # NEW: all git ops on playwright-healer-state
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

### Pattern 1: State Branch Bootstrap (first-ever run)

The action checks if `playwright-healer-state` exists before any append attempt. If the branch is absent, it creates an orphan branch with an initial empty NDJSON file.

```bash
# state-branch bootstrap — runs inside a git-cloned workspace
git fetch origin playwright-healer-state 2>&1
FETCH_EXIT=$?

if [ "$FETCH_EXIT" -ne 0 ]; then
  # Branch does not exist — bootstrap
  git checkout --orphan playwright-healer-state
  git rm -rf .          # clean working tree (orphan inherits index)
  mkdir -p runs/$(date -u +%Y/%m)
  echo "" > "runs/$(date -u +%Y/%m)/$(date -u +%d).ndjson"
  git add -A
  git commit -m "chore: init playwright-healer-state [skip-healer]" \
    --author="playwright-healer-bot <playwright-healer-bot@users.noreply.github.com>"
  git push -u origin playwright-healer-state
  # Concurrent bootstrap race: second bootstrapper will fail push and fall into retry loop
fi
```

Key facts:
- `git checkout --orphan <branch>` creates a branch with no parent commit [CITED: https://git-scm.com/docs/git-checkout]
- `git rm -rf .` is mandatory after orphan creation — the working tree still contains the previous HEAD's files
- Two concurrent bootstrappers: one push wins; the other's push fails as non-fast-forward and correctly falls into the STA-03 retry loop below
- The `--author` flag is important for SEC-05 loop guard (bot email = early exit signal)

### Pattern 2: State Branch Safe-Append Retry Loop (STA-03)

```typescript
// src/shared/state-branch.ts
import { getExecOutput } from '@actions/exec';

const MAX_RETRIES = 5;

export async function appendRecord(
  record: NdjsonRecord,
  ndjsonPath: string  // e.g. runs/2026/04/24.ndjson
): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Step 1: Fetch latest state
    await getExecOutput('git', ['fetch', 'origin', 'playwright-healer-state']);

    // Step 2: Get the file from remote (clobbers local copy)
    await getExecOutput('git', [
      'checkout', 'origin/playwright-healer-state', '--', ndjsonPath
    ]);

    // Step 3: Append record
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(ndjsonPath, line, 'utf8');

    // Step 4: Commit
    await getExecOutput('git', ['add', ndjsonPath]);
    await getExecOutput('git', [
      'commit', '-m',
      `stats: run ${record.runId} [skip-healer]`,
      '--author=playwright-healer-bot <playwright-healer-bot@users.noreply.github.com>'
    ]);

    // Step 5: Push with lease
    const push = await getExecOutput(
      'git', ['push', '--force-with-lease', 'origin', 'playwright-healer-state'],
      { ignoreReturnCode: true }
    );

    if (push.exitCode === 0) return; // success

    // Rejected (non-fast-forward): exponential backoff + jitter
    const delayMs = 100 * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
    core.warning(`State branch push rejected (attempt ${attempt + 1}/${MAX_RETRIES}). Retry in ${delayMs}ms.`);
    await new Promise(r => setTimeout(r, delayMs));

    // Reset commit (local) before retry
    await getExecOutput('git', ['reset', '--soft', 'HEAD~1']);
  }

  // Exhausted retries — non-fatal; log and continue
  core.warning(
    `State branch: all ${MAX_RETRIES} push attempts rejected. ` +
    `Run ${record.runId} stats will not be recorded. Threshold evaluation proceeds with stale data.`
  );
}
```

Key facts:
- `--force-with-lease` succeeds only if the remote ref matches our local `FETCH_HEAD`; concurrent push from another job causes rejection [CITED: https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegt]
- Reset strategy: `git reset --soft HEAD~1` preserves staged changes while undoing the commit; the retry re-appends the record on top of the freshly-fetched remote state
- `ignoreReturnCode: true` on `getExecOutput` prevents throwing; we inspect `exitCode` manually
- After exhausted retries: **non-fatal**. The run's data is lost for this push (not catastrophic for analytics). Log a warning; threshold evaluation still runs on the latest valid state. [ASSUMED — "non-fatal after 5 exhausted retries" is the ARCHITECTURE.md design intent but the exact behaviour for the user can be discussed if a hard-fail is preferred]

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
- **Per-run record** (not per-test) — one NDJSON line per CI run is far more efficient: `git add + commit` happens once, not once per test file; a 100-test suite produces one append, not 100 [ASSUMED — single record per run is simpler; per-test-file partitioning trades simplicity for query speed at high test counts; Phase 02 defers partitioning]

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

**Why date-partitioned?** The rolling window evaluation reads only the last `flake-window-days` worth of files (e.g. 7 days = at most 7 files), not the entire NDJSON corpus. The evaluator can compute the required date range (`today - window_days`) and `git checkout` only those files.

**Pruning rule (STA-05):** After a successful push, delete files older than `retention-days` (default 90). Since this is on a separate orphan branch, a force push is safe and expected. The delete+force-push happens in the same git operation as the append (or as a separate GC run).

```typescript
// GC: invoked after successful push, not before (avoids interleaving with concurrent append)
export async function runGc(retentionDays: number): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  // Walk runs/ directory, delete date directories older than cutoff
  // ... fs.readdirSync recursion ...
  // git add -A + git commit -m "chore: gc healer state [skip-healer]" + push
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

// ── CFG-03: Threshold inputs (extend existing getInputSchema()) ─────────────
// Add to the z.object({}) inside getInputSchema():
//   reportPath:           z.string().default('test-results/results.json'),
//   flakeRateThreshold:   z.coerce.number().min(0).max(1).default(0.2),
//   flakeWindowDays:      z.coerce.number().int().min(1).default(7),
//   slowRegressionPct:    z.coerce.number().min(1).default(1.5),
//   rerunCount:           z.coerce.number().int().min(1).default(10),
//   rerunPassRate:        z.coerce.number().min(0).max(1).default(0.9),
//   maxBudgetUsd:         z.coerce.number().min(0).default(2.0),
//   maxTurns:             z.coerce.number().int().min(1).default(30),
//   retentionDays:        z.coerce.number().int().min(1).default(90),
//   maxHealsPerTestPerWeek: z.coerce.number().int().min(0).default(3),
//   stateBranchName:      z.string().default('playwright-healer-state'),

// ── CFG-06: YAML config file loader ─────────────────────────────────────────
export function loadYamlConfig(workspacePath: string): Record<string, unknown> {
  const configPath = `${workspacePath}/.github/playwright-healer.yml`;
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = parseYaml(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<string, unknown>;
  } catch (err) {
    core.warning(`CFG-06: .github/playwright-healer.yml could not be parsed as YAML: ${err}. Ignoring.`);
    return {};
  }
}

// ── Merge rule: action.yml inputs WIN over config file ───────────────────────
// Action.yml inputs arrive as strings from core.getInput(); empty string = not set.
// YAML file provides the user's preferred defaults for their repo.
// Non-empty action.yml input overrides the YAML file value.
export function mergeConfigs(
  actionInputs: Record<string, string>,
  yamlConfig: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...yamlConfig };
  for (const [key, value] of Object.entries(actionInputs)) {
    if (value !== '') {
      // camelCase → kebab-case for YAML key lookup is unnecessary here;
      // action inputs arrive as camelCase after getInputSchema(), YAML keys are kebab-case.
      // The Zod schema handles coercion; we merge before parsing.
      merged[key] = value;
    }
  }
  return merged;
}
```

**Precedence rule:** action.yml inputs WIN when non-empty. YAML file provides per-repo defaults that are overridable at invocation time. This matches how Dependabot and Renovate handle config: file-based config with per-invocation overrides.

**Security: fork PRs and the YAML file.** The `.github/playwright-healer.yml` file is read from `${{ github.workspace }}` — the checked-out commit. On a fork PR, this is the attacker's fork commit. However, Phase 02 only reads this file, never executes its values as code. The values are Zod-validated numbers and strings. The only risk is threshold manipulation (e.g. setting `flake-rate-threshold: 0` to force detections). Since Phase 02 is log-only (DET-04) and ingest does not run on fork PRs (SEC-02 means no `pull_request_target`), this is a non-issue in Phase 02. Phase 04 documents the fork warning in the README.

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
    if (runCount < 10) continue;  // DET-02: need at least 10 runs

    // Flake rate: (failed OR flaky) / total
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

    // Duration p95 regression (DET-03)
    const durations = runs.map(r => r.durationMs).sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;
    // Baseline: first 10 runs as the "before" baseline
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

  // Guard 1: bot author email
  const authorEmail = payload.head_commit?.author?.email ?? '';
  if (authorEmail === BOT_EMAIL) {
    core.info(`SEC-05: Skipping ingest — commit is from playwright-healer-bot (${BOT_EMAIL})`);
    return true;
  }

  // Guard 2: [skip-healer] in commit message
  const commitMessage = payload.head_commit?.message ?? '';
  if (commitMessage.includes(SKIP_SENTINEL)) {
    core.info(`SEC-05: Skipping ingest — commit message contains [skip-healer] sentinel`);
    return true;
  }

  return false;
}
```

Notes:
- **Guard 3 (per-test heal cap in state branch) is evaluated in Phase 04** when dispatch is added; Phase 02 doesn't need it for log-only mode
- The bot email `playwright-healer-bot@users.noreply.github.com` is the form GitHub uses for app tokens; document this in the action README so consumers can configure their PAT identity if using a personal token instead
- `payload.head_commit` is available on `push` events; on `workflow_call` events, the consumer workflow must pass commit metadata as inputs

### Pattern 11: SEC-07 Allowlist Carve-Out for Octokit (Q10)

Phase 02 introduces git operations via `@actions/exec` (spawns `git` binary). The security-lint Check 4 bans HTTP client patterns in `src/**`:

```
PATTERNS='fetch\(|http\.request\(|https\.request\(|axios|got\(|node-fetch|undici'
```

**Octokit does not match any of these patterns.** `@actions/github` and `@octokit/rest` are imported as modules; their internal fetch calls are not in `src/**`. The Check 4 grep scans call-sites in the project's own source files, not in `node_modules/`. Therefore Phase 02 requires **no change to security-lint Check 4**.

If Phase 02 were to call `octokit.repos.getContent()` or similar directly in `src/**`, that would be a module import (`import { Octokit } from '@octokit/rest'`) with no matching grep pattern. The ban is against raw HTTP primitives (`fetch(`, `http.request(`), not against higher-level client libraries.

**However:** Phase 02 does NOT use Octokit at all. State branch writes use the `git` CLI (spawned via `@actions/exec`). `@actions/github` is used only to read `context.payload` for the loop guard (no HTTP call from our source code). This keeps Phase 02 free of any API call that would need a Check 4 carve-out.

Phase 04, when it adds `workflow_dispatch` via Octokit, will need to extend Check 4 with an allowlist comment for `octokit.rest.actions.createWorkflowDispatch`. The pattern to add at that time:

```yaml
# ALLOWLIST for Phase 04: Octokit workflow_dispatch (SEC-07 approved)
ALLOWED_PATTERN='createWorkflowDispatch'
```

### Pattern 12: Git Author Identity for State Branch Commits

State branch commits authored by the action must use a consistent bot identity for SEC-05 Guard 1 detection to work:

```bash
git -c user.email="playwright-healer-bot@users.noreply.github.com" \
    -c user.name="playwright-healer-bot" \
    commit -m "stats: run ${RUN_ID} [skip-healer]"
```

Or via the TypeScript layer:
```typescript
await getExecOutput('git', [
  '-c', 'user.email=playwright-healer-bot@users.noreply.github.com',
  '-c', 'user.name=playwright-healer-bot',
  'commit', '-m', `stats: run ${runId} [skip-healer]`
]);
```

**Do NOT use `--author` flag alone** — it sets the author but not the committer; `user.email`/`user.name` config sets both. `git log --format=%ae` (author email) must return `playwright-healer-bot@users.noreply.github.com` for Guard 1 to fire.

**Commit signing:** Unsigned commits (Phase 02 default). GITHUB_TOKEN commits appear in GitHub UI as authored by `github-actions[bot]` only if authenticated via the token's identity. For clarity, the action sets its own bot identity via `-c user.email=`. This does not require GPG signing. [ASSUMED — unsigned is simpler and sufficient for Phase 02; GPG signing is a possible Phase 06 polish item]

### Pattern 13: Concurrent-Write Integration Test Harness (STA-04)

The bare-repo approach from ARCHITECTURE.md §Testing Strategy is the canonical pattern:

```typescript
// tests/integration/state-branch.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('state-branch concurrent write (STA-04)', () => {
  let remoteDir: string;
  let ws1: string;
  let ws2: string;

  beforeEach(() => {
    // Create a bare "remote" repo
    remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-remote-'));
    execSync('git init --bare', { cwd: remoteDir });

    // Two separate local clones (simulate two parallel CI jobs)
    ws1 = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-ws1-'));
    ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-ws2-'));
    execSync(`git clone ${remoteDir} .`, { cwd: ws1 });
    execSync(`git clone ${remoteDir} .`, { cwd: ws2 });

    // Configure git identity in both workspaces
    for (const ws of [ws1, ws2]) {
      execSync('git config user.email "test@test.com"', { cwd: ws });
      execSync('git config user.name "Test"', { cwd: ws });
    }
  });

  afterEach(() => {
    fs.rmSync(remoteDir, { recursive: true, force: true });
    fs.rmSync(ws1, { recursive: true, force: true });
    fs.rmSync(ws2, { recursive: true, force: true });
  });

  it('both concurrent writes land without either record lost', async () => {
    // Bootstrap state branch from ws1
    await bootstrapStateBranch(ws1, remoteDir);

    // Simulate concurrent: ws1 fetches first, then ws2 also fetches before ws1 pushes
    const record1 = makeRecord('run-001');
    const record2 = makeRecord('run-002');

    // Both fetch at the same time
    await fetchStateBranch(ws1);
    await fetchStateBranch(ws2);

    // ws1 appends and pushes first
    await appendAndPush(ws1, record1);  // should succeed

    // ws2 appends and tries to push — should be rejected once, retry, then succeed
    await appendAndPush(ws2, record2);  // should retry and succeed

    // Verify both records are in the final state
    const finalContent = getFinalNdjson(remoteDir);
    expect(finalContent).toContain('run-001');
    expect(finalContent).toContain('run-002');
  });
});
```

**Key design note:** This test exercises the actual `appendRecord()` function from `state-branch.ts`, not a mock. The test drives real `git` CLI commands. The barrier (ws1 pushes before ws2's push attempt) is simulated by calling `appendAndPush(ws1)` awaited before `appendAndPush(ws2)`. The retry loop in `appendRecord()` should handle the conflict automatically.

**Test runner:** `vitest --pool=forks` is required for integration tests that spawn child processes (git CLI). The `--pool=forks` flag gives each test its own process memory space, preventing git environment variable leakage between tests.

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
    description: 'Days to retain state branch records before GC. Default: 90'
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

### Pitfall A: `git rm -rf .` after orphan creates a "dirty" state if run twice

**What goes wrong:** If the bootstrap code runs in a workspace that already has the orphan branch (e.g. a concurrent bootstrap race resolved and the branch now exists), `git rm -rf .` deletes all files before the push. If the push then fails because the branch already has commits, the local workspace is corrupted.

**Prevention:** Wrap the entire bootstrap sequence in a guard that re-checks the remote after `git rm -rf .`:
```bash
git fetch origin playwright-healer-state 2>&1 || true
if git rev-parse --verify origin/playwright-healer-state >/dev/null 2>&1; then
  # Branch was created by concurrent bootstrapper — fall into normal retry loop
  git checkout origin/playwright-healer-state
else
  # Still no branch — proceed with orphan creation
  git checkout --orphan playwright-healer-state
  git rm -rf .
  # ... create initial commit ...
fi
```

### Pitfall B: State branch NDJSON file corruption from partial writes

**What goes wrong:** A process exits mid-write (SIGTERM from runner timeout) after appending a partial JSON object to the `.ndjson` file. The next read attempt fails to parse the file.

**Prevention:** Write to a temp file in the same directory, then `fs.renameSync()` (atomic on POSIX). Since we're operating in a git worktree anyway, the rename is within the same filesystem:
```typescript
const tmpPath = `${ndjsonPath}.tmp`;
fs.writeFileSync(tmpPath, appendedContent, 'utf8');
fs.renameSync(tmpPath, ndjsonPath);  // atomic on POSIX
```

**Recovery:** Reader (threshold evaluator) must parse the NDJSON file line-by-line with try/catch per line. A corrupt line is skipped with a warning; the remainder of the file is usable.

### Pitfall C: `git push --force-with-lease` fails with "stale info" when workspace ref is cached

**What goes wrong:** If the local `FETCH_HEAD` is stale (e.g. a previous `git fetch` of a different branch updated it), `--force-with-lease` may use the wrong expected ref and fail permanently even after a successful fetch of `playwright-healer-state`.

**Prevention:** Use the fully qualified form:
```bash
git push --force-with-lease=playwright-healer-state origin playwright-healer-state
```

This pins the lease to the specific ref rather than relying on `FETCH_HEAD`. [CITED: https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegt]

### Pitfall D: `@actions/github` `context.payload.head_commit` is null on non-push events

**What goes wrong:** The loop guard reads `context.payload.head_commit.author.email`. On `workflow_call` or `pull_request` events, `head_commit` is undefined, causing a null dereference.

**Prevention:**
```typescript
const authorEmail = github.context.payload?.head_commit?.author?.email ?? '';
```
Use optional chaining everywhere. If `head_commit` is absent (non-push event), the bot-email guard simply doesn't fire — which is correct; the action proceeds normally.

### Pitfall E: YAML parser throws on malformed `.github/playwright-healer.yml` — crashes ingest

**What goes wrong:** Consumer has a syntax error in their config file. `yaml.parse()` throws. This crashes the entire ingest run, losing the current run's stats.

**Prevention:** Wrap the YAML parse in try/catch (Pattern 7 already shows this). Emit a `core.warning()` and return an empty config object — action.yml defaults take effect, and the run proceeds.

### Pitfall F: `z.coerce.number()` on non-numeric YAML values produces NaN (CFG-07 gap)

**What goes wrong:** Consumer writes `flake-rate-threshold: "banana"` in the YAML config. `z.coerce.number()` coerces the string `"banana"` to `NaN`, which passes `z.number()` type check. The threshold evaluator then produces no detections (NaN comparisons are always false).

**Prevention:** Add `.refine((v) => !isNaN(v), { message: 'must be a valid number' })` after `z.coerce.number()`:
```typescript
flakeRateThreshold: z.coerce.number()
  .refine((v) => !isNaN(v), { message: 'flake-rate-threshold must be a valid number (e.g. 0.2)' })
  .min(0).max(1)
  .default(0.2),
```

This is the CFG-07 success criterion: SC#4 says "invalid `flake-rate-threshold: "banana"` causes action to fail with a Zod validation error naming the invalid field, not a JavaScript crash."

### Pitfall G: `report-path` input uses glob but `@actions/glob` is not yet installed

**What goes wrong:** ING-01 allows a glob pattern for `report-path`. If the planner implements it with a hardcoded `fs.readFileSync(config.reportPath)`, users who specify a glob pattern get an ENOENT error.

**Prevention:** Add `@actions/glob` to dependencies (it's already in STACK.md; verify it's in package.json). Use `glob.create(config.reportPath).glob()` to resolve the pattern, then process each matched file. If zero files match, emit a warning (not a failure) and record as `report-unreadable` — the test run may have produced no report (e.g. all tests were skipped).

### Pitfall H: The state branch `playwright-healer-state` contains test code after a non-orphan `git checkout`

**What goes wrong:** The bootstrap runs `git checkout --orphan playwright-healer-state` but forgets `git rm -rf .`. The orphan branch commit then contains all files from the previous HEAD (the consumer's main branch source code). This bloats the state branch and confuses tools that inspect it.

**Prevention:** `git rm -rf .` immediately after `git checkout --orphan` (Pattern 1 shows this). Add a verification step in the integration test: after bootstrap, `git ls-files` on the state branch should return ONLY the `.ndjson` file.

### Pitfall I: Threshold evaluator reads ALL NDJSON files instead of only the window

**What goes wrong:** The evaluator does `git checkout playwright-healer-state -- runs/` (checking out the entire `runs/` directory). On a repo with 1 year of data, this means reading hundreds of MB of NDJSON.

**Prevention:** Check out only the files in the window:
```typescript
const filesToFetch = getDatesInWindow(config.flakeWindowDays)
  .map(d => `runs/${d.year}/${d.month.toString().padStart(2,'0')}/${d.day.toString().padStart(2,'0')}.ndjson`);
for (const f of filesToFetch) {
  await getExecOutput('git', ['checkout', 'origin/playwright-healer-state', '--', f], { ignoreReturnCode: true });
  // ignoreReturnCode because the file may not exist yet for older dates
}
```

### Pitfall J: SEC-07 Check 4 false-positive if `@actions/github` import appears in src/

**What goes wrong:** Importing `@actions/github` in `src/shared/loop-guard.ts` does not match any banned pattern (the banned patterns are `fetch(`, `http.request(`, etc., not module names). But a future developer might add a direct `fetch()` call next to the import and forget the ban. 

**Prevention:** The current Check 4 patterns correctly target call-sites, not imports. No change needed. Document in the ingest module's header comment that any network calls must be reviewed against SEC-07 before adding.

---

## Answers to Critical Research Questions

### Q1: State branch concurrency — force-with-lease retry loop

**Answer:** The canonical implementation is the Pattern 2 retry loop above. Key parameters:
- **Max retries:** 5 (from ARCHITECTURE.md §State Branch Update Protocol)
- **Backoff:** `100ms * 2^attempt + random(0..100ms)` jitter — starts at ~100–200ms, reaches ~3.3–3.4s at attempt 5
- **Failure mode after exhausted retries:** Non-fatal. Log a `core.warning()`. Threshold evaluation proceeds with the last successfully fetched state (which is stale by one record, at most). The lost record is a minor analytics gap, not a security or correctness issue.
- **Git ref:** Use `--force-with-lease=playwright-healer-state` (fully qualified form) per Pitfall C.

### Q2: NDJSON record schema

**Answer:** See Pattern 3. Key fields: `schemaVersion: 1`, `timestamp` (ISO 8601 UTC), `runId` (GITHUB_RUN_ID), `commitSha`, `branch`, `healerVersion`, `shardIndex | null`, `shardTotal | null`, `tests: NdjsonTestEntry[]`. The `testId` = `"{filePath}::{title}"` (stable across runs). All per-run test data in one record (one NDJSON line per CI run).

### Q3: Orphan branch creation

**Answer:** See Pattern 1. Exact sequence:
1. `git fetch origin playwright-healer-state` — check existence
2. If exit code 128 (not found): `git checkout --orphan playwright-healer-state` → `git rm -rf .` → create initial `.ndjson` → `git add` → `git commit` → `git push -u origin playwright-healer-state`
3. If concurrent bootstrapper wins the push: the second bootstrapper's push fails; it falls into the Pattern 2 retry loop which re-fetches the new branch and appends its record normally.
**Token:** `GITHUB_TOKEN` with `contents: write` is sufficient for state branch operations. `healer-token` PAT is not needed in Phase 02. [VERIFIED against STACK.md §Token Architecture]

### Q4: Rolling window threshold evaluation

**Answer:** Phase 02 implements **both** flake-rate (DET-02) and slow-regression (DET-03) detection. The math is in Pattern 8. The `rerunCount` and `rerunPassRate` inputs are declared in the Zod schema (CFG-03 completeness) but NOT evaluated in Phase 02 — those are Phase 03 (VAL-01). The evaluator lives in `src/ingest/threshold-evaluator.ts` as a pure function. The ingest module calls it after the state-branch write (so the evaluator sees the freshly-appended data).

### Q5: CFG-06 .github/playwright-healer.yml config file

**Answer:** See Pattern 7. Precedence: **action.yml inputs win** (non-empty action input overrides YAML file value). The file is read from `process.env.GITHUB_WORKSPACE + '/.github/playwright-healer.yml'`. On fork PRs this is the fork's file — but Phase 02 is log-only (DET-04) and fork PRs don't run ingest (no `pull_request_target`). The only risk is threshold manipulation, which is non-critical in log-only mode.

### Q6: CFG-07 Zod validation of merged config

**Answer:** Extend the existing `getInputSchema()` factory in `src/shared/config.ts`. Do NOT create a separate `getIngestConfigSchema()`. The factory pattern (`export function getInputSchema()`) allows Phase 02 to add the threshold fields to the same factory call — tests can still call `getInputSchema()` without module-level state. The `z.coerce.number().refine(!isNaN)` pattern (Pitfall F) catches `"banana"` inputs with a field-naming Zod error.

### Q7: SEC-05 loop guard

**Answer:** See Pattern 10. Two guards in Phase 02:
1. **Bot author email check:** `payload.head_commit?.author?.email === 'playwright-healer-bot@users.noreply.github.com'`
2. **Commit message sentinel:** `payload.head_commit?.message?.includes('[skip-healer]')`

Guard 3 (per-test heal cap) is not needed in Phase 02 (log-only; no dispatch). The check is in `src/shared/loop-guard.ts`, called as the FIRST thing in `src/ingest/index.ts` after config validation, before any state-branch operation.

### Q8: DET-01..04 detection mechanism

**Answer:** See Pattern 9. Contract:
- **`$GITHUB_STEP_SUMMARY`:** Markdown table with columns: Test, Reason, Value, Threshold, Runs in Window. Plus an explicit "log-only" note that no dispatch fires.
- **`::warning::` annotations:** One annotation per detection using `core.warning(message, { file: d.filePath })`. This surfaces in the GitHub Actions UI as a file-level warning annotation.
- **Test ID format:** `"{filePath}::{title}"` — the same `testId` used in the NDJSON schema.
- **No `workflow_dispatch` call anywhere in Phase 02 source.** This is an import-discipline assertion: `src/ingest/**` must not import the dispatch path. Phase 04 adds it.

### Q9: Fork-PR safety

**Answer:** Fork PRs do not reach the ingest step in Phase 02 because:
- The action uses no `pull_request_target` trigger (SEC-02, D-14)
- On a `pull_request` event from a fork, `GITHUB_TOKEN` has read-only access; any state branch push would fail with 403 anyway

The action should detect this gracefully: check `github.context.payload.pull_request?.head?.repo?.fork === true` at startup and emit `core.info('Skipping ingest: fork PRs are not supported')`. This prevents a confusing 403 error in the log. Implement this check in `loop-guard.ts` as Guard 0 (before the bot-email check).

### Q10: Octokit + @actions/github — SEC-07 allowlist

**Answer:** See Pattern 11. Phase 02 requires **no change to security-lint Check 4**. The banned patterns (`fetch(`, `http.request(`, etc.) are call-site patterns in `src/**`, not module names. `@actions/github` and `@actions/exec` are safe to import; their internals are in `node_modules/`, outside the scan scope. Phase 04 will add the `createWorkflowDispatch` allowlist comment when dispatch is implemented.

### Q11: Commit signing and token identity

**Answer:** Unsigned commits via GITHUB_TOKEN. Git author identity is set per-command via `-c user.email=playwright-healer-bot@users.noreply.github.com` (Pattern 12). This ensures `git log --format=%ae` returns the bot email for SEC-05 Guard 1 detection. GITHUB_TOKEN is sufficient for state branch writes (`contents: write`). No `healer-token` PAT needed in Phase 02. GPG signing is deferred to Phase 06 as optional polish.

### Q12: Concurrent-write integration test design

**Answer:** See Pattern 13. Test harness: local bare git repo as remote + two separate local clones (simulating two parallel CI jobs). Uses real `git` CLI via `child_process.execSync`. Test runner: `vitest --pool=forks`. The test exercises the real `appendRecord()` function — not a mock. The concurrent write scenario is simulated by: (a) both clones `fetch` before either pushes, (b) ws1 appends+pushes (succeeds), (c) ws2 appends+pushes (rejected once, retries, succeeds). Assert both records in final state.

### Q13: NDJSON file structure

**Answer:** Date-partitioned (Pattern 4). Single file per day: `runs/YYYY/MM/DD.ndjson`. This is simpler than per-test-file partitioning and defers the performance concern. At 100 tests × 10 CI runs/day × 365 days = ~365,000 lines per year per test (unrealistic; more like 100 tests × 5 runs/day = ~500 lines/day across all tests). At this scale the per-day file is well under 1MB. Phase 04 can add partitioning if needed. GC (STA-05) happens after successful push; delete files older than `retention-days`.

### Q14: Threshold log-only semantics

**Answer:** Phase 02 source code never imports `createWorkflowDispatch` or any dispatch-related Octokit method. The "log-only" guarantee is enforced at the import level: `src/ingest/threshold-evaluator.ts` has no `@actions/github` import for dispatch. The summary output includes an explicit note: `"No workflow_dispatch was fired. Enable auto-dispatch in Phase 04."` This is also a CI-verifiable assertion: `grep -r 'createWorkflowDispatch' src/` must return zero results until Phase 04.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML file parsing | Custom YAML tokenizer | `yaml` 2.8.3 (eemeli) | YAML 1.2 edge cases (anchors, multi-line strings, null vs empty) are tricky; the library handles them correctly |
| Glob resolution for report-path | `fs.readdirSync` + manual pattern matching | `@actions/glob` 0.7.0 | Already in STACK.md; handles GitHub Actions glob semantics (`**`, negation) correctly |
| Exponential backoff | Custom sleep loop | Inline formula `100 * 2^attempt + jitter` | Simple enough to inline; full backoff libraries overkill |
| NDJSON line-by-line parsing | Custom streaming parser | `JSON.parse` per line in a loop | NDJSON is trivially parseable line-by-line; no streaming library needed |
| Git author identity | Custom GH App token flow | `-c user.email=...` git flag | Bot identity via git config is zero-infra; GH App token is Phase 06 polish |
| Step summary rendering | Custom HTML generation | `@actions/core.summary` API | Official GitHub API; handles summary file path, buffering, and write flush |

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
| STA-01 | Orphan branch bootstrap on first use | integration | `npx vitest run --pool=forks tests/integration/state-branch.test.ts` | ❌ Wave 0 |
| STA-02 | NDJSON append (second run appends, not overwrites) | integration | `npx vitest run --pool=forks tests/integration/state-branch.test.ts` | ❌ Wave 0 |
| STA-03 | force-with-lease retry on rejection | integration | `npx vitest run --pool=forks tests/integration/state-branch.test.ts` | ❌ Wave 0 |
| STA-04 | Both concurrent writes land (no record lost) | integration | `npx vitest run --pool=forks tests/integration/state-branch.test.ts` | ❌ Wave 0 |
| STA-05 | GC: records older than retention-days are dropped | unit | `npx vitest run tests/unit/state-branch-gc.test.ts` | ❌ Wave 0 |
| DET-01 | Rolling metrics computed (flake rate, p95) | unit | `npx vitest run tests/unit/threshold-evaluator.test.ts` | ❌ Wave 0 |
| DET-02 | Flake candidate detection (>=10 runs, rate >= threshold) | unit | `npx vitest run tests/unit/threshold-evaluator.test.ts` | ❌ Wave 0 |
| DET-03 | Slow candidate detection (p95 regression) | unit | `npx vitest run tests/unit/threshold-evaluator.test.ts` | ❌ Wave 0 |
| DET-04 | Log-only: step summary written, no dispatch fired | unit (import assert) | `grep -r 'createWorkflowDispatch' src/ \|\| true` | ❌ Wave 0 |
| CFG-03 | Threshold inputs declared and default correctly | unit | `npx vitest run tests/unit/config.test.ts` | ❌ Wave 0 |
| CFG-06 | YAML config file merges with action.yml inputs (action wins) | unit | `npx vitest run tests/unit/config.test.ts` | ❌ Wave 0 |
| CFG-07 | Invalid `flake-rate-threshold: "banana"` fails with Zod field error | unit | `npx vitest run tests/unit/config.test.ts` | ❌ Wave 0 |
| SEC-05 | Bot author email → early exit; [skip-healer] → early exit | unit | `npx vitest run tests/unit/loop-guard.test.ts` | ❌ Wave 0 |

### Phase 02 Success Criteria → Test Map

| SC | Behavior | Primary Test |
|----|----------|-------------|
| SC#1 | Orphan branch created on first use; second run appends NDJSON line | integration/state-branch.test.ts |
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

- [ ] `vitest.config.ts` — Vitest configuration with `pool: 'forks'` for integration tests
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
| V4 Access Control | Yes (partial) | SEC-05 loop guard (bot-author + skip-healer); fork-PR early exit |
| V5 Input Validation | Yes | Zod schema on all action inputs + YAML config file values (CFG-07) |
| V6 Cryptography | No | No crypto operations; git operations use GITHUB_TOKEN (managed by GitHub) |

### Known Threat Patterns for Phase 02 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Config file threshold manipulation (fork PR) | Tampering | Log-only mode in Phase 02; no dispatch fired; malicious threshold = no heal triggered |
| NDJSON injection via test title containing newline characters | Tampering | `JSON.stringify()` encodes all control characters including `\n`; NDJSON records are safe |
| State branch commit by attacker impersonating bot email | Spoofing | Bot email check is defense-in-depth; state branch push requires GITHUB_TOKEN `contents:write`; attacker cannot push to consuming repo's state branch |
| Loop amplification (action triggers itself via commit) | Repudiation | SEC-05 guards 1+2 (bot email + skip-healer sentinel); both are checked before any git write |
| YAML bomb (`yes: &a [*a, *a, *a, *a]` expansion) | DoS | `yaml` 2.8.3 has built-in alias depth limit; add `maxAliasCount: 100` to parse options as defense-in-depth |

---

## Open Questions

1. **GC trigger timing**
   - What we know: STA-05 says GC happens periodically; ARCHITECTURE.md says GC after successful push, not before
   - What's unclear: Should GC run on every push (with a date check to skip if nothing to GC) or only on a scheduled cron? Every-push GC is simpler; cron-based is cheaper for repos with short retention windows
   - Recommendation: GC on every push (check date of oldest file; skip if within retention window). Add a `retention-days: 0` shortcut to disable GC for Phase 02 testing

2. **State branch write permission model in fork-based repos**
   - What we know: GITHUB_TOKEN on the consuming repo has `contents: write` if the workflow grants it; fork PR workflows only get read access
   - What's unclear: Some consuming repos may have org-level policies restricting `contents: write` to specific conditions; this could cause silent state branch push failures
   - Recommendation: Emit `core.info()` with the effective token scope at startup (debug mode only); document minimum required permissions in README

3. **`report-path` glob returning multiple files (sharded ingest)**
   - What we know: ING-01 says glob is supported; ING-04 says shard metadata is attached
   - What's unclear: If `report-path: 'test-results/shard-*.json'` matches 4 files, do we process each and write 4 NDJSON records (one per shard) or merge them into 1 record?
   - Recommendation: Write one NDJSON record per matched file, each tagged with shard index derived from the filename or from a `SHARD_INDEX` input. The threshold evaluator deduplicates across shards by `(commitSha, testId)`.

4. **`vitest.config.ts` pool strategy for unit vs integration tests**
   - What we know: Integration tests need `--pool=forks`; unit tests can use the faster default `--pool=threads`
   - What's unclear: Can a single vitest config handle both with different pool settings per test directory?
   - Recommendation: Use `projects` array in `vitest.config.ts` with two projects: `unit` (threads pool) and `integration` (forks pool). This avoids needing two separate config files.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` CLI | STA-01..05 (state branch operations) | ✓ (GitHub runners) | system git | — |
| `GITHUB_TOKEN` with `contents: write` | STA-01..05 | ✓ (standard on push workflows) | — | None — document as hard prerequisite |
| Node.js 24 | All TypeScript modules | ✓ (setup-node step) | 24.x | — |
| `npm` | Dependency install | ✓ | 10.x | — |
| `yq` | security-lint Check 2 (existing) | ✓ (GitHub runners) | — | — |

**Missing dependencies with no fallback:**
- `GITHUB_TOKEN` with `contents: write` permission — consuming workflow MUST grant this; without it state branch push silently fails. Planner must include a "Permissions block" task for the consumer example workflow.

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
| `git push --force` (overwrites) | `git push --force-with-lease` + retry loop | Research phase | Concurrent-safe; no lost records under parallel CI |
| `zod ^3.25.x` | `zod ^4.0.0` (resolved 4.3.6) | Phase 01 execution | `z.string().min(1, { message })` object form required; positional shorthand deprecated |
| `anthropic-api-key` input | `api-key` input (multi-provider) | Phase 01.1 | All Zod extensions must use `apiKey` (camelCase), not `anthropicApiKey` |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Non-fatal after 5 exhausted retries — run data is lost silently | Pattern 2, Q1 | If user expects hard fail on exhausted retries, action would need to exit 1; discuss in Phase 02 planning |
| A2 | Single NDJSON record per CI run (not per test) is sufficient at Phase 02 scale | Pattern 3 | If a consuming repo has 1000+ tests per shard, the per-run record becomes very large; partitioning may be needed sooner |
| A3 | GPG signing of state-branch commits is deferred to Phase 06 | Q11 | If consuming repos require signed commits on protected branches, state branch push would fail; document this constraint |
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
- `src/shared/config.ts` — Zod schema factory pattern, existing fields, superRefine pattern [VERIFIED: local file]
- `src/index.ts` — D-07 startup ordering, rawInputs shape, dispatch structure [VERIFIED: local file]
- `action.yml` — Existing inputs, INPUT_* env block, hyphen convention [VERIFIED: local file]
- [git-push --force-with-lease documentation](https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegt) — Lease semantics, ref-qualified form [CITED: git-scm.com]
- [git checkout --orphan documentation](https://git-scm.com/docs/git-checkout) — Orphan branch creation, empty initial working tree requirement [CITED: git-scm.com]
- [Playwright JSON reporter — test.status values](https://playwright.dev/docs/api/class-suitedescription) — `"expected" | "unexpected" | "flaky" | "skipped"` (NOT `"passed" | "failed"`) [CITED: playwright.dev]

### Secondary (MEDIUM confidence)

- FEATURES.md — Feature dependency graph, MVP definition [VERIFIED: local file]
- Phase 01.1 SUMMARY.md — Zod 4 patterns, INPUT_* hyphen convention empirical verification [VERIFIED: local file]

### Tertiary (LOW confidence — not applicable in this research)

No WebSearch-only findings in this research. All claims are VERIFIED or CITED.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions npm-verified on 2026-04-24
- Architecture: HIGH — ARCHITECTURE.md provides the complete protocol; research crystallized it into plan-ready patterns
- Pitfalls: HIGH — derived from the existing PITFALLS.md + new Phase 02-specific risks identified during pattern writing
- Test harness: HIGH — vitest bare-repo pattern is well-established for git integration testing

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (stable ecosystem; 30-day horizon)
