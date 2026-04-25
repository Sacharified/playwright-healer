// tests/unit/threshold-evaluator.test.ts
// Unit tests for evaluateThresholds() — DET-01, DET-02, DET-03 coverage
// Uses synthetic records (not the fixture file) for deterministic assertions.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateThresholds } from '../../src/ingest/threshold-evaluator.js';
import type { NdjsonRecord, NdjsonTestEntry } from '../../src/shared/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  flakeRateThreshold: 0.2,
  flakeWindowDays: 7,
  slowRegressionPct: 1.5,
};

/**
 * Build a synthetic NdjsonRecord for a single test entry.
 * @param runId — unique run identifier (also used as commitSha if not overridden)
 * @param tests — array of test descriptors
 * @param daysAgo — how many days ago this record was created (0 = now)
 * @param commitSha — override commitSha (defaults to runId)
 */
function makeRecord(
  runId: string,
  tests: Array<{
    testId: string;
    outcome: NdjsonTestEntry['outcome'];
    durationMs: number;
    filePath?: string;
  }>,
  daysAgo: number = 0,
  commitSha: string = runId,
): NdjsonRecord {
  const timestamp = new Date(
    Date.now() - daysAgo * 24 * 60 * 60 * 1000,
  ).toISOString();
  return {
    schemaVersion: 1,
    timestamp,
    runId,
    commitSha,
    branch: 'main',
    healerVersion: '0.0.0',
    shardIndex: null,
    shardTotal: null,
    tests: tests.map((t) => ({
      testId: t.testId,
      filePath: t.filePath ?? 'tests/test.spec.ts',
      title: t.testId.split('::')[1] ?? t.testId,
      outcome: t.outcome,
      durationMs: t.durationMs,
      retryCount: 0,
      workerIndex: 0,
      errorSignature: null,
      traceAttachmentPath: null,
    })),
  };
}

/** Build N records for a single testId with the given outcome. */
function makeNRecords(
  testId: string,
  count: number,
  outcome: NdjsonTestEntry['outcome'],
  durationMs: number = 100,
  startDaysAgo: number = 0,
): NdjsonRecord[] {
  return Array.from({ length: count }, (_, i) =>
    makeRecord(
      `run-${testId}-${i}`,
      [{ testId, outcome, durationMs }],
      startDaysAgo + i,
    ),
  );
}

// ─── DET-02: Minimum run count gate ──────────────────────────────────────────

describe('evaluateThresholds — DET-02: minimum run count', () => {
  it('produces no detection for 9 runs with 8 failed', () => {
    const testId = 'tests/flaky.spec.ts::test one';
    const records = makeNRecords(testId, 9, 'failed');
    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    expect(detections).toHaveLength(0);
  });

  it('produces detection for 10 runs with 4 failed (threshold=0.2)', () => {
    const testId = 'tests/flaky.spec.ts::test one';
    const passed = makeNRecords(testId, 6, 'passed');
    const failed = makeNRecords(testId, 4, 'failed', 100, 6);
    const detections = evaluateThresholds([...passed, ...failed], DEFAULT_CONFIG);
    const flakeDetections = detections.filter((d) => d.reason === 'flake-rate');
    expect(flakeDetections).toHaveLength(1);
    expect(flakeDetections[0].value).toBeCloseTo(0.4);
    expect(flakeDetections[0].runCount).toBe(10);
    expect(flakeDetections[0].testId).toBe(testId);
  });
});

// ─── DET-01: Flake-rate detection ────────────────────────────────────────────

describe('evaluateThresholds — DET-01: flake-rate detection', () => {
  it('SC#3: 10 runs with 4 failed → flakeRate=0.4 breaches threshold 0.2 → Detection', () => {
    const testId = 'tests/auth.spec.ts::should login';
    const passed = makeNRecords(testId, 6, 'passed', 100, 0);
    const failed = makeNRecords(testId, 4, 'failed', 100, 6);
    const records = [...passed, ...failed];

    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    const d = detections.find(
      (det) => det.reason === 'flake-rate' && det.testId === testId,
    );
    expect(d).toBeDefined();
    expect(d!.reason).toBe('flake-rate');
    expect(d!.value).toBeCloseTo(0.4);
    expect(d!.threshold).toBe(0.2);
    expect(d!.runCount).toBe(10);
  });

  it('10 runs with all passed → no flake detection', () => {
    const testId = 'tests/stable.spec.ts::button click';
    const records = makeNRecords(testId, 10, 'passed');
    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    expect(detections.filter((d) => d.reason === 'flake-rate')).toHaveLength(0);
  });

  it('10 runs with 0 failures → no flake detection', () => {
    const testId = 'tests/stable.spec.ts::form submit';
    const records = makeNRecords(testId, 10, 'passed');
    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    expect(detections).toHaveLength(0);
  });

  it('flaky and timed-out outcomes count toward flake rate', () => {
    const testId = 'tests/flaky.spec.ts::timed out test';
    const passed = makeNRecords(testId, 7, 'passed', 100, 0);
    const timedOut = makeNRecords(testId, 2, 'timed-out', 100, 7);
    const flaky = makeNRecords(testId, 1, 'flaky', 100, 9);
    const records = [...passed, ...timedOut, ...flaky];

    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    const d = detections.find(
      (det) => det.reason === 'flake-rate' && det.testId === testId,
    );
    expect(d).toBeDefined();
    // 3 / 10 = 0.3 >= 0.2
    expect(d!.value).toBeCloseTo(0.3);
  });
});

