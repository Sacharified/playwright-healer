import { describe, it, expect } from 'vitest';
import { assemblePrompt } from './prompt-assembler.js';

describe('prompt-assembler — D-05/D-06/D-07/D-08, FIX-03, HEA-05', () => {
  const baseArgs = {
    fixClassHint: 'selectors' as const,
    traceAttachmentPath: '/tmp/trace.zip',
    testTitle: 'completes purchase flow',
    testFile: 'tests/checkout.spec.ts',
  };

  it('is deterministic — same inputs produce same output', () => {
    const a = assemblePrompt(baseArgs);
    const b = assemblePrompt(baseArgs);
    expect(a).toBe(b);
  });

  it('selectors variant includes selectors anti-pattern list', () => {
    const out = assemblePrompt({ ...baseArgs, fixClassHint: 'selectors' });
    expect(out).toMatch(/nth-child/);
    expect(out).toMatch(/getByRole/);
  });

  it('waits variant includes wait anti-pattern list', () => {
    const out = assemblePrompt({ ...baseArgs, fixClassHint: 'waits' });
    expect(out).toMatch(/waitForTimeout/);
    expect(out).toMatch(/waitForLoadState/);
  });

  it('fix-class sections are mutually exclusive — selectors prompt does not include waits-only guidance', () => {
    const sel = assemblePrompt({ ...baseArgs, fixClassHint: 'selectors' });
    const waits = assemblePrompt({ ...baseArgs, fixClassHint: 'waits' });
    // Selectors prompt should not contain the waits-class header
    expect(sel).not.toMatch(/Fix class: waits/);
    expect(waits).not.toMatch(/Fix class: selectors/);
  });

  it('trace-free variant instructs live reproduction (HEA-05)', () => {
    const noTrace = assemblePrompt({ ...baseArgs, traceAttachmentPath: null, fixClassHint: 'selectors' });
    expect(noTrace).toMatch(/reproduce/i);
    expect(noTrace).toMatch(/Playwright MCP/i);
  });

  it('always includes sandbox guardrails (T-3-PIT-04 mitigation)', () => {
    const out = assemblePrompt(baseArgs);
    expect(out).toMatch(/untrusted/i);
    expect(out).toMatch(/sandbox/i);
  });

  it('always includes termination rule (T-3-PIT-06 mitigation)', () => {
    const out = assemblePrompt(baseArgs);
    expect(out).toMatch(/10 browser tool calls/);
    expect(out).toMatch(/no-fix-proposable/);
  });

  it('substitutes {{TEST_TITLE}} and {{TEST_FILE}}', () => {
    const out = assemblePrompt({ ...baseArgs, testTitle: 'X-marker', testFile: 'tests/Y-marker.spec.ts' });
    expect(out).toMatch(/X-marker/);
    expect(out).toMatch(/Y-marker/);
    // No raw placeholder strings remain (proves all interpolations matched).
    expect(out).not.toMatch(/\{\{TEST_TITLE\}\}/);
    expect(out).not.toMatch(/\{\{TEST_FILE\}\}/);
  });

  it('substitutes {{FORBIDDEN_PATTERNS}} with comma-separated names from forbidden-patterns.ts', () => {
    const out = assemblePrompt(baseArgs);
    // Source of truth — must include at least these names from FORBIDDEN_PATCHED_LINE_PATTERNS
    expect(out).toMatch(/waitForTimeout/);
    expect(out).toMatch(/nth-child/);
    expect(out).not.toMatch(/\{\{FORBIDDEN_PATTERNS\}\}/);
  });

  it('snapshot — selectors + no-trace variant is stable', () => {
    const out = assemblePrompt({
      fixClassHint: 'selectors',
      traceAttachmentPath: null,
      testTitle: 'snapshot test',
      testFile: 'tests/snap.spec.ts',
    });
    expect(out).toMatchSnapshot();
  });
});
