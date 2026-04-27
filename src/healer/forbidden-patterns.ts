// src/healer/forbidden-patterns.ts
//
// SINGLE SOURCE OF TRUTH for diff-lint AND agent system-prompt forbidden-pattern
// list (CONTEXT D-17). Two consumers:
//   1. src/healer/diff-lint.ts — runtime regex check on patched lines
//   2. src/healer/prompt-assembler.ts — textual injection into agent system prompt
//      (defense in depth — agent forbidden at input layer; lint enforces at output)
//
// DO NOT inline these patterns elsewhere. Inline literals like `'waitForTimeout'`
// or `/:nth-child/` outside this file divergence drift between prompt and lint.

export const FORBIDDEN_PATCHED_LINE_PATTERNS = Object.freeze([
  { name: 'waitForTimeout', re: /\bwaitForTimeout\s*\(/ },
  { name: 'nth-child',      re: /:nth-child\s*\(/ },
  { name: 'nth-of-type',    re: /:nth-of-type\s*\(/ },
  { name: 'xpath-equals',   re: /xpath\s*=/ },
  // Matches // only when it appears as the start of a string literal argument to a
  // Playwright selector call. This avoids false-positives on TypeScript // comments
  // while still catching page.locator('//div'), waitForSelector('//button'), getByText('//...').
  // The locator-anchored form is chosen over bare /['"`]\/\// to avoid firing on
  // page.goto('//cdn.example.com') and similar URL patterns. (D-16 / HI-02)
  { name: 'xpath-prefix',   re: /(?:locator|waitForSelector|getBy\w+)\s*\(\s*['"`]\/\// },
] as const);

export const ASSERTION_WEAKENING_PAIRS = Object.freeze([
  { from: /\.toBe\s*\(/, to: /\.toBeTruthy\s*\(/ },
  { from: /\.toBe\s*\(/, to: /\.toBeFalsy\s*\(/ },
  { from: /\.toEqual\s*\(/, to: /\.toContain\s*\(/ },
] as const);

export const TEST_PATH_ALLOWLIST = Object.freeze([
  /^tests\//,
  /^e2e\//,
  /^playwright\//,
] as const);
