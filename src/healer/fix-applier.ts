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
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { SKIP_SENTINEL, BOT_EMAIL, BOT_NAME } from '../shared/loop-guard.js';
import { normalizeDiff } from './diff-normalizer.js';

/**
 * Extract the set of `-` body lines per target file from a unified diff.
 * Used by the no-op-patch diagnostic to determine whether the patch is a no-op
 * because the file already matches the post-state, or because of a normalizer
 * bug. A `-` line that DOES appear in the current file ⇒ apply should have
 * changed something; absence ⇒ file is already in the post-state.
 *
 * Trims the leading `-` and surrounding whitespace so noisy whitespace drift
 * between the agent's diff and the file doesn't produce false negatives.
 */
function extractMinusLinesByFile(diff: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let currentPath: string | null = null;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4).trim();
      currentPath = p === '/dev/null' ? null : p.replace(/^a\//, '');
      if (currentPath && !result[currentPath]) result[currentPath] = [];
    } else if (raw.startsWith('-') && !raw.startsWith('---') && currentPath) {
      const trimmed = raw.slice(1).trim();
      if (trimmed.length > 0) result[currentPath].push(trimmed);
    }
  }
  return result;
}

// BOT_EMAIL / BOT_NAME from loop-guard.js are the *fallback* identity used
// when a caller doesn't supply args.botEmail / args.botName. Real callers
// (healer/index.ts) always pass the values from config.botEmail / config.botName,
// which default in the schema to the canonical github-actions[bot] noreply.
// The fallback exists so unit tests and historical call sites keep compiling.

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
  token: string;           // healer_token PAT (registered with core.setSecret at startup);
                           //   ignored by file:// remotes — set to '' for tests
  botEmail?: string;       // git author email for the heal commit. Optional —
                           //   falls back to BOT_EMAIL constant for back-compat.
                           //   Production callers thread config.botEmail through
                           //   so deploy gates (Vercel, Netlify) that verify the
                           //   commit-author → GitHub-account mapping accept the PR.
  botName?: string;        // pairs with botEmail; falls back to BOT_NAME.
}

export interface ApplyFixResult {
  branch: string;          // 'playwright-healer/<testSlug>-<shortSha>'
  commitSha: string;       // SHA of the new commit
}

