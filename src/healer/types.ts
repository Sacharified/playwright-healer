// src/healer/types.ts
// Shared types for the heal pipeline. ContextBundle is produced by context-bundler
// and consumed by adapters; FailureMode tokens are LOCKED per CONTEXT D-09 — issue
// titles + Phase 4 PRI-04 dedup match against these exact strings.

export interface ContextBundle {
  testFile: string;                        // path relative to repo root
  testTitle: string;                       // exact title from dispatch payload
  testFileSource: string;                  // full text of failing test file
  firstHopImports: Record<string, string>; // path → file source for one-hop relative imports (HEA-04)
  gitBlame: string;                        // raw `git blame -p` output for testFile
  traceAttachmentPath: string | null;      // null when trace.zip missing or expired (drives D-07 prompt variant)
  recentErrorMessages: string[];           // last N error messages from dispatch payload's recentRunStats or empty
}

export type FailureMode =
  | 'app-startup-timeout'
  | 'agent-budget-exhausted'
  | 'no-fix-proposable'
  | 'diff-lint-blocked'
  | 'validation-failed'
  | 'deterministic-failure';
