// src/ingest/classifier.ts
// FIX-07: maps a Playwright errorSignature shape to a fixClassHint enum value.
// Pure function — no I/O, no global state. Treats the input as untrusted (T-04-04):
// regex `.test()` only; never `eval`, `new Function`, or `RegExp(input)`.
//
// Substring rules per RESEARCH §"FIX-07 Architecture":
//   `Test timeout of` / `Test timed out`            → 'slow'
//   `expect(received)` / `Expected:.Received:` / `assertion` → 'assertions'
//   `Element is not stable` / `intercepted`          → 'waits'
//   `locator.` / `waiting for locator` / `Target closed` → 'selectors'
//   anything else                                    → 'selectors' (fallback — most common)
//
// ORDER MATTERS: 'slow' is checked before 'assertions' because some Playwright
// timeout messages also contain `expect(...)` substrings; the timeout signal is
// the primary actionable hint.

export type FixClassHint = 'selectors' | 'waits' | 'assertions' | 'slow';

// All regexes are static module-scope literals — the input never reaches
// the RegExp constructor (T-04-04 mitigation).
const SLOW_RE       = /Test timeout of|Test timed out/i;
const ASSERTIONS_RE = /expect\(received\)|Expected:[\s\S]*Received:|assertion/i;
const WAITS_RE      = /Element is not stable|intercepted/i;
const SELECTORS_RE  = /locator\.|waiting for locator|Target closed/i;

/**
 * Classify a Playwright `errorSignature` string into one of four fix-class hints.
 *
 * Security: the input is treated as untrusted. Only static regex `.test()` calls
 * are used — no dynamic `RegExp` construction, no `eval`, no `new Function`.
 * Worst case for a crafted input: misclassification → `selectors` fallback →
 * agent emits `no-fix-proposable` → routes to issue-fallback. Acceptable degradation.
 */
export function classifyFixClass(errorSignature: string): FixClassHint {
  if (SLOW_RE.test(errorSignature))       return 'slow';
  if (ASSERTIONS_RE.test(errorSignature)) return 'assertions';
  if (WAITS_RE.test(errorSignature))      return 'waits';
  if (SELECTORS_RE.test(errorSignature))  return 'selectors';
  return 'selectors'; // defensive fallback — most common class
}
