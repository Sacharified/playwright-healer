# Output format

Emit exactly one JSON object as your final response (no surrounding prose):

```json
{
  "rootCause": "<one-sentence explanation of why the test fails>",
  "fixClass": "selectors" | "waits" | "assertions" | "slow",
  "diff": "<unified-diff format, scoped to the failing test file>",
  "rationale": "<one-paragraph explanation of why this fix is correct and stable>"
}
```

If you cannot fix the test (insufficient context, ambiguous failure, or out-of-scope cause), emit instead:

```json
{
  "reason": "no-fix-proposable",
  "evidence": "<text excerpt: tool calls performed, observations, why no fix applies>"
}
```

The `diff` field must be a valid unified diff applied via `git apply --3way`. The diff may modify the failing test file. The diff may NOT modify any file outside the test directory.

The diff MUST follow this exact structure — `git apply` rejects deviations:

```
diff --git a/tests/example.spec.ts b/tests/example.spec.ts
--- a/tests/example.spec.ts
+++ b/tests/example.spec.ts
@@ -9,5 +9,5 @@
 test('something', async ({ page }) => {
   await page.goto('/');
-  await page.locator('#wrong-id').click();
+  await page.getByRole('button', { name: 'Submit' }).click();
   await expect(page.locator('#message')).toHaveText('Submitted!');
 });
```

Hunk-header rules (the most common failure mode):
- The header is `@@ -L,N +M,K @@` where:
  - `L` is the 1-indexed start line in the OLD file
  - `N` is the EXACT count of body lines starting with `-` or ` ` (space, context)
  - `M` is the 1-indexed start line in the NEW file
  - `K` is the EXACT count of body lines starting with `+` or ` ` (space, context)
- Do NOT use placeholders like `@@ ... @@`. Compute the numbers.
- A 5-minus / 5-plus hunk replacing lines 9–13 has header `@@ -9,5 +9,5 @@` — not `@@ -9,7 +9,11 @@`.
- Include at least one line of unchanged context (` ` prefix) above and below the change when possible — context lines help `git apply --3way` succeed.
