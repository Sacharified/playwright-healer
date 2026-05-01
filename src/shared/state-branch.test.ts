// src/shared/state-branch.test.ts
// Tests for appendHealEvent (Phase 04 Pitfall 7):
//   - Happy path: writes heal NDJSON + [skip-healer] commit
//   - Retry exhaustion: non-fatal (core.warning, no throw)
//   - Pitfall A: every git call uses { cwd: worktreePath }
//   - Pitfall C: push uses --force-with-lease=playwright-healer-state (ref-qualified)
//   - Sentinel discipline: commit message MUST contain [skip-healer]

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── vi.hoisted ensures these are initialized before vi.mock factories run ──────

const {
  mockGetExecOutput,
  mockCoreWarning,
  mockCoreInfo,
} = vi.hoisted(() => ({
  mockGetExecOutput: vi.fn(),
  mockCoreWarning: vi.fn(),
  mockCoreInfo: vi.fn(),
}));

vi.mock('@actions/exec', () => ({ getExecOutput: mockGetExecOutput }));
vi.mock('@actions/core', () => ({
  warning: mockCoreWarning,
  info: mockCoreInfo,
}));

import { appendHealEvent, todayHealPath } from './state-branch.js';
import type { HealEvent } from './types.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeWorktree(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'healer-test-'));
}

function makeEvent(overrides: Partial<HealEvent> = {}): HealEvent {
  return {
    schemaVersion: 1,
    timestamp: '2026-05-01T12:00:00.000Z',
    testId: 'tests/foo.spec.ts::login',
    outcome: 'pr-opened',
    dispatchRunId: 'r1',
    prUrl: 'https://github.com/acme/repo/pull/1',
    ...overrides,
  };
}

