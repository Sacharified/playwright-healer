// src/healer/diff-normalizer.ts
//
// Defensive normalization of agent-emitted unified diffs.
//
// Models — especially OpenAI families on GitHub Models — routinely emit
// "almost-unified" diffs that `git apply` rejects. Two failure modes seen in
// production:
//
//   1. Placeholder hunk headers: `@@ ... @@` with no line numbers at all.
//      gpt-4.1 produced this; `git apply` reports "No valid patches in input."
//
//   2. Mis-counted hunk headers: `@@ -9,7 +9,11 @@` for a hunk that actually
//      has 5 minus + 5 plus body lines. gpt-4.1-mini produced this;
//      `git apply` reports "corrupt patch."
//
// This module rewrites both into a canonical form by:
//   - synthesizing a `diff --git a/<path> b/<path>` line if absent
//   - recomputing each hunk header from the body's actual `-` / `+` / ` `
//     line counts
//   - locating each hunk's old-start line by searching the source file for
//     the first non-`+` body line (which uniquely identifies the position
//     for the single-hunk-per-file replacements typical of selector/wait fixes)
//
// The function is pure and read-only against the workspace; callers should
// invoke it just before writing the patch file in fix-applier.ts.

import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

export class DiffNormalizationFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiffNormalizationFailure';
  }
}

interface FileBlock {
  oldPath: string;            // path after stripping `a/` prefix; '' for new files (`/dev/null`)
  newPath: string;            // path after stripping `b/` prefix
  hunks: HunkBlock[];
}

interface HunkBlock {
  rawHeader: string;          // original `@@ ... @@` line, if any
  body: string[];             // body lines beginning with `-`, `+`, or ` ` (or `\` for "no newline")
}

export function normalizeDiff(rawDiff: string, cwd: string): string {
  const lines = rawDiff.split('\n');
  const blocks = parseBlocks(lines);
  if (blocks.length === 0) {
    throw new DiffNormalizationFailure('Diff contains no `--- a/...` / `+++ b/...` file headers');
  }

  const out: string[] = [];
  for (const block of blocks) {
    out.push(`diff --git a/${block.oldPath || block.newPath} b/${block.newPath || block.oldPath}`);
    out.push(`--- a/${block.oldPath || block.newPath}`);
    out.push(`+++ b/${block.newPath || block.oldPath}`);

    const sourcePath = block.oldPath
      ? path.join(cwd, block.oldPath)
      : null;
    const sourceLines = sourcePath && existsSync(sourcePath)
      ? readFileSync(sourcePath, 'utf8').split('\n')
      : [];

    // Track new-side offset across hunks (sum of prior +N - -N deltas).
    let newOffset = 0;
    for (const hunk of block.hunks) {
      const oldCount = countOldLines(hunk.body);
      const newCount = countNewLines(hunk.body);
      const oldStart = findHunkStart(hunk, sourceLines);
      const newStart = oldStart + newOffset;

      out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
      for (const line of hunk.body) out.push(line);

      newOffset += newCount - oldCount;
    }
  }

  return out.join('\n') + '\n';
}

function parseBlocks(lines: string[]): FileBlock[] {
  const blocks: FileBlock[] = [];
  let current: FileBlock | null = null;
  let currentHunk: HunkBlock | null = null;

  const flushHunk = () => {
    if (currentHunk && current) {
      // Strip trailing blank lines that aren't part of the hunk body.
      while (
        currentHunk.body.length > 0 &&
        currentHunk.body[currentHunk.body.length - 1] === ''
      ) {
        currentHunk.body.pop();
      }
      if (currentHunk.body.length > 0) current.hunks.push(currentHunk);
    }
    currentHunk = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // `--- a/path` opens a new file block; expect `+++ b/path` next non-empty.
    if (line.startsWith('--- ')) {
      flushHunk();
      if (current) blocks.push(current);
      const oldPath = stripFilePrefix(line.slice(4).trim(), 'a/');
      // Look ahead for `+++ `
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const plusLine = lines[j] ?? '';
      if (!plusLine.startsWith('+++ ')) {
        throw new DiffNormalizationFailure(`Expected '+++ b/...' after '--- a/...' at line ${i + 1}`);
      }
      const newPath = stripFilePrefix(plusLine.slice(4).trim(), 'b/');
      current = { oldPath, newPath, hunks: [] };
      i = j;
      continue;
    }

    if (line.startsWith('@@')) {
      flushHunk();
      currentHunk = { rawHeader: line, body: [] };
      continue;
    }

    if (currentHunk) {
      // Valid body line prefixes: '-', '+', ' ' (context), '\' (no-newline marker).
      // Anything else terminates the hunk (e.g. a stray `diff --git`).
      if (line.length === 0 || ' -+\\'.includes(line[0])) {
        currentHunk.body.push(line);
      } else if (line.startsWith('diff --git') || line.startsWith('index ')) {
        flushHunk();
      } else {
        // Unknown body line — be lenient, treat as context. Common when a model
        // emits a trailing prose line; we'll drop it via the trailing-blank flush.
        currentHunk.body.push(line);
      }
    }
    // Otherwise: pre-hunk preamble (`diff --git`, `index ...`, prose) — ignore.
  }
  flushHunk();
  if (current) blocks.push(current);
  return blocks;
}

function stripFilePrefix(p: string, prefix: 'a/' | 'b/'): string {
  if (p === '/dev/null') return '';
  if (p.startsWith(prefix)) return p.slice(prefix.length);
  return p;
}

function countOldLines(body: string[]): number {
  return body.filter((l) => l.startsWith('-') || l.startsWith(' ')).length;
}

function countNewLines(body: string[]): number {
  return body.filter((l) => l.startsWith('+') || l.startsWith(' ')).length;
}

/**
 * Determine the 1-indexed start line of the hunk in the OLD file.
 *
 * If the model gave a parseable `@@ -L,N` we trust L. Otherwise we locate the
 * first non-`+` body line (a removed or context line) in the source and use
 * its 1-indexed line number. If the hunk has only `+` lines (pure insertion
 * with no context), we default to 1 — `git apply --3way` will use fuzzy
 * positioning to land it.
 */
function findHunkStart(hunk: HunkBlock, sourceLines: string[]): number {
  const explicit = parseExplicitOldStart(hunk.rawHeader);
  if (explicit !== null) return explicit;

  if (sourceLines.length === 0) return 1;

  const firstAnchor = hunk.body.find(
    (l) => l.startsWith('-') || l.startsWith(' '),
  );
  if (!firstAnchor) return 1;

  const needle = firstAnchor.slice(1); // drop leading '-' or ' '
  for (let i = 0; i < sourceLines.length; i++) {
    if (sourceLines[i] === needle) return i + 1;
  }
  // Fallback: if exact match fails (whitespace drift), match the first
  // trimmed non-empty line against trimmed source.
  const trimmedNeedle = needle.trim();
  if (trimmedNeedle.length > 0) {
    for (let i = 0; i < sourceLines.length; i++) {
      if (sourceLines[i].trim() === trimmedNeedle) return i + 1;
    }
  }
  throw new DiffNormalizationFailure(
    `Could not locate hunk anchor in source: ${needle.slice(0, 80)}`,
  );
}

function parseExplicitOldStart(header: string): number | null {
  // Match a real `@@ -<num>[,<num>] +...` form. Reject placeholder `@@ ... @@`.
  const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!m) return null;
  return Number(m[1]);
}
