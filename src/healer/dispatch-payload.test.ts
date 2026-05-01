import { describe, it, expect } from 'vitest';
import { DispatchPayload } from './dispatch-payload.js';
import { getInputSchema } from '../shared/config.js';

// ────────────────────────────────────────────────────────────────────────────
// DispatchPayload — Zod schema for workflow_dispatch payload (Phase 04 widening)
//
// Phase 04 breaking changes from P3:
//   1. `fixClassHint` enum widened: adds 'assertions' + 'slow'
//   2. `recentRunStats` nested object REMOVED — replaced by flat fields
//   3. `concurrencyKey` added as REQUIRED field
//   4. Flat numeric fields (`flakeRate`, `windowDays`, `runCount`) are optional
//      and accept strings via z.coerce.number() (workflow_dispatch sends strings)
// ────────────────────────────────────────────────────────────────────────────

const BASE = {
  commitSha: 'abc1234',
  testFile: 'tests/foo.spec.ts',
  testTitle: 't',
  concurrencyKey: 'k',
} as const;

describe('DispatchPayload — Phase 04 widened schema', () => {
  // ── New behavior (Plan 01 Phase 04) ─────────────────────────────────────

  // Test 1: 'assertions' now valid (was rejected in P3)
  it('accepts fixClassHint: assertions (enum widened in Phase 04)', () => {
    const result = DispatchPayload.safeParse({ ...BASE, fixClassHint: 'assertions' });
    expect(result.success).toBe(true);
  });

  // Test 2: 'slow' now valid (was rejected in P3)
  it('accepts fixClassHint: slow (enum widened in Phase 04)', () => {
    const result = DispatchPayload.safeParse({ ...BASE, fixClassHint: 'slow' });
    expect(result.success).toBe(true);
  });

  // Test 3: unknown fixClassHint → failure
  it('rejects unknown fixClassHint with path [fixClassHint]', () => {
    const result = DispatchPayload.safeParse({ ...BASE, fixClassHint: 'unknown' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path);
      expect(paths.some((p) => p.includes('fixClassHint'))).toBe(true);
    }
  });

  // Test 4: concurrencyKey omitted → failure
  it('rejects payload missing concurrencyKey (now required)', () => {
    const result = DispatchPayload.safeParse({
      commitSha: 'abc1234',
      testFile: 'tests/foo.spec.ts',
      testTitle: 't',
      fixClassHint: 'selectors',
      // no concurrencyKey
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path);
      expect(paths.some((p) => p.includes('concurrencyKey'))).toBe(true);
    }
  });

  // Test 5: flat numerics as strings — z.coerce.number() coerces '0.42' → 0.42
  it('parses flat numeric fields from string inputs (workflow_dispatch coercion)', () => {
    const result = DispatchPayload.safeParse({
      ...BASE,
      fixClassHint: 'selectors',
      flakeRate: '0.42',
      windowDays: '7',
      runCount: '15',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flakeRate).toBe(0.42);
      expect(result.data.windowDays).toBe(7);
      expect(result.data.runCount).toBe(15);
    }
  });

  // Test 6: backwards compat — selectors still works (existing Phase 03 class)
  it('accepts selectors + concurrencyKey (backwards compat with Phase 03)', () => {
    const result = DispatchPayload.safeParse({
      commitSha: 'abc1234',
      testFile: 'tests/e2e/checkout.spec.ts',
      testTitle: 'completes purchase flow',
      fixClassHint: 'selectors',
      concurrencyKey: 'test-key',
    });
    expect(result.success).toBe(true);
  });

  // ── Unchanged validations ────────────────────────────────────────────────

  // commitSha: non-hex → failure
  it('rejects a non-hex commitSha', () => {
    const result = DispatchPayload.safeParse({
      ...BASE,
      commitSha: 'not-hex',
      fixClassHint: 'selectors',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['commitSha']);
    }
  });

  // commitSha: 40-char full SHA → success
  it('accepts a 40-character full SHA', () => {
    const result = DispatchPayload.safeParse({
      ...BASE,
      commitSha: '0123456789abcdef0123456789abcdef01234567',
      fixClassHint: 'selectors',
    });
    expect(result.success).toBe(true);
  });

  // testFile: '' → failure
  it('rejects an empty testFile', () => {
    const result = DispatchPayload.safeParse({ ...BASE, testFile: '', fixClassHint: 'selectors' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['testFile']);
    }
  });

  // testTitle: '' → failure
  it('rejects an empty testTitle', () => {
    const result = DispatchPayload.safeParse({ ...BASE, testTitle: '', fixClassHint: 'selectors' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['testTitle']);
    }
  });

  // flakeRate > 1 → failure (flat field)
  it('rejects flakeRate > 1 (max violation)', () => {
    const result = DispatchPayload.safeParse({
      ...BASE,
      fixClassHint: 'selectors',
      flakeRate: 1.5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path);
      expect(paths.some((p) => p.includes('flakeRate'))).toBe(true);
    }
  });

  // windowDays: 0 → failure (flat field)
  it('rejects windowDays: 0 (min(1) violation)', () => {
    const result = DispatchPayload.safeParse({
      ...BASE,
      fixClassHint: 'selectors',
      windowDays: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path);
      expect(paths.some((p) => p.includes('windowDays'))).toBe(true);
    }
  });
});

// ── Config: enableAutoDispatch field ────────────────────────────────────────

describe('Config — enableAutoDispatch + healerWorkflowFile (Task 1)', () => {
  const BASE_CONFIG = {
    mode: 'ingest',
    healerToken: 'tok',
    githubToken: 'gtok',
    apiKey: 'key',
    provider: 'anthropic',
  } as const;

  // Test 7: 'true' → true; absent/'false' → false
  it("enableAutoDispatch: 'true' → true; absent → false", () => {
    const withTrue = getInputSchema().safeParse({ ...BASE_CONFIG, enableAutoDispatch: 'true' });
    expect(withTrue.success).toBe(true);
    if (withTrue.success) expect(withTrue.data.enableAutoDispatch).toBe(true);

    const withFalse = getInputSchema().safeParse({ ...BASE_CONFIG, enableAutoDispatch: 'false' });
    expect(withFalse.success).toBe(true);
    if (withFalse.success) expect(withFalse.data.enableAutoDispatch).toBe(false);

    const withAbsent = getInputSchema().safeParse({ ...BASE_CONFIG });
    expect(withAbsent.success).toBe(true);
    if (withAbsent.success) expect(withAbsent.data.enableAutoDispatch).toBe(false);
  });

  // healerWorkflowFile default
  it("healerWorkflowFile defaults to 'playwright-healer.yml'", () => {
    const result = getInputSchema().safeParse({ ...BASE_CONFIG });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.healerWorkflowFile).toBe('playwright-healer.yml');
  });

  // healerWorkflowFile override
  it('healerWorkflowFile accepts a custom value', () => {
    const result = getInputSchema().safeParse({ ...BASE_CONFIG, healerWorkflowFile: 'my-healer.yml' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.healerWorkflowFile).toBe('my-healer.yml');
  });
});
