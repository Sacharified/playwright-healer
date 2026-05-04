# Fix class: slow tests (trace available — primary evidence source)

A Playwright trace.zip is available at the trace path passed to your tooling. Before proposing a fix:

1. Inspect the trace's network and action timeline to identify the dominant wall-clock contributor.
2. Cross-reference with `{{TEST_FILE}}` (test title: `{{TEST_TITLE}}`) to map trace step → test source line.
3. Decide whether the bottleneck is: (a) test-side (redundant goto, sequential awaits) → fix; (b) app-side (slow API, hydration race) → emit `no-fix-proposable` so it routes to issue-fallback (logic-bug territory).

If the trace is inconclusive, you MAY reproduce live at `{{BASE_URL}}` with no more than 5 Playwright MCP calls.

Slow-test optimization hierarchy (apply the FIRST that addresses the trace-identified bottleneck):
1. Remove redundant `await page.goto(...)` / `await page.reload()` calls
2. Use `Promise.all([page.waitForResponse(...), page.click(...)])` to overlap network-bound waits
3. Replace overly generous `{ timeout: ... }` with the trace-measured value plus 50% margin
4. Move expensive setup into `test.beforeAll(...)` if state is shareable

Forbidden ({{FORBIDDEN_PATTERNS}}):
- `await page.waitForTimeout(<ms>)`
- `test.setTimeout(<huge>)` to mask slowness
- Splitting an assertion bundle just to reduce per-test wall-clock

Constraint: the fix MUST address the bottleneck the trace identifies, not work around it by extending timeouts.
