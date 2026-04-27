// src/healer/validator.ts
//
// VAL-01..04: re-run a single failing test exactly N times to validate a fix.
// CLI flags --retries=0 and --workers=1 are passed verbatim (D-19) — NOT a
// config-file patch (writing to the workspace mid-run is a risk surface).
//
// VAL-04: this validator does NOT restart the app between reruns. It assumes
// the app under test is already running (Plan 14 action.yml Step 4 spawns it).
// Documented limitation; consumers using non-idempotent tests should use
// UUID/randomized inputs.
//
// VAL-05 (validation summary rendering) lives in pr-writer.ts — this file
// returns structured data only.

import { getExecOutput } from '@actions/exec';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

export interface RunResult {
  status: 'passed' | 'failed' | 'timed-out' | 'skipped';
  durationMs: number;
}

export interface ValidationResult {
  passed: number;
  total: number;
  passRate: number;
  perRun: RunResult[];
}

// Regex escape recipe per RESEARCH §Don't Hand-Roll line 706 / T-3-VAL-01 mitigation.
// Escapes all RE2 metacharacters before embedding testTitle in --grep.
const REGEX_META = /[\\^$*+?.()|[\]{}]/g;

export function escapeForGrep(s: string): string {
  return s.replace(REGEX_META, '\\$&');
}

export async function validate(
  testFile: string,
  testTitle: string,
  rerunCount: number,
): Promise<ValidationResult> {
  const grepEscaped = escapeForGrep(testTitle);
  const perRun: RunResult[] = [];
  const tempDir = process.env.RUNNER_TEMP ?? '/tmp';

  for (let i = 0; i < rerunCount; i += 1) {
    const reportPath = path.join(tempDir, `playwright-healer-rerun-${i}.json`);

    const result = await getExecOutput(
      'npx',
      [
        'playwright',
        'test',
        testFile,
        '--grep',
        grepEscaped,
        '--retries=0',
        '--workers=1',
        '--reporter=json',
      ],
      {
        ignoreReturnCode: true,
        env: {
          ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
        },
        silent: true,
      },
    );

    perRun.push(await parseRerunResult(result.stdout, reportPath, result.exitCode));
  }

  const passed = perRun.filter((r) => r.status === 'passed').length;
  const total = rerunCount;
  return {
    passed,
    total,
    passRate: total > 0 ? passed / total : 0,
    perRun,
  };
}

async function parseRerunResult(
  stdout: string,
  reportPath: string,
  exitCode: number,
): Promise<RunResult> {
  // Try stdout first (fastest path), then file fallback.
  let json: unknown = null;
  try {
    json = JSON.parse(stdout);
  } catch {
    try {
      const fileText = await readFile(reportPath, 'utf8');
      json = JSON.parse(fileText);
    } catch {
      /* leave json null */
    }
  }

  if (!json || typeof json !== 'object') {
    return { status: 'failed', durationMs: 0 };
  }

  // Playwright JSON reporter shape: { stats: { expected, unexpected, flaky, skipped, duration } }
  const stats = (json as Record<string, unknown>).stats ?? {};
  const statsObj = stats as Record<string, unknown>;
  const expected = Number(statsObj['expected'] ?? 0);
  const unexpected = Number(statsObj['unexpected'] ?? 0);
  const duration = Number(statsObj['duration'] ?? 0);
  const skipped = Number(statsObj['skipped'] ?? 0);

  if (unexpected > 0) {
    return { status: 'failed', durationMs: duration };
  }
  if (expected > 0) {
    return { status: 'passed', durationMs: duration };
  }
  if (skipped > 0) {
    return { status: 'skipped', durationMs: duration };
  }
  // Edge case: zero stats with non-zero exit code — treat as failed
  if (exitCode !== 0) {
    return { status: 'failed', durationMs: duration };
  }
  return { status: 'failed', durationMs: duration };
}
