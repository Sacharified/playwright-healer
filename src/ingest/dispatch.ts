// src/ingest/dispatch.ts
// DET-05/06/07: Phase 04 ingest-side workflow_dispatch wrapper.
// Reuses the @octokit/rest + healer_token PAT pattern from src/healer/pr-writer.ts:67.
//
// CRITICAL: this file MUST NOT use @actions/github's built-in client — that is
// GITHUB_TOKEN-only and bot-dispatched workflows would not trigger downstream CI
// (Pitfall 1 / SC-1, also documented at pr-writer.ts:3-7).
//
// T-04-01: core.info and core.summary lines surface test ID + class hint only —
// args.patToken flows through Octokit constructor argv only, never into a log call.
// T-04-04: testFile/testTitle treated as untrusted strings — slugged before reaching
// the workflow concurrency.group expression; SHA-1 for collision resistance.

import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';
import { createHash } from 'node:crypto';
import type { Detection } from '../shared/types.js';

// Pitfall 1: GitHub caps each workflow_dispatch input at 1024 chars; safety margin.
const MAX_INPUT_LEN = 1000;

export interface FireDispatchArgs {
  patToken:       string;
  owner:          string;
  repo:           string;
  workflowFile:   string;    // 'playwright-healer.yml' default; configurable via action input
  ref:            string;    // default branch — workflow_dispatch requires a ref (Pitfall 2)
  detection:      Detection;
  commitSha:      string;
  fixClassHint:   'selectors' | 'waits' | 'assertions' | 'slow';
  flakeRate:      number;
  windowDays:     number;
  runCount:       number;
  concurrencyKey: string;
}

/**
 * Fire a workflow_dispatch event to the healer workflow.
 * Authenticates via the healer_token PAT (DET-06).
 * Validates all 8 inputs are within the GitHub length cap before firing (Pitfall 1).
 */
export async function fireDispatch(args: FireDispatchArgs): Promise<void> {
  // Parse testFile + testTitle from testId ("filePath::title")
  const colonIndex = args.detection.testId.indexOf('::');
  const testFile  = colonIndex >= 0 ? args.detection.testId.slice(0, colonIndex) : args.detection.testId;
  const testTitle = colonIndex >= 0 ? args.detection.testId.slice(colonIndex + 2) : '';

  // Build the 8 flat string inputs (workflow_dispatch only accepts strings)
  const inputs: Record<string, string> = {
    commitSha:      args.commitSha,
    testFile,
    testTitle,
    fixClassHint:   args.fixClassHint,
    flakeRate:      String(args.flakeRate),
    windowDays:     String(args.windowDays),
    runCount:       String(args.runCount),
    concurrencyKey: args.concurrencyKey,
  };

  // Pitfall 1 pre-check — refuse to fire a dispatch with over-length inputs
  for (const [k, v] of Object.entries(inputs)) {
    if (v.length > MAX_INPUT_LEN) {
      core.warning(
        `playwright-healer: dispatch input "${k}" exceeds ${MAX_INPUT_LEN} chars (${v.length}); ` +
        `skipping dispatch for "${args.detection.testId}"`,
      );
      return;
    }
  }

  // DET-06: authenticate with the healer_token PAT, not GITHUB_TOKEN
  const octokit = new Octokit({ auth: args.patToken });

  await octokit.rest.actions.createWorkflowDispatch({
    owner:       args.owner,
    repo:        args.repo,
    workflow_id: args.workflowFile,
    ref:         args.ref,
    inputs,
  });

  core.info(
    `Phase 04: dispatched heal for "${testTitle}" (${testFile}) — fixClassHint=${args.fixClassHint}`,
  );

  // T-04-01: summary never includes args.patToken
  await core.summary
    .addRaw(
      `## Heal dispatched (DET-05)\n\n` +
      `- **Test:** \`${testTitle}\`\n` +
      `- **File:** \`${testFile}\`\n` +
      `- **Class hint:** ${args.fixClassHint}\n` +
      `- **Concurrency key:** \`${args.concurrencyKey}\`\n`,
    )
    .write();
}

/**
 * Build a deterministic concurrency-group key per (testFile, testTitle).
 *
 * Format: `<file-slug-≤40>-<title-slug-≤40>-<sha1-8>`
 * Maximum length: 40 + 1 + 40 + 1 + 8 = 90 chars (well under 250).
 *
 * SHA-1 component (Pitfall 5): preserves uniqueness for case-variant titles whose
 * slug collapses to the same string after lowercasing (e.g. 'Login Flow' vs
 * 'login flow' → same slug but different SHA-1).
 *
 * T-04-04: slug fn lowercases + replaces non-alphanumeric chars with '-' BEFORE
 * the hash, neutralizing expression-injection via `${{ ... }}` in test titles.
 */
export function buildConcurrencyKey(testFile: string, testTitle: string): string {
  const fileSlug  = slug(testFile, 40);
  const titleSlug = slug(testTitle, 40);
  const hash = createHash('sha1')
    .update(`${testFile}::${testTitle}`)
    .digest('hex')
    .slice(0, 8);
  return `${fileSlug}-${titleSlug}-${hash}`;
}

/** Lowercase, replace non-alphanumeric runs with '-', trim leading/trailing '-', truncate. */
function slug(s: string, maxLen: number): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}
