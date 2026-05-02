// src/shared/state-branch.ts — Git-as-database state branch management
// Implements Patterns 1, 2, 4, J from Phase 02 research:
//   - Pattern 1: bootstrapOrGetWorktree (orphan branch + worktree isolation)
//   - Pattern 2: appendRecord (force-with-lease retry loop, Pitfall C)
//   - Pattern 4: runGc (date-based pruning with early-return)
//   - Pattern J fix: removeWorktree (ignoreReturnCode + rmSync guarantee)
//
// CRITICAL INVARIANTS:
//   - Every getExecOutput('git', ...) call MUST include { cwd: worktreePath }
//     to prevent workspace contamination (Pitfall A)
//   - --force-with-lease MUST be ref-qualified: --force-with-lease=playwright-healer-state
//     to prevent stale FETCH_HEAD false-positives (Pitfall C)
//   - After exhausted retries: core.warning() only, no throw (Assumption A1)

import { getExecOutput } from '@actions/exec';
import * as core from '@actions/core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { NdjsonRecord, HealEvent } from './types.js';

const STATE_BRANCH = 'playwright-healer-state';
const BOT_EMAIL = 'playwright-healer-bot@users.noreply.github.com';
const BOT_NAME = 'playwright-healer-bot';
const MAX_RETRIES = 5;

/**
 * Returns inline `git -c http.extraheader=...` flags injecting HEALER_TOKEN as
 * basic-auth for github.com requests. Same pattern as actions/checkout and
 * fix-applier.ts CRACK-2 fix — token never lands in ~/.gitconfig or
 * .git/config; per-invocation argv only. PAT was registered with
 * core.setSecret upstream so any leaked stderr is masked by the runner.
 *
 * Returns [] when HEALER_TOKEN is unset/empty (local dev, file:// remotes, and
 * public repos all work without auth).
 */
function gitCredentialFlags(): string[] {
  const token = process.env['HEALER_TOKEN'] ?? '';
  if (!token) return [];
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.https://github.com/.extraheader=Authorization: basic ${auth}`];
}

/**
 * Returns the relative NDJSON path for today's date in UTC.
 * Format: "runs/YYYY/MM/DD.ndjson"
 * Exported so integration tests can assert on the exact file path.
 */
export function todayPath(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `runs/${y}/${m}/${d}.ndjson`;
}

/**
 * Heal-event NDJSON path for today (Phase 04, Pitfall 7).
 * Sibling of todayPath() — runs/YYYY/MM/DD-heals.ndjson.
 */
export function todayHealPath(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `runs/${y}/${m}/${d}-heals.ndjson`;
}

/**
 * Append a single HealEvent to today's runs/YYYY/MM/DD-heals.ndjson on the
 * state branch. SAME retry-loop and durability invariants as appendRecord:
 *   - Pitfall A: every git call uses { cwd: worktreePath }
 *   - Pitfall B: atomic write via .tmp rename
 *   - Pitfall C: --force-with-lease=playwright-healer-state (ref-qualified)
 *   - Sentinel: [skip-healer] in every commit message (Guard 2 prerequisite)
 *   - Exhaustion: core.warning, no throw (Assumption A1)
 *
 * DO NOT abstract a shared helper with appendRecord — duplicating preserves
 * the existing test surface for appendRecord while keeping the heal path
 * independently auditable.
 */
