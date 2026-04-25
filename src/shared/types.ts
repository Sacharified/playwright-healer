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
