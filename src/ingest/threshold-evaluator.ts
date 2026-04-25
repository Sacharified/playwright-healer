// src/ingest/threshold-evaluator.ts
// Pure function: NdjsonRecord[] + EvaluatorConfig → Detection[]
// DET-01: flake-rate detection
// DET-02: minimum 10-run gate before emitting detections
// DET-03: p95 duration slow-regression detection
// DET-04: NO workflow_dispatch — log-only in Phase 02

import type { NdjsonRecord, NdjsonTestEntry, Detection } from '../shared/types.js';

// Config subset needed by evaluator (avoids importing full Config from config.ts)
export interface EvaluatorConfig {
  flakeRateThreshold: number;
  flakeWindowDays: number;
  slowRegressionPct: number;
}

export function evaluateThresholds(
  records: NdjsonRecord[],
  config: EvaluatorConfig,
): Detection[] {
  const now = Date.now();
  const windowStart = now - config.flakeWindowDays * 24 * 60 * 60 * 1000;

  // 1. Filter to rolling window
  const windowRecords = records.filter(
    (r) => new Date(r.timestamp).getTime() >= windowStart,
  );

  // 2. Group: testId → commitSha → entries (for cross-shard dedup per ING-04)
  const byTestId = new Map<string, Map<string, NdjsonTestEntry[]>>();
  for (const record of windowRecords) {
    for (const entry of record.tests) {
      // ING-03: skip report-unreadable entries — they don't count as runs
      if (entry.outcome === 'report-unreadable') continue;
      if (!byTestId.has(entry.testId)) byTestId.set(entry.testId, new Map());
      const byCommit = byTestId.get(entry.testId)!;
      if (!byCommit.has(record.commitSha)) byCommit.set(record.commitSha, []);
      byCommit.get(record.commitSha)!.push(entry);
    }
  }

  const detections: Detection[] = [];

  for (const [testId, commitMap] of byTestId) {
    // One "run" = one commitSha. Cross-shard aggregation: worst outcome wins (ING-04).
    const runs = [...commitMap.entries()].map(([, entries]) => ({
      outcome: worstOutcome(entries.map((e) => e.outcome)),
      durationMs: Math.max(...entries.map((e) => e.durationMs)),
    }));

    const runCount = runs.length;

    // DET-02: insufficient data gate — minimum 10 runs required
    if (runCount < 10) continue;

    // Grab a sample entry for file path metadata
    const sampleEntry = [...commitMap.values()][0][0];

    // ── DET-01: Flake-rate detection ─────────────────────────────────────────
    const failedOrFlaky = runs.filter(
      (r) =>
        r.outcome === 'failed' ||
        r.outcome === 'flaky' ||
        r.outcome === 'timed-out',
    ).length;
    const flakeRate = failedOrFlaky / runCount;

    if (flakeRate >= config.flakeRateThreshold) {
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

    // ── DET-03: p95 duration slow-regression detection ────────────────────────
    const durations = runs.map((r) => r.durationMs).sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;
    // Baseline = first 10 (lowest durations) in the sorted array
    const baselineDurations = durations.slice(0, Math.min(10, durations.length));
    const baselineP95 = baselineDurations[Math.floor(baselineDurations.length * 0.95)] ?? 0;

    // Skip slow-regression when baseline is 0 to avoid division-by-zero
    if (baselineP95 > 0) {
      const regressionRatio = p95 / baselineP95;

      if (regressionRatio >= config.slowRegressionPct) {
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
  }

  return detections;
}

/**
 * Determine the worst outcome across multiple shard entries for the same test run.
 * Priority: failed > timed-out > flaky > passed > skipped
 * report-unreadable entries should never reach this function (filtered above).
 */
function worstOutcome(
  outcomes: NdjsonTestEntry['outcome'][],
): NdjsonTestEntry['outcome'] {
  if (outcomes.includes('failed')) return 'failed';
  if (outcomes.includes('timed-out')) return 'timed-out';
  if (outcomes.includes('flaky')) return 'flaky';
  if (outcomes.includes('passed')) return 'passed';
  return 'skipped';
}
