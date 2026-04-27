# Fix class: selectors (trace available)

Hint from threshold evaluator: this test fails due to a brittle or incorrect locator.

A Playwright trace.zip is attached at the path provided in your context. Use it to identify exactly which `page.locator(...)` / `getBy*(...)` call resolved to zero or wrong elements at the failing assertion.

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
