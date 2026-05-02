// src/healer/pr-writer.ts
//
// PRI-01 / PRI-02 / PRI-06 / VAL-05 / D-20 / SC-1: open the healer PR via
// @octokit/rest authenticated with the healer_token PAT. Using @actions/github
// is FORBIDDEN here because that path is GITHUB_TOKEN-only — bot-authored PRs
// via GITHUB_TOKEN do not trigger downstream CI (Pitfall 1), making SC-1 vacuous.

import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';
import { SKIP_SENTINEL } from '../shared/loop-guard.js';
import type { ValidationResult } from './validator.js';
import { TEST_PATH_ALLOWLIST } from './forbidden-patterns.js';

// ── Phase 05: auto-merge gate (CONTEXT D-04) ────────────────────────────────
//
// CONFIG_FILE_DENYLIST is the second, stricter overlay on top of TEST_PATH_ALLOWLIST.
// CONTEXT D-03: lives next to the gate (NOT in forbidden-patterns.ts) — that file's
// D-17 single-source-of-truth contract is for diff-lint+prompt-assembler shared
// patterns; auto-merge is a third consumer with different semantics (a heal that
// legitimately patches playwright.config.ts for a waits-class issue should still
// open a PR for human review; only the auto-merge path is forbidden).
//
// Two regexes evaluated separately so the reasoning band can name the matched
// pattern. Extension alternation is constrained to `(ts|js|mjs|cjs)` to prevent
// false positives on unrelated dot-suffixed names (e.g., `playwright.config.foo`).
const CONFIG_FILE_DENYLIST = Object.freeze([
  /(?:^|\/)playwright\.config\.(?:ts|js|mjs|cjs)$/,
  /(?:^|\/)[^/]+\.config\.(?:ts|js|mjs|cjs)$/,
] as const);

export interface AutoMergeCondition {
  condition: 'pass_rate' | 'fix_class' | 'scope' | 'config_files';
  result: 'matched' | 'blocked';
  reason: string; // human-readable rationale for the reasoning band
}

export interface AutoMergeDecision {
  eligible: boolean; // true iff every condition.result === 'matched'
  conditions: readonly AutoMergeCondition[];
}

/**
 * Parse the unified-diff `+++ b/<path>` lines and return the patched-file list.
 * Excludes `/dev/null` (file deletion) and `+++ /dev/null` (literal).
 *
 * Used by `evaluateAutoMerge` (gate scope/config-file checks per D-02 / D-03)
 * AND by `src/healer/index.ts:354` (to compute the `patchedFiles` arg threaded
 * into `openHealerPr`). EXPORTED so index.ts imports rather than duplicating —
 * single source of truth for the parser. Lives in pr-writer.ts since the gate
 * is the primary consumer; index.ts is a one-line caller.
 */
export function extractPatchedFiles(diff: string): string[] {
  const out: string[] = [];
  for (const line of diff.split('\n')) {
    // Match `+++ b/<path>` headers; tolerate trailing whitespace + arbitrary path chars.
    const m = /^\+\+\+\s+b\/(\S.*?)\s*$/.exec(line);
    if (!m) continue;
    const path = m[1];
    if (path === 'dev/null' || path === '/dev/null') continue;
    out.push(path);
  }
  return out;
}

function isInTestPath(filePath: string): boolean {
  return TEST_PATH_ALLOWLIST.some((re) => re.test(filePath));
}

function isConfigFile(filePath: string): boolean {
  return CONFIG_FILE_DENYLIST.some((re) => re.test(filePath));
}

export interface OpenHealerPrArgs {
  patToken: string;
  owner: string;
  repo: string;
  testTitle: string;
  testFile: string;
  defaultBranch: string;
  branch: string;
  rootCause: string;
  // Phase 04 widen: all four v1 fix classes (FIX-07 cascade from adapter.ts).
  fixClass: 'selectors' | 'waits' | 'assertions' | 'slow';
  rationale: string;
  validation: ValidationResult;
  costUsd: number;
  triggeringRunUrl: string;
  traceLink: string | null;
  // ── Phase 05 (Plan 01 — interface widening only; Plan 02 lands the gate logic) ──
  // Auto-merge config from src/shared/config.ts. The fix-classes string is
  // already split-and-trimmed by the index.ts call site; this interface receives
  // the array form so the gate stays a pure function over its inputs.
  enableAutoMerge: boolean;
  autoMergePassRate: number;
  autoMergeFixClasses: string[];
  // Per-heal data: list of files in the agent's diff (extracted from `proposal.diff`
  // via Plan 02's `extractPatchedFiles()` helper). Used by the gate's scope and
  // config-file conditions (CONTEXT D-02 / D-03).
  patchedFiles: string[];
}

