// src/shared/types.ts — Shared type definitions for playwright-healer
// Pattern 3: NdjsonRecord + NdjsonTestEntry + Detection
// These are TypeScript interface definitions only — no runtime code.

export interface NdjsonRecord {
  schemaVersion: 1;
  timestamp: string;      // ISO 8601 UTC
  runId: string;          // GITHUB_RUN_ID
  commitSha: string;
  branch: string;
  healerVersion: string;
  shardIndex: number | null;   // null if not sharded; 1-based if sharded
  shardTotal: number | null;
  tests: NdjsonTestEntry[];
}

export interface NdjsonTestEntry {
  testId: string;          // "{filePath}::{title}" — stable cross-run key
  filePath: string;
  title: string;
  outcome: 'passed' | 'failed' | 'flaky' | 'skipped' | 'timed-out' | 'report-unreadable';
  durationMs: number;
  retryCount: number;
  workerIndex: number;
  errorSignature: string | null;
  traceAttachmentPath: string | null;
}

// Detection type (for threshold-evaluator, Pattern 8)
export interface Detection {
  testId: string;
  filePath: string;
  reason: 'flake-rate' | 'slow-regression';
  windowDays: number;
  value: number;
  threshold: number;
  runCount: number;
}

// HealEvent (Phase 04 — Pitfall 7): per-test heal record on the state branch.
// Schema: runs/YYYY/MM/DD-heals.ndjson — sibling of runs/YYYY/MM/DD.ndjson (NdjsonRecord).
// Append-only; same --force-with-lease=playwright-healer-state retry loop.
// Written from THREE sites (state must agree across all):
//   1. src/healer/index.ts Step 11 after openHealerPr returns → outcome 'pr-opened'
//   2. src/healer/index.ts fileIssue helper after openIssue returns → outcome 'issue-opened'
//   3. src/ingest/dispatch.ts cap-hit branch BEFORE skipping dispatch → outcome 'cap-reached'
export interface HealEvent {
  schemaVersion: 1;
  timestamp: string;     // ISO 8601 UTC
  testId: string;        // "{filePath}::{title}" — same key as NdjsonTestEntry.testId
  outcome: 'pr-opened' | 'issue-opened' | 'cap-reached';
  dispatchRunId: string; // GITHUB_RUN_ID at write time
  prUrl?: string;
  issueUrl?: string;
}