function setupSuccessfulGitMock(): void {
  // Default: all git commands succeed, push returns 0
  mockGetExecOutput.mockImplementation(async (_cmd: string, args: string[]) => {
    const isCommit = args.includes('commit');
    return {
      exitCode: 0,
      stdout: isCommit ? '[state-branch abcd1234] heal: ...' : '',
      stderr: '',
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── todayHealPath unit test ───────────────────────────────────────────────────

describe('todayHealPath', () => {
  it('returns a path matching runs/YYYY/MM/DD-heals.ndjson format', () => {
    const p = todayHealPath();
    expect(p).toMatch(/^runs\/\d{4}\/\d{2}\/\d{2}-heals\.ndjson$/);
  });

  it('uses UTC date (not local date)', () => {
    const p = todayHealPath();
    const now = new Date();
    const y = now.getUTCFullYear().toString();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    expect(p).toBe(`runs/${y}/${m}/${d}-heals.ndjson`);
  });

  it('is distinct from todayPath (no -heals suffix on regular stats path)', async () => {
    const { todayPath } = await import('./state-branch.js');
    expect(todayHealPath()).not.toBe(todayPath());
    expect(todayHealPath()).toContain('-heals');
    expect(todayPath()).not.toContain('-heals');
  });
});

// ── Test 3: appendHealEvent happy path ───────────────────────────────────────

describe('appendHealEvent — Test 3 (happy path)', () => {
  it('writes the event to the correct NDJSON file and pushes', async () => {
    const worktreePath = makeWorktree();
    try {
      setupSuccessfulGitMock();

      const event = makeEvent();
      await appendHealEvent(event, worktreePath);

      // File should be written in the correct location
      const expectedPath = path.join(worktreePath, todayHealPath());
      expect(fs.existsSync(expectedPath)).toBe(true);

      // File content should be parseable JSON matching the event
      const content = fs.readFileSync(expectedPath, 'utf8').trim();
      const parsed = JSON.parse(content);
      expect(parsed.testId).toBe('tests/foo.spec.ts::login');
      expect(parsed.outcome).toBe('pr-opened');
      expect(parsed.schemaVersion).toBe(1);
    } finally {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  it('pushes to the remote after committing', async () => {
    const worktreePath = makeWorktree();
    try {
      setupSuccessfulGitMock();
      await appendHealEvent(makeEvent(), worktreePath);

      // At least one push call should have been made
      type ExecCall = [string, string[]];
      const allCalls = mockGetExecOutput.mock.calls as unknown as ExecCall[];
      const pushCall = allCalls.find((call) => call[1].includes('push'));
      expect(pushCall).toBeDefined();
    } finally {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});

// ── Test 4: appendHealEvent retry exhaustion non-fatal ───────────────────────

describe('appendHealEvent — Test 4 (retry exhaustion non-fatal)', () => {
  it('returns without throwing after all push retries are exhausted', async () => {
    const worktreePath = makeWorktree();
    try {
      // All git commands succeed EXCEPT push — always returns non-zero
      mockGetExecOutput.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes('push')) {
          return { exitCode: 1, stdout: '', stderr: 'rejected: stale ref' };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      });

      // Must not throw
      await expect(appendHealEvent(makeEvent(), worktreePath)).resolves.toBeUndefined();
    } finally {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  it('emits core.warning after all retry attempts are exhausted', async () => {
    const worktreePath = makeWorktree();
    try {
      mockGetExecOutput.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes('push')) {
          return { exitCode: 1, stdout: '', stderr: 'rejected' };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      });

      await appendHealEvent(makeEvent(), worktreePath);
      expect(mockCoreWarning).toHaveBeenCalledWith(
        expect.stringContaining('heal-event push'),
      );
    } finally {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});

// ── Test 8: Pitfall A — every git call uses { cwd: worktreePath } ────────────

describe('appendHealEvent — Test 8 (Pitfall A: cwd discipline)', () => {
  it('every getExecOutput call passes { cwd: worktreePath }', async () => {
    const worktreePath = makeWorktree();
    try {
      setupSuccessfulGitMock();
      await appendHealEvent(makeEvent(), worktreePath);

      // All calls should have cwd = worktreePath in their options
      type ExecCall = [string, string[], { cwd?: string } | undefined];
      const allCalls = mockGetExecOutput.mock.calls as unknown as ExecCall[];
      const gitCalls = allCalls.filter((call) => call[0] === 'git');
      expect(gitCalls.length).toBeGreaterThan(0);
      for (const [, , opts] of gitCalls) {
        expect(opts?.cwd).toBe(worktreePath);
      }
    } finally {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});

// ── Test 9: Pitfall C — ref-qualified --force-with-lease ─────────────────────

describe('appendHealEvent — Test 9 (Pitfall C: ref-qualified force-with-lease)', () => {
  it('push command uses --force-with-lease=playwright-healer-state (NOT bare)', async () => {
    const worktreePath = makeWorktree();
    try {
      setupSuccessfulGitMock();
      await appendHealEvent(makeEvent(), worktreePath);

      // Find the push call
      type ExecCall = [string, string[]];
      const allCalls = mockGetExecOutput.mock.calls as unknown as ExecCall[];
      const pushCall = allCalls.find((call) => call[1].includes('push'));
      expect(pushCall).toBeDefined();

      const args = pushCall![1];
      // Must use ref-qualified form
      expect(args).toContain('--force-with-lease=playwright-healer-state');
      // Must NOT use bare --force-with-lease
      expect(args).not.toContain('--force-with-lease');
    } finally {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});

// ── Test 10: [skip-healer] sentinel in commit message ────────────────────────

describe('appendHealEvent — Test 10 ([skip-healer] sentinel discipline)', () => {
  it('commit message contains the [skip-healer] sentinel', async () => {
    const worktreePath = makeWorktree();
    try {
      setupSuccessfulGitMock();
      await appendHealEvent(makeEvent(), worktreePath);

      // Find the commit call
      type ExecCall = [string, string[]];
      const allCalls = mockGetExecOutput.mock.calls as unknown as ExecCall[];
      const commitCall = allCalls.find((call) => call[1].includes('commit'));
      expect(commitCall).toBeDefined();

      // -m argument should contain [skip-healer]
      const args = commitCall![1];
      const mFlagIndex = args.indexOf('-m');
      expect(mFlagIndex).toBeGreaterThanOrEqual(0);
      const commitMsg = args[mFlagIndex + 1];
      expect(commitMsg).toContain('[skip-healer]');
    } finally {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  it('commit message contains the testId and outcome', async () => {
    const worktreePath = makeWorktree();
    try {
      setupSuccessfulGitMock();
      const event = makeEvent({ testId: 'tests/checkout.spec.ts::buy now', outcome: 'issue-opened' });
      await appendHealEvent(event, worktreePath);

      type ExecCall = [string, string[]];
      const allCalls = mockGetExecOutput.mock.calls as unknown as ExecCall[];
      const commitCall = allCalls.find((call) => call[1].includes('commit'));
      expect(commitCall).toBeDefined();
      const args = commitCall![1];
      const mFlagIndex = args.indexOf('-m');
      const commitMsg = args[mFlagIndex + 1];
      expect(commitMsg).toContain('tests/checkout.spec.ts::buy now');
      expect(commitMsg).toContain('issue-opened');
    } finally {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});
