// src/ingest/index.test.ts
// Integration tests for the ingest pipeline (Task 3 — Phase 04 auto-dispatch wiring).
// Tests cover Step 9 (fireDispatch loop) + summary-writer dispatch-mode surface.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Config } from '../shared/config.js';
import type { Detection } from '../shared/types.js';

// ── vi.hoisted — all mocks initialized before vi.mock factories run ──────────

const {
  mockBootstrapOrGetWorktree,
  mockAppendRecord,
  mockRunGc,
  mockReadWindowRecords,
  mockEvaluateThresholds,
  mockSummarizeBelowGate,
  mockWriteDetectionSummary,
  mockFireDispatch,
  mockBuildConcurrencyKey,
  mockRemoveWorktree,
  mockShouldSkipIngest,
  mockParseReport,
  mockGlobberGlob,
  mockClassifyFixClass,
  mockCountHealsForTest,
  mockRecordCapHit,
  mockAppendHealEvent,
} = vi.hoisted(() => ({
  mockBootstrapOrGetWorktree: vi.fn(),
  mockAppendRecord: vi.fn(),
  mockRunGc: vi.fn(),
  mockReadWindowRecords: vi.fn(),
  mockEvaluateThresholds: vi.fn(),
  mockSummarizeBelowGate: vi.fn(),
  mockWriteDetectionSummary: vi.fn(),
  mockFireDispatch: vi.fn(),
  mockBuildConcurrencyKey: vi.fn(),
  mockRemoveWorktree: vi.fn(),
  mockShouldSkipIngest: vi.fn(),
  mockParseReport: vi.fn(),
  mockGlobberGlob: vi.fn(),
  mockClassifyFixClass: vi.fn(),
  mockCountHealsForTest: vi.fn(),
  mockRecordCapHit: vi.fn(),
  mockAppendHealEvent: vi.fn(),
}));

vi.mock('../shared/loop-guard.js', () => ({
  shouldSkipIngest: mockShouldSkipIngest,
  countHealsForTest: mockCountHealsForTest,
}));
vi.mock('../shared/state-branch.js', () => ({
  bootstrapOrGetWorktree: mockBootstrapOrGetWorktree,
  appendRecord: mockAppendRecord,
  appendHealEvent: mockAppendHealEvent,
  runGc: mockRunGc,
  removeWorktree: mockRemoveWorktree,
}));
vi.mock('./report-parser.js', () => ({ parseReport: mockParseReport }));
vi.mock('./threshold-evaluator.js', () => ({
  evaluateThresholds: mockEvaluateThresholds,
  summarizeBelowGate: mockSummarizeBelowGate,
}));
vi.mock('./summary-writer.js', () => ({ writeDetectionSummary: mockWriteDetectionSummary }));
vi.mock('./dispatch.js', () => ({
  fireDispatch: mockFireDispatch,
  buildConcurrencyKey: mockBuildConcurrencyKey,
  recordCapHit: mockRecordCapHit,
}));

vi.mock('./classifier.js', () => ({
  classifyFixClass: mockClassifyFixClass,
}));

// readWindowRecords is a module-private function in index.ts — mock fs to control it
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
}));

vi.mock('@actions/glob', () => ({
  create: vi.fn().mockResolvedValue({ glob: mockGlobberGlob }),
}));

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@actions/github', () => ({
  context: {
    sha: 'deadbeef1234567',
    ref: 'refs/heads/main',
    repo: { owner: 'acme', repo: 'testrepo' },
    payload: {
      repository: { default_branch: 'main' },
    },
  },
}));

// Stub createRequire so package.json version read doesn't fail
vi.mock('module', () => ({
  createRequire: vi.fn().mockReturnValue(() => ({ version: '0.0.0-test' })),
}));

import { run } from './index.js';

// ── Shared fixtures ──────────────────────────────────────────────────────────

