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

import { shouldSkipIngest, countHealsForTest } from '../shared/loop-guard.js';
import { type Config } from '../shared/config.js';
import { parseReport } from './report-parser.js';
import {
  bootstrapOrGetWorktree,
  appendRecord,
  runGc,
  removeWorktree,
} from '../shared/state-branch.js';
import type { NdjsonRecord, NdjsonTestEntry } from '../shared/types.js';
import { evaluateThresholds, summarizeBelowGate } from './threshold-evaluator.js';
import { writeDetectionSummary } from './summary-writer.js';
import { fireDispatch, buildConcurrencyKey, recordCapHit } from './dispatch.js';
import { classifyFixClass } from './classifier.js';

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
      const parsed = parseReport(rawJson, {
        workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
        workingDirectory: config.workingDirectory,
      });
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
    const gated = summarizeBelowGate(windowRecords, config);

    // ── Step 8: STEP SUMMARY (DET-04) ───────────────────────────────────
    // Pass enableAutoDispatch so summary-writer surfaces live vs log-only mode.
    // gated + minRunsForDetection let the summary explain why a clearly-failing
    // test isn't being healed yet (sample size still accumulating).
    await writeDetectionSummary(
      detections,
      config.enableAutoDispatch,
      gated,
      config.minRunsForDetection,
    );

    // ── Step 9: AUTO-DISPATCH (DET-05/06/07, Phase 04) ──────────────────
    // CONTEXT D-01: opt-in via enable_auto_dispatch (default 'false').
    if (config.enableAutoDispatch && detections.length > 0) {
      // Build a testId → latest-entry map for fixClassHint lookup (FIX-07).
      // Last-failed-entry wins: windowRecords are ordered oldest-to-newest by
      // file walk; any non-passed entry for a testId overwrites the prior one.
      const latestEntryByTestId = new Map<string, NdjsonTestEntry>();
      for (const rec of windowRecords) {
        for (const entry of rec.tests) {
          if (entry.outcome === 'failed' || entry.outcome === 'flaky' || entry.outcome === 'timed-out') {
            latestEntryByTestId.set(entry.testId, entry);
          }
        }
      }

      for (const detection of detections) {
        const [testFile, testTitle] = detection.testId.split('::', 2);
        const latestEntry = latestEntryByTestId.get(detection.testId);
        const fixClassHint = classifyFixClass(latestEntry?.errorSignature ?? '');

        // D-04 (Phase 04): cheap pre-dispatch heal-cap query — saves a workflow run on
        // the cap-already-hit path. Healer-side Guard 3 (Step 1.5) is the backstop.
        if (worktreePath) {
          const healCount = countHealsForTest(detection.testId, config.flakeWindowDays, worktreePath);
          if (healCount >= config.maxHealsPerTestPerWeek) {
            await recordCapHit({
              testId: detection.testId,
              count: healCount,
              cap: config.maxHealsPerTestPerWeek,
              worktreePath,
            });
            continue;
          }
        }

        // CFG-04: per-class disable — operator can suppress a class with a warning,
        // not a silent skip, so the action log surfaces the operator-actionable signal.
        const enabledFor: Record<typeof fixClassHint, boolean> = {
          selectors:  config.enableSelectorFixes,
          waits:      config.enableWaitFixes,
          assertions: config.enableAssertionFixes,
          slow:       config.enableSlowFixes,
        };
        if (!enabledFor[fixClassHint]) {
          core.warning(
            `playwright-healer: ${fixClassHint} fix class disabled — skipping dispatch for ${detection.testId}`,
          );
          continue;
        }

        await fireDispatch({
          patToken:       config.healerToken,
          owner:          github.context.repo.owner,
          repo:           github.context.repo.repo,
          // RESEARCH §"Open Questions §2 RESOLVED": configurable via healer_workflow_file
          // action input (default 'playwright-healer.yml'). Multi-workflow consumers override.
          workflowFile:   config.healerWorkflowFile,
          // Pitfall 2: ref MUST be the default branch (where the heal workflow file lives),
          // NOT GITHUB_REF_NAME (which could be a feature branch without the workflow).
          ref:            (github.context.payload.repository as { default_branch?: string } | undefined)?.default_branch ?? 'main',
          detection,
          commitSha:      github.context.sha,
          fixClassHint,
          flakeRate:      detection.reason === 'flake-rate' ? detection.value : 0,
          windowDays:     detection.windowDays,
          runCount:       detection.runCount,
          concurrencyKey: buildConcurrencyKey(testFile, testTitle),
        });
      }
    }
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
