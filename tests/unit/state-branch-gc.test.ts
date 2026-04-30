// tests/unit/state-branch-gc.test.ts — GC unit tests for STA-05
//
// Tests date-based pruning logic of runGc() using vi.mock('@actions/exec').
// This lets the full filesystem pruning logic run without a real git repo.
// The git commit call (only fires when files are deleted) is intercepted by the mock.
//
// Key invariants tested:
//   - retentionDays === 0: no-op with ZERO git calls
//   - old file (beyond retention): deleted + git commit called
//   - recent file (within retention): preserved + NO git calls at all

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock @actions/exec so git calls succeed without a real git repo.
// MUST be declared before importing the module under test (Vitest hoists vi.mock).
vi.mock('@actions/exec', () => ({
  getExecOutput: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

// Mock @actions/core to suppress warning output in tests
vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  info: vi.fn(),
}));

import { runGc } from '../../src/shared/state-branch.js';

describe('runGc() — STA-05', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-gc-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retention_days: 0 is a no-op (GC disabled) — zero git calls', async () => {
    // Create a file that would be deleted if GC ran
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);
    const y = oldDate.getUTCFullYear();
    const m = String(oldDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(oldDate.getUTCDate()).padStart(2, '0');
    const filePath = path.join(tmpDir, 'runs', String(y), m, `${d}.ndjson`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'test-record\n', 'utf8');

    await runGc(0, tmpDir); // 0 = disabled

    expect(fs.existsSync(filePath)).toBe(true); // file still exists (no-op)

    // CRITICAL: zero git calls when GC is disabled (unit test gate)
    const { getExecOutput } = await import('@actions/exec');
    expect(getExecOutput).not.toHaveBeenCalled();
  });

  it('STA-05: prunes files older than retentionDays', async () => {
    // Create a file 100 days old — should be deleted with 30-day retention
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);
    const y = oldDate.getUTCFullYear();
    const m = String(oldDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(oldDate.getUTCDate()).padStart(2, '0');
    const filePath = path.join(tmpDir, 'runs', String(y), m, `${d}.ndjson`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'test-record\n', 'utf8');

    // Also create a recent file (1 day ago) that should NOT be deleted
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 1);
    const ry = recentDate.getUTCFullYear();
    const rm = String(recentDate.getUTCMonth() + 1).padStart(2, '0');
    const rd = String(recentDate.getUTCDate()).padStart(2, '0');
    const recentPath = path.join(tmpDir, 'runs', String(ry), rm, `${rd}.ndjson`);
    fs.mkdirSync(path.dirname(recentPath), { recursive: true });
    fs.writeFileSync(recentPath, 'recent-record\n', 'utf8');

    // runGc with git mocked — filesystem pruning runs, git commit is intercepted
    await runGc(30, tmpDir);

    // Old file should be deleted
    expect(fs.existsSync(filePath)).toBe(false);

    // Recent file should still exist
    expect(fs.existsSync(recentPath)).toBe(true);

    // Git commit should have been called (since a file was deleted)
    const { getExecOutput } = await import('@actions/exec');
    expect(getExecOutput).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['commit']),
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it('STA-05: prunes empty month and year directories after file deletion', async () => {
    // Single file 90 days old in an isolated year/month that will be entirely empty after GC
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 90);
    const y = oldDate.getUTCFullYear();
    const m = String(oldDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(oldDate.getUTCDate()).padStart(2, '0');
    const filePath = path.join(tmpDir, 'runs', String(y), m, `${d}.ndjson`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'old-record\n', 'utf8');

    await runGc(30, tmpDir);

    // File gone
    expect(fs.existsSync(filePath)).toBe(false);
    // Month dir gone (was empty after file deletion)
    expect(fs.existsSync(path.dirname(filePath))).toBe(false);
    // Year dir gone (was empty after month dir deletion)
    expect(fs.existsSync(path.join(tmpDir, 'runs', String(y)))).toBe(false);
  });

  it('retention_days: 7 leaves recent files intact — no git calls at all', async () => {
    // Create a file from yesterday — should NOT be deleted with 7-day retention
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const y = yesterday.getUTCFullYear();
    const m = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getUTCDate()).padStart(2, '0');
    const filePath = path.join(tmpDir, 'runs', String(y), m, `${d}.ndjson`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'test-record\n', 'utf8');

    await runGc(7, tmpDir);

    // File preserved
    expect(fs.existsSync(filePath)).toBe(true);

    // CRITICAL: git must NOT be called when nothing was deleted
    const { getExecOutput } = await import('@actions/exec');
    expect(getExecOutput).not.toHaveBeenCalled();
  });

  it('no-op when runs/ directory does not exist', async () => {
    // tmpDir has no runs/ subdirectory
    await runGc(7, tmpDir);

    const { getExecOutput } = await import('@actions/exec');
    expect(getExecOutput).not.toHaveBeenCalled();
  });
});
