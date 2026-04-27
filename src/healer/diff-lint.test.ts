// src/healer/diff-lint.test.ts
// Tests for diff-lint FIX-06 defense layer (pure function).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { lintDiff } from './diff-lint.js';

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), 'tests', 'fixtures', name), 'utf8');

describe('diff-lint — FIX-06', () => {
  it('returns empty findings for a clean diff', () => {
    expect(lintDiff(fixture('unified-diff-clean.patch'))).toEqual([]);
  });

  it('flags waitForTimeout', () => {
    const findings = lintDiff(fixture('unified-diff-with-waitForTimeout.patch'));
    expect(findings.some((f) => f.pattern === 'waitForTimeout')).toBe(true);
  });

  it('flags :nth-child', () => {
    const findings = lintDiff(fixture('unified-diff-with-nth-child.patch'));
    expect(findings.some((f) => f.pattern === 'nth-child')).toBe(true);
  });

  it('flags assertion weakening (.toBe → .toBeTruthy)', () => {
    const findings = lintDiff(fixture('unified-diff-with-weakened-assertion.patch'));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].pattern).toMatch(/toBe|weaken|assertion/i);
  });

  it('flags modification of paths outside test-paths allowlist', () => {
    const findings = lintDiff(fixture('unified-diff-out-of-testdir.patch'));
    expect(findings.some((f) => f.filePath === 'src/foo.ts')).toBe(true);
    expect(
      findings.some(
        (f) => f.pattern.includes('test-dir') || f.pattern.includes('allowlist'),
      ),
    ).toBe(true);
  });

  it('handles empty diff string', () => {
    expect(lintDiff('')).toEqual([]);
  });

  // One inline assertion per anti-pattern not covered by fixtures, to ensure
  // the `\s*\(` whitespace tolerance: agent might emit `waitForTimeout (3000)`.
  it('flags waitForTimeout with whitespace before paren', () => {
    const diff = [
      'diff --git a/tests/x.spec.ts b/tests/x.spec.ts',
      '--- a/tests/x.spec.ts',
      '+++ b/tests/x.spec.ts',
      '@@ -1,1 +1,2 @@',
      ' test',
      '+await page.waitForTimeout (3000);',
    ].join('\n');
    expect(lintDiff(diff).some((f) => f.pattern === 'waitForTimeout')).toBe(true);
  });
});
