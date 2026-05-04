// src/shared/loop-guard.ts — SEC-05 loop guard
// Prevents playwright-healer commits from triggering infinite ingest loops.
// Phase 02 checks only guards 0, 1, 2. Guard 3 (per-test heal cap) is Phase 04.
//
// Critical: use optional chaining (?.} throughout — head_commit is undefined on
// non-push events (workflow_call, pull_request) — Pitfall D.

import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

/**
 * SEC-05 Guard 3 (Phase 04, NEW per RESEARCH Pitfall 6).
 *
 * Counts heal events for a given testId within the rolling window. Reads
 * runs/YYYY/MM/DD-heals.ndjson on the state branch (written by appendHealEvent).
 * Pure I/O — no git calls. Caller must hold a state-branch worktree.
 *
 * Used by:
 *   - Ingest D-04 cheap pre-dispatch gate (src/ingest/dispatch.ts)
 *   - Healer Guard 3 backstop (src/healer/index.ts Step 1.5)
 *
 * NOTE: synchronous file I/O is fine here — the loop walks ≤ flakeWindowDays
 * files, each typically <1KB. Async would add complexity without throughput benefit.
 */
export function countHealsForTest(
  testId: string,
  windowDays: number,
  worktreePath: string,
): number {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  let count = 0;
  for (let daysBack = 0; daysBack <= windowDays; daysBack++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - daysBack);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const filePath = path.join(worktreePath, 'runs', String(y), m, `${day}-heals.ndjson`);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line) as { testId: string; timestamp: string };
        if (ev.testId === testId && new Date(ev.timestamp).getTime() >= cutoff) {
          count += 1;
        }
      } catch {
        // Pitfall B resilience: malformed line skipped silently
      }
    }
  }
  return count;
}

/**
 * Healer-side SEC-05 Guard 3 backstop. Returns { skip, count }.
 * Caller files a `cap-exceeded` issue when skip === true.
 */
export function shouldSkipHeal(
  testId: string,
  config: { maxHealsPerTestPerWeek: number; flakeWindowDays: number },
  worktreePath: string,
): { skip: boolean; count: number } {
  const count = countHealsForTest(testId, config.flakeWindowDays, worktreePath);
  if (count >= config.maxHealsPerTestPerWeek) {
    core.info(
      `SEC-05 Guard 3: per-test heal cap reached for "${testId}" (${count} >= ${config.maxHealsPerTestPerWeek})`,
    );
  }
  return { skip: count >= config.maxHealsPerTestPerWeek, count };
}
