// src/shared/loop-guard.ts — SEC-05 loop guard
// Prevents playwright-healer commits from triggering infinite ingest loops.
// Phase 02 checks only guards 0, 1, 2. Guard 3 (per-test heal cap) is Phase 04.
//
// Critical: use optional chaining (?.} throughout — head_commit is undefined on
// non-push events (workflow_call, pull_request) — Pitfall D.

import * as core from '@actions/core';
import * as github from '@actions/github';

export const BOT_EMAIL = 'playwright-healer-bot@users.noreply.github.com';
export const BOT_NAME = 'playwright-healer-bot';
export const SKIP_SENTINEL = '[skip-healer]';

/**
 * Returns true if the current GitHub Actions event should be skipped by ingest.
 *
 * Guard 0: fork PR — payload.pull_request?.head?.repo?.fork === true
 * Guard 1: bot author email — payload.head_commit?.author?.email === BOT_EMAIL
 * Guard 2: commit message — payload.head_commit?.message?.includes(SKIP_SENTINEL)
 */
export function shouldSkipIngest(): boolean {
  const payload = github.context.payload;

  // Guard 0: Skip on fork PRs — fork repo cannot forge push payload author email,
  // but we exit before any write operations as a defense-in-depth measure.
  if (payload.pull_request?.head?.repo?.fork === true) {
    core.info('SEC-05 Guard 0: Skipping ingest — fork PR detected');
    return true;
  }

  // Guard 1: Skip if the commit was authored by the healer bot itself.
  // Uses optional chaining because head_commit is undefined on non-push events.
  if (payload.head_commit?.author?.email === BOT_EMAIL) {
    core.info(`SEC-05 Guard 1: Skipping ingest — bot-authored commit detected (${BOT_EMAIL})`);
    return true;
  }

  // Guard 2: Skip if the commit message contains the explicit skip sentinel.
  // Provides an escape hatch for maintainers who want to suppress a run.
  if (payload.head_commit?.message?.includes(SKIP_SENTINEL)) {
    core.info(`SEC-05 Guard 2: Skipping ingest — commit message contains '${SKIP_SENTINEL}'`);
    return true;
  }

  return false;
}