export async function applyFix(args: ApplyFixArgs): Promise<ApplyFixResult> {
  const branch = `playwright-healer/${args.testSlug}-${args.shortSha}`;
  const botEmail = args.botEmail ?? BOT_EMAIL;
  const botName = args.botName ?? BOT_NAME;
  const identityFlags = (): string[] => [
    '-c', `user.email=${botEmail}`,
    '-c', `user.name=${botName}`,
  ];

  // Build inline credential flags for fetch. Same pattern as the push step
  // below. The empty-value reset preceding our auth header ensures we replace
  // (not append to) any persisted `http.https://github.com/.extraheader` left
  // in `.git/config` by the consumer's `actions/checkout` (default
  // persist-credentials: true). Without the reset, both Authorization headers
  // are sent and GitHub returns "Duplicate header: Authorization" / 400.
  const fetchAuth = args.token
    ? [
        '-c', 'http.https://github.com/.extraheader=',
        '-c', `http.https://github.com/.extraheader=Authorization: basic ${Buffer.from(`x-access-token:${args.token}`).toString('base64')}`,
      ]
    : [];

  // 1. Fetch the default branch (shallow — we only need the tip)
  await exec(
    'git',
    [...fetchAuth, 'fetch', 'origin', args.defaultBranch, '--depth=50'],
    { cwd: args.cwd },
  );

  // 2. Create a fresh branch from origin/<defaultBranch>
  //    checkout -B resets the branch if it already exists (idempotent)
  await exec(
    'git',
    ['checkout', '-B', branch, `origin/${args.defaultBranch}`],
    { cwd: args.cwd },
  );

  // 3. Normalize the agent-emitted diff so `git apply` will accept it.
  //    Models routinely emit malformed unified diffs — placeholder hunk
  //    headers (`@@ ... @@`) and miscounted line totals are both common.
  //    See diff-normalizer.ts for the full failure-mode catalogue.
  //    Done AFTER the branch checkout so the source files we read for
  //    line-number lookup match the diff's "before" state.
  let normalizedDiff: string;
  try {
    normalizedDiff = normalizeDiff(args.diff, args.cwd);
  } catch (err) {
    throw new DiffApplyFailure(
      `diff normalization failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4. Write the diff to a temp file
  const tempDir = process.env['RUNNER_TEMP'] ?? '/tmp';
  const patchPath = path.join(tempDir, 'playwright-healer.patch');
  await writeFile(patchPath, normalizedDiff, 'utf8');

  // 4. Apply the diff with 3-way merge fallback AND stage in one atomic op.
  //    `--index` stages exactly the files in the patch — untracked workspace
  //    files (e.g. .healer/ from subpath-checkout consumers, package-lock.json
  //    from setup_command npm install) are NOT swept into the commit.
  //    Surfaced during 03.1-03 iteration 5 — fix replaces the prior `git apply --3way`
  //    + `git add -A` pair, which had been silently committing arbitrary worktree state.
  const apply = await getExecOutput(
    'git',
    ['apply', '--3way', '--index', patchPath],
    { cwd: args.cwd, ignoreReturnCode: true },
  );
  if (apply.exitCode !== 0) {
    throw new DiffApplyFailure(`git apply failed: ${apply.stderr.trim()}`);
  }

  // 5. Verify the patch actually staged changes. `git apply --3way --index`
  //    exits 0 even when the patch is a no-op (every hunk already matches the
  //    current file state, OR --3way silently reconciled a malformed/path-
  //    mismatched diff to the existing tree). Without this check, the next
  //    `git commit` fails with "nothing to commit, working tree clean" and
  //    exits 1, which surfaces as the opaque "process '/usr/bin/git' failed
  //    with exit code 1" in the consumer's run log.
  //
  //    The thrown message includes the first 800 chars of the normalized diff
  //    so the no-op cause is visible in the filed issue (catch-block route
  //    truncates at 1000 chars).
  const staged = await getExecOutput(
    'git',
    ['diff', '--cached', '--name-only'],
    { cwd: args.cwd, silent: true },
  );
  if (staged.stdout.trim().length === 0) {
    const minusByFile = extractMinusLinesByFile(normalizedDiff);
    const checks: string[] = [];
    for (const [relPath, minusLines] of Object.entries(minusByFile)) {
      const absPath = path.join(args.cwd, relPath);
      if (!existsSync(absPath)) {
        checks.push(`  - ${relPath}: FILE NOT FOUND under cwd (path mismatch)`);
        continue;
      }
      if (minusLines.length === 0) {
        checks.push(`  - ${relPath}: pure-insertion hunk; no '-' lines to verify`);
        continue;
      }
      const content = readFileSync(absPath, 'utf8');
      const present = minusLines.filter((l) => content.includes(l)).length;
      if (present === 0) {
        checks.push(
          `  - ${relPath}: 0/${minusLines.length} '-' lines found in file ` +
            `→ file is ALREADY in the post-state (agent proposed a fix that's already applied)`,
        );
      } else if (present === minusLines.length) {
        checks.push(
          `  - ${relPath}: ${present}/${minusLines.length} '-' lines found in file ` +
            `→ apply should have changed the file (possible diff-normalizer or git-apply bug)`,
        );
      } else {
        checks.push(
          `  - ${relPath}: ${present}/${minusLines.length} '-' lines found (partial match — likely whitespace drift)`,
        );
      }
    }

    const diffPreview = normalizedDiff.slice(0, 500);
    const truncated = normalizedDiff.length > 500 ? ` … (+${normalizedDiff.length - 500} more chars)` : '';
    throw new DiffApplyFailure(
      'git apply succeeded but staged zero changes. Per-file analysis:\n' +
      `${checks.join('\n')}\n` +
      `apply.stdout=${apply.stdout.trim().slice(0, 200) || '<empty>'}\n` +
      `Diff preview:\n${diffPreview}${truncated}`,
    );
  }

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

  // 8. Push the branch with credentials supplied inline via `git -c`.
  //    Uses the same pattern as actions/checkout: an http.extraheader scoped
  //    to this single git invocation. The PAT is base64-encoded in argv (not
  //    plaintext); registered with core.setSecret at startup so the runner
  //    masker redacts any leaked material. Nothing lands in ~/.gitconfig or
  //    .git/config — the config flag is per-process and ignored for file://
  //    remotes (which is why integration tests can pass token: '').
  //
  //    Plain --force (not --force-with-lease) because playwright-healer/* is a
  //    bot-exclusive namespace (fix-applier is the only writer). Lease's
  //    refuse-on-manual-commit safety adds no value, and --force-with-lease
  //    produces "stale info" rejections in shallow clones where the heal
  //    branch wasn't pre-fetched.
  const auth = Buffer.from(`x-access-token:${args.token}`).toString('base64');
  const credentialFlags = args.token
    ? [
        // Empty-value reset clears any persisted extraheader from
        // actions/checkout's default persist-credentials: true; otherwise
        // GitHub rejects with "Duplicate header: Authorization".
        '-c', 'http.https://github.com/.extraheader=',
        '-c', `http.https://github.com/.extraheader=Authorization: basic ${auth}`,
      ]
    : [];
  await exec(
    'git',
    [...credentialFlags, 'push', '--force', 'origin', `HEAD:${branch}`],
    { cwd: args.cwd, silent: true },
  );

  return { branch, commitSha };
}