export async function appendHealEvent(
  event: HealEvent,
  worktreePath: string,
): Promise<void> {
  const ndjsonPath = todayHealPath();
  const absPath = path.join(worktreePath, ndjsonPath);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // 1. Sync to remote state before every attempt
    await getExecOutput(
      'git',
      [...gitCredentialFlags(), 'fetch', 'origin', STATE_BRANCH],
      { cwd: worktreePath },
    );
    await getExecOutput(
      'git',
      ['reset', '--hard', `origin/${STATE_BRANCH}`],
      { cwd: worktreePath },
    );

    // 2. Ensure NDJSON directory exists
    fs.mkdirSync(path.join(worktreePath, path.dirname(ndjsonPath)), { recursive: true });

    // 3. Atomic append (temp rename prevents partial-write corruption — Pitfall B)
    const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
    const appended = existing + JSON.stringify(event) + '\n';
    const tmpPath = `${absPath}.tmp`;
    fs.writeFileSync(tmpPath, appended, 'utf8');
    fs.renameSync(tmpPath, absPath);

    // 4. Stage and commit in the worktree (never in process.cwd())
    await getExecOutput(
      'git',
      ['add', ndjsonPath],
      { cwd: worktreePath },
    );
    await getExecOutput(
      'git',
      [
        '-c', `user.email=${BOT_EMAIL}`,
        '-c', `user.name=${BOT_NAME}`,
        'commit', '-m', `heal: ${event.testId} ${event.outcome} [skip-healer]`,
      ],
      { cwd: worktreePath },
    );

    // 5. Push with ref-qualified lease (Pitfall C: prevents stale FETCH_HEAD false-positive)
    //    Form: --force-with-lease=playwright-healer-state (NOT bare --force-with-lease)
    const push = await getExecOutput(
      'git',
      [
        ...gitCredentialFlags(),
        'push',
        `--force-with-lease=${STATE_BRANCH}`,
        'origin',
        STATE_BRANCH,
      ],
      { cwd: worktreePath, ignoreReturnCode: true },
    );

    if (push.exitCode === 0) return;

    // Push rejected — another concurrent writer pushed first
    // Exponential backoff + jitter before retry
    const delayMs = 100 * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
    core.warning(
      `State branch heal-event push rejected (attempt ${attempt + 1}/${MAX_RETRIES}). Retry in ${delayMs}ms.`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));

    // Undo local commit before retry (fetch + reset at top of loop will re-sync anyway)
    await getExecOutput(
      'git',
      ['reset', '--soft', 'HEAD~1'],
      { cwd: worktreePath },
    );
  }

  // All retry attempts exhausted — non-fatal (analytics gap, not a security issue)
  core.warning(
    `State branch: all ${MAX_RETRIES} heal-event push attempts rejected. Heal record for ${event.testId} not persisted.`,
  );
}

/**
 * Bootstrap or reconnect to the playwright-healer-state orphan branch.
 *
 * First use (branch absent on remote):
 *   - Creates a standalone git init in a tmpdir (cannot use `worktree add` on non-existent ref)
 *   - Creates the orphan branch + initial empty file commit
 *   - Pushes to remote; if concurrent bootstrapper won, retries via recursion
 *
 * Subsequent uses (branch exists on remote):
 *   - Fetches the branch
 *   - Adds a git worktree in tmpdir (shares .git with primary workspace)
 *   - Checks out playwright-healer-state in the worktree
 *
 * @param repoRemoteUrl - file:// URL or https:// remote URL
 * @param primaryCwd - cwd for git ls-remote/fetch/worktree-add (defaults to process.cwd())
 * @returns worktreePath — a unique tmpdir containing the state branch checkout
 */
export async function bootstrapOrGetWorktree(
  repoRemoteUrl: string,
  primaryCwd: string = process.cwd(),
): Promise<string> {
  // Use fs.mkdtempSync for the worktree path — never user-controlled (Threat T-2-04b)
  const worktreePath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playwright-healer-state-'),
  );

  // Check whether the state branch already exists on the remote
  const lsRemote = await getExecOutput(
    'git',
    [...gitCredentialFlags(), 'ls-remote', '--exit-code', 'origin', `refs/heads/${STATE_BRANCH}`],
    { cwd: primaryCwd, ignoreReturnCode: true },
  );

  if (lsRemote.exitCode === 0) {
    // Branch exists — use git worktree add (shares .git with primary workspace)
    await getExecOutput(
      'git',
      [...gitCredentialFlags(), 'fetch', 'origin', STATE_BRANCH],
      { cwd: primaryCwd },
    );
    await getExecOutput(
      'git',
      ['worktree', 'add', '--no-checkout', worktreePath, `origin/${STATE_BRANCH}`],
      { cwd: primaryCwd },
    );
    await getExecOutput(
      'git',
      ['-c', `user.email=${BOT_EMAIL}`, '-c', `user.name=${BOT_NAME}`,
       'checkout', STATE_BRANCH],
      { cwd: worktreePath },
    );
    return worktreePath;
  }

  if (lsRemote.exitCode === 2) {
    // Branch absent on remote — first use, create orphan branch via standalone git init
    // Cannot use `git worktree add` on a non-existent ref (Pitfall J)
    // Note: tmpdir was already created by mkdtempSync above

    await getExecOutput('git', ['init'], { cwd: worktreePath });
    await getExecOutput(
      'git',
      ['remote', 'add', 'origin', repoRemoteUrl],
      { cwd: worktreePath },
    );
    await getExecOutput(
      'git',
      [
        '-c', `user.email=${BOT_EMAIL}`,
        '-c', `user.name=${BOT_NAME}`,
        'checkout', '--orphan', STATE_BRANCH,
      ],
      { cwd: worktreePath },
    );

    // Create initial empty today file so the first commit is non-empty
    const today = todayPath();
    fs.mkdirSync(path.join(worktreePath, path.dirname(today)), { recursive: true });
    fs.writeFileSync(path.join(worktreePath, today), '', 'utf8');

    await getExecOutput('git', ['add', '-A'], { cwd: worktreePath });
    await getExecOutput(
      'git',
      [
        '-c', `user.email=${BOT_EMAIL}`,
        '-c', `user.name=${BOT_NAME}`,
        'commit', '-m', `chore: init playwright-healer-state [skip-healer]`,
      ],
      { cwd: worktreePath },
    );

    // Push — if a concurrent bootstrapper wins, our push fails (non-zero exit)
    const push = await getExecOutput(
      'git',
      [...gitCredentialFlags(), 'push', '-u', 'origin', STATE_BRANCH],
      { cwd: worktreePath, ignoreReturnCode: true },
    );

    if (push.exitCode !== 0) {
      // Race condition: another bootstrapper pushed first. Clean up and recurse.
      // The branch now exists, so the second call will take the ls-remote === 0 path.
      fs.rmSync(worktreePath, { recursive: true, force: true });
      return bootstrapOrGetWorktree(repoRemoteUrl, primaryCwd);
    }

    return worktreePath;
  }

  // Any exit code other than 0 or 2 is a genuine git error
  throw new Error(
    `git ls-remote failed with exit code ${lsRemote.exitCode}: ${lsRemote.stderr}`,
  );
}

