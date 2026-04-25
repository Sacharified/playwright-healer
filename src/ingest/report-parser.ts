// src/ingest/report-parser.ts — Playwright JSON report → NdjsonTestEntry[]
//
// ING-01: Accepts already-parsed JSON (the caller resolves file paths via glob)
// ING-02: Extracts all 9 NdjsonTestEntry fields from the Playwright report
// ING-03: Graceful degrade — unrecognized shape returns { entries: [], reportUnreadable: true }
// ING-04: Shard metadata lives on NdjsonRecord (set by caller), NOT on individual entries
//
// IMPORTANT: test.status values are 'expected' | 'unexpected' | 'flaky' | 'skipped'
// NOT 'passed' | 'failed' — mapOutcome() converts these to our canonical outcome values.

import { z } from 'zod';
import * as core from '@actions/core';
import type { NdjsonTestEntry } from '../shared/types.js';

// Minimal shape validation — deep walk is manual (z.array(z.any()) for flexibility)
const ReportSchema = z.object({
  config: z.object({ rootDir: z.string() }).optional(),
  suites: z.array(z.any()),
  stats: z.object({ startTime: z.string(), duration: z.number() }).optional(),
});

type Outcome = NdjsonTestEntry['outcome'];

/**
 * Convert Playwright test.status to our canonical outcome.
 * Playwright: 'expected' | 'unexpected' | 'flaky' | 'skipped'
 * Ours:       'passed'   | 'failed'      | 'flaky' | 'skipped'
 */
function mapOutcome(playwrightStatus: string): Outcome {
  switch (playwrightStatus) {
    case 'expected': return 'passed';
    case 'unexpected': return 'failed';
    case 'flaky': return 'flaky';
    case 'skipped': return 'skipped';
    default: return 'failed'; // defensive fallback for unknown values
  }
}

/**
 * Walk all suites recursively, collecting NdjsonTestEntry records.
 * @param suites - array of suite objects from Playwright JSON
 * @param parentTitle - title of the parent suite (empty string at top level)
 * @param entries - accumulator array to push entries into
 */
function walkSuites(suites: unknown[], parentTitle: string, entries: NdjsonTestEntry[]): void {
  for (const suite of suites) {
    if (!suite || typeof suite !== 'object') continue;
    const s = suite as Record<string, unknown>;

    const suiteTitle = typeof s['title'] === 'string' ? s['title'] : '';

    // Recurse into nested suites (pass current suite title as parent for children)
    if (Array.isArray(s['suites'])) {
      walkSuites(s['suites'] as unknown[], suiteTitle, entries);
    }

    // Process specs in this suite
    // Use suiteTitle (current suite) as the prefix for spec titles
    if (Array.isArray(s['specs'])) {
      for (const spec of s['specs']) {
        if (!spec || typeof spec !== 'object') continue;
        const sp = spec as Record<string, unknown>;

        const specTitle = typeof sp['title'] === 'string' ? sp['title'] : '';
        const filePath = typeof sp['file'] === 'string' ? sp['file'] : '';

        // testId: "{filePath}::{suiteTitle} > {specTitle}" or "{filePath}::{specTitle}" if no suite
        const fullTitle = suiteTitle ? `${suiteTitle} > ${specTitle}` : specTitle;
        const testId = `${filePath}::${fullTitle}`;

        // Process each test variant (usually one per spec in non-parametrized tests)
        const tests = Array.isArray(sp['tests']) ? sp['tests'] : [];
        for (const test of tests) {
          if (!test || typeof test !== 'object') continue;
          const t = test as Record<string, unknown>;

          const status = typeof t['status'] === 'string' ? t['status'] : 'unknown';
          const results: unknown[] = Array.isArray(t['results']) ? t['results'] : [];

          // Last result is the authoritative result for duration and trace attachment
          const lastResult = results.length > 0
            ? (results[results.length - 1] as Record<string, unknown>)
            : null;

          const durationMs = lastResult !== null && typeof lastResult['duration'] === 'number'
            ? lastResult['duration']
            : 0;

          const workerIndex = lastResult !== null && typeof lastResult['parallelIndex'] === 'number'
            ? lastResult['parallelIndex']
            : 0;

          // retryCount = max retry value across all results
          const retryCount = Math.max(
            0,
            ...results.map(r => {
              if (r && typeof r === 'object') {
                const rv = (r as Record<string, unknown>)['retry'];
                return typeof rv === 'number' ? rv : 0;
              }
              return 0;
            }),
          );

          // errorSignature from last result's error message, truncated to 200 chars
          const lastError = lastResult !== null && typeof lastResult['error'] === 'object' && lastResult['error'] !== null
            ? (lastResult['error'] as Record<string, unknown>)
            : null;
          const errorSignature = lastError !== null && typeof lastError['message'] === 'string'
            ? lastError['message'].slice(0, 200)
            : null;

          // traceAttachmentPath from attachments where name === 'trace'
          const attachments = lastResult !== null && Array.isArray(lastResult['attachments'])
            ? (lastResult['attachments'] as Array<Record<string, unknown>>)
            : [];
          const traceAttachment = attachments.find(a => a['name'] === 'trace');
          const traceAttachmentPath = traceAttachment !== undefined && typeof traceAttachment['path'] === 'string'
            ? traceAttachment['path']
            : null;

          entries.push({
            testId,
            filePath,
            title: specTitle,
            outcome: mapOutcome(status),
            durationMs,
            retryCount,
            workerIndex,
            errorSignature,
            traceAttachmentPath,
          });
        }
      }
    }
  }
}

/**
 * Parse a Playwright JSON report (already parsed from JSON.parse()) into NdjsonTestEntry[].
 *
 * Returns { entries: [], reportUnreadable: true } on schema failure (ING-03).
 * Returns { entries: [...], reportUnreadable: false } on success.
 */
export function parseReport(
  rawJson: unknown,
): { entries: NdjsonTestEntry[]; reportUnreadable: boolean } {
  const parsed = ReportSchema.safeParse(rawJson);

  if (!parsed.success) {
    core.warning(
      `ING-03: Playwright report does not match expected shape — ` +
      `recording as "report-unreadable". Zod issues: ${parsed.error.message}`,
    );
    return { entries: [], reportUnreadable: true };
  }

  const entries: NdjsonTestEntry[] = [];
  walkSuites(parsed.data.suites, '', entries);
  return { entries, reportUnreadable: false };
}
