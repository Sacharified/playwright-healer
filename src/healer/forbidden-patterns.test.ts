// src/healer/forbidden-patterns.test.ts
// Tests for D-17 single source of truth: frozen constants for diff-lint patterns.

import { describe, it, expect } from 'vitest';
import {
  FORBIDDEN_PATCHED_LINE_PATTERNS,
  ASSERTION_WEAKENING_PAIRS,
  TEST_PATH_ALLOWLIST,
} from './forbidden-patterns.js';

describe('forbidden-patterns — D-17 single source of truth', () => {
  it('FORBIDDEN_PATCHED_LINE_PATTERNS is frozen', () => {
    expect(Object.isFrozen(FORBIDDEN_PATCHED_LINE_PATTERNS)).toBe(true);
  });

  it('ASSERTION_WEAKENING_PAIRS is frozen', () => {
    expect(Object.isFrozen(ASSERTION_WEAKENING_PAIRS)).toBe(true);
  });

  it('TEST_PATH_ALLOWLIST is frozen', () => {
    expect(Object.isFrozen(TEST_PATH_ALLOWLIST)).toBe(true);
  });

  it('FORBIDDEN_PATCHED_LINE_PATTERNS has exactly 5 entries with correct names', () => {
    expect(FORBIDDEN_PATCHED_LINE_PATTERNS).toHaveLength(5);
    const names = FORBIDDEN_PATCHED_LINE_PATTERNS.map((p) => p.name);
    expect(names).toEqual([
      'waitForTimeout',
      'nth-child',
      'nth-of-type',
      'xpath-equals',
      'xpath-prefix',
    ]);
  });

  it('waitForTimeout regex matches standard usage', () => {
    const re = FORBIDDEN_PATCHED_LINE_PATTERNS.find((p) => p.name === 'waitForTimeout')!.re;
    expect(re.test('await page.waitForTimeout(3000)')).toBe(true);
  });

  it('waitForTimeout regex matches with whitespace before paren (\\s* tolerance)', () => {
    const re = FORBIDDEN_PATCHED_LINE_PATTERNS.find((p) => p.name === 'waitForTimeout')!.re;
    expect(re.test('await page.waitForTimeout (3000)')).toBe(true);
  });

  it('waitForTimeout regex does not match when not a word boundary', () => {
    const re = FORBIDDEN_PATCHED_LINE_PATTERNS.find((p) => p.name === 'waitForTimeout')!.re;
    expect(re.test('mywaitForTimeout(3000)')).toBe(false);
  });

  it(':nth-child regex matches button:nth-child(3)', () => {
    const re = FORBIDDEN_PATCHED_LINE_PATTERNS.find((p) => p.name === 'nth-child')!.re;
    expect(re.test('button:nth-child(3)')).toBe(true);
  });

  it('ASSERTION_WEAKENING_PAIRS[0] from matches .toBe(5) and to matches .toBeTruthy()', () => {
    const pair = ASSERTION_WEAKENING_PAIRS[0];
    expect(pair.from.test('.toBe(5)')).toBe(true);
    expect(pair.to.test('.toBeTruthy()')).toBe(true);
  });

  it('TEST_PATH_ALLOWLIST matches tests/ paths', () => {
    expect(TEST_PATH_ALLOWLIST.some((re) => re.test('tests/foo.spec.ts'))).toBe(true);
  });

  it('TEST_PATH_ALLOWLIST does not match src/ paths', () => {
    expect(TEST_PATH_ALLOWLIST.some((re) => re.test('src/foo.ts'))).toBe(false);
  });
});
