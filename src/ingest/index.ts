// src/ingest/index.ts
//
// Phase 02 ingest pipeline orchestration. Order of operations is load-bearing
// (see 02-RESEARCH.md and the SEC-05 / DET-04 contracts):
//
//   1. shouldSkipIngest()  — SEC-05 loop-guard MUST be first; bot/fork/sentinel
//      authors return early before any I/O or git operation.
//   2. (config already merged + validated upstream in src/index.ts main())
//   3. parseReport()       — locate playwright JSON via @actions/glob, parse;
//      zero matches or unreadable → record marked 'report-unreadable' but pipeline continues.
//   4. NDJSON record build — runId/commitSha/branch from runner env;
//      shardIndex/shardTotal from SHARD_INDEX/SHARD_TOTAL env (null if unset).
//   5. bootstrapOrGetWorktree() + appendRecord() — STA-01..04 git-as-DB write.
//   6. runGc()             — STA-05 retention prune.
//   7. evaluateThresholds()— DET-01..03 over the rolling window.
//   8. writeDetectionSummary() — DET-04 log-only step summary.
//
// Worktree cleanup runs in `finally` so partial failures don't leak /tmp dirs.

import * as core from '@actions/core';
import * as github from '@actions/github';
import { create as createGlob } from '@actions/glob';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

import { shouldSkipIngest } from '../shared/loop-guard.js';
import { type Config } from '../shared/config.js';
import { parseReport } from './report-parser.js';
import {
  bootstrapOrGetWorktree,
  appendRecord,
  runGc,
  removeWorktree,
} from '../shared/state-branch.js';
import type { NdjsonRecord, NdjsonTestEntry } from '../shared/types.js';
import { evaluateThresholds } from './threshold-evaluator.js';
import { writeDetectionSummary } from './summary-writer.js';

// Read package.json version for healerVersion (composite action — no bundling)
const require = createRequire(import.meta.url);
const { version: VERSION } = require('../../package.json') as { version: string };

export async function run(config: Config): Promise<void> {
  // ── Step 1: LOOP GUARD (SEC-05) — must be first ──────────────────────────
  if (shouldSkipIngest()) {
    return; // shouldSkipIngest() emits the core.info() message
  }

  // ── Step 2: Config already merged + validated by src/index.ts main() ────

  // ── Step 3: REPORT PARSE (ING-01..04) ───────────────────────────────────
  const globber = await createGlob(config.reportPath, {
    followSymbolicLinks: false,
  });
  const reportFiles = await globber.glob();

  // Shard metadata from environment (ING-04). `parseInt('') || null` and
  // `parseInt('0') || null` both collapse to null — this is intentional:
  // unset OR explicit "0" both mean "not sharded".
  const shardIndex = parseInt(process.env.SHARD_INDEX ?? '', 10) || null;
  const shardTotal = parseInt(process.env.SHARD_TOTAL ?? '', 10) || null;

  let allEntries: NdjsonTestEntry[] = [];
  let reportUnreadable = false;

  if (reportFiles.length === 0) {
    core.warning(
      `ING-01: No report files matched pattern "${config.reportPath}". ` +
        `Recording as "report-unreadable".`,
    );
    reportUnreadable = true;
  } else {
    for (const reportFile of reportFiles) {
      let rawJson: unknown;
      try {
        rawJson = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      } catch (err) {
        core.warning(
          `ING-01: Could not read/parse ${reportFile}: ${String(err)}. Skipping.`,
        );
        continue;
      }
      const parsed = parseReport(rawJson);
      if (parsed.reportUnreadable) {
        reportUnreadable = true;
      } else {
        allEntries = allEntries.concat(parsed.entries);
      }
    }
  }

  // ── Step 4: BUILD NDJSON RECORD ─────────────────────────────────────────
  const record: NdjsonRecord = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: process.env.GITHUB_RUN_ID ?? 'local',
    commitSha: github.context.sha,
    branch: github.context.ref,
    healerVersion: VERSION,
    shardIndex,
    shardTotal,
    tests: reportUnreadable
      ? [
          {
            testId: 'report-unreadable',
            filePath: config.reportPath,
            title: 'report-unreadable',
            outcome: 'report-unreadable',
            durationMs: 0,
            retryCount: 0,
            workerIndex: 0,
            errorSignature: null,
            traceAttachmentPath: null,
          },
        ]
      : allEntries,
  };

  // ── Step 5: STATE BRANCH APPEND (STA-01..04) ────────────────────────────
  const remoteUrl =
    `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/` +
    `${process.env.GITHUB_REPOSITORY ?? ''}.git`;
  const primaryCwd = process.env.GITHUB_WORKSPACE ?? process.cwd();

  let worktreePath: string | null = null;
  try {
    worktreePath = await bootstrapOrGetWorktree(remoteUrl, primaryCwd);
    await appendRecord(record, worktreePath);

    // ── Step 6: GC (STA-05) ──────────────────────────────────────────────
    await runGc(config.retentionDays, worktreePath);

    // ── Step 7: THRESHOLD EVALUATION (DET-01..03) ────────────────────────
    const windowRecords = readWindowRecords(worktreePath, config.flakeWindowDays);
    const detections = evaluateThresholds(windowRecords, config);

    // ── Step 8: STEP SUMMARY (DET-04 log-only) ───────────────────────────
    await writeDetectionSummary(detections);
  } finally {
    if (worktreePath) {
      await removeWorktree(worktreePath).catch((e: unknown) =>
        core.warning(`Worktree cleanup failed: ${String(e)}`),
      );
    }
  }
}

/**
 * Reads NDJSON records from the rolling window date range.
 * Only walks files within [today - flakeWindowDays, today] — not the entire corpus.
 * Malformed NDJSON lines are skipped with a warning (per Pitfall B resilience).
 */
function readWindowRecords(
  worktreePath: string,
  flakeWindowDays: number,
): NdjsonRecord[] {
  const records: NdjsonRecord[] = [];
  const today = new Date();

  for (let daysBack = 0; daysBack <= flakeWindowDays; daysBack++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - daysBack);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const filePath = path.join(worktreePath, 'runs', String(y), m, `${day}.ndjson`);

    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        records.push(JSON.parse(line) as NdjsonRecord);
      } catch {
        core.warning(
          `State branch: malformed NDJSON line skipped in ${filePath}`,
        );
      }
    }
  }

  return records;
}