/**
 * Append a single NdjsonRecord to today's NDJSON file on the state branch.
 *
 * Uses a fetch + reset --hard loop with --force-with-lease=<branch> (ref-qualified,
 * Pitfall C) to handle concurrent appenders from different primary workspaces.
 * After MAX_RETRIES exhausted: emits core.warning() only — non-fatal (Assumption A1).
 *
 * Write strategy:
 *   - Write to .tmp file first, then rename (prevents partial-write corruption, Pitfall B)
 *
 * @param record - NdjsonRecord to append
 * @param worktreePath - path returned by bootstrapOrGetWorktree()
 */
export async function appendRecord(
  record: NdjsonRecord,
  worktreePath: string,
): Promise<void> {
  const ndjsonPath = todayPath();
  const absPath = path.join(worktreePath, ndjsonPath);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // 1. Sync to remote state before every attempt
    await getExecOutput(
      'git',
      [...gitCredentialFlags(), 'fetch', 'origin', STATE_BRANCH],
      { cwd: worktreePath },
    );
    await getExecOutput(
      'git',
      ['reset', '--hard', `origin/${STATE_BRANCH}`],
      { cwd: worktreePath },
    );

    // 2. Ensure NDJSON directory exists
    fs.mkdirSync(path.join(worktreePath, path.dirname(ndjsonPath)), { recursive: true });

    // 3. Atomic append (temp rename prevents partial-write corruption — Pitfall B)
    const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
    const appended = existing + JSON.stringify(record) + '\n';
    const tmpPath = `${absPath}.tmp`;
    fs.writeFileSync(tmpPath, appended, 'utf8');
    fs.renameSync(tmpPath, absPath);

    // 4. Stage and commit in the worktree (never in process.cwd())
    await getExecOutput(
      'git',
      ['add', ndjsonPath],
      { cwd: worktreePath },
    );
    await getExecOutput(
      'git',
      [
        '-c', `user.email=${BOT_EMAIL}`,
        '-c', `user.name=${BOT_NAME}`,
        'commit', '-m', `stats: run ${record.runId} [skip-healer]`,
      ],
      { cwd: worktreePath },
    );

    // 5. Push with ref-qualified lease (Pitfall C: prevents stale FETCH_HEAD false-positive)
    //    Form: --force-with-lease=playwright-healer-state (NOT bare --force-with-lease)
    const push = await getExecOutput(
      'git',
      [
        ...gitCredentialFlags(),
        'push',
        `--force-with-lease=${STATE_BRANCH}`,
        'origin',
        STATE_BRANCH,
      ],
      { cwd: worktreePath, ignoreReturnCode: true },
    );

    if (push.exitCode === 0) return;

    // Push rejected — another concurrent writer pushed first
    // Exponential backoff + jitter before retry
    const delayMs = 100 * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
    core.warning(
      `State branch push rejected (attempt ${attempt + 1}/${MAX_RETRIES}). Retry in ${delayMs}ms.`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));

    // Undo local commit before retry (fetch + reset at top of loop will re-sync anyway)
    await getExecOutput(
      'git',
      ['reset', '--soft', 'HEAD~1'],
      { cwd: worktreePath },
    );
  }

  // All retry attempts exhausted — non-fatal (analytics gap, not a security issue)
  core.warning(
    `State branch: all ${MAX_RETRIES} push attempts rejected. ` +
    `Run ${record.runId} stats will not be recorded this time.`,
  );
}

