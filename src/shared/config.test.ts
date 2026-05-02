import { describe, it, expect } from 'vitest';
import { getInputSchema } from './config.js';

// Minimal valid base inputs required for all config parse tests.
// apiKey present (non-empty) so the existing provider superRefine doesn't
// fire on cases that only test Phase 05 fields.
const BASE = {
  mode: 'heal',
  healerToken: 'tok-x',
  githubToken: 'ghtok-y',
  apiKey: 'apikey-z',
};

// ── Phase 05 — enable_auto_merge field ────────────────────────────────────────

describe('config — Phase 05 enable_auto_merge', () => {
  it('Test 1: defaults to false when INPUT_ENABLE_AUTO_MERGE is absent', () => {
    const parsed = getInputSchema().parse(BASE);
    expect(parsed.enableAutoMerge).toBe(false);
  });

  it("Test 2: 'true' string transforms to true", () => {
    const parsed = getInputSchema().parse({ ...BASE, enableAutoMerge: 'true' });
    expect(parsed.enableAutoMerge).toBe(true);
  });

  it("Test 3: 'false' string transforms to false", () => {
    const parsed = getInputSchema().parse({ ...BASE, enableAutoMerge: 'false' });
    expect(parsed.enableAutoMerge).toBe(false);
  });

  it("Test 4: truthy string 'yes' transforms to false (strict === 'true' only)", () => {
    const parsed = getInputSchema().parse({ ...BASE, enableAutoMerge: 'yes' });
    expect(parsed.enableAutoMerge).toBe(false);
  });
});

// ── Phase 05 — auto_merge_pass_rate field ─────────────────────────────────────

describe('config — Phase 05 auto_merge_pass_rate', () => {
  it('Test 5: defaults to 1.0 when absent', () => {
    const parsed = getInputSchema().parse(BASE);
    expect(parsed.autoMergePassRate).toBe(1.0);
  });

  it("Test 6: '0.9' string coerces to 0.9", () => {
    const parsed = getInputSchema().parse({ ...BASE, autoMergePassRate: '0.9' });
    expect(parsed.autoMergePassRate).toBe(0.9);
  });

  it('Test 7: value > 1 (1.5) fails parse with issue at autoMergePassRate', () => {
    const result = getInputSchema().safeParse({ ...BASE, autoMergePassRate: '1.5' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('autoMergePassRate');
    }
  });

  it('Test 8: negative value (-0.1) fails parse', () => {
    const result = getInputSchema().safeParse({ ...BASE, autoMergePassRate: '-0.1' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('autoMergePassRate');
    }
  });

  it("Test 9: non-numeric string 'banana' fails with message about valid number", () => {
    const result = getInputSchema().safeParse({ ...BASE, autoMergePassRate: 'banana' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('auto_merge_pass_rate must be a valid number'))).toBe(true);
    }
  });
});

// ── Phase 05 — auto_merge_fix_classes field + superRefine misconfig guard ─────

describe('config — Phase 05 auto_merge_fix_classes + superRefine', () => {
  it("Test 10: defaults to 'selectors' when absent", () => {
    const parsed = getInputSchema().parse(BASE);
    expect(parsed.autoMergeFixClasses).toBe('selectors');
  });

  it("Test 11: comma-string 'selectors,waits' passes through as string", () => {
    const parsed = getInputSchema().parse({ ...BASE, autoMergeFixClasses: 'selectors,waits' });
    expect(parsed.autoMergeFixClasses).toBe('selectors,waits');
  });

  it('Test 12: enable_auto_merge=true with empty autoMergeFixClasses fails with issue at autoMergeFixClasses', () => {
    const result = getInputSchema().safeParse({
      ...BASE,
      enableAutoMerge: 'true',
      autoMergeFixClasses: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'autoMergeFixClasses');
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('auto_merge_fix_classes must contain at least one class');
    }
  });

  it('Test 13: enable_auto_merge=true with whitespace-only allow-list fails', () => {
    const result = getInputSchema().safeParse({
      ...BASE,
      enableAutoMerge: 'true',
      autoMergeFixClasses: ' , ',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'autoMergeFixClasses');
      expect(issue).toBeDefined();
    }
  });

  it('Test 14: enable_auto_merge=false with empty autoMergeFixClasses succeeds (gate never invoked)', () => {
    const result = getInputSchema().safeParse({
      ...BASE,
      enableAutoMerge: 'false',
      autoMergeFixClasses: '',
    });
    expect(result.success).toBe(true);
  });
});

// ── Phase 05 — regression: existing apiKey superRefine still fires ─────────────

describe('config — Phase 05 no-regression: apiKey superRefine', () => {
  it('Test 15: provider !== ollama AND apiKey empty still emits issue at apiKey path', () => {
    const result = getInputSchema().safeParse({
      mode: 'heal',
      healerToken: 'tok-x',
      githubToken: 'ghtok-y',
      apiKey: '',
      provider: 'anthropic',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'apiKey');
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('api_key is required');
    }
  });
});
