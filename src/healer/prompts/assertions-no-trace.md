# Fix class: assertions (no trace available — reproduce live via Playwright MCP)

The Playwright trace.zip is missing or expired. Before proposing a fix, you MUST:

1. Use the Playwright MCP browser tools to navigate to `{{BASE_URL}}`.
2. Reproduce the failure path described in `{{TEST_FILE}}` (test title: `{{TEST_TITLE}}`).
3. Inspect the actual rendered state at the failing assertion to identify the correct expected value.

Use no more than 10 browser tool calls before proposing a fix. If you cannot reproduce the failure, emit `no-fix-proposable` with the tool-call log as evidence.

Assertion strengthening hierarchy (use the FIRST that captures the intent precisely):
1. `await expect(locator).toHaveText('<exact text>')` — preferred for visible text content
2. `await expect(locator).toHaveValue('<value>')` — for form fields
3. `await expect(locator).toBeVisible()` / `.toBeHidden()` / `.toBeEnabled()` — for state assertions
4. `await expect(locator).toHaveAttribute('<attr>', '<value>')` — for ARIA / data-*

Forbidden ({{FORBIDDEN_PATTERNS}}):
- Weakening assertions: `.toBe → .toBeTruthy`, `.toEqual({a:1, b:2}) → .toEqual(expect.objectContaining({a:1}))`, `.toHaveText → .toContainText` (only loosen if the actual rendered text is non-deterministic, NOT to make a wrong assertion pass)
- Removing assertions entirely without replacing them with a stronger one
- Wrapping assertions in `try/catch` to swallow failures

Constraint: the fix MUST CORRECT the assertion to match the actual rendered state, not loosen the existing assertion to silence the failure. The diff-lint pass detects assertion weakening and will reject patches that take the easy path.
