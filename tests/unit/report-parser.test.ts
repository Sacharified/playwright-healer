import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Mock @actions/core before importing report-parser
vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  info: vi.fn(),
}));

import { parseReport } from '../../src/ingest/report-parser.js';
import * as core from '@actions/core';

// Load fixture files
const fixturesDir = join(import.meta.dirname, '../fixtures');
const sampleReport = JSON.parse(readFileSync(join(fixturesDir, 'sample-report.json'), 'utf8'));
const unreadableReport = JSON.parse(readFileSync(join(fixturesDir, 'sample-report-unreadable.json'), 'utf8'));
const shardedReport = JSON.parse(readFileSync(join(fixturesDir, 'sample-report-sharded.json'), 'utf8'));

describe('parseReport() — Playwright JSON → NdjsonTestEntry[]', () => {
  it('returns entries array with correct length for valid report', () => {
    const result = parseReport(sampleReport);
    expect(result.reportUnreadable).toBe(false);
    expect(result.entries).toHaveLength(2);
  });

  it('produces testId in format "{filePath}::{suiteTitle} > {specTitle}"', () => {
    const result = parseReport(sampleReport);
    const loginEntry = result.entries.find(e => e.title === 'should login');
    expect(loginEntry).toBeDefined();
    expect(loginEntry!.testId).toBe('tests/auth.spec.ts::auth > should login');
  });

  it('maps status "expected" → outcome "passed"', () => {
    const result = parseReport(sampleReport);
    const loginEntry = result.entries.find(e => e.title === 'should login');
    expect(loginEntry!.outcome).toBe('passed');
  });

  it('maps status "flaky" → outcome "flaky"', () => {
    const result = parseReport(sampleReport);
    const logoutEntry = result.entries.find(e => e.title === 'should logout');
    expect(logoutEntry!.outcome).toBe('flaky');
  });

  it('maps status "unexpected" → outcome "failed"', () => {
    // Create a minimal report with unexpected status
    const failReport = {
      config: { rootDir: '/repo' },
      stats: { startTime: '2026-04-24T10:00:00.000Z', duration: 100 },
      suites: [
        {
          title: 'api',
          file: 'tests/api.spec.ts',
          suites: [],
          specs: [
            {
              title: 'should create user',
              file: 'tests/api.spec.ts',
              tests: [
                {
                  status: 'unexpected',
                  results: [
                    { status: 'failed', duration: 100, retry: 0, parallelIndex: 0, attachments: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = parseReport(failReport);
    expect(result.entries[0]!.outcome).toBe('failed');
  });

  it('maps status "skipped" → outcome "skipped"', () => {
    const skipReport = {
      config: { rootDir: '/repo' },
      stats: { startTime: '2026-04-24T10:00:00.000Z', duration: 0 },
      suites: [
        {
          title: 'ui',
          file: 'tests/ui.spec.ts',
          suites: [],
          specs: [
            {
              title: 'should render',
              file: 'tests/ui.spec.ts',
              tests: [
                {
                  status: 'skipped',
                  results: [],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = parseReport(skipReport);
    expect(result.entries[0]!.outcome).toBe('skipped');
  });

  it('extracts durationMs from last result duration', () => {
    const result = parseReport(sampleReport);
    const logoutEntry = result.entries.find(e => e.title === 'should logout');
    // The flaky logout test has results: [{duration:200, retry:0}, {duration:180, retry:1}]
    // Last result duration = 180
    expect(logoutEntry!.durationMs).toBe(180);
  });

  it('extracts retryCount as max retry value across results', () => {
    const result = parseReport(sampleReport);
    const logoutEntry = result.entries.find(e => e.title === 'should logout');
    // Max retry across [{retry:0}, {retry:1}] = 1
    expect(logoutEntry!.retryCount).toBe(1);
  });

  it('sets retryCount to 0 for tests with single result (no retries)', () => {
    const result = parseReport(sampleReport);
    const loginEntry = result.entries.find(e => e.title === 'should login');
    expect(loginEntry!.retryCount).toBe(0);
  });

  it('extracts errorSignature truncated to 200 chars from last result error', () => {
    // The logout test error appears in the first result (status:failed), not last result
    // The last result is the passing retry — no error there
    // Create a report where the last result has an error
    const longErrorMsg = 'A'.repeat(300);
    const errReport = {
      config: { rootDir: '/repo' },
      stats: { startTime: '2026-04-24T10:00:00.000Z', duration: 100 },
      suites: [
        {
          title: 'err',
          file: 'tests/err.spec.ts',
          suites: [],
          specs: [
            {
              title: 'should fail',
              file: 'tests/err.spec.ts',
              tests: [
                {
                  status: 'unexpected',
                  results: [
                    {
                      status: 'failed',
                      duration: 100,
                      retry: 0,
                      parallelIndex: 0,
                      attachments: [],
                      error: { message: longErrorMsg },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = parseReport(errReport);
    expect(result.entries[0]!.errorSignature).toHaveLength(200);
    expect(result.entries[0]!.errorSignature).toBe('A'.repeat(200));
  });

  it('sets errorSignature to null when no error in last result', () => {
    const result = parseReport(sampleReport);
    const loginEntry = result.entries.find(e => e.title === 'should login');
    expect(loginEntry!.errorSignature).toBeNull();
  });

  it('extracts traceAttachmentPath from attachment named "trace"', () => {
    const result = parseReport(sampleReport);
    const logoutEntry = result.entries.find(e => e.title === 'should logout');
    // logout last result has trace attachment
    expect(logoutEntry!.traceAttachmentPath).toBe('test-results/trace-auth-logout.zip');
  });

  it('sets traceAttachmentPath to null when no trace attachment', () => {
    const result = parseReport(sampleReport);
    const loginEntry = result.entries.find(e => e.title === 'should login');
    expect(loginEntry!.traceAttachmentPath).toBeNull();
  });

  it('ING-03: returns { entries: [], reportUnreadable: true } for report missing suites', () => {
    const result = parseReport(unreadableReport);
    expect(result.entries).toHaveLength(0);
    expect(result.reportUnreadable).toBe(true);
  });

  it('ING-03: emits core.warning() on unreadable report', () => {
    vi.clearAllMocks();
    parseReport(unreadableReport);
    expect(core.warning).toHaveBeenCalledOnce();
  });

  it('ING-03: returns { entries: [], reportUnreadable: true } for null input', () => {
    const result = parseReport(null);
    expect(result.entries).toHaveLength(0);
    expect(result.reportUnreadable).toBe(true);
  });

  it('ING-03: returns { entries: [], reportUnreadable: true } for empty object', () => {
    const result = parseReport({});
    expect(result.entries).toHaveLength(0);
    expect(result.reportUnreadable).toBe(true);
  });

  it('ING-04: sharded report fixture parses correctly — shard metadata lives on NdjsonRecord (not entries)', () => {
    const result = parseReport(shardedReport);
    expect(result.reportUnreadable).toBe(false);
    expect(result.entries).toHaveLength(1);
    // Verify the entry itself has no shard fields
    const entry = result.entries[0]!;
    expect('shardIndex' in entry).toBe(false);
    expect('shardTotal' in entry).toBe(false);
    expect(entry.testId).toBe('tests/checkout.spec.ts::checkout > should complete purchase');
  });

  it('sets filePath from spec.file', () => {
    const result = parseReport(sampleReport);
    expect(result.entries[0]!.filePath).toBe('tests/auth.spec.ts');
  });

  it('sets workerIndex from last result parallelIndex', () => {
    const result = parseReport(sampleReport);
    const loginEntry = result.entries.find(e => e.title === 'should login');
    expect(loginEntry!.workerIndex).toBe(0);
  });
});

// ─── filePath rebasing (working_directory + custom rootDir) ──────────────────
//
// Real-world bug surfaced by battledex: playwright.config.ts at frontend/, but
// testDir: 'e2e' makes Playwright collapse rootDir to '/.../frontend/e2e'.
// Spec.file is then 'pokedex.spec.ts' (rel to rootDir), and the heal pipeline
// running from cwd=/.../frontend opens '/.../frontend/pokedex.spec.ts' → ENOENT.
//
// Fix: rebase spec.file from rootDir-relative to (workspace+working_directory)-
// relative when pathContext is supplied.

describe('parseReport() — filePath rebasing', () => {
  function makeReport(rootDir: string, specFile: string) {
    return {
      config: { rootDir },
      stats: { startTime: '2026-05-05T00:00:00Z', duration: 100 },
      suites: [
        {
          title: 'pokedex',
          file: specFile,
          specs: [
            {
              title: 'renders heading',
              file: specFile,
              tests: [{ status: 'unexpected', results: [{ duration: 1, retry: 0 }] }],
            },
          ],
        },
      ],
    };
  }

  it('rebases when rootDir is deeper than workspace+working_directory', () => {
    // Battledex shape: config at frontend/playwright.config.ts, testDir: 'e2e'
    const r = makeReport(
      '/home/runner/work/battledex/battledex/frontend/e2e',
      'pokedex.spec.ts',
    );
    const result = parseReport(r, {
      workspace: '/home/runner/work/battledex/battledex',
      workingDirectory: 'frontend',
    });
    expect(result.entries[0]!.filePath).toBe('e2e/pokedex.spec.ts');
  });

  it('passes spec.file through unchanged when rootDir equals workspace+working_directory', () => {
    // Standard shape: rootDir is the same as workspace+wd, spec.file already includes the testDir.
    const r = makeReport(
      '/home/runner/work/repo/frontend',
      'e2e/pokedex.spec.ts',
    );
    const result = parseReport(r, {
      workspace: '/home/runner/work/repo',
      workingDirectory: 'frontend',
    });
    expect(result.entries[0]!.filePath).toBe('e2e/pokedex.spec.ts');
  });

  it('handles workspace-root projects (working_directory empty)', () => {
    const r = makeReport('/home/runner/work/repo', 'tests/foo.spec.ts');
    const result = parseReport(r, {
      workspace: '/home/runner/work/repo',
      workingDirectory: '',
    });
    expect(result.entries[0]!.filePath).toBe('tests/foo.spec.ts');
  });

  it('passes through unchanged when pathContext is omitted (back-compat)', () => {
    const r = makeReport('/repo', 'tests/foo.spec.ts');
    const result = parseReport(r);
    expect(result.entries[0]!.filePath).toBe('tests/foo.spec.ts');
  });

  it('handles absolute spec.file by computing relative to workspace+working_directory', () => {
    const r = makeReport(
      '/home/runner/work/repo/frontend/e2e',
      '/home/runner/work/repo/frontend/e2e/pokedex.spec.ts',
    );
    const result = parseReport(r, {
      workspace: '/home/runner/work/repo',
      workingDirectory: 'frontend',
    });
    expect(result.entries[0]!.filePath).toBe('e2e/pokedex.spec.ts');
  });
});