/**
 * Prune NDJSON files older than retentionDays from the state branch worktree.
 *
 * - retentionDays === 0: disabled, returns immediately (no git calls at all)
 * - Walks runs/YYYY/MM/DD.ndjson structure; deletes files where file date < cutoff
 * - Removes empty month/year directories after pruning
 * - Only stages+commits if at least one file was deleted
 * - GC commit is NOT pushed here; the next appendRecord push will carry it
 *
 * @param retentionDays - 0 = disabled; positive integer = max file age in days
 * @param worktreePath - path returned by bootstrapOrGetWorktree()
 */
export async function runGc(
  retentionDays: number,
  worktreePath: string,
): Promise<void> {
  // 0 = GC disabled — early return with ZERO git calls (unit test asserts this)
  if (retentionDays === 0) return;

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  cutoff.setUTCHours(0, 0, 0, 0);

  const runsDir = path.join(worktreePath, 'runs');
  if (!fs.existsSync(runsDir)) return;

  let deletedAny = false;

  // Walk runs/YYYY/MM/DD.ndjson
  const years = fs.readdirSync(runsDir).filter((e) => /^\d{4}$/.test(e));
  for (const year of years) {
    const yearDir = path.join(runsDir, year);
    const months = fs.readdirSync(yearDir).filter((e) => /^\d{2}$/.test(e));

    for (const month of months) {
      const monthDir = path.join(yearDir, month);
      const files = fs.readdirSync(monthDir).filter((e) => /^\d{2}\.ndjson$/.test(e));

      for (const file of files) {
        const day = file.replace('.ndjson', '');
        // Parse file date from directory structure (UTC)
        const fileDate = new Date(`${year}-${month}-${day}T00:00:00Z`);

        if (fileDate < cutoff) {
          fs.unlinkSync(path.join(monthDir, file));
          deletedAny = true;
        }
      }

      // Remove empty month directory
      const remaining = fs.readdirSync(monthDir);
      if (remaining.length === 0) {
        fs.rmdirSync(monthDir);
      }
    }

    // Remove empty year directory
    const remainingMonths = fs.readdirSync(yearDir);
    if (remainingMonths.length === 0) {
      fs.rmdirSync(yearDir);
    }
  }

  // Only commit if something was actually deleted
  // (unit test: expect(getExecOutput).not.toHaveBeenCalled() when nothing deleted)
  if (!deletedAny) return;

  await getExecOutput('git', ['add', '-A'], { cwd: worktreePath });
  // Use ignoreReturnCode: true — untracked files (seeded in integration tests but
  // never committed) mean git may report "nothing to commit" after add -A
  await getExecOutput(
    'git',
    [
      '-c', `user.email=${BOT_EMAIL}`,
      '-c', `user.name=${BOT_NAME}`,
      'commit', '-m',
      `chore: gc healer state (retention ${retentionDays}d) [skip-healer]`,
    ],
    { cwd: worktreePath, ignoreReturnCode: true },
  );
}

/**
 * Remove a state branch worktree and guarantee the directory is gone.
 *
 * Pattern J fix: `git worktree remove` only works for worktrees registered via
 * `git worktree add`. The standalone-init path (first-ever bootstrap) creates a
 * separate .git dir — `git worktree remove` will fail with a non-zero exit on it.
 * Using ignoreReturnCode: true ensures cleanup proceeds regardless.
 *
 * @param worktreePath - path returned by bootstrapOrGetWorktree()
 */
export async function removeWorktree(worktreePath: string): Promise<void> {
  // ignoreReturnCode: true — standalone-init worktrees are not registered via worktree add
  await getExecOutput(
    'git',
    ['worktree', 'remove', '--force', worktreePath],
    { ignoreReturnCode: true },
  );
  // Always follow up with rmSync — guarantees cleanup even if git didn't know about it
  fs.rmSync(worktreePath, { recursive: true, force: true });
}
