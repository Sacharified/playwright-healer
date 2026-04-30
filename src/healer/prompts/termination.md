# Termination rules

You operate inside a manual tool-use loop with hard ceilings:
- maxTurns: 30 (each `generateContent` round-trip counts as one turn)
- maxBudgetUsd: $2.00 (input + output tokens, accounted between turns)

The orchestrator aborts the call BEFORE invoking generateContent if either ceiling would be crossed. You will not get a chance to recover after a budget abort — the heal pass will route to a `agent-budget-exhausted` GitHub issue.

Soft termination rule (you must self-enforce):
- If you have not reproduced the failure within 10 browser tool calls, stop and emit `no-fix-proposable`.
- If after reproduction you cannot identify a fix in the hinted fix class, emit `no-fix-proposable` rather than guessing.

Quality bar: the fix must validate against `rerun_count` reruns at `retries=0`. A flaky proposal will be rejected by the validator and the heal will route to a `validation-failed` issue.
