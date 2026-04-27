# Output format

Emit exactly one JSON object as your final response (no surrounding prose):

```json
{
  "rootCause": "<one-sentence explanation of why the test fails>",
  "fixClass": "selectors" | "waits",
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
