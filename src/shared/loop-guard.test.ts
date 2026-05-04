// src/shared/loop-guard.test.ts
// Tests for countHealsForTest + shouldSkipHeal (Phase 04 SEC-05 Guard 3)
// Uses fs.mkdtempSync to seed fixture worktrees with crafted heal NDJSON lines.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock @actions/core before importing loop-guard (which imports it)
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

// Mock @actions/github (shouldSkipIngest uses it)
vi.mock('@actions/github', () => ({
  context: {
    payload: {},
  },
}));

import { countHealsForTest, shouldSkipHeal } from './loop-guard.js';
import * as core from '@actions/core';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeWorktree(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'healer-test-lg-'));
}

function teardownWorktree(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

function writeHealFile(
  worktreePath: string,
  dateStr: string, // 'YYYY-MM-DD'
  events: Array<{ testId: string; timestamp: string; outcome?: string }>,
): void {
  const [y, m, d] = dateStr.split('-');
  const dir = path.join(worktreePath, 'runs', y, m);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${d}-heals.ndjson`);
  const content = events
    .map((e) =>
      JSON.stringify({
        schemaVersion: 1,
        testId: e.testId,
        timestamp: e.timestamp,
        outcome: e.outcome ?? 'pr-opened',
        dispatchRunId: 'r1',
      }),
    )
    .join('\n');
  fs.writeFileSync(filePath, content + '\n', 'utf8');
}

function utcDateStr(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().split('T')[0]; // 'YYYY-MM-DD'
}

function utcTimestamp(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Test 5: countHealsForTest window filtering ────────────────────────────────

describe('countHealsForTest — Test 5 (window filtering)', () => {
  it('counts only events within the rolling window for the given testId', () => {
    const wt = makeWorktree();
    try {
      // Day 0 (today) — within window → count
      writeHealFile(wt, utcDateStr(0), [
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
      ]);
      // Day 6 — within 7-day window → count
      writeHealFile(wt, utcDateStr(6), [
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(6) },
      ]);
      // Day 8 — outside 7-day window → skip
      writeHealFile(wt, utcDateStr(8), [
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(8) },
      ]);

      const count = countHealsForTest('tests/a.spec.ts::testA', 7, wt);
      expect(count).toBe(2);
    } finally {
      teardownWorktree(wt);
    }
  });

  it('returns 0 when no heal files exist', () => {
    const wt = makeWorktree();
    try {
      const count = countHealsForTest('tests/a.spec.ts::testA', 7, wt);
      expect(count).toBe(0);
    } finally {
      teardownWorktree(wt);
    }
  });

  it('does not count heal events for a different testId', () => {
    const wt = makeWorktree();
    try {
      writeHealFile(wt, utcDateStr(0), [
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
        { testId: 'tests/b.spec.ts::testB', timestamp: utcTimestamp(0) },
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(1) },
      ]);

      const countA = countHealsForTest('tests/a.spec.ts::testA', 7, wt);
      const countB = countHealsForTest('tests/b.spec.ts::testB', 7, wt);
      expect(countA).toBe(2);
      expect(countB).toBe(1);
    } finally {
      teardownWorktree(wt);
    }
  });
});

// ── Test 6: countHealsForTest malformed line resilience ──────────────────────

describe('countHealsForTest — Test 6 (malformed line resilience)', () => {
  it('skips malformed JSON lines without throwing', () => {
    const wt = makeWorktree();
    try {
      // Write a file with a mix of good lines and malformed ones
      const d = new Date();
      const y = d.getUTCFullYear().toString();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');

      const dir = path.join(wt, 'runs', y, m);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${day}-heals.ndjson`);

      const goodLine = JSON.stringify({
        schemaVersion: 1,
        testId: 'tests/a.spec.ts::testA',
        timestamp: utcTimestamp(0),
        outcome: 'pr-opened',
        dispatchRunId: 'r1',
      });

      const content = [
        goodLine,
        'not-json{{{',           // malformed
        '{}',                    // missing testId/timestamp — still parseable but won't match
        goodLine,                // another valid event
        '{"incomplete":',       // malformed
      ].join('\n');
      fs.writeFileSync(filePath, content + '\n', 'utf8');

      // Should not throw, and should count the 2 valid lines
      expect(() => countHealsForTest('tests/a.spec.ts::testA', 7, wt)).not.toThrow();
      const count = countHealsForTest('tests/a.spec.ts::testA', 7, wt);
      expect(count).toBe(2);
    } finally {
      teardownWorktree(wt);
    }
  });
});

// ── Test 7: shouldSkipHeal boundary conditions ────────────────────────────────

describe('shouldSkipHeal — Test 7 (boundary conditions)', () => {
  it('returns { skip: true, count: 3 } when count === maxHealsPerTestPerWeek', () => {
    const wt = makeWorktree();
    try {
      // Seed 3 events for testA within the window
      writeHealFile(wt, utcDateStr(0), [
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(1) },
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(2) },
      ]);

      const result = shouldSkipHeal(
        'tests/a.spec.ts::testA',
        { maxHealsPerTestPerWeek: 3, flakeWindowDays: 7 },
        wt,
      );
      expect(result).toEqual({ skip: true, count: 3 });
    } finally {
      teardownWorktree(wt);
    }
  });

  it('returns { skip: false, count: 2 } when count < maxHealsPerTestPerWeek', () => {
    const wt = makeWorktree();
    try {
      // Seed 2 events for testA within the window
      writeHealFile(wt, utcDateStr(0), [
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(1) },
      ]);

      const result = shouldSkipHeal(
        'tests/a.spec.ts::testA',
        { maxHealsPerTestPerWeek: 3, flakeWindowDays: 7 },
        wt,
      );
      expect(result).toEqual({ skip: false, count: 2 });
    } finally {
      teardownWorktree(wt);
    }
  });

  it('returns { skip: true } when count exceeds the cap (count > max)', () => {
    const wt = makeWorktree();
    try {
      // Seed 5 events, cap is 3
      writeHealFile(wt, utcDateStr(0), [
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
      ]);

      const result = shouldSkipHeal(
        'tests/a.spec.ts::testA',
        { maxHealsPerTestPerWeek: 3, flakeWindowDays: 7 },
        wt,
      );
      expect(result.skip).toBe(true);
      expect(result.count).toBe(5);
    } finally {
      teardownWorktree(wt);
    }
  });

  it('emits core.info when skip=true (SEC-05 Guard 3 message)', () => {
    const wt = makeWorktree();
    try {
      writeHealFile(wt, utcDateStr(0), [
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
      ]);

      shouldSkipHeal(
        'tests/a.spec.ts::testA',
        { maxHealsPerTestPerWeek: 3, flakeWindowDays: 7 },
        wt,
      );
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('SEC-05 Guard 3'),
      );
    } finally {
      teardownWorktree(wt);
    }
  });

  it('does NOT emit core.info when skip=false (under cap)', () => {
    const wt = makeWorktree();
    try {
      // Only 1 event, cap is 3
      writeHealFile(wt, utcDateStr(0), [
        { testId: 'tests/a.spec.ts::testA', timestamp: utcTimestamp(0) },
      ]);

      shouldSkipHeal(
        'tests/a.spec.ts::testA',
        { maxHealsPerTestPerWeek: 3, flakeWindowDays: 7 },
        wt,
      );
      expect(core.info).not.toHaveBeenCalled();
    } finally {
      teardownWorktree(wt);
    }
  });
});