// ─── DET-03: Slow-regression detection ───────────────────────────────────────

describe('evaluateThresholds — DET-03: slow-regression detection', () => {
  it('baseline p95=100ms, current p95=200ms, threshold=1.5 → regressionRatio=2.0 → Detection', () => {
    const testId = 'tests/slow.spec.ts::slow test';
    // 10 fast runs (baseline), then 10 slow runs
    const fast = makeNRecords(testId, 10, 'passed', 100, 10);
    const slow = makeNRecords(testId, 10, 'passed', 200, 0);
    const records = [...fast, ...slow];

    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    const d = detections.find(
      (det) => det.reason === 'slow-regression' && det.testId === testId,
    );
    expect(d).toBeDefined();
    expect(d!.reason).toBe('slow-regression');
    expect(d!.value).toBeGreaterThanOrEqual(1.5);
    expect(d!.threshold).toBe(1.5);
    expect(d!.runCount).toBe(20);
  });

  it('uniform durations produce no slow-regression detection', () => {
    const testId = 'tests/uniform.spec.ts::uniform test';
    const records = makeNRecords(testId, 10, 'passed', 150);
    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    expect(detections.filter((d) => d.reason === 'slow-regression')).toHaveLength(0);
  });

  it('skips slow-regression when baseline p95 is 0', () => {
    const testId = 'tests/zero.spec.ts::zero duration';
    const records = makeNRecords(testId, 10, 'passed', 0);
    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    // No division by zero — regressionRatio defaults to 1 when baselineP95 === 0
    expect(detections.filter((d) => d.reason === 'slow-regression')).toHaveLength(0);
  });
});

// ─── ING-03: report-unreadable exclusion ─────────────────────────────────────

describe('evaluateThresholds — ING-03: report-unreadable exclusion', () => {
  it('records with outcome report-unreadable are excluded from run count', () => {
    const testId = 'tests/unreadable.spec.ts::some test';
    // 9 real runs + 1 unreadable = still only 9 valid runs → no detection
    const valid = makeNRecords(testId, 9, 'failed');
    const unreadable = [
      makeRecord('run-unreadable', [
        { testId, outcome: 'report-unreadable', durationMs: 0 },
      ], 1),
    ];
    const detections = evaluateThresholds([...valid, ...unreadable], DEFAULT_CONFIG);
    expect(detections).toHaveLength(0);
  });

  it('10 valid runs + 5 unreadable → detection based on 10 valid runs', () => {
    const testId = 'tests/mixed.spec.ts::mixed test';
    const failed = makeNRecords(testId, 5, 'failed', 100, 0);
    const passed = makeNRecords(testId, 5, 'passed', 100, 5);
    const unreadable = Array.from({ length: 5 }, (_, i) =>
      makeRecord(`run-unreadable-${i}`, [
        { testId, outcome: 'report-unreadable', durationMs: 0 },
      ], 10 + i),
    );
    const records = [...failed, ...passed, ...unreadable];
    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    // 5/10 = 0.5 >= 0.2 → flake-rate detection
    const d = detections.find((det) => det.reason === 'flake-rate' && det.testId === testId);
    expect(d).toBeDefined();
    expect(d!.runCount).toBe(10);
  });
});

// ─── Shard deduplication ─────────────────────────────────────────────────────

