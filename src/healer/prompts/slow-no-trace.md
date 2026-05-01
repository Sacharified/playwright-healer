# Fix class: slow tests (no trace available — reproduce live via Playwright MCP)

The Playwright trace.zip is missing or expired. Before proposing a fix, you MUST:

1. Use the Playwright MCP browser tools to navigate to `{{BASE_URL}}`.
2. Reproduce the failure path described in `{{TEST_FILE}}` (test title: `{{TEST_TITLE}}`).
3. Identify which step blocks the longest — measure with explicit `console.time` instrumentation if needed.

Use no more than 10 browser tool calls before proposing a fix. If you cannot reproduce the slowness, emit `no-fix-proposable` with the tool-call log as evidence.

Slow-test optimization hierarchy (apply the FIRST that addresses the bottleneck):
1. Remove redundant `await page.goto(...)` / `await page.reload()` calls
2. Replace `expect(...).toBeVisible({ timeout: 30000 })` with a tighter timeout once the actual settle time is measured
3. Use `Promise.all([page.waitForResponse(...), page.click(...)])` to overlap network-bound waits
4. Split a multi-assertion test into focused tests if the wall time is dominated by sequential setup
5. Move expensive setup into `test.beforeAll(...)` if the state can be shared across tests in the file

Forbidden ({{FORBIDDEN_PATTERNS}}):
- `await page.waitForTimeout(<ms>)` — passes locally, flakes in CI under load
- Hard-coded `setTimeout` polling
- Disabling the test's individual timeout via `test.setTimeout(<huge number>)` to mask the slowness — this hides the regression rather than fixing it
- Splitting an assertion bundle just to reduce per-test wall-clock without addressing the underlying slow operation

Constraint: do NOT change `await expect(...).toBeVisible()` calls to `.toBeVisible({ timeout: 60000 })` as a substitute for fixing the slow operation. The diff-lint pass and reviewers detect this pattern.
