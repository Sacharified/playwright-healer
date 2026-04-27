// src/healer/pr-writer.ts
//
// PRI-01 / PRI-02 / PRI-06 / VAL-05 / D-20 / SC-1: open the healer PR via
// @octokit/rest authenticated with the healer-token PAT. Using @actions/github
// is FORBIDDEN here because that path is GITHUB_TOKEN-only — bot-authored PRs
// via GITHUB_TOKEN do not trigger downstream CI (Pitfall 1), making SC-1 vacuous.

import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';
import { SKIP_SENTINEL } from '../shared/loop-guard.js';
import type { ValidationResult } from './validator.js';

export interface OpenHealerPrArgs {
  patToken: string;
  owner: string;
  repo: string;
  testTitle: string;
  testFile: string;
  defaultBranch: string;
  branch: string;
  rootCause: string;
  fixClass: 'selectors' | 'waits';
  rationale: string;
  validation: ValidationResult;
  costUsd: number;
  triggeringRunUrl: string;
  traceLink: string | null;
}

export function renderPrBody(args: OpenHealerPrArgs): string {
  const passPct = (args.validation.passRate * 100).toFixed(0);
  const perRunRow = args.validation.perRun
    .map((r, i) => `| ${i + 1} | ${r.status} | ${r.durationMs}ms |`)
    .join('\n');

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
    `Pass rate: **${passPct}%** (${args.validation.passed}/${args.validation.total} reruns at \`--retries=0\`)`,
    `Cost spent: **$${args.costUsd.toFixed(4)}**`,
    '',
    `| # | Status | Duration |`,
    `| --- | --- | --- |`,
    perRunRow,
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

export async function openHealerPr(args: OpenHealerPrArgs): Promise<string> {
  const octokit = new Octokit({ auth: args.patToken });

  const title = `[playwright-healer] Fix flaky ${args.testTitle}`;
  const body = renderPrBody(args);

  const { data: pr } = await octokit.pulls.create({
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
