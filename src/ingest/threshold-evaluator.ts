// src/ingest/threshold-evaluator.ts
// Pure function: NdjsonRecord[] + EvaluatorConfig → Detection[]
// DET-01: flake-rate detection
// DET-02: minimum-run gate before emitting detections (configurable via
//         min_runs_for_detection action input; default 10)
// DET-03: p95 duration slow-regression detection
// DET-04: log-only in Phase 02 — no downstream dispatch

import type { NdjsonRecord, NdjsonTestEntry, Detection } from '../shared/types.js';

// Config subset needed by evaluator (avoids importing full Config from config.ts)
export interface EvaluatorConfig {
  flakeRateThreshold: number;
  flakeWindowDays: number;
  slowRegressionPct: number;
  minRunsForDetection: number;
}

/**
 * Diagnostic record: a test that has at least one failure in the rolling
 * window but has not yet accumulated enough runs to be evaluated against the
 * flake-rate threshold. Surfaced in the step summary so consumers can see why
 * a known-failing test isn't being healed yet.
 */
export interface GatedTest {
  testId: string;
  filePath: string;
  runCount: number;
  failedCount: number;
  flakeRate: number;
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

    // DET-02: insufficient data gate — minimum runs required to evaluate.
    // Configurable via min_runs_for_detection (default 10). Tests below the
    // gate are surfaced separately by summarizeBelowGate() for the step summary.
    if (runCount < config.minRunsForDetection) continue;

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

/**
 * Returns tests that have at least one failed/flaky/timed-out run in the
 * rolling window but have not yet accumulated min_runs_for_detection unique
 * commits. These are silently skipped by evaluateThresholds (DET-02) and
 * would otherwise leave consumers wondering why a clearly-failing test isn't
 * being healed. The summary writer renders them under "Tests waiting for
 * sample size" so the gate is visible.
 *
 * Tests with zero failures are excluded — they don't need explanation;
 * they're just passing.
 */
export function summarizeBelowGate(
  records: NdjsonRecord[],
  config: EvaluatorConfig,
): GatedTest[] {
  const now = Date.now();
  const windowStart = now - config.flakeWindowDays * 24 * 60 * 60 * 1000;
  const windowRecords = records.filter(
    (r) => new Date(r.timestamp).getTime() >= windowStart,
  );

  const byTestId = new Map<string, Map<string, NdjsonTestEntry[]>>();
  for (const record of windowRecords) {
    for (const entry of record.tests) {
      if (entry.outcome === 'report-unreadable') continue;
      if (!byTestId.has(entry.testId)) byTestId.set(entry.testId, new Map());
      const byCommit = byTestId.get(entry.testId)!;
      if (!byCommit.has(record.commitSha)) byCommit.set(record.commitSha, []);
      byCommit.get(record.commitSha)!.push(entry);
    }
  }

  const gated: GatedTest[] = [];
  for (const [testId, commitMap] of byTestId) {
    const runs = [...commitMap.values()].map((entries) =>
      worstOutcome(entries.map((e) => e.outcome)),
    );
    const runCount = runs.length;
    if (runCount >= config.minRunsForDetection) continue;

    const failedCount = runs.filter(
      (o) => o === 'failed' || o === 'flaky' || o === 'timed-out',
    ).length;
    if (failedCount === 0) continue;

    const sampleEntry = [...commitMap.values()][0][0];
    gated.push({
      testId,
      filePath: sampleEntry.filePath,
      runCount,
      failedCount,
      flakeRate: failedCount / runCount,
    });
  }

  return gated;
}
