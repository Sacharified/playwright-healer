# Fix class: assertions (trace available — primary evidence source)

A Playwright trace.zip is available at the trace path passed to your tooling. Before proposing a fix:

1. Inspect the trace's failing assertion frame to see the actual rendered DOM/text/value at the moment of failure.
2. Compare with the assertion's expected value in `{{TEST_FILE}}` (test title: `{{TEST_TITLE}}`).
3. Decide whether the assertion expected value is wrong (→ correct it) or whether the test is racing (→ this should have classified as `waits`, emit no-fix-proposable so it routes correctly).

If the trace is incomplete or contradictory, you MAY use the Playwright MCP to reproduce live at `{{BASE_URL}}` (no more than 5 tool calls before proposing).

Assertion strengthening hierarchy (use the FIRST that captures the intent precisely):
1. `await expect(locator).toHaveText('<exact text>')` — preferred for visible text content
2. `await expect(locator).toHaveValue('<value>')` — for form fields
3. `await expect(locator).toBeVisible()` / `.toBeHidden()` / `.toBeEnabled()` — for state assertions
4. `await expect(locator).toHaveAttribute('<attr>', '<value>')` — for ARIA / data-*

Forbidden ({{FORBIDDEN_PATTERNS}}):
- Weakening assertions: `.toBe → .toBeTruthy`, `.toHaveText → .toContainText` (only loosen if rendered text is non-deterministic)
- Removing assertions entirely without replacing them with a stronger one

Constraint: the fix MUST CORRECT the assertion to match actual state, not loosen it. The diff-lint pass detects assertion weakening.
