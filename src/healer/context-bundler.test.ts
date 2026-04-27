import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// vi.mock must be declared BEFORE the SUT import (PATTERNS.md §E)
vi.mock('@actions/exec', () => ({
  getExecOutput: vi.fn().mockResolvedValue({ stdout: 'mock blame output\n', stderr: '', exitCode: 0 }),
}));

import { bundleContext } from './context-bundler.js';
import { getExecOutput } from '@actions/exec';

const mockExec = getExecOutput as unknown as ReturnType<typeof vi.fn>;

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'context-bundler-'));
  vi.clearAllMocks();
  mockExec.mockResolvedValue({ stdout: 'mock blame output\n', stderr: '', exitCode: 0 });
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function write(rel: string, content: string) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('bundleContext — HEA-04 / HEA-05', () => {
  it('reads testFileSource', async () => {
    write('tests/checkout.spec.ts', `test('x', () => {});\n`);
    const r = await bundleContext({ testFile: 'tests/checkout.spec.ts', testTitle: 'x', cwd });
    expect(r.testFileSource).toContain("test('x',");
  });

  it('resolves first-hop relative imports', async () => {
    write('tests/checkout.spec.ts', `import { user } from './fixtures/user.ts';\ntest('x', () => {});\n`);
    write('tests/fixtures/user.ts', `export const user = {};\n`);
    const r = await bundleContext({ testFile: 'tests/checkout.spec.ts', testTitle: 'x', cwd });
    expect(r.firstHopImports['tests/fixtures/user.ts']).toContain('export const user');
  });

  it('skips non-relative imports', async () => {
    write('tests/x.spec.ts', `import { test } from '@playwright/test';\nimport React from 'react';\ntest('x', () => {});\n`);
    const r = await bundleContext({ testFile: 'tests/x.spec.ts', testTitle: 'x', cwd });
    expect(Object.keys(r.firstHopImports)).toEqual([]);
  });

  it('skips TS path-alias (@/) imports — documented P3 limitation', async () => {
    write('tests/x.spec.ts', `import { foo } from '@/utils/foo';\ntest('x', () => {});\n`);
    const r = await bundleContext({ testFile: 'tests/x.spec.ts', testTitle: 'x', cwd });
    expect(Object.keys(r.firstHopImports)).toEqual([]);
  });

  it('does NOT recurse — only first hop is included', async () => {
    write('tests/x.spec.ts', `import { a } from './a.ts';\n`);
    write('tests/a.ts', `import { b } from './b.ts';\nexport const a = b;\n`);
    write('tests/b.ts', `export const b = 1;\n`);
    const r = await bundleContext({ testFile: 'tests/x.spec.ts', testTitle: 'x', cwd });
    expect(r.firstHopImports['tests/a.ts']).toBeDefined();
    expect(r.firstHopImports['tests/b.ts']).toBeUndefined();
  });

  it('sets traceAttachmentPath to null when file does not exist (HEA-05)', async () => {
    write('tests/x.spec.ts', `test('x', () => {});\n`);
    const r = await bundleContext({
      testFile: 'tests/x.spec.ts', testTitle: 'x', cwd,
      traceAttachmentPath: '/nonexistent/trace.zip',
    });
    expect(r.traceAttachmentPath).toBeNull();
  });

  it('preserves traceAttachmentPath when file exists', async () => {
    write('tests/x.spec.ts', `test('x', () => {});\n`);
    const tracePath = path.join(cwd, 'trace.zip');
    fs.writeFileSync(tracePath, 'fake');
    const r = await bundleContext({
      testFile: 'tests/x.spec.ts', testTitle: 'x', cwd,
      traceAttachmentPath: tracePath,
    });
    expect(r.traceAttachmentPath).toBe(tracePath);
  });

  it('sets traceAttachmentPath to null when arg is undefined', async () => {
    write('tests/x.spec.ts', `test('x', () => {});\n`);
    const r = await bundleContext({ testFile: 'tests/x.spec.ts', testTitle: 'x', cwd });
    expect(r.traceAttachmentPath).toBeNull();
  });

  it('captures git blame stdout', async () => {
    write('tests/x.spec.ts', `test('x', () => {});\n`);
    mockExec.mockResolvedValueOnce({ stdout: 'mocked blame line\n', stderr: '', exitCode: 0 });
    const r = await bundleContext({ testFile: 'tests/x.spec.ts', testTitle: 'x', cwd });
    expect(r.gitBlame).toContain('mocked blame line');
  });

  it('returns empty gitBlame on non-zero git exit', async () => {
    write('tests/x.spec.ts', `test('x', () => {});\n`);
    mockExec.mockResolvedValueOnce({ stdout: 'whatever', stderr: 'fatal: not a git repo', exitCode: 128 });
    const r = await bundleContext({ testFile: 'tests/x.spec.ts', testTitle: 'x', cwd });
    expect(r.gitBlame).toBe('');
  });

  it('rejects testFile that escapes workspace (T-3-CTX-01)', async () => {
    await expect(
      bundleContext({ testFile: '../../etc/passwd', testTitle: 'x', cwd }),
    ).rejects.toThrow(/outside workspace/);
  });

  it('defaults recentErrorMessages to empty array', async () => {
    write('tests/x.spec.ts', `test('x', () => {});\n`);
    const r = await bundleContext({ testFile: 'tests/x.spec.ts', testTitle: 'x', cwd });
    expect(r.recentErrorMessages).toEqual([]);
  });
});
