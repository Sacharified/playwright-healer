// src/healer/issue-writer.ts
//
// PRI-03 / D-09 / D-10: open a structured GitHub issue when no PR is possible.
// Title format LOCKED: `[playwright-healer] <test title> is unhealable`.
// Body opens with `## Failure mode` containing one of six exact tokens (D-09).
// Phase 4 PRI-04 dedup will match against title + failure-mode token.

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

export async function openIssue(args: OpenIssueArgs): Promise<string> {
  const octokit = new Octokit({ auth: args.patToken });
  const title = `[playwright-healer] ${args.testTitle} is unhealable`;
  const body = renderIssueBody(args);

  const { data: issue } = await octokit.issues.create({
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
