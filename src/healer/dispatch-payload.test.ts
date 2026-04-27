import { describe, it, expect } from 'vitest';
import { DispatchPayload } from './dispatch-payload.js';

// ────────────────────────────────────────────────────────────────────────────
// DispatchPayload — Zod schema for workflow_dispatch payload (CONTEXT D-18)
// ────────────────────────────────────────────────────────────────────────────

describe('DispatchPayload', () => {
  // 1. Valid minimal payload (no recentRunStats) → success
  it('accepts a valid minimal payload without recentRunStats', () => {
    const result = DispatchPayload.safeParse({
      commitSha: 'abc1234',
      testFile: 'tests/e2e/checkout.spec.ts',
      testTitle: 'completes purchase flow',
      fixClassHint: 'selectors',
    });
    expect(result.success).toBe(true);
  });

  // 2. Valid full payload (with recentRunStats) → success
  it('accepts a valid full payload with recentRunStats', () => {
    const result = DispatchPayload.safeParse({
      commitSha: 'abc1234',
      testFile: 'tests/e2e/checkout.spec.ts',
      testTitle: 'completes purchase flow',
      fixClassHint: 'waits',
      recentRunStats: {
        flakeRate: 0.4,
        windowDays: 7,
        runCount: 25,
      },
    });
    expect(result.success).toBe(true);
  });

  // 3. commitSha: 'not-hex' → failure, error path === ['commitSha']
  it('rejects a non-hex commitSha', () => {
    const result = DispatchPayload.safeParse({
      commitSha: 'not-hex',
      testFile: 'tests/e2e/checkout.spec.ts',
      testTitle: 'completes purchase flow',
      fixClassHint: 'selectors',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['commitSha']);
      expect(result.error.issues[0].message).toContain('commitSha must be a hex SHA');
    }
  });

  // 4. commitSha: 'abc' (length < 7) → failure, path === ['commitSha']
  it('rejects a commitSha shorter than 7 characters', () => {
    const result = DispatchPayload.safeParse({
      commitSha: 'abc',
      testFile: 'tests/e2e/checkout.spec.ts',
      testTitle: 'completes purchase flow',
      fixClassHint: 'selectors',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['commitSha']);
    }
  });

  // 5. commitSha: 40-char full SHA → success
  it('accepts a 40-character full SHA', () => {
    const result = DispatchPayload.safeParse({
      commitSha: '0123456789abcdef0123456789abcdef01234567',
      testFile: 'tests/e2e/checkout.spec.ts',
      testTitle: 'completes purchase flow',
      fixClassHint: 'selectors',
    });
    expect(result.success).toBe(true);
  });

  // 6. testFile: '' → failure, path === ['testFile']
  it('rejects an empty testFile', () => {
    const result = DispatchPayload.safeParse({
      commitSha: 'abc1234',
      testFile: '',
      testTitle: 'completes purchase flow',
      fixClassHint: 'selectors',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['testFile']);
    }
  });

  // 7. testTitle: '' → failure, path === ['testTitle']
  it('rejects an empty testTitle', () => {
    const result = DispatchPayload.safeParse({
      commitSha: 'abc1234',
      testFile: 'tests/e2e/checkout.spec.ts',
      testTitle: '',
      fixClassHint: 'selectors',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['testTitle']);
    }
  });

  // 8. fixClassHint: 'assertions' → failure, path === ['fixClassHint']
  it('rejects fixClassHint: assertions (P3 scope; assertions deferred to P4)', () => {
    const result = DispatchPayload.safeParse({
      commitSha: 'abc1234',
      testFile: 'tests/e2e/checkout.spec.ts',
      testTitle: 'completes purchase flow',
      fixClassHint: 'assertions',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['fixClassHint']);
    }
  });

  // 9. fixClassHint: 'slow' → failure (P3 scope; slow deferred to P4)
  it('rejects fixClassHint: slow (P3 scope; slow deferred to P4)', () => {
    const result = DispatchPayload.safeParse({
      commitSha: 'abc1234',
      testFile: 'tests/e2e/checkout.spec.ts',
      testTitle: 'completes purchase flow',
      fixClassHint: 'slow',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['fixClassHint']);
    }
  });

  // 10. recentRunStats.flakeRate > 1 → failure, path === ['recentRunStats', 'flakeRate']
  it('rejects recentRunStats.flakeRate > 1 (max violation)', () => {
    const result = DispatchPayload.safeParse({
      commitSha: 'abc1234',
      testFile: 'tests/e2e/checkout.spec.ts',
      testTitle: 'completes purchase flow',
      fixClassHint: 'selectors',
      recentRunStats: {
        flakeRate: 1.5,
        windowDays: 7,
        runCount: 25,
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['recentRunStats', 'flakeRate']);
    }
  });

  // 11. recentRunStats.windowDays: 0 → failure, path === ['recentRunStats', 'windowDays']
  it('rejects recentRunStats.windowDays: 0 (min(1) violation)', () => {
    const result = DispatchPayload.safeParse({
      commitSha: 'abc1234',
      testFile: 'tests/e2e/checkout.spec.ts',
      testTitle: 'completes purchase flow',
      fixClassHint: 'selectors',
      recentRunStats: {
        flakeRate: 0.4,
        windowDays: 0,
        runCount: 25,
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['recentRunStats', 'windowDays']);
    }
  });
});
