// src/healer/fix-applier.test.ts
//
// Regression test for the "git apply silently skipped" failure (May 2026):
// when fix-applier ran from a working_directory subdirectory (e.g. `frontend/`
// in a monorepo), git apply silently exited 0 with no staged changes — its
// stdout printed "Skipped patch '<path>'" and bailed because the patch path
// didn't exist relative to the repository root. Fixed by passing
// --directory=<workingDirectoryPrefix> to git apply.
//
// The test is intentionally surgical: it mocks @actions/exec to capture the
// argv passed to git apply and asserts the --directory flag is present /
// absent based on the input. End-to-end git behavior is verified by the
// existing self-test workflow in CI.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const execCalls: string[][] = [];
const getExecOutputCalls: string[][] = [];

vi.mock('@actions/exec', () => ({
  exec: vi.fn(async (_cmd: string, args: string[]) => {
    execCalls.push(args);
    return 0;
  }),
  getExecOutput: vi.fn(async (_cmd: string, args: string[]) => {
    getExecOutputCalls.push(args);
    // Apply step: stage the file so the no-op detector passes.
    if (args[0] === 'apply') {
      // Simulate a successful apply that stages e2e/x.spec.ts.
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'diff' && args.includes('--cached')) {
      // Pretend a file was staged so applyFix doesn't trip the no-op guard.
      return { exitCode: 0, stdout: 'e2e/x.spec.ts\n', stderr: '' };
    }
    if (args[0] === 'rev-parse') {
      return { exitCode: 0, stdout: 'a1b2c3d4e5f6789012345678901234567890abcd\n', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }),
}));

const { applyFix } = await import('./fix-applier.js');

let workspace: string;
let frontend: string;

beforeEach(() => {
  execCalls.length = 0;
  getExecOutputCalls.length = 0;
  workspace = mkdtempSync(path.join(tmpdir(), 'fix-applier-test-'));
  frontend = path.join(workspace, 'frontend');
  mkdirSync(path.join(frontend, 'e2e'), { recursive: true });
  // diff-normalizer reads the source file to anchor the hunk start; provide one
  // that contains the diff's `-` line so normalization succeeds.
  writeFileSync(
    path.join(frontend, 'e2e/x.spec.ts'),
    'before\n  await page.click("#wrong");\nafter\n',
    'utf8',
  );
});

const SAMPLE_DIFF = `diff --git a/e2e/x.spec.ts b/e2e/x.spec.ts
--- a/e2e/x.spec.ts
+++ b/e2e/x.spec.ts
@@ -2,1 +2,1 @@
-  await page.click("#wrong");
+  await page.click("#right");
`;

describe('applyFix — --directory=<workingDirectoryPrefix>', () => {
  it('passes --directory=frontend to git apply when workingDirectoryPrefix is set', async () => {
    await applyFix({
      diff: SAMPLE_DIFF,
      defaultBranch: 'main',
      testSlug: 'x',
      shortSha: 'abc1234',
      cwd: frontend,
      token: '',
      workingDirectoryPrefix: 'frontend',
    });

    const applyCall = getExecOutputCalls.find((c) => c[0] === 'apply');
    expect(applyCall).toBeDefined();
    expect(applyCall).toContain('--directory=frontend');
    expect(applyCall).toContain('--3way');
    expect(applyCall).toContain('--index');
  });

  it('omits --directory when workingDirectoryPrefix is empty (single-tree repo)', async () => {
    // Re-set source at workspace root for the empty-prefix case.
    mkdirSync(path.join(workspace, 'e2e'), { recursive: true });
    writeFileSync(
      path.join(workspace, 'e2e/x.spec.ts'),
      'before\n  await page.click("#wrong");\nafter\n',
      'utf8',
    );

    await applyFix({
      diff: SAMPLE_DIFF,
      defaultBranch: 'main',
      testSlug: 'x',
      shortSha: 'abc1234',
      cwd: workspace,
      token: '',
      workingDirectoryPrefix: '',
    });

    const applyCall = getExecOutputCalls.find((c) => c[0] === 'apply');
    expect(applyCall).toBeDefined();
    expect(applyCall?.some((a) => a.startsWith('--directory='))).toBe(false);
  });

  it('omits --directory when workingDirectoryPrefix is undefined', async () => {
    mkdirSync(path.join(workspace, 'e2e'), { recursive: true });
    writeFileSync(
      path.join(workspace, 'e2e/x.spec.ts'),
      'before\n  await page.click("#wrong");\nafter\n',
      'utf8',
    );

    await applyFix({
      diff: SAMPLE_DIFF,
      defaultBranch: 'main',
      testSlug: 'x',
      shortSha: 'abc1234',
      cwd: workspace,
      token: '',
    });

    const applyCall = getExecOutputCalls.find((c) => c[0] === 'apply');
    expect(applyCall?.some((a) => a.startsWith('--directory='))).toBe(false);
  });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});
