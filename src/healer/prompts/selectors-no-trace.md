# Fix class: selectors (no trace available — reproduce live via Playwright MCP)

The Playwright trace.zip is missing or expired. Before proposing a fix, you MUST:

1. Use the Playwright MCP browser tools to navigate to `{{BASE_URL}}`.
2. Reproduce the failure path described in `{{TEST_FILE}}` (test title: `{{TEST_TITLE}}`).
3. Inspect the DOM at the failing step to identify the correct locator.

Use no more than 10 browser tool calls before proposing a fix. If you cannot reproduce the failure, emit `no-fix-proposable` with the tool-call log as evidence.

Selector hierarchy (use the FIRST that resolves uniquely):
1. `page.getByRole('<role>', { name: '<accessible-name>' })` — preferred for buttons, links, form fields
2. `page.getByLabel('<label-text>')` — form fields with explicit labels
3. `page.getByText('<text>', { exact: true })` — for visible text content
4. `page.getByTestId('<id>')` — last resort; requires a `data-testid` in product code

Forbidden ({{FORBIDDEN_PATTERNS}}):
- `:nth-child(...)` and `:nth-of-type(...)` — break when designers add or reorder elements
- Positional XPath (`xpath=//div[3]`, selectors starting with `//`)
- Class selectors based on minified/hashed CSS class names

Constraint: do NOT relax existing assertions while fixing the selector. The diff-lint pass detects `.toBe → .toBeTruthy` and similar weakenings.
