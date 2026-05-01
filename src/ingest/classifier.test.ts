// src/ingest/classifier.test.ts
// FIX-07: Coverage of all four substring rules + fallback + empty + security (T-04-04).
// Tests 1-9 per 04-02-PLAN.md Task 2 behavior. Tests 10-11 live in index.test.ts.

import { describe, it, expect } from 'vitest';
import { classifyFixClass } from './classifier.js';

describe('classifyFixClass — slow rule', () => {
  it('Test 1: "Test timeout of 30000ms exceeded." → slow', () => {
    expect(classifyFixClass('Test timeout of 30000ms exceeded.')).toBe('slow');
  });

  it('Test 2: "Test timed out after 5s" → slow', () => {
    expect(classifyFixClass('Test timed out after 5s')).toBe('slow');
  });
});

describe('classifyFixClass — assertions rule', () => {
  it('Test 3: expect(received).toBe(...) → assertions', () => {
    expect(
      classifyFixClass('expect(received).toBe(expected)\nExpected: 1\nReceived: 2'),
    ).toBe('assertions');
  });
});

describe('classifyFixClass — selectors rule', () => {
  it('Test 4: locator.click waiting for locator → selectors', () => {
    expect(
      classifyFixClass("locator.click: waiting for locator('#submit')"),
    ).toBe('selectors');
  });

  it('Test 6: "Target closed" → selectors', () => {
    expect(classifyFixClass('Target closed')).toBe('selectors');
  });
});

describe('classifyFixClass — waits rule', () => {
  it('Test 5: "Element is not stable - is moving" → waits', () => {
    expect(classifyFixClass('Element is not stable - is moving')).toBe('waits');
  });
});

describe('classifyFixClass — fallback', () => {
  it('Test 7: totally unknown error shape → selectors (fallback)', () => {
    expect(classifyFixClass('totally unknown error shape xyz')).toBe('selectors');
  });

  it('Test 8: empty string → selectors (empty fallback)', () => {
    expect(classifyFixClass('')).toBe('selectors');
  });
});

describe('classifyFixClass — T-04-04 security (no eval/RegExp(input))', () => {
  it('Test 9: classifyFixClass is a pure function with no dynamic regex construction', () => {
    // This test documents the invariant. The actual security guarantee is verified
    // by the done-criteria grep: grep -nE "eval|new Function|new RegExp\(" classifier.ts
    // returns ZERO matches. Here we confirm the function is callable with an adversarial
    // input containing regex metacharacters and returns a safe fallback, never throws.
    const adversarialInput = '(?P<x>.*)eval(new Function("malicious"))';
    expect(() => classifyFixClass(adversarialInput)).not.toThrow();
    // The output is 'selectors' (fallback) — the dangerous string didn't match any rule.
    expect(classifyFixClass(adversarialInput)).toBe('selectors');
  });
});
