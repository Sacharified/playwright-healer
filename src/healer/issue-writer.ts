// src/healer/issue-writer.ts
//
// PRI-03 / D-09 / D-10: open a structured GitHub issue when no PR is possible.
// Title format LOCKED: `[playwright-healer] <test title> is unhealable`.
// Body opens with `## Failure mode` containing one of six exact tokens (D-09).
// Phase 4 PRI-04 dedup matches against title + failure-mode token.

import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';
import type { FailureMode } from './types.js';

export interface OpenIssueArgs {
  patToken: string;
  owner: string;
  repo: string;
  testTitle: string;
  failureMode: FailureMode;
  rootCause: string;
  reproSteps: string;
  suggestedManualFix: string;
  triggeringRunUrl: string;
}

export function renderIssueBody(args: OpenIssueArgs): string {
  return [
    `## Failure mode`,
    '',
    '`' + args.failureMode + '`',
    '',
    `## Root cause`,
    args.rootCause,
    '',
    `## Reproduction`,
    args.reproSteps,
    '',
    `## Suggested manual fix`,
    args.suggestedManualFix,
    '',
    `[Triggering run](${args.triggeringRunUrl})`,
  ].join('\n');
}

/**
 * PRI-04 dedup query for issues. Returns the first matching open issue or null.
 *
 * Issues are not branch-tied — title + failureMode body token is the dedup key.
 * Search API requires `is:issue` or `is:pull-request` qualifier (Pitfall 4 —
 * HTTP 422 without it). Title format is locked per D-09:
 *   `[playwright-healer] <test title> is unhealable`
 * Body contains `\`<failureMode>\`` (backticked) under "## Failure mode" header
 * (see renderIssueBody above). Per RESEARCH §"PRI-04 State Matrix":
 *   "Open issue for same test, different failureMode → Create new issue"
 * The `in:body` qualifier scopes the failureMode token search to the issue body.
 */
async function findExistingOpenIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  testTitle: string,
  failureMode: FailureMode,
): Promise<{ number: number; html_url: string } | null> {
  // Sanitize testTitle for the search expression — escape embedded double-quotes
  // (Octokit doesn't auto-escape inside `q:`). Worst case: an untrusted title with
  // a `"` would cause the search to match more issues than intended; the dedup is
  // best-effort, so this falls through to create which then "succeeds" by creating
  // a duplicate. T-04-04 mitigation. failureMode is a typed enum (FailureMode union),
  // so it's safe-by-construction — no need to escape.
  const safeTitle = testTitle.replace(/"/g, '');
  // Compose failureMode into the query so issues with the SAME test but DIFFERENT
  // failureMode get a new issue (matches RESEARCH State Matrix row 6). The
  // failureMode token is rendered as `\`<token>\`` in the body; the search
  // matches the bare token via `in:body`.
  const q = `repo:${owner}/${repo} is:issue is:open in:title "[playwright-healer]" "${safeTitle}" "is unhealable" in:body "${failureMode}"`;
  try {
    const { data } = await octokit.rest.search.issuesAndPullRequests({ q, per_page: 1 });
    return data.items.length > 0
      ? { number: data.items[0].number, html_url: data.items[0].html_url }
      : null;
  } catch (err) {
    core.warning(
      `PRI-04: issue dedup query failed for "${testTitle}" (failureMode=${failureMode}) — ${String(err)}. Proceeding with create.`,
    );
    return null;
  }
}

async function commentOnIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

export async function openIssue(args: OpenIssueArgs): Promise<string> {
  const octokit = new Octokit({ auth: args.patToken });
  const title = `[playwright-healer] ${args.testTitle} is unhealable`;
  const body = renderIssueBody(args);

  // PRI-04 dedup — query BEFORE create. Pass failureMode so issues for the same
  // test with different failureModes (e.g., agent-budget-exhausted vs validation-failed)
  // get a fresh issue rather than colliding (RESEARCH §PRI-04 State Matrix).
  const existing = await findExistingOpenIssue(
    octokit,
    args.owner,
    args.repo,
    args.testTitle,
    args.failureMode,
  );
  if (existing) {
    const commentBody =
      `## Re-trigger evidence (failureMode: \`${args.failureMode}\`)\n\n` +
      `${body}\n\n` +
      `_Comment added by Phase 04 PRI-04 dedup; original issue remains open._`;
    await commentOnIssue(octokit, args.owner, args.repo, existing.number, commentBody);
    await core.summary
      .addRaw(
        `## Healer issue updated (dedup)\n\n[${title}](${existing.html_url})\n\nNew evidence appended as comment.`,
      )
      .write();
    return existing.html_url;
  }

  // No existing — original create path
  const { data: issue } = await octokit.rest.issues.create({
    owner: args.owner,
    repo: args.repo,
    title,
    body,
  });

  await core.summary
    .addRaw(`## Healer issue opened\n\n[${title}](${issue.html_url})\n\n${body}`)
    .write();

  return issue.html_url;
}
