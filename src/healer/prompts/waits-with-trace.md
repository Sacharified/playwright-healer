# Fix class: waits / timing (trace available)

Hint from threshold evaluator: this test fails due to a timing or load-order issue.

Use the trace to identify which step is racing. Common causes:
- Action invoked before the target element is interactable
- Assertion checked before async data has loaded
- Navigation completing earlier or later than the test assumes

Replace any sleep-based wait with deterministic conditions:
1. `await locator.waitForSelector({ state: 'visible' })` — wait for an element
2. `await page.waitForLoadState('networkidle')` — wait for navigation/XHR settle
3. `await expect(locator).toBeVisible({ timeout: <ms> })` — assertion with built-in retry
4. `await page.waitForResponse(response => response.url().includes('/api/x'))` — wait for a specific request

Forbidden ({{FORBIDDEN_PATTERNS}}):
- `await page.waitForTimeout(<ms>)` — passes on dev machine, flakes in CI under load
- Hard-coded delays of any form (`setTimeout`-based polling, `sleep`)

Constraint: do NOT relax existing assertions while fixing the wait. The diff-lint pass detects assertion weakening.