const DETECTION: Detection = {
  testId: 'tests/login.spec.ts::login flow',
  filePath: 'tests/login.spec.ts',
  reason: 'flake-rate',
  windowDays: 7,
  value: 0.35,
  threshold: 0.2,
  runCount: 20,
};

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    mode: 'ingest',
    setupCommand: '',
    startCommand: '',
    testCommand: '',
    baseUrl: '',
    workingDirectory: '',
    botEmail: '41898282+github-actions[bot]@users.noreply.github.com',
    botName: 'github-actions[bot]',
    apiKey: 'key',
    healerToken: 'healer-pat',
    githubToken: 'gh-tok',
    provider: 'anthropic',
    model: '',
    apiEndpoint: '',
    reportPath: 'test-results/results.json',
    flakeRateThreshold: 0.2,
    flakeWindowDays: 7,
    slowRegressionPct: 1.5,
    minRunsForDetection: 10,
    rerunCount: 10,
    rerunPassRate: 0.9,
    maxBudgetUsd: 2.0,
    maxTurns: 30,
    retentionDays: 90,
    maxHealsPerTestPerWeek: 3,
    stateBranchName: 'playwright-healer-state',
    enableSelectorFixes: true,
    enableWaitFixes: true,
    enableAssertionFixes: true,
    enableSlowFixes: true,
    startupTimeoutSeconds: 120,
    skipDeterministicCheck: false,
    skipPostFixValidation: false,
    skipDiffLint: false,
    enableAutoDispatch: false,
    healerWorkflowFile: 'playwright-healer.yml',
    ...overrides,
  } as Config;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: ingest loop guard passes
  mockShouldSkipIngest.mockReturnValue(false);
  // Default: glob finds no report files (safe default, avoids parse path)
  mockGlobberGlob.mockResolvedValue([]);
  // Default: worktree bootstrap succeeds
  mockBootstrapOrGetWorktree.mockResolvedValue('/tmp/worktree-test');
  mockAppendRecord.mockResolvedValue(undefined);
  mockRunGc.mockResolvedValue(undefined);
  mockEvaluateThresholds.mockReturnValue([]);
  mockSummarizeBelowGate.mockReturnValue([]);
  mockWriteDetectionSummary.mockResolvedValue(undefined);
  mockFireDispatch.mockResolvedValue(undefined);
  mockBuildConcurrencyKey.mockReturnValue('test-concurrency-key');
  mockRemoveWorktree.mockResolvedValue(undefined);
  mockClassifyFixClass.mockReturnValue('selectors');
  // D-04: by default heal count is 0 (below cap) — dispatch proceeds
  mockCountHealsForTest.mockReturnValue(0);
  mockRecordCapHit.mockResolvedValue(undefined);
  mockAppendHealEvent.mockResolvedValue(undefined);
});

// ── Task 3 Test 1: enableAutoDispatch=false suppresses fireDispatch ──────────

describe('Step 9 auto-dispatch — flag off', () => {
  it('does NOT call fireDispatch when enableAutoDispatch is false, even with detections', async () => {
    mockEvaluateThresholds.mockReturnValue([DETECTION]);
    const config = makeConfig({ enableAutoDispatch: false });
    await run(config);
    expect(mockFireDispatch).not.toHaveBeenCalled();
  });
});

// ── Task 3 Test 2: enableAutoDispatch=true + 1 detection → fireDispatch called ──

describe('Step 9 auto-dispatch — flag on + 1 detection', () => {
  it('calls fireDispatch once with correct workflowFile and ref when enableAutoDispatch is true', async () => {
    mockEvaluateThresholds.mockReturnValue([DETECTION]);
    const config = makeConfig({ enableAutoDispatch: true });
    await run(config);

    expect(mockFireDispatch).toHaveBeenCalledTimes(1);
    const callArgs = mockFireDispatch.mock.calls[0][0];
    expect(callArgs.workflowFile).toBe('playwright-healer.yml');
    expect(callArgs.ref).toBe('main');
    expect(callArgs.commitSha).toBe('deadbeef1234567');
  });
});

// ── Task 3 Test 3: enableAutoDispatch=true + 0 detections → no dispatch ─────

describe('Step 9 auto-dispatch — flag on + zero detections', () => {
  it('does NOT call fireDispatch when there are no detections', async () => {
    mockEvaluateThresholds.mockReturnValue([]);
    const config = makeConfig({ enableAutoDispatch: true });
    await run(config);
    expect(mockFireDispatch).not.toHaveBeenCalled();
  });
});

// ── Task 3 Test 4: dispatch loop is inside try block (removeWorktree always runs) ──

describe('Step 9 auto-dispatch — inside try block', () => {
  it('calls removeWorktree even when fireDispatch throws', async () => {
    mockEvaluateThresholds.mockReturnValue([DETECTION]);
    mockFireDispatch.mockRejectedValue(new Error('dispatch failed'));
    const config = makeConfig({ enableAutoDispatch: true });

    // run() propagates the error — we just check removeWorktree was called
    await expect(run(config)).rejects.toThrow('dispatch failed');
    expect(mockRemoveWorktree).toHaveBeenCalledWith('/tmp/worktree-test');
  });
});

// ── Task 3 Test 5: writeDetectionSummary called with enableAutoDispatch=true ──

