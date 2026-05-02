// src/healer/pr-writer.ts
//
// PRI-01 / PRI-02 / PRI-06 / VAL-05 / D-20 / SC-1: open the healer PR via
// @octokit/rest authenticated with the healer_token PAT. Using @actions/github
// is FORBIDDEN here because that path is GITHUB_TOKEN-only — bot-authored PRs
// via GITHUB_TOKEN do not trigger downstream CI (Pitfall 1), making SC-1 vacuous.

import { Octokit } from '@octokit/rest';
import { GraphqlResponseError } from '@octokit/graphql';
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

export interface EvaluateAutoMergeArgs {
  validation: ValidationResult;        // from src/healer/validator.ts
  autoMergePassRate: number;           // 0..1, parsed from config (Plan 01)
  fixClass: 'selectors' | 'waits' | 'assertions' | 'slow';
  autoMergeFixClasses: string[];       // already split + trimmed (Plan 01 schema produces string; index.ts splits)
  patchedFiles: string[];              // from extractPatchedFiles(proposal.diff)
}

/**
 * Pure function — produces an AutoMergeDecision over four conditions.
 * NEVER calls any IO. Ordered: pass_rate, fix_class, scope, config_files.
 *
 * eligible iff every condition.result === 'matched'.
 *
 * Empty patchedFiles[] is treated as vacuously matched on scope+config_files
 * (RESEARCH §"Empty patchedFiles[] outcome"). In practice this branch is unreachable
 * because the gate fires post-pulls.create which only succeeds with a non-empty diff;
 * the explicit handling is defensive against future call-site changes.
 */
export function evaluateAutoMerge(args: EvaluateAutoMergeArgs): AutoMergeDecision {
  const conditions: AutoMergeCondition[] = [];

  // 1. pass_rate (D-07 — total > 0 AND passRate >= threshold)
  if (args.validation.total === 0) {
    conditions.push({ condition: 'pass_rate', result: 'blocked', reason: 'validation skipped (demo mode)' });
  } else if (args.validation.passRate >= args.autoMergePassRate) {
    const thresholdStr = args.autoMergePassRate.toString();
    conditions.push({
      condition: 'pass_rate',
      result: 'matched',
      reason: `${args.validation.passed}/${args.validation.total} passed (≥ ${thresholdStr})`,
    });
  } else {
    const observedPct = (args.validation.passRate * 100).toFixed(0);
    const thresholdPct = (args.autoMergePassRate * 100).toFixed(0);
    conditions.push({
      condition: 'pass_rate',
      result: 'blocked',
      reason: `pass rate ${observedPct}% < ${thresholdPct}%`,
    });
  }

  // 2. fix_class (MRG-02)
  if (args.autoMergeFixClasses.includes(args.fixClass)) {
    conditions.push({
      condition: 'fix_class',
      result: 'matched',
      reason: `${args.fixClass} in allow-list (${args.autoMergeFixClasses.join(', ') || 'empty'})`,
    });
  } else {
    conditions.push({
      condition: 'fix_class',
      result: 'blocked',
      reason: `${args.fixClass} not in allow-list (${args.autoMergeFixClasses.join(', ') || 'empty'})`,
    });
  }

  // 3. scope (D-02)
  const offendingPath = args.patchedFiles.find((p) => !isInTestPath(p));
  if (offendingPath) {
    conditions.push({
      condition: 'scope',
      result: 'blocked',
      reason: `files outside test directory (${offendingPath})`,
    });
  } else {
    conditions.push({
      condition: 'scope',
      result: 'matched',
      reason: 'all patched files in tests/, e2e/, or playwright/',
    });
  }

  // 4. config_files (D-03)
  const configHit = args.patchedFiles.find(isConfigFile);
  if (configHit) {
    conditions.push({
      condition: 'config_files',
      result: 'blocked',
      reason: `configuration file change (${configHit})`,
    });
  } else {
    conditions.push({
      condition: 'config_files',
      result: 'matched',
      reason: 'no config files patched',
    });
  }

  const eligible = conditions.every((c) => c.result === 'matched');
  return { eligible, conditions };
}

// ── Phase 05: GraphQL enablePullRequestAutoMerge wrapper (MRG-03) ───────────

const ENABLE_AUTO_MERGE_MUTATION = /* GraphQL */ `
  mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
    enablePullRequestAutoMerge(input: {
      pullRequestId: $pullRequestId,
      mergeMethod: $mergeMethod
    }) {
      pullRequest {
        autoMergeRequest {
          enabledAt
          mergeMethod
        }
      }
    }
  }
`;

interface EnableAutoMergeResponse {
  enablePullRequestAutoMerge: {
    pullRequest: { autoMergeRequest: { enabledAt: string; mergeMethod: 'SQUASH' | 'MERGE' | 'REBASE' } };
  };
}

export interface EnableAutoMergeResult {
  /** Populated on success. ISO-8601 timestamp from GitHub. */
  enabledAt?: string;
  /** Populated on failure (D-05 soft-fail). Joined GraphQL error messages or stringified non-GraphQL exception. */
  errorMessage?: string;
}

