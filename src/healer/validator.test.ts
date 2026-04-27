// src/healer/validator.test.ts
//
// VAL-01..04: Tests for the validator harness.
// Mocks @actions/exec to avoid spawning real Playwright processes.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

vi.mock('@actions/exec', () => ({
  getExecOutput: vi.fn(),
}));

import { validate, escapeForGrep } from './validator.js';
import { getExecOutput } from '@actions/exec';

const mockExec = getExecOutput as unknown as ReturnType<typeof vi.fn>;

const PASSED_JSON = readFileSync(
  path.join(process.cwd(), 'tests/fixtures/playwright-rerun-passed.json'),
  'utf8',
);
const FAILED_JSON = readFileSync(
  path.join(process.cwd(), 'tests/fixtures/playwright-rerun-failed.json'),
  'utf8',
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('escapeForGrep — T-3-VAL-01 mitigation', () => {
  it('escapes parentheses', () => {
    expect(escapeForGrep('foo (bar)')).toBe('foo \\(bar\\)');
  });
  it('escapes dots', () => {
    expect(escapeForGrep('X.toBe(5)')).toBe('X\\.toBe\\(5\\)');
  });
  it('escapes brackets and pipes', () => {
    expect(escapeForGrep('a[b]|c')).toBe('a\\[b\\]\\|c');
  });
  it('leaves alphanumeric strings untouched', () => {
    expect(escapeForGrep('plainTitle')).toBe('plainTitle');
  });
});

describe('validate — VAL-01..04', () => {
  it('passes --retries=0, --workers=1, --grep, --reporter=json (VAL-01)', async () => {
    mockExec.mockResolvedValue({ stdout: PASSED_JSON, stderr: '', exitCode: 0 });
    await validate('tests/x.spec.ts', 'completes purchase', 1);
    const callArgs = mockExec.mock.calls[0];
    const argv = callArgs[1] as string[];
    expect(argv).toContain('--retries=0');
    expect(argv).toContain('--workers=1');
    expect(argv).toContain('--grep');
    expect(argv).toContain('--reporter=json');
  });

  it('escapes regex metachars in --grep argument (T-3-VAL-01)', async () => {
    mockExec.mockResolvedValue({ stdout: PASSED_JSON, stderr: '', exitCode: 0 });
    await validate('tests/x.spec.ts', 'foo (bar) [baz]', 1);
    const argv = mockExec.mock.calls[0][1] as string[];
    const grepIdx = argv.indexOf('--grep');
    expect(argv[grepIdx + 1]).toBe('foo \\(bar\\) \\[baz\\]');
  });

  it('runs exactly rerunCount times (VAL-02)', async () => {
    mockExec.mockResolvedValue({ stdout: PASSED_JSON, stderr: '', exitCode: 0 });
    await validate('tests/x.spec.ts', 'X', 5);
    expect(mockExec).toHaveBeenCalledTimes(5);
  });

  it('all passing → passRate = 1.0', async () => {
    mockExec.mockResolvedValue({ stdout: PASSED_JSON, stderr: '', exitCode: 0 });
    const r = await validate('tests/x.spec.ts', 'X', 10);
    expect(r.passed).toBe(10);
    expect(r.total).toBe(10);
    expect(r.passRate).toBe(1.0);
  });

  it('all failing → passRate = 0', async () => {
    mockExec.mockResolvedValue({ stdout: FAILED_JSON, stderr: '', exitCode: 1 });
    const r = await validate('tests/x.spec.ts', 'X', 10);
    expect(r.passed).toBe(0);
    expect(r.passRate).toBe(0);
  });

  it('9 pass / 1 fail → passRate = 0.9', async () => {
    let call = 0;
    mockExec.mockImplementation(async () => {
      call += 1;
      const json = call <= 9 ? PASSED_JSON : FAILED_JSON;
      const exitCode = call <= 9 ? 0 : 1;
      return { stdout: json, stderr: '', exitCode };
    });
    const r = await validate('tests/x.spec.ts', 'X', 10);
    expect(r.passed).toBe(9);
    expect(r.passRate).toBeCloseTo(0.9, 6);
  });

  it('runs sequentially (--workers=1 + sequential calls — VAL-04 documented limitation)', async () => {
    mockExec.mockResolvedValue({ stdout: PASSED_JSON, stderr: '', exitCode: 0 });
    await validate('tests/x.spec.ts', 'X', 3);
    // The for-loop awaits each call, so calls are made one-at-a-time.
    // Assert --workers=1 is in every argv call
    for (const call of mockExec.mock.calls) {
      expect(call[1]).toContain('--workers=1');
    }
  });

  it('handles unparseable JSON gracefully', async () => {
    mockExec.mockResolvedValue({ stdout: 'not json', stderr: '', exitCode: 1 });
    const r = await validate('tests/x.spec.ts', 'X', 1);
    expect(r.perRun[0].status).toBe('failed');
  });
});

describe('VAL-04 — does not restart the app between reruns', () => {
  it('validator.ts has no import from app-supervisor', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/healer/validator.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"][./]+app-supervisor/);
  });
});

describe('validate — HI-01 cwd threading', () => {
  it('passes cwd to getExecOutput options when provided', async () => {
    mockExec.mockResolvedValue({ stdout: PASSED_JSON, stderr: '', exitCode: 0 });
    await validate('tests/x.spec.ts', 'my test', 1, '/my/workspace');
    const callArgs = mockExec.mock.calls[0];
    const options = callArgs[2] as { cwd?: string };
    expect(options.cwd).toBe('/my/workspace');
  });

  it('passes cwd=undefined to getExecOutput when no cwd argument', async () => {
    mockExec.mockResolvedValue({ stdout: PASSED_JSON, stderr: '', exitCode: 0 });
    await validate('tests/x.spec.ts', 'my test', 1);
    const callArgs = mockExec.mock.calls[0];
    const options = callArgs[2] as { cwd?: string };
    expect(options.cwd).toBeUndefined();
  });
});
