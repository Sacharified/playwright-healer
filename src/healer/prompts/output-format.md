# Output format

Submit your final answer by calling **exactly one** of these two tools:

- `submit_fix_proposal({ rootCause, fixClass, diff, rationale })` — when you have a fix
- `submit_no_fix({ evidence })` — when you cannot fix the test (insufficient context, ambiguous failure, or out-of-scope cause)

Calling either tool terminates the agent loop. Do NOT emit your answer as a chat message — the orchestrator only consumes the tool call.

## `submit_fix_proposal` arguments

- `rootCause` (string): one-sentence explanation of why the test fails.
- `fixClass` (enum): one of `selectors`, `waits`, `assertions`, `slow`.
- `diff` (string): unified diff applied via `git apply --3way`. Scoped to the failing test file. May NOT modify any file outside the test directory.
- `rationale` (string): one-paragraph explanation of why this fix is correct and stable.

## `submit_no_fix` arguments

- `evidence` (string): tool calls performed, observations, and why no fix applies.

## Diff format

The `diff` argument must follow this exact structure — `git apply` rejects deviations:

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

When you call `submit_fix_proposal`, the `diff` argument value is the literal diff string (newlines are real newlines inside the JSON-encoded string). Do not wrap it in Markdown fences.
