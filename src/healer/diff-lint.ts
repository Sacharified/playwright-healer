// src/healer/diff-lint.ts
// Defense-in-depth FIX-06: scan a unified-diff string for forbidden patterns.
// Pure function — no @actions/core, no IO, no exceptions for control flow.
// Returns LintFinding[]; empty array means the diff is clean.
//
// Patterns are imported from forbidden-patterns.ts (D-17 single source of truth).
// Same constants drive prompt-assembler.ts forbidden-list injection.

import {
  FORBIDDEN_PATCHED_LINE_PATTERNS,
  ASSERTION_WEAKENING_PAIRS,
  TEST_PATH_ALLOWLIST,
} from './forbidden-patterns.js';

export interface LintFinding {
  pattern: string;       // matches the `name` field of the failed pattern
  filePath: string;      // file path from the diff header (+++ b/...)
  hunkLine: number;      // 1-based line number within the patch (0 for file-level findings)
  excerpt: string;       // the offending line text
}

export function lintDiff(unifiedDiff: string): LintFinding[] {
  if (!unifiedDiff) return [];

  const findings: LintFinding[] = [];
  const lines = unifiedDiff.split('\n');

  // Track state across lines
  let currentFilePath = '';
  let hunkLineNum = 0;

  // Per-hunk accumulation for assertion-weakening detection
  let hunkRemovedLines: string[] = [];
  let hunkAddedLines: string[] = [];

  // Track which file paths have added lines (for allowlist check)
  // Map from filePath → set of hunk line numbers (for reporting)
  const fileHasAddedLines = new Map<string, number>();

  // Flush hunk: check ASSERTION_WEAKENING_PAIRS against accumulated hunk lines
  function flushHunk(): void {
    for (const pair of ASSERTION_WEAKENING_PAIRS) {
      const removedMatches = hunkRemovedLines.some((l) => pair.from.test(l));
      const addedMatches = hunkAddedLines.some((l) => pair.to.test(l));
      if (removedMatches && addedMatches) {
        // Determine name from the pair: encode as 'from-to' pattern name
        // We pick the matching `to` line as the finding excerpt
        const excerptLine = hunkAddedLines.find((l) => pair.to.test(l)) ?? '';
        // Construct a descriptive pattern name from the regex sources
        const fromSrc = pair.from.source.replace(/\\/g, '').replace(/\s\*/g, '');
        const toSrc = pair.to.source.replace(/\\/g, '').replace(/\s\*/g, '');
        const patternName = `${fromSrc.replace(/^\./,'').replace(/\s*\($/,'')}-to-${toSrc.replace(/^\./,'').replace(/\s*\($/,'')}`;
        findings.push({
          pattern: patternName,
          filePath: currentFilePath,
          hunkLine: hunkLineNum,
          excerpt: excerptLine,
        });
      }
    }
    hunkRemovedLines = [];
    hunkAddedLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    hunkLineNum = i + 1;

    // 1. Detect file header: +++ b/<path>
    if (line.startsWith('+++ ')) {
      // Flush previous hunk before switching files
      flushHunk();

      // Extract path after "+++ b/" or "+++ " (some diffs omit the "b/" prefix)
      const raw = line.slice(4);
      if (raw === '/dev/null') {
        currentFilePath = '/dev/null';
      } else if (raw.startsWith('b/')) {
        currentFilePath = raw.slice(2);
      } else {
        currentFilePath = raw;
      }
      continue;
    }

    // 2. Detect hunk header: @@ ... @@
    if (line.startsWith('@@ ')) {
      // Flush previous hunk state
      flushHunk();
      continue;
    }

    // 3. Skip --- header lines (before-file indicator)
    if (line.startsWith('--- ')) {
      continue;
    }

    // 4. Process added lines (+): check forbidden patterns
    if (line.startsWith('+')) {
      const content = line.slice(1); // strip leading '+'
      hunkAddedLines.push(content);

      // Track that this file has added lines (for allowlist check)
      if (currentFilePath && currentFilePath !== '/dev/null') {
        if (!fileHasAddedLines.has(currentFilePath)) {
          fileHasAddedLines.set(currentFilePath, hunkLineNum);
        }
      }

      // Check each forbidden pattern against the added line content
      for (const entry of FORBIDDEN_PATCHED_LINE_PATTERNS) {
        if (entry.re.test(content)) {
          findings.push({
            pattern: entry.name,
            filePath: currentFilePath,
            hunkLine: hunkLineNum,
            excerpt: line,
          });
        }
      }
      continue;
    }

    // 5. Process removed lines (-): accumulate for weakening check
    if (line.startsWith('-')) {
      const content = line.slice(1); // strip leading '-'
      hunkRemovedLines.push(content);
      continue;
    }
  }

  // Flush final hunk
  flushHunk();

  // 4. Path allowlist check: for each file with added lines, verify it's in the allowlist
  for (const [filePath, firstHunkLine] of fileHasAddedLines) {
    const allowed = TEST_PATH_ALLOWLIST.some((re) => re.test(filePath));
    if (!allowed) {
      findings.push({
        pattern: 'out-of-test-dir',
        filePath,
        hunkLine: firstHunkLine,
        excerpt: `+++ b/${filePath}`,
      });
    }
  }

  return findings;
}