describe('Step 8 summary-writer — dispatch mode signaled', () => {
  it('calls writeDetectionSummary with enableAutoDispatch=true when flag is on', async () => {
    mockEvaluateThresholds.mockReturnValue([DETECTION]);
    const config = makeConfig({ enableAutoDispatch: true });
    await run(config);

    expect(mockWriteDetectionSummary).toHaveBeenCalledWith(
      [DETECTION],
      true,
      [],
      10,
    );
  });
});

// ── Task 3 Test 6: writeDetectionSummary called with enableAutoDispatch=false ─

describe('Step 8 summary-writer — log-only mode', () => {
  it('calls writeDetectionSummary with enableAutoDispatch=false when flag is off', async () => {
    mockEvaluateThresholds.mockReturnValue([DETECTION]);
    const config = makeConfig({ enableAutoDispatch: false });
    await run(config);

    expect(mockWriteDetectionSummary).toHaveBeenCalledWith(
      [DETECTION],
      false,
      [],
      10,
    );
  });
});

// ── Task 3 Test 7 (action.yml): verified by grep in done criteria ────────────
// (shell-level assertion — checked separately in done criteria verification)

// ── Task 2 Tests 10-11: CFG-04 per-class disable + classifier integration ────

import * as core from '@actions/core';

describe('Step 9 auto-dispatch — CFG-04 per-class disable (Test 10)', () => {
  it('suppresses dispatch and emits core.warning when assertions fix class is disabled', async () => {
    // Classifier returns 'assertions'; enableAssertionFixes is false → skip + warn
    mockClassifyFixClass.mockReturnValue('assertions');
    mockEvaluateThresholds.mockReturnValue([DETECTION]);
    const config = makeConfig({
      enableAutoDispatch: true,
      enableAssertionFixes: false,
    });
    await run(config);

    expect(mockFireDispatch).not.toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringMatching(/assertions fix class disabled/),
    );
  });
});

describe('Step 9 auto-dispatch — classifier integration (Test 11)', () => {
  it('calls fireDispatch with fixClassHint from classifier when all toggles are enabled', async () => {
    // Classifier returns 'slow' — fireDispatch should receive fixClassHint: 'slow'
    mockClassifyFixClass.mockReturnValue('slow');
    mockEvaluateThresholds.mockReturnValue([DETECTION]);
    const config = makeConfig({ enableAutoDispatch: true });
    await run(config);

    expect(mockFireDispatch).toHaveBeenCalledTimes(1);
    const callArgs = mockFireDispatch.mock.calls[0][0];
    expect(callArgs.fixClassHint).toBe('slow');
  });
});

// ── Phase 04 D-04 heal-cap gate tests ────────────────────────────────────────

describe('Step 9 auto-dispatch — D-04 heal-cap gate (Test 12: cap-hit suppresses dispatch)', () => {
  it('does NOT call fireDispatch when heal count >= maxHealsPerTestPerWeek', async () => {
    // heal count at the cap
    mockCountHealsForTest.mockReturnValue(3);
    mockEvaluateThresholds.mockReturnValue([DETECTION]);
    const config = makeConfig({ enableAutoDispatch: true, maxHealsPerTestPerWeek: 3 });
    await run(config);

    expect(mockFireDispatch).not.toHaveBeenCalled();
  });

  it('calls recordCapHit with correct args when cap is hit', async () => {
    mockCountHealsForTest.mockReturnValue(3);
    mockEvaluateThresholds.mockReturnValue([DETECTION]);
    const config = makeConfig({ enableAutoDispatch: true, maxHealsPerTestPerWeek: 3 });
    await run(config);

    expect(mockRecordCapHit).toHaveBeenCalledWith(
      expect.objectContaining({
        testId: DETECTION.testId,
        count: 3,
        cap: 3,
        worktreePath: '/tmp/worktree-test',
      }),
    );
  });
});

describe('Step 9 auto-dispatch — D-04 heal-cap gate (Test 13: below cap → dispatch fires)', () => {
  it('calls fireDispatch when heal count < maxHealsPerTestPerWeek', async () => {
    // count is below the cap
    mockCountHealsForTest.mockReturnValue(2);
    mockEvaluateThresholds.mockReturnValue([DETECTION]);
    const config = makeConfig({ enableAutoDispatch: true, maxHealsPerTestPerWeek: 3 });
    await run(config);

    expect(mockFireDispatch).toHaveBeenCalledTimes(1);
    expect(mockRecordCapHit).not.toHaveBeenCalled();
  });
});
