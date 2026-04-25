// tests/integration/state-branch.test.ts — Integration tests using local bare repo harness
//
// Validates STA-01..05 state-branch requirements using real git operations against
// a local bare repo (no network access required). Runs in forks pool (vitest.config.ts)
// to prevent git child-process state leakage between tests.
//
// Requirements covered:
//   STA-01: orphan branch created on first bootstrapOrGetWorktree()
//   STA-02: second appendRecord() appends (does not overwrite)
//   STA-03/04: serial conflict path — two workspaces, second retry succeeds
//   Isolation: primary workspace branch unchanged after appendRecord + removeWorktree
//   STA-05: runGc prunes old files in a real worktree

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeBareRepo, BareRepoContext } from '../_helpers/bare-repo.js';
import {
  bootstrapOrGetWorktree,
  appendRecord,
  removeWorktree,
  todayPath,
  runGc,
} from '../../src/shared/state-branch.js';
import type { NdjsonRecord } from '../../src/shared/types.js';
import * as fs from 'fs';
import * as path from 'path';

function makeRecord(runId: string): NdjsonRecord {
  return {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId,
    commitSha: 'abc123',
    branch: 'main',
    healerVersion: '0.0.0',
    shardIndex: null,
    shardTotal: null,
    tests: [],
  };
}

describe('state-branch — STA-01..05', () => {
  let ctx: BareRepoContext;

  beforeEach(() => {
    ctx = makeBareRepo();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('STA-01: bootstrap creates orphan playwright-healer-state branch on first use', async () => {
    const wt = await bootstrapOrGetWorktree(ctx.remoteUrl, ctx.primaryWs1);

    try {
      // Branch must exist on the bare remote
      const { execSync } = await import('child_process');
      const branches = execSync(`git branch -a`, { cwd: ctx.remoteDir }).toString();
      expect(branches).toContain('playwright-healer-state');

      // Primary workspace must NOT have the state branch as a local branch
      // (the standalone-init path uses a separate .git, so no worktree registration)
      const primaryBranches = execSync('git branch', { cwd: ctx.primaryWs1 }).toString();
      expect(primaryBranches).not.toContain('playwright-healer-state');
    } finally {
      await removeWorktree(wt);
    }
  });

  it('STA-02: second appendRecord appends (does not overwrite)', async () => {
    const wt = await bootstrapOrGetWorktree(ctx.remoteUrl, ctx.primaryWs1);

    try {
      await appendRecord(makeRecord('run-001'), wt);
      await appendRecord(makeRecord('run-002'), wt);

      const today = todayPath();
      const content = fs.readFileSync(path.join(wt, today), 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);

      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('run-001');
      expect(lines[1]).toContain('run-002');
    } finally {
      await removeWorktree(wt);
    }
  });

  it('STA-03 + STA-04: two sequential appends from different workspaces (serial conflict path)', async () => {
    // Bootstrap both workspaces: wt1 creates the branch (first use),
    // wt2 fetches the now-existing branch.
    const wt1 = await bootstrapOrGetWorktree(ctx.remoteUrl, ctx.primaryWs1);
    const wt2 = await bootstrapOrGetWorktree(ctx.remoteUrl, ctx.primaryWs2);

    try {
      // wt1 appends first (succeeds on first attempt — no contention yet)
      await appendRecord(makeRecord('run-001'), wt1);

      // wt2's local state is now stale (wt1 pushed ahead).
      // The force-with-lease retry loop fetches + resets, then succeeds.
      await appendRecord(makeRecord('run-002'), wt2);

      // Verify both records are on remote — fetch latest from wt1
      const { getExecOutput } = await import('@actions/exec');
      await getExecOutput('git', ['fetch', 'origin', 'playwright-healer-state'], { cwd: wt1 });
      await getExecOutput('git', ['reset', '--hard', 'origin/playwright-healer-state'], { cwd: wt1 });

      const today = todayPath();
      const content = fs.readFileSync(path.join(wt1, today), 'utf8');

      // Neither record lost — both appended
      expect(content).toContain('run-001');
      expect(content).toContain('run-002');
    } finally {
      await removeWorktree(wt1);
      await removeWorktree(wt2);
    }
  });

  it('primary workspace is unmodified after appendRecord (workspace isolation)', async () => {
    const { execSync } = await import('child_process');
    const beforeBranch = execSync('git branch --show-current', { cwd: ctx.primaryWs1 })
      .toString()
      .trim();

    const wt = await bootstrapOrGetWorktree(ctx.remoteUrl, ctx.primaryWs1);
    await appendRecord(makeRecord('run-isolation'), wt);
    await removeWorktree(wt);

    // Primary workspace current branch unchanged (not switched to playwright-healer-state)
    const afterBranch = execSync('git branch --show-current', { cwd: ctx.primaryWs1 })
      .toString()
      .trim();
    expect(afterBranch).toBe(beforeBranch);

    // Temp worktree directory has been cleaned up
    expect(fs.existsSync(wt)).toBe(false);
  });

  it('STA-05: runGc prunes files older than retentionDays in a real worktree', async () => {
    // Bootstrap + append to create a real worktree with git history
    const wt = await bootstrapOrGetWorktree(ctx.remoteUrl, ctx.primaryWs1);

    try {
      await appendRecord(makeRecord('run-gc-test'), wt);

      // Seed an artificially old file directly in the worktree filesystem.
      // NOTE: this file is NOT git-committed — it's untracked. After runGc
      // calls git add -A + git commit, git may report "nothing to commit"
      // (the tracked file was just deleted, and the untracked old file also gone).
      // The runGc implementation uses ignoreReturnCode: true on the commit
      // to handle this gracefully.
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60);
      const y = oldDate.getUTCFullYear();
      const m = String(oldDate.getUTCMonth() + 1).padStart(2, '0');
      const d = String(oldDate.getUTCDate()).padStart(2, '0');
      const oldFilePath = path.join(wt, 'runs', String(y), m, `${d}.ndjson`);
      fs.mkdirSync(path.dirname(oldFilePath), { recursive: true });
      fs.writeFileSync(
        oldFilePath,
        JSON.stringify({ schemaVersion: 1, runId: 'old-run' }) + '\n',
        'utf8',
      );

      // Run GC with 30-day retention — old file (60 days) should be pruned
      await runGc(30, wt);

      // Old file should be gone
      expect(fs.existsSync(oldFilePath)).toBe(false);
    } finally {
      await removeWorktree(wt);
    }
  });
});
