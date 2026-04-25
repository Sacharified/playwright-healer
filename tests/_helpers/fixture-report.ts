// tests/_helpers/fixture-report.ts

/** Minimal shape that satisfies the report-parser Zod schema */
export interface FixtureTestSpec {
  file: string;    // relative path, e.g. "tests/auth.spec.ts"
  title: string;   // test name
  /** Playwright's test.status enum: 'expected' | 'unexpected' | 'flaky' | 'skipped' */
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  durationMs?: number;
  retries?: number;
  errorMessage?: string;
}

/**
 * Fabricates a minimal Playwright JSON report with the given test specs.
 * Returns the raw object (not stringified) so tests can JSON.stringify or modify it.
 */
export function makeFixtureReport(specs: FixtureTestSpec[]): unknown {
  return {
    config: { rootDir: '/repo' },
    stats: { startTime: new Date().toISOString(), duration: 1000 },
    suites: [
      {
        title: 'fixture-suite',
        file: specs[0]?.file ?? 'tests/fixture.spec.ts',
        suites: [],
        specs: specs.map((s) => ({
          title: s.title,
          file: s.file,
          tests: [
            {
              status: s.status,
              results: [
                {
                  status: s.status === 'expected' ? 'passed' : s.status === 'skipped' ? 'skipped' : 'failed',
                  duration: s.durationMs ?? 100,
                  retry: s.retries ?? 0,
                  parallelIndex: 0,
                  attachments: [],
                  error: s.errorMessage ? { message: s.errorMessage } : undefined,
                },
              ],
            },
          ],
        })),
      },
    ],
  };
}

/** Creates a single-spec report — convenience wrapper */
export function makeTestEntry(override: Partial<FixtureTestSpec> = {}): FixtureTestSpec {
  return {
    file: 'tests/auth.spec.ts',
    title: 'should login successfully',
    status: 'expected',
    durationMs: 100,
    retries: 0,
    ...override,
  };
}