/**
 * Enable auto-merge on a PR via GitHub's GraphQL `enablePullRequestAutoMerge` mutation.
 *
 * D-05 soft-fail: catches BOTH `GraphqlResponseError` (mutation rejected — typically due
 * to missing branch protection / "Allow auto-merge" toggle off / squash merging not
 * enabled at repo level) AND any other thrown error (network, timeout, etc.). Returns
 * a result object instead of throwing — heal pipeline never aborts on auto-merge
 * failures (PR is already open and useful for human review).
 *
 * Mutation called WITHOUT commitHeadline/commitBody — repo defaults apply, which means
 * the squash commit reuses the PR body and KEEPS the loop-guard SKIP_SENTINEL (T-05-06).
 */
export async function enableAutoMerge(
  octokit: Octokit,
  prNodeId: string,
): Promise<EnableAutoMergeResult> {
  try {
    const data = await octokit.graphql<EnableAutoMergeResponse>(ENABLE_AUTO_MERGE_MUTATION, {
      pullRequestId: prNodeId,
      mergeMethod: 'SQUASH',
    });
    return { enabledAt: data.enablePullRequestAutoMerge.pullRequest.autoMergeRequest.enabledAt };
  } catch (err) {
    if (err instanceof GraphqlResponseError) {
      const messages = (err.errors ?? []).map((e) => e.message).filter(Boolean);
      const summary = messages.length > 0 ? messages.join('; ') : err.message;
      return { errorMessage: summary };
    }
    return { errorMessage: `Auto-merge enable failed: ${String(err)}` };
  }
}

// ── Phase 05: Reasoning-band renderer (MRG-04) ──────────────────────────────

/**
 * Render the reasoning band markdown — string[] of lines for joining into core.summary.
 *
 * MRG-04: emit per-condition table + final outcome row. The band ALWAYS renders when a
 * PR is created (D-09), regardless of `enableAutoMerge` flag value, so consumers can
 * preview eligibility before flipping the flag on (matches Phase 04 D-01 log-only-then-live
 * pattern).
 */
export function renderAutoMergeBand(
  decision: AutoMergeDecision,
  enabledFlag: boolean,
  enableResult: EnableAutoMergeResult | null,
): string[] {
  const tableHead = ['| Condition | Result | Reason |', '| --- | --- | --- |'];
  const rows = decision.conditions.map(
    (c) => `| ${c.condition} | ${c.result} | ${c.reason} |`,
  );

  let outcomeRow: string;
  if (!enabledFlag) {
    const outcome = decision.eligible ? 'eligible' : 'blocked';
    outcomeRow = `| auto_merge | ${outcome} | enable_auto_merge=false (informational only) |`;
  } else if (!decision.eligible) {
    outcomeRow = `| auto_merge | blocked | one or more conditions failed |`;
  } else if (enableResult?.errorMessage) {
    outcomeRow = `| auto_merge | blocked | ${enableResult.errorMessage} — see README §auto-merge-prerequisites |`;
  } else if (enableResult?.enabledAt) {
    outcomeRow = `| auto_merge | enabled | mutation succeeded at ${enableResult.enabledAt} |`;
  } else {
    // Defensive — shouldn't reach here in normal flow
    outcomeRow = `| auto_merge | unknown | gate state inconsistent |`;
  }

  return ['## Auto-merge decision', '', ...tableHead, ...rows, outcomeRow, ''];
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

  // ── Phase 05: auto-merge gate (CONTEXT D-04 / D-08 — only on no-existing-PR path) ──
  const decision = evaluateAutoMerge({
    validation: args.validation,
    autoMergePassRate: args.autoMergePassRate,
    fixClass: args.fixClass,
    autoMergeFixClasses: args.autoMergeFixClasses,
    patchedFiles: args.patchedFiles,
  });

  let enableResult: EnableAutoMergeResult | null = null;
  if (args.enableAutoMerge && decision.eligible) {
    if (!pr.node_id) {
      // Defensive: openapi-types says node_id is `string | undefined`. In practice
      // GitHub always populates it, but guard so the gate degrades to soft-fail
      // rather than throwing a TypeError on the mutation call.
      enableResult = { errorMessage: 'PR creation succeeded but node_id missing — cannot enable auto-merge' };
      core.warning(
        'Auto-merge enable skipped: PR creation succeeded but node_id missing — cannot enable auto-merge.',
      );
    } else {
      enableResult = await enableAutoMerge(octokit, pr.node_id);
      if (enableResult.errorMessage) {
        core.warning(
          `Auto-merge enable failed: ${enableResult.errorMessage} — leaving PR open for review. see README §auto-merge-prerequisites.`,
        );
      }
    }
  }

  const bandLines = renderAutoMergeBand(decision, args.enableAutoMerge, enableResult);

  // D-11 step summary parity (no secrets in summary)
  await core.summary
    .addRaw(`## Healer PR opened\n\n[${title}](${pr.html_url})\n\n${body}\n\n${bandLines.join('\n')}`)
    .write();

  return pr.html_url;
}
