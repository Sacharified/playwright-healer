// src/ingest/dispatch.test.ts
// DET-05/06/07 unit coverage for fireDispatch + buildConcurrencyKey.
//
// Mock naming: vitest auto-hoists declarations whose names start with 'mock'.
// Variables NOT starting with 'mock' would throw ReferenceError before the
// factory runs. All mock vars use the 'mock' prefix.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock setup (hoisted by vitest because names start with 'mock') ──────────

const mockCreateWorkflowDispatch = vi.fn();
const mockOctokitConstructor = vi.fn().mockImplementation(() => ({
  rest: { actions: { createWorkflowDispatch: mockCreateWorkflowDispatch } },
}));

vi.mock('@octokit/rest', () => ({ Octokit: mockOctokitConstructor }));

const mockCoreWarning = vi.fn();
const mockCoreInfo = vi.fn();
const mockCoreSummaryAddRaw = vi.fn().mockReturnThis();
const mockCoreSummaryWrite = vi.fn().mockResolvedValue(undefined);

vi.mock('@actions/core', () => ({
  warning: mockCoreWarning,
  info: mockCoreInfo,
  summary: {
    addRaw: mockCoreSummaryAddRaw,
    write: mockCoreSummaryWrite,
  },
}));

// Import AFTER mocks are set up
import { fireDispatch, buildConcurrencyKey } from './dispatch.js';
import type { Detection } from '../shared/types.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

const DETECTION: Detection = {
  testId: 'tests/login.spec.ts::login flow',
  filePath: 'tests/login.spec.ts',
  reason: 'flake-rate',
  windowDays: 7,
  value: 0.35,
  threshold: 0.2,
  runCount: 20,
};

const BASE_ARGS = {
  patToken: 'pat-test-secret',
  owner: 'acme',
  repo: 'myrepo',
  workflowFile: 'playwright-healer.yml',
  ref: 'main',
  detection: DETECTION,
  commitSha: 'abc1234',
  fixClassHint: 'selectors' as const,
  flakeRate: 0.35,
  windowDays: 7,
  runCount: 20,
  concurrencyKey: 'tests-login-spec-ts-login-flow-a1b2c3d4',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateWorkflowDispatch.mockResolvedValue({});
});

// ── DET-05: Dispatch fires with correct payload shape ────────────────────────

describe('fireDispatch — DET-05 (workflow_dispatch payload)', () => {
  it('calls createWorkflowDispatch exactly once with the 8 flat inputs', async () => {
    await fireDispatch(BASE_ARGS);

    expect(mockCreateWorkflowDispatch).toHaveBeenCalledTimes(1);
    const call = mockCreateWorkflowDispatch.mock.calls[0][0];

    expect(call.workflow_id).toBe('playwright-healer.yml');
    expect(call.ref).toBe('main');
    expect(call.owner).toBe('acme');
    expect(call.repo).toBe('myrepo');

    // All 8 flat inputs must be present as strings
    expect(call.inputs).toBeDefined();
    expect(call.inputs.commitSha).toBe('abc1234');
    expect(call.inputs.testFile).toBe('tests/login.spec.ts');
    expect(call.inputs.testTitle).toBe('login flow');
    expect(call.inputs.fixClassHint).toBe('selectors');
    expect(call.inputs.flakeRate).toBe('0.35');
    expect(call.inputs.windowDays).toBe('7');
    expect(call.inputs.runCount).toBe('20');
    expect(call.inputs.concurrencyKey).toBe('tests-login-spec-ts-login-flow-a1b2c3d4');
  });
});

// ── DET-06: PAT authentication (NOT GITHUB_TOKEN) ────────────────────────────

describe('fireDispatch — DET-06 (PAT auth)', () => {
  it('constructs Octokit with the patToken, never an empty string or GITHUB_TOKEN literal', async () => {
    await fireDispatch(BASE_ARGS);

    expect(mockOctokitConstructor).toHaveBeenCalledTimes(1);
    const constructorArg = mockOctokitConstructor.mock.calls[0][0];

    expect(constructorArg.auth).toBe('pat-test-secret');
    expect(constructorArg.auth).not.toBe('');
    expect(constructorArg.auth).not.toBe('GITHUB_TOKEN');
  });
});

// ── DET-07: buildConcurrencyKey determinism + length budget ──────────────────

describe('buildConcurrencyKey — DET-07 (determinism + length)', () => {
  it('returns the same value across two calls (deterministic)', () => {
    const k1 = buildConcurrencyKey('tests/a/b.spec.ts', 'login flow');
    const k2 = buildConcurrencyKey('tests/a/b.spec.ts', 'login flow');
    expect(k1).toBe(k2);
  });

  it('differs for case-distinct titles (SHA-1 component preserves case uniqueness)', () => {
    const kLower = buildConcurrencyKey('tests/a/b.spec.ts', 'login flow');
    const kUpper = buildConcurrencyKey('tests/a/b.spec.ts', 'login Flow');
    expect(kLower).not.toBe(kUpper);
  });

  it('differs for different file paths (file-distinct)', () => {
    const kB = buildConcurrencyKey('tests/a/b.spec.ts', 'login flow');
    const kC = buildConcurrencyKey('tests/a/c.spec.ts', 'login flow');
    expect(kB).not.toBe(kC);
  });

  it('returns a string of length <= 250 even for pathological inputs', () => {
    const key = buildConcurrencyKey('a'.repeat(500), 'b'.repeat(500));
    expect(key.length).toBeLessThanOrEqual(250);
  });
});

// ── Pitfall 1: over-length input guard ───────────────────────────────────────

describe('fireDispatch — Pitfall 1 (input length guard)', () => {
  it('calls core.warning and does NOT call createWorkflowDispatch when an input exceeds 1000 chars', async () => {
    // concurrencyKey is one of the 8 inputs — make it over-length
    const overLengthArgs = {
      ...BASE_ARGS,
      concurrencyKey: 'x'.repeat(1001),
    };
    await fireDispatch(overLengthArgs);

    expect(mockCoreWarning).toHaveBeenCalled();
    expect(mockCreateWorkflowDispatch).not.toHaveBeenCalled();
  });
});

// ── Pitfall 5: case-folding safety in slug component ─────────────────────────

describe('buildConcurrencyKey — Pitfall 5 (case-folding)', () => {
  it('lowercases the slug component', () => {
    const key = buildConcurrencyKey('TESTS/Login.spec.ts', 'X');
    const slugPart = key.split('-').slice(0, -1).join('-');
    // slug lowercases; SHA-1 hex is also lowercase by convention
    expect(slugPart).toBe(slugPart.toLowerCase());
  });
});

// ── flakeRate zero-coalesce for slow-regression detections ───────────────────

describe('fireDispatch — flakeRate zero-coalesce', () => {
  it("passes flakeRate='0' when detection.reason is 'slow-regression'", async () => {
    const slowDetection: Detection = {
      ...DETECTION,
      reason: 'slow-regression',
      value: 2.3,  // this is the slow-regression ratio, NOT the flake rate
    };
    await fireDispatch({
      ...BASE_ARGS,
      detection: slowDetection,
      flakeRate: 0, // caller already coalesces: detection.reason === 'flake-rate' ? value : 0
    });

    const call = mockCreateWorkflowDispatch.mock.calls[0][0];
    expect(call.inputs.flakeRate).toBe('0');
  });
});
