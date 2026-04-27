# Fix class: waits / timing (no trace available — reproduce live via Playwright MCP)

The Playwright trace.zip is missing or expired. Before proposing a fix, you MUST:

1. Use the Playwright MCP browser tools to navigate to the application's base URL.
2. Reproduce the failure path described in `{{TEST_FILE}}` (test title: `{{TEST_TITLE}}`).
3. Observe the timing issue live — identify which step races or loads too slowly.

Use no more than 10 browser tool calls before proposing a fix. If you cannot reproduce the failure, emit `no-fix-proposable` with the tool-call log as evidence.

Replace any sleep-based wait with deterministic conditions:
1. `await locator.waitForSelector({ state: 'visible' })` — wait for an element
2. `await page.waitForLoadState('networkidle')` — wait for navigation/XHR settle
3. `await expect(locator).toBeVisible({ timeout: <ms> })` — assertion with built-in retry
4. `await page.waitForResponse(response => response.url().includes('/api/x'))` — wait for a specific request

Forbidden ({{FORBIDDEN_PATTERNS}}):
- `await page.waitForTimeout(<ms>)` — passes on dev machine, flakes in CI under load
- Hard-coded delays of any form (`setTimeout`-based polling, `sleep`)

Constraint: do NOT relax existing assertions while fixing the wait. The diff-lint pass detects assertion weakening.