describe('evaluateThresholds — shard deduplication', () => {
  it('same testId + same commitSha from two shards counts as 1 run, not 2', () => {
    const testId = 'tests/sharded.spec.ts::shared test';
    const commitSha = 'sha-multi-shard';
    // Two records with same commitSha (different shards), both passed
    const shard1 = makeRecord(
      'run-shard-1',
      [{ testId, outcome: 'passed', durationMs: 100 }],
      0,
      commitSha,
    );
    const shard2 = makeRecord(
      'run-shard-2',
      [{ testId, outcome: 'passed', durationMs: 120 }],
      0,
      commitSha,
    );
    // Add 8 more unique runs to reach exactly 9 valid deduped runs
    const others = Array.from({ length: 8 }, (_, i) =>
      makeRecord(
        `run-unique-${i}`,
        [{ testId, outcome: 'failed', durationMs: 100 }],
        i + 1,
        `sha-unique-${i}`,
      ),
    );
    const records = [shard1, shard2, ...others];
    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    // Only 9 deduped runs (shard1+shard2 = 1 run, plus 8 unique) → below 10 minimum
    expect(detections).toHaveLength(0);
  });

  it('cross-shard worst-outcome: shard passed + shard failed → run outcome = failed', () => {
    const testId = 'tests/sharded.spec.ts::worst outcome test';
    const commitSha = 'sha-worst-outcome';

    const shardPassed = makeRecord(
      'run-pass-shard',
      [{ testId, outcome: 'passed', durationMs: 100 }],
      0,
      commitSha,
    );
    const shardFailed = makeRecord(
      'run-fail-shard',
      [{ testId, outcome: 'failed', durationMs: 100 }],
      0,
      commitSha,
    );
    // 9 more unique runs all passed (now 10 total deduped runs)
    const others = Array.from({ length: 9 }, (_, i) =>
      makeRecord(
        `run-extra-${i}`,
        [{ testId, outcome: 'passed', durationMs: 100 }],
        i + 1,
        `sha-extra-${i}`,
      ),
    );
    const records = [shardPassed, shardFailed, ...others];
    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    // 1 deduped failed run out of 10 deduped runs = 10% → below 20% threshold → no flake detection
    // (worst-outcome: the combined shard counts as 'failed')
    expect(detections.filter((d) => d.reason === 'flake-rate')).toHaveLength(0);
  });

  it('cross-shard worst-outcome: enough failed shards cause detection', () => {
    const testId = 'tests/sharded.spec.ts::enough failures test';

    // 10 deduped runs: 4 commits with (passed + failed shards) → worst = failed
    // 6 commits all passed
    const failedShardRuns: NdjsonRecord[] = [];
    for (let i = 0; i < 4; i++) {
      const sha = `sha-fail-${i}`;
      failedShardRuns.push(
        makeRecord(`run-fa-${i}`, [{ testId, outcome: 'passed', durationMs: 100 }], i, sha),
        makeRecord(`run-fb-${i}`, [{ testId, outcome: 'failed', durationMs: 100 }], i, sha),
      );
    }
    const passedRuns = Array.from({ length: 6 }, (_, i) =>
      makeRecord(
        `run-pass-${i}`,
        [{ testId, outcome: 'passed', durationMs: 100 }],
        4 + i,
        `sha-pass-${i}`,
      ),
    );
    const records = [...failedShardRuns, ...passedRuns];
    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    // 4 deduped failed + 6 deduped passed = 10 runs, flakeRate = 0.4
    const d = detections.find((det) => det.reason === 'flake-rate' && det.testId === testId);
    expect(d).toBeDefined();
    expect(d!.value).toBeCloseTo(0.4);
    expect(d!.runCount).toBe(10);
  });
});

// ─── Window filtering ─────────────────────────────────────────────────────────

describe('evaluateThresholds — window filtering', () => {
  it('records older than flakeWindowDays are excluded from evaluation', () => {
    const testId = 'tests/window.spec.ts::window test';
    // 7 records within window (all passed), 5 records outside window (all failed)
    const inside = makeNRecords(testId, 7, 'passed', 100, 0);   // 0-6 days ago
    const outside = makeNRecords(testId, 5, 'failed', 100, 10); // 10-14 days ago (outside 7-day window)
    const records = [...inside, ...outside];

    const detections = evaluateThresholds(records, DEFAULT_CONFIG);
    // Only 7 in-window runs → below 10 minimum → no detection
    expect(detections).toHaveLength(0);
  });

  it('10 records within extended window trigger detection', () => {
    const testId = 'tests/window.spec.ts::extended window test';
    // Use 30-day window to cover records up to 29 days ago
    const extendedConfig = { ...DEFAULT_CONFIG, flakeWindowDays: 30 };
    const passed = makeNRecords(testId, 6, 'passed', 100, 0);
    const failed = makeNRecords(testId, 4, 'failed', 100, 10); // 10-13 days ago
    const records = [...passed, ...failed];

    const detections = evaluateThresholds(records, extendedConfig);
    const d = detections.find((det) => det.reason === 'flake-rate' && det.testId === testId);
    expect(d).toBeDefined();
    expect(d!.value).toBeCloseTo(0.4);
  });
});

// ─── Sample fixture smoke test (with extended window) ────────────────────────

describe('evaluateThresholds — fixture smoke test', () => {
  it('loads sample-runs.ndjson and evaluates with 30-day window (no crash)', () => {
    const fixturePath = join(
      new URL('../../tests/fixtures/sample-runs.ndjson', import.meta.url).pathname,
    );
    const lines = readFileSync(fixturePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    // Use 30-day window to avoid the date cutoff trap (records are 2026-03-31 → 2026-04-24)
    const extendedConfig = { ...DEFAULT_CONFIG, flakeWindowDays: 30 };
    const detections = evaluateThresholds(lines, extendedConfig);
    // Fixture has 25 records, 1 test. With 30-day window all 25 in scope. 10 failed = 40% → detection
    expect(detections.length).toBeGreaterThanOrEqual(1);
    const d = detections.find((det) => det.reason === 'flake-rate');
    expect(d).toBeDefined();
  });
});
