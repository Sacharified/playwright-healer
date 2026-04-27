// src/healer/fix-applier.ts
//
// FIX-05 + PRI-06: rebase onto origin/<defaultBranch>, apply the agent's diff,
// commit with SKIP_SENTINEL, push to origin. Returns the branch + commit SHA
// for Plan 12 pr-writer to use when opening the PR.
//
// Driver: @actions/exec (CONTEXT preference, single-source-of-truth git ops).
// All git invocations pass `{ cwd }` explicitly (state-branch.ts Pitfall A).
// Bot identity is set per-command via -c flags (state-branch.ts pattern).

import { exec, getExecOutput } from '@actions/exec';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { SKIP_SENTINEL, BOT_EMAIL, BOT_NAME } from '../shared/loop-guard.js';

export class DiffApplyFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiffApplyFailure';
  }
}

export interface ApplyFixArgs {
  diff: string;            // unified diff content from agent's FixProposal
  defaultBranch: string;   // e.g., 'main' or 'master' — caller's responsibility
  testSlug: string;        // slugified test title (lowercase, [^a-z0-9]+ → -, max 50 chars)
  shortSha: string;        // 7-char hex SHA from dispatch payload
  cwd: string;             // workspace where origin remote is configured
}

export interface ApplyFixResult {
  branch: string;          // 'playwright-healer/<testSlug>-<shortSha>'
  commitSha: string;       // SHA of the new commit
}

const identityFlags = (): string[] => [
  '-c', `user.email=${BOT_EMAIL}`,
  '-c', `user.name=${BOT_NAME}`,
];

export async function applyFix(args: ApplyFixArgs): Promise<ApplyFixResult> {
  const branch = `playwright-healer/${args.testSlug}-${args.shortSha}`;

  // 1. Fetch the default branch (shallow — we only need the tip)
  await exec(
    'git',
    ['fetch', 'origin', args.defaultBranch, '--depth=50'],
    { cwd: args.cwd },
  );

  // 2. Create a fresh branch from origin/<defaultBranch>
  //    checkout -B resets the branch if it already exists (idempotent)
  await exec(
    'git',
    ['checkout', '-B', branch, `origin/${args.defaultBranch}`],
    { cwd: args.cwd },
  );

  // 3. Write the diff to a temp file
  const tempDir = process.env['RUNNER_TEMP'] ?? '/tmp';
  const patchPath = path.join(tempDir, 'playwright-healer.patch');
  await writeFile(patchPath, args.diff, 'utf8');

  // 4. Apply the diff with 3-way merge fallback (handles drift when branch has diverged)
  const apply = await getExecOutput(
    'git',
    ['apply', '--3way', patchPath],
    { cwd: args.cwd, ignoreReturnCode: true },
  );
  if (apply.exitCode !== 0) {
    throw new DiffApplyFailure(`git apply failed: ${apply.stderr.trim()}`);
  }

  // 5. Stage all changes
  await exec('git', ['add', '-A'], { cwd: args.cwd });

  // 6. Commit with SKIP_SENTINEL in the message body (PRI-06)
  //    Subject line is short; body contains the sentinel to suppress ingest loop.
  const commitMessage = `fix: heal flaky test\n\n${SKIP_SENTINEL}`;
  await exec(
    'git',
    [...identityFlags(), 'commit', '-m', commitMessage],
    { cwd: args.cwd },
  );

  // 7. Read the commit SHA
  const sha = await getExecOutput(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: args.cwd, silent: true },
  );
  const commitSha = sha.stdout.trim();

  // 8. Push the new branch to origin (fresh branch — no lease flag needed)
  await exec(
    'git',
    ['push', '-u', 'origin', branch],
    { cwd: args.cwd },
  );

  return { branch, commitSha };
}
