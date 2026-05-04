import { describe, it, expect } from 'vitest';
import { assemblePrompt } from './prompt-assembler.js';

describe('prompt-assembler — D-05/D-06/D-07/D-08, FIX-03, HEA-05', () => {
  const baseArgs = {
    fixClassHint: 'selectors' as const,
    traceAttachmentPath: '/tmp/trace.zip',
    testTitle: 'completes purchase flow',
    testFile: 'tests/checkout.spec.ts',
    baseUrl: 'http://localhost:3000',
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
      baseUrl: 'http://localhost:3000',
    });
    expect(out).toMatchSnapshot();
  });

  it('interpolates {{BASE_URL}} into selectors-no-trace template', () => {
    const result = assemblePrompt({
      fixClassHint: 'selectors',
      traceAttachmentPath: null,
      testTitle: 'should click button',
      testFile: 'tests/example.spec.ts',
      baseUrl: 'http://localhost:3000',
    });
    expect(result).toContain('http://localhost:3000');
    expect(result).not.toContain('{{BASE_URL}}');
  });

  it('replaces {{BASE_URL}} with empty string when baseUrl is empty', () => {
    const result = assemblePrompt({
      fixClassHint: 'selectors',
      traceAttachmentPath: null,
      testTitle: 'should click button',
      testFile: 'tests/example.spec.ts',
      baseUrl: '',
    });
    // No literal placeholder leaks through even when value is empty.
    expect(result).not.toContain('{{BASE_URL}}');
  });
});

describe('prompt-assembler — FIX-07 new fix class templates (assertions + slow)', () => {
  const baseArgs = {
    testTitle: 't',
    testFile: 'f.spec.ts',
    baseUrl: 'http://x',
  };

  // Test 1: assertions + no-trace
  it('assertions no-trace: contains assertion strengthening guidance', () => {
    const out = assemblePrompt({ ...baseArgs, fixClassHint: 'assertions', traceAttachmentPath: null });
    expect(out.toLowerCase()).toMatch(/assertion strengthening hierarchy/i);
  });

  // Test 2: assertions + with-trace
  it('assertions with-trace: contains assertion strengthening guidance (different from no-trace)', () => {
    const withTrace = assemblePrompt({ ...baseArgs, fixClassHint: 'assertions', traceAttachmentPath: '/tmp/trace.zip' });
    const noTrace   = assemblePrompt({ ...baseArgs, fixClassHint: 'assertions', traceAttachmentPath: null });
    expect(withTrace.toLowerCase()).toMatch(/assertion strengthening hierarchy/i);
    expect(withTrace).not.toBe(noTrace); // with-trace is a different template
  });

  // Test 3: slow + no-trace
  it('slow no-trace: contains slow-test optimization guidance', () => {
    const out = assemblePrompt({ ...baseArgs, fixClassHint: 'slow', traceAttachmentPath: null });
    expect(out.toLowerCase()).toMatch(/slow-test optimization hierarchy/i);
  });

  // Test 4: slow + with-trace
  it('slow with-trace: contains slow-test optimization guidance', () => {
    const out = assemblePrompt({ ...baseArgs, fixClassHint: 'slow', traceAttachmentPath: '/tmp/trace.zip' });
    expect(out.toLowerCase()).toMatch(/slow-test optimization hierarchy/i);
  });

  // Test 5: no leftover {{ in any of the four new templates
  it('all four new templates interpolate all placeholders (no leftover {{)', () => {
    const combos: Array<{ fixClassHint: 'assertions' | 'slow'; traceAttachmentPath: string | null }> = [
      { fixClassHint: 'assertions', traceAttachmentPath: null },
      { fixClassHint: 'assertions', traceAttachmentPath: '/tmp/trace.zip' },
      { fixClassHint: 'slow',       traceAttachmentPath: null },
      { fixClassHint: 'slow',       traceAttachmentPath: '/tmp/trace.zip' },
    ];
    for (const combo of combos) {
      const out = assemblePrompt({ ...baseArgs, ...combo });
      expect(out, `leftover {{ in ${combo.fixClassHint}-${combo.traceAttachmentPath ? 'with-trace' : 'no-trace'}`).not.toMatch(/\{\{/);
    }
  });

  // Test 6: each new template contains the Forbidden stanza (defense-in-depth)
  it('all four new templates contain Forbidden stanza with interpolated FORBIDDEN_PATTERNS', () => {
    const combos: Array<{ fixClassHint: 'assertions' | 'slow'; traceAttachmentPath: string | null }> = [
      { fixClassHint: 'assertions', traceAttachmentPath: null },
      { fixClassHint: 'assertions', traceAttachmentPath: '/tmp/trace.zip' },
      { fixClassHint: 'slow',       traceAttachmentPath: null },
      { fixClassHint: 'slow',       traceAttachmentPath: '/tmp/trace.zip' },
    ];
    for (const combo of combos) {
      const out = assemblePrompt({ ...baseArgs, ...combo });
      // The Forbidden stanza must be present and the {{FORBIDDEN_PATTERNS}} interpolated
      expect(out, `missing Forbidden stanza in ${combo.fixClassHint}`).toMatch(/Forbidden/);
      expect(out, `leftover FORBIDDEN_PATTERNS placeholder`).not.toContain('{{FORBIDDEN_PATTERNS}}');
    }
  });

  // Snapshots for the two no-trace variants (extend the existing snapshot file)
  it('snapshot — assertions + no-trace variant is stable', () => {
    const out = assemblePrompt({
      fixClassHint: 'assertions',
      traceAttachmentPath: null,
      testTitle: 'snapshot test',
      testFile: 'tests/snap.spec.ts',
      baseUrl: 'http://localhost:3000',
    });
    expect(out).toMatchSnapshot();
  });

  it('snapshot — slow + no-trace variant is stable', () => {
    const out = assemblePrompt({
      fixClassHint: 'slow',
      traceAttachmentPath: null,
      testTitle: 'snapshot test',
      testFile: 'tests/snap.spec.ts',
      baseUrl: 'http://localhost:3000',
    });
    expect(out).toMatchSnapshot();
  });
});
