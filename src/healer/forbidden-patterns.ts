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
  // Playwright selector-string API. Anchored to locator and waitForSelector — the
  // only Playwright APIs whose first string argument is interpreted as a selector
  // (where // is XPath syntax). The getBy* family (getByText, getByRole, getByLabel,
  // etc.) takes literal text/role/label arguments — // there is just two slash
  // characters, not XPath, so flagging is a false positive (WR-01). page.goto takes
  // a URL, not a selector, so URLs like '//cdn.example.com' are also unaffected.
  // (D-16 / HI-02 / WR-01)
  { name: 'xpath-prefix',   re: /(?:locator|waitForSelector)\s*\(\s*['"`]\/\// },
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