export function renderPrBody(args: OpenHealerPrArgs): string {
  // WR-02: when total === 0, post-fix validation was skipped (demo mode).
  // Render an explicit "skipped" message rather than computing 0/0 → 100%
  // which misled reviewers about the heal's evidence.
  let validationLines: string[];
  if (args.validation.total === 0) {
    validationLines = [
      `Pass rate: **skipped (post-fix validation disabled)**`,
      `Cost spent: **$${args.costUsd.toFixed(4)}**`,
    ];
  } else {
    const passPct = (args.validation.passRate * 100).toFixed(0);
    const perRunRow = args.validation.perRun
      .map((r, i) => `| ${i + 1} | ${r.status} | ${r.durationMs}ms |`)
      .join('\n');
    validationLines = [
      `Pass rate: **${passPct}%** (${args.validation.passed}/${args.validation.total} reruns at \`--retries=0\`)`,
      `Cost spent: **$${args.costUsd.toFixed(4)}**`,
      '',
      `| # | Status | Duration |`,
      `| --- | --- | --- |`,
      perRunRow,
    ];
  }

  const lines: string[] = [
    `## Root cause`,
    args.rootCause,
    '',
    `**Fix class:** ${args.fixClass}`,
    `**Test:** \`${args.testTitle}\` (\`${args.testFile}\`)`,
    '',
    `## Rationale`,
    args.rationale,
    '',
    `## Validation`,
    ...validationLines,
    '',
    `## Links`,
    `- [Triggering run](${args.triggeringRunUrl})`,
    args.traceLink ? `- [Playwright trace](${args.traceLink})` : '',
    '',
    `Signed-off: playwright-healer-bot`,
    '',
    SKIP_SENTINEL, // PRI-06 defense-in-depth (loop-guard checks commit msgs; body inclusion is auditable)
  ];

  return lines.filter((l) => l !== '').join('\n');
}

/**
 * PRI-04 dedup query. Returns the first matching open PR or null.
 *
 * Uses `pulls.list({ head: 'owner:branch' })` — the healer branch name is
 * deterministic per (test, sha), so a head filter is exact (Pattern 3).
 * Pitfall 3: the head filter format MUST be `${owner}:${branch}` — bare branch
 * name returns ALL open PRs.
 */
async function findExistingOpenPr(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ number: number; html_url: string } | null> {
  try {
    const { data: prs } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      head: `${owner}:${branch}`, // Pitfall 3: 'user:ref-name' format
      per_page: 1,
    });
    return prs.length > 0 ? { number: prs[0].number, html_url: prs[0].html_url } : null;
  } catch (err) {
    core.warning(
      `PRI-04: dedup query failed for ${owner}:${branch} — ${String(err)}. Proceeding with create.`,
    );
    return null;
  }
}

/**
 * Add a comment to an existing PR. Issues and PRs share the comments API
 * (PRs are issues with extra fields).
 */
async function commentOnPr(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

export async function openHealerPr(args: OpenHealerPrArgs): Promise<string> {
  const octokit = new Octokit({ auth: args.patToken });

  const title = `[playwright-healer] Fix flaky ${args.testTitle}`;
  const body = renderPrBody(args);

  // PRI-04 dedup — query BEFORE create
  const existing = await findExistingOpenPr(octokit, args.owner, args.repo, args.branch);
  if (existing) {
    const commentBody =
      `## Re-trigger evidence\n\n` +
      `${body}\n\n` +
      `_Comment added by Phase 04 PRI-04 dedup; original PR remains open for review._`;
    await commentOnPr(octokit, args.owner, args.repo, existing.number, commentBody);
    await core.summary
      .addRaw(
        `## Healer PR updated (dedup)\n\n[${title}](${existing.html_url})\n\nNew evidence appended as comment.`,
      )
      .write();
    return existing.html_url;
  }

  // No existing — original create path
  const { data: pr } = await octokit.rest.pulls.create({
    owner: args.owner,
    repo: args.repo,
    title,
    head: args.branch,
    base: args.defaultBranch,
    body,
  });

  // D-11 step summary parity (no secrets in summary)
  await core.summary
    .addRaw(`## Healer PR opened\n\n[${title}](${pr.html_url})\n\n${body}`)
    .write();

  return pr.html_url;
}
